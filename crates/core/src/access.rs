//! Access computations: ground-station passes and imaging opportunities.

use crate::frames::{ecef_to_teme, look_angles, teme_to_ecef, Geodetic};
use crate::orbit::Satellite;
use crate::sensor::{body_axes, off_nadir_angle, Fov, Sensor};
use crate::sun::sun_elevation;
use crate::time::{add_secs, secs_between, Epoch};
use serde::{Deserialize, Serialize};

/// Generic interval finder: samples `f` every `step_s` and refines each
/// transition to ~0.5 s by bisection.
pub fn find_intervals(start: Epoch, end: Epoch, step_s: f64, f: impl Fn(Epoch) -> bool) -> Vec<(Epoch, Epoch)> {
    let total = secs_between(start, end);
    if !(total > 0.0) {
        return Vec::new();
    }
    let refine = |mut a: Epoch, mut b: Epoch, a_val: bool| {
        while secs_between(a, b) > 0.5 {
            let m = add_secs(a, secs_between(a, b) / 2.0);
            if f(m) == a_val { a = m } else { b = m }
        }
        if a_val { a } else { b }
    };
    let mut out = Vec::new();
    let mut prev_t = start;
    let mut prev = f(start);
    let mut open: Option<Epoch> = if prev { Some(start) } else { None };
    let mut s = step_s;
    loop {
        let t = if s >= total { end } else { add_secs(start, s) };
        let cur = f(t);
        if cur != prev {
            let edge = refine(prev_t, t, prev);
            if cur {
                open = Some(edge);
            } else if let Some(o) = open.take() {
                out.push((o, edge));
            }
        }
        prev = cur;
        prev_t = t;
        if s >= total {
            break;
        }
        s += step_s;
    }
    if let Some(o) = open {
        out.push((o, end));
    }
    out
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Pass {
    pub start: Epoch,
    pub end: Epoch,
    pub max_el_deg: f64,
    pub max_el_time: Epoch,
}

impl Pass {
    pub fn duration_s(&self) -> f64 {
        secs_between(self.start, self.end)
    }
}

/// Passes of `sat` over a ground station above `min_el_deg`.
pub fn station_passes(sat: &Satellite, site: Geodetic, min_el_deg: f64, start: Epoch, end: Epoch) -> Vec<Pass> {
    let el = |t: Epoch| -> f64 {
        sat.state(t)
            .map(|s| look_angles(site, teme_to_ecef(s.r, t)).el_deg)
            .unwrap_or(-90.0)
    };
    find_intervals(start, end, 20.0, |t| el(t) >= min_el_deg)
        .into_iter()
        .map(|(a, b)| {
            let (mut best_t, mut best) = (a, el(a));
            let n = (secs_between(a, b) / 5.0).ceil().max(1.0) as usize;
            for i in 0..=n {
                let t = add_secs(a, secs_between(a, b) * i as f64 / n as f64);
                let e = el(t);
                if e > best {
                    best = e;
                    best_t = t;
                }
            }
            Pass { start: a, end: b, max_el_deg: best, max_el_time: best_t }
        })
        .collect()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImagingWindow {
    pub start: Epoch,
    pub end: Epoch,
    /// Smallest off-nadir angle reached in the window [deg]
    pub min_off_nadir_deg: f64,
    pub best_time: Epoch,
    /// Solar elevation at the target at `best_time` [deg]
    pub sun_el_deg: f64,
}

/// Times when `target` can be imaged: off-nadir angle within the agility limit
/// and the target sunlit enough (`min_sun_el_deg`, use -90 for SAR/night).
pub fn imaging_opportunities(
    sat: &Satellite,
    target: Geodetic,
    max_off_nadir_deg: f64,
    min_sun_el_deg: f64,
    start: Epoch,
    end: Epoch,
) -> Vec<ImagingWindow> {
    let target_ecef = target.to_ecef();
    let off = |t: Epoch| -> Option<f64> {
        let s = sat.state(t)?;
        let tgt = ecef_to_teme(target_ecef, t);
        // target must be on the visible side of the Earth
        if look_angles(target, teme_to_ecef(s.r, t)).el_deg <= 0.0 {
            return None;
        }
        Some(off_nadir_angle(&s, tgt))
    };
    find_intervals(start, end, 10.0, |t| {
        off(t).is_some_and(|a| a <= max_off_nadir_deg) && sun_elevation(target, t) >= min_sun_el_deg
    })
    .into_iter()
    .map(|(a, b)| {
        let (mut best_t, mut best) = (a, f64::MAX);
        let n = (secs_between(a, b) / 2.0).ceil().max(1.0) as usize;
        for i in 0..=n {
            let t = add_secs(a, secs_between(a, b) * i as f64 / n as f64);
            if let Some(o) = off(t) {
                if o < best {
                    best = o;
                    best_t = t;
                }
            }
        }
        ImagingWindow { start: a, end: b, min_off_nadir_deg: best, best_time: best_t, sun_el_deg: sun_elevation(target, best_t) }
    })
    .collect()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GridCellCoverage {
    pub lat: f64,
    pub lon: f64,
    pub covered: bool,
    pub hit_count: u32,
    pub first_hit_epoch: Option<Epoch>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AreaCoverageResult {
    pub total_cells: usize,
    pub covered_cells: usize,
    pub coverage_percent: f64,
    pub cells: Vec<GridCellCoverage>,
}

/// Ray-casting point-in-polygon check on (lat, lon).
fn point_in_polygon(lat: f64, lon: f64, poly: &[(f64, f64)]) -> bool {
    if poly.len() < 3 {
        return false;
    }
    let mut inside = false;
    let mut j = poly.len() - 1;
    for i in 0..poly.len() {
        let (yi, xi) = poly[i];
        let (yj, xj) = poly[j];
        let intersect = ((yi > lat) != (yj > lat))
            && (lon < (xj - xi) * (lat - yi) / ((yj - yi) + 1e-15) + xi);
        if intersect {
            inside = !inside;
        }
        j = i;
    }
    inside
}

/// Compute multi-pass coverage of a polygon area target `polygon_lat_lon`
/// by a satellite + sensor between `start` and `end`.
pub fn area_target_coverage(
    sat: &Satellite,
    sensor: &Sensor,
    polygon_lat_lon: &[(f64, f64)],
    grid_res_deg: f64,
    min_sun_el_deg: f64,
    start: Epoch,
    end: Epoch,
) -> AreaCoverageResult {
    if polygon_lat_lon.len() < 3 {
        return AreaCoverageResult {
            total_cells: 0,
            covered_cells: 0,
            coverage_percent: 0.0,
            cells: Vec::new(),
        };
    }
    let min_lat = polygon_lat_lon.iter().map(|p| p.0).fold(f64::INFINITY, f64::min);
    let max_lat = polygon_lat_lon.iter().map(|p| p.0).fold(f64::NEG_INFINITY, f64::max);
    let min_lon = polygon_lat_lon.iter().map(|p| p.1).fold(f64::INFINITY, f64::min);
    let max_lon = polygon_lat_lon.iter().map(|p| p.1).fold(f64::NEG_INFINITY, f64::max);

    let step = grid_res_deg.max(0.1);
    let mut cells = Vec::new();
    let mut lat = min_lat + step * 0.5;
    while lat <= max_lat {
        let mut lon = min_lon + step * 0.5;
        while lon <= max_lon {
            if point_in_polygon(lat, lon, polygon_lat_lon) {
                cells.push(GridCellCoverage {
                    lat,
                    lon,
                    covered: false,
                    hit_count: 0,
                    first_hit_epoch: None,
                });
            }
            lon += step;
        }
        lat += step;
    }
    // Fallback to vertices + centroid if polygon is smaller than grid step
    if cells.is_empty() {
        let c_lat = polygon_lat_lon.iter().map(|p| p.0).sum::<f64>() / polygon_lat_lon.len() as f64;
        let c_lon = polygon_lat_lon.iter().map(|p| p.1).sum::<f64>() / polygon_lat_lon.len() as f64;
        cells.push(GridCellCoverage {
            lat: c_lat,
            lon: c_lon,
            covered: false,
            hit_count: 0,
            first_hit_epoch: None,
        });
    }

    let cell_ecefs: Vec<_> = cells
        .iter()
        .map(|c| (Geodetic::new(c.lat, c.lon, 0.0), Geodetic::new(c.lat, c.lon, 0.0).to_ecef()))
        .collect();

    let cross_half_rad = match sensor.fov {
        Fov::Conic { half_angle_deg } => half_angle_deg.to_radians(),
        Fov::Rectangular { cross_half_deg, .. } => cross_half_deg.to_radians(),
    };
    let along_half_rad = match sensor.fov {
        Fov::Conic { half_angle_deg } => half_angle_deg.to_radians().max(0.035),
        Fov::Rectangular { along_half_deg, .. } => along_half_deg.to_radians().max(0.035),
    };
    let roll_rad = sensor.roll_deg.to_radians();
    let pitch_rad = sensor.pitch_deg.to_radians();

    let total_s = secs_between(start, end);
    let dt = 8.0; // 8-second sampling step
    let mut s_sec = 0.0;
    while s_sec <= total_s {
        let t = add_secs(start, s_sec);
        if let Some(st) = sat.state(t) {
            let axes = body_axes(&st);
            for (idx, (geo, ecef)) in cell_ecefs.iter().enumerate() {
                if sun_elevation(*geo, t) < min_sun_el_deg {
                    continue;
                }
                let tgt_teme = ecef_to_teme(*ecef, t);
                let u = (tgt_teme - st.r).normalize();
                let bz = u.dot(axes.z);
                if bz <= 0.15 {
                    continue;
                }
                let bx = u.dot(axes.x);
                let by = u.dot(axes.y);
                let tgt_roll = by.clamp(-1.0, 1.0).asin();
                let tgt_pitch = bx.atan2(bz);
                if (tgt_roll - roll_rad).abs() <= cross_half_rad
                    && (tgt_pitch - pitch_rad).abs() <= along_half_rad
                {
                    let c = &mut cells[idx];
                    c.covered = true;
                    c.hit_count += 1;
                    if c.first_hit_epoch.is_none() {
                        c.first_hit_epoch = Some(t);
                    }
                }
            }
        }
        s_sec += dt;
    }

    let covered_cells = cells.iter().filter(|c| c.covered).count();
    let total_cells = cells.len();
    let coverage_percent = if total_cells > 0 {
        (covered_cells as f64 / total_cells as f64) * 100.0
    } else {
        0.0
    };

    AreaCoverageResult {
        total_cells,
        covered_cells,
        coverage_percent,
        cells,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::orbit::{raan_for_ltan, sun_sync_inclination, Keplerian};
    use chrono::{TimeZone, Utc};

    fn eo_sat(t0: Epoch) -> Satellite {
        Satellite::from_keplerian(
            "EO",
            t0,
            Keplerian {
                altitude_km: 786.0,
                eccentricity: 0.0,
                inclination_deg: sun_sync_inclination(786.0),
                raan_deg: raan_for_ltan(t0, 22.5),
                arg_perigee_deg: 0.0,
                mean_anomaly_deg: 0.0,
            },
        )
        .unwrap()
    }

    #[test]
    fn intervals_simple() {
        let t0 = Utc.with_ymd_and_hms(2026, 1, 1, 0, 0, 0).unwrap();
        let t1 = add_secs(t0, 1000.0);
        let v = find_intervals(t0, t1, 30.0, |t| {
            let s = secs_between(t0, t);
            (100.0..300.0).contains(&s) || s > 900.0
        });
        assert_eq!(v.len(), 2);
        assert!((secs_between(t0, v[0].0) - 100.0).abs() < 1.0);
        assert!((secs_between(t0, v[0].1) - 300.0).abs() < 1.0);
        assert_eq!(v[1].1, t1);
    }

    #[test]
    fn polar_station_sees_many_passes() {
        let t0 = Utc.with_ymd_and_hms(2026, 11, 12, 0, 0, 0).unwrap();
        let sat = eo_sat(t0);
        // high-latitude station sees a sun-synchronous satellite on most orbits
        let passes = station_passes(&sat, Geodetic::new(78.23, 15.4, 0.5), 5.0, t0, add_secs(t0, 86_400.0));
        assert!(passes.len() >= 10, "passes={}", passes.len());
        for p in &passes {
            assert!(p.max_el_deg >= 5.0 && p.duration_s() > 0.0 && p.duration_s() < 1200.0);
        }
    }

    #[test]
    fn bangkok_imaging_is_daytime() {
        let t0 = Utc.with_ymd_and_hms(2026, 11, 12, 0, 0, 0).unwrap();
        let sat = eo_sat(t0);
        let bkk = Geodetic::new(13.75, 100.5, 0.0);
        let w = imaging_opportunities(&sat, bkk, 30.0, 10.0, t0, add_secs(t0, 3.0 * 86_400.0));
        assert!(!w.is_empty());
        for win in &w {
            assert!(win.sun_el_deg >= 10.0);
            assert!(win.min_off_nadir_deg <= 30.0);
            // Bangkok is UTC+7, 10:30 descending node -> morning local time
            let local_h = ((win.best_time.timestamp().rem_euclid(86_400)) as f64 / 3600.0 + 7.0).rem_euclid(24.0);
            assert!(local_h > 9.0 && local_h < 12.0, "local={local_h}");
        }
    }
}
