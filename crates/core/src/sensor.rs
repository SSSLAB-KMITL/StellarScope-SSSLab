//! Imaging sensor model: field of view, pointing, ground footprint and swath.
//!
//! Body frame (LVLH-style, nadir pointing):
//! * +Z = nadir (towards Earth centre)
//! * +X = roughly along the velocity vector
//! * +Y = right of the ground track (looking down, facing the direction of motion)
//!
//! Positive roll tilts the boresight to the right, positive pitch tilts it forward.

use crate::frames::{ray_ellipsoid, surface_distance};
use crate::math::V3;
use crate::orbit::State;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Fov {
    /// Circular cone with the given half-angle [deg]
    Conic { half_angle_deg: f64 },
    /// Pushbroom / frame camera: half-angles across and along track [deg]
    Rectangular { cross_half_deg: f64, along_half_deg: f64 },
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Sensor {
    pub fov: Fov,
    /// Off-nadir roll (cross-track) [deg]
    pub roll_deg: f64,
    /// Off-nadir pitch (along-track) [deg]
    pub pitch_deg: f64,
}

impl Default for Sensor {
    fn default() -> Self {
        // Wide-swath multispectral imager (≈290 km swath at 786 km)
        Self { fov: Fov::Rectangular { cross_half_deg: 10.3, along_half_deg: 0.5 }, roll_deg: 0.0, pitch_deg: 0.0 }
    }
}

/// Orthonormal body axes expressed in the inertial frame.
#[derive(Debug, Clone, Copy)]
pub struct BodyAxes {
    pub x: V3,
    pub y: V3,
    pub z: V3,
}

pub fn body_axes(s: &State) -> BodyAxes {
    let z = (-s.r).normalize();
    let y = (-(s.r.cross(s.v))).normalize();
    let x = y.cross(z);
    BodyAxes { x, y, z }
}

impl Sensor {
    /// Direction of a ray inside the FOV, given sensor-frame tangent offsets
    /// (`tx` along-track, `ty` cross-track), in the inertial frame.
    fn ray(&self, axes: &BodyAxes, tx: f64, ty: f64) -> V3 {
        let (sr, cr) = self.roll_deg.to_radians().sin_cos();
        let (sp, cp) = self.pitch_deg.to_radians().sin_cos();
        // sensor frame vector
        let (x, y, z) = (tx, ty, 1.0);
        // roll about X: tilts +Z towards +Y
        let (y, z) = (y * cr + z * sr, -y * sr + z * cr);
        // pitch about Y: tilts +Z towards +X
        let (x, z) = (x * cp + z * sp, -x * sp + z * cp);
        (axes.x * x + axes.y * y + axes.z * z).normalize()
    }

    pub fn boresight(&self, s: &State) -> V3 {
        self.ray(&body_axes(s), 0.0, 0.0)
    }

    /// Ground point hit by the boresight (inertial frame), if it hits the Earth.
    pub fn boresight_ground(&self, s: &State) -> Option<V3> {
        ray_ellipsoid(s.r, self.boresight(s), 0.0)
    }

    /// Rays around the FOV edge, `n` samples per side (rectangular) or `4n` (conic).
    pub fn edge_rays(&self, s: &State, n: usize) -> Vec<V3> {
        let axes = body_axes(s);
        let n = n.max(1);
        let mut out = Vec::with_capacity(4 * n);
        match self.fov {
            Fov::Conic { half_angle_deg } => {
                let t = half_angle_deg.to_radians().tan();
                for i in 0..4 * n {
                    let a = std::f64::consts::TAU * i as f64 / (4 * n) as f64;
                    out.push(self.ray(&axes, t * a.cos(), t * a.sin()));
                }
            }
            Fov::Rectangular { cross_half_deg, along_half_deg } => {
                let (ty, tx) = (cross_half_deg.to_radians().tan(), along_half_deg.to_radians().tan());
                let corners = [(tx, -ty), (tx, ty), (-tx, ty), (-tx, -ty)];
                for k in 0..4 {
                    let (a, b) = (corners[k], corners[(k + 1) % 4]);
                    for i in 0..n {
                        let f = i as f64 / n as f64;
                        out.push(self.ray(&axes, a.0 + (b.0 - a.0) * f, a.1 + (b.1 - a.1) * f));
                    }
                }
            }
        }
        out
    }

    /// Footprint outline on the ground (inertial frame). Rays that miss the Earth
    /// (looking past the horizon) are dropped.
    pub fn footprint(&self, s: &State, n: usize) -> Vec<V3> {
        self.edge_rays(s, n).into_iter().filter_map(|d| ray_ellipsoid(s.r, d, 0.0)).collect()
    }

    /// Left and right cross-track edge points at the centre of the along-track FOV.
    pub fn swath_edges(&self, s: &State) -> Option<(V3, V3)> {
        let axes = body_axes(s);
        let ty = match self.fov {
            Fov::Conic { half_angle_deg } => half_angle_deg,
            Fov::Rectangular { cross_half_deg, .. } => cross_half_deg,
        }
        .to_radians()
        .tan();
        let l = ray_ellipsoid(s.r, self.ray(&axes, 0.0, -ty), 0.0)?;
        let r = ray_ellipsoid(s.r, self.ray(&axes, 0.0, ty), 0.0)?;
        Some((l, r))
    }

    /// Cross-track swath width on the ground [km].
    pub fn swath_width_km(&self, s: &State) -> Option<f64> {
        self.swath_edges(s).map(|(l, r)| surface_distance(l, r))
    }
}

/// Off-nadir angle needed to look at `target` (inertial frame) [deg].
pub fn off_nadir_angle(s: &State, target: V3) -> f64 {
    (-s.r).angle(target - s.r).to_degrees()
}

/// Compute exact (roll_deg, pitch_deg) required to point the sensor boresight
/// from satellite state `s` at `target` (both in the same frame, e.g. TEME),
/// returning `None` if the off-nadir angle exceeds `max_slew_deg` or if the
/// target is behind the local nadir hemisphere.
pub fn slew_angles_to_target(s: &State, target: V3, max_slew_deg: f64) -> Option<(f64, f64)> {
    let off = off_nadir_angle(s, target);
    if off > max_slew_deg {
        return None;
    }
    let axes = body_axes(s);
    let u = (target - s.r).normalize();
    let bx = u.dot(axes.x);
    let by = u.dot(axes.y);
    let bz = u.dot(axes.z);
    if bz <= 0.0 {
        return None;
    }
    let roll_deg = by.clamp(-1.0, 1.0).asin().to_degrees();
    let pitch_deg = bx.atan2(bz).to_degrees();
    Some((roll_deg, pitch_deg))
}

/// Ground sample distance [m] for a camera with focal length `focal_mm` and
/// detector pixel pitch `pixel_um`, at slant range `range_km`.
pub fn gsd_m(range_km: f64, focal_mm: f64, pixel_um: f64) -> f64 {
    range_km * 1000.0 * (pixel_um * 1e-6) / (focal_mm * 1e-3)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::frames::{Geodetic, WGS84_A};

    fn equator_state(alt: f64) -> State {
        let r = WGS84_A + alt;
        let v = (crate::frames::MU_EARTH / r).sqrt();
        // over (0N, 0E), moving north
        State { r: V3::new(r, 0.0, 0.0), v: V3::new(0.0, 0.0, v) }
    }

    #[test]
    fn nadir_boresight_hits_subpoint() {
        let s = equator_state(786.0);
        let p = Sensor::default().boresight_ground(&s).unwrap();
        let g = Geodetic::from_ecef(p);
        assert!(g.lat.abs() < 1e-6 && g.lon.abs() < 1e-6);
    }

    #[test]
    fn swath_width_wide_imager() {
        let s = equator_state(786.0);
        let w = Sensor::default().swath_width_km(&s).unwrap();
        // flat-earth 2*786*tan(10.3°) = 285.7 km; curvature adds a little
        assert!(w > 285.0 && w < 300.0, "w={w}");
    }

    #[test]
    fn positive_roll_looks_right() {
        // Moving north over the equator: right-hand side is east (+lon)
        let s = equator_state(600.0);
        let sensor = Sensor { roll_deg: 20.0, ..Sensor::default() };
        let g = Geodetic::from_ecef(sensor.boresight_ground(&s).unwrap());
        assert!(g.lon > 1.0, "lon={}", g.lon);
        let off = off_nadir_angle(&s, sensor.boresight_ground(&s).unwrap());
        assert!((off - 20.0).abs() < 1e-6);
    }

    #[test]
    fn positive_pitch_looks_forward() {
        let s = equator_state(600.0);
        let sensor = Sensor { pitch_deg: 15.0, ..Sensor::default() };
        let g = Geodetic::from_ecef(sensor.boresight_ground(&s).unwrap());
        assert!(g.lat > 1.0, "lat={}", g.lat);
    }

    #[test]
    fn footprint_has_all_points_when_nadir() {
        let s = equator_state(600.0);
        let fp = Sensor { fov: Fov::Conic { half_angle_deg: 20.0 }, roll_deg: 0.0, pitch_deg: 0.0 }.footprint(&s, 8);
        assert_eq!(fp.len(), 32);
    }

    #[test]
    fn gsd_example() {
        // 786 km, f=600 mm, 7.5 µm pixel -> ~9.8 m
        let g = gsd_m(786.0, 600.0, 7.5);
        assert!((g - 9.825).abs() < 0.01);
    }

    #[test]
    fn slew_to_target_points_boresight_at_target() {
        let s = equator_state(650.0);
        let target = Geodetic::new(1.5, 2.2, 0.0).to_ecef();
        let (roll_deg, pitch_deg) = slew_angles_to_target(&s, target, 45.0).unwrap();
        let sensor = Sensor { roll_deg, pitch_deg, ..Sensor::default() };
        let hit = sensor.boresight_ground(&s).unwrap();
        let hit_geo = Geodetic::from_ecef(hit);
        assert!((hit_geo.lat - 1.5).abs() < 1e-4, "lat={}", hit_geo.lat);
        assert!((hit_geo.lon - 2.2).abs() < 1e-4, "lon={}", hit_geo.lon);
    }
}
