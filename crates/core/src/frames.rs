//! Reference frames and the WGS84 ellipsoid.
//!
//! * TEME  – the quasi-inertial frame SGP4 outputs. Used as the scene's inertial frame.
//! * ECEF  – Earth-fixed. TEME -> ECEF is a rotation about Z by GMST
//!   (polar motion is ignored; its effect is ~10 m).

use crate::math::V3;
use crate::time::{gmst, Epoch};
use serde::{Deserialize, Serialize};

/// WGS84 semi-major axis [km]
pub const WGS84_A: f64 = 6378.137;
/// WGS84 flattening
pub const WGS84_F: f64 = 1.0 / 298.257_223_563;
/// WGS84 semi-minor axis [km]
pub const WGS84_B: f64 = WGS84_A * (1.0 - WGS84_F);
const E2: f64 = WGS84_F * (2.0 - WGS84_F);

/// Earth gravitational parameter [km^3/s^2]
pub const MU_EARTH: f64 = 398_600.4418;
/// Earth J2
pub const J2: f64 = 1.082_626_68e-3;
/// Earth rotation rate [rad/s]
pub const OMEGA_EARTH: f64 = 7.292_115_146_7e-5;

pub fn teme_to_ecef(r: V3, t: Epoch) -> V3 {
    r.rot_z(-gmst(t))
}

pub fn ecef_to_teme(r: V3, t: Epoch) -> V3 {
    r.rot_z(gmst(t))
}

/// Geodetic coordinates (WGS84).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Geodetic {
    /// Latitude [deg]
    pub lat: f64,
    /// Longitude [deg], -180..180
    pub lon: f64,
    /// Height above ellipsoid [km]
    pub alt: f64,
}

impl Geodetic {
    pub fn new(lat: f64, lon: f64, alt: f64) -> Self {
        Self { lat, lon, alt }
    }

    pub fn to_ecef(self) -> V3 {
        let (lat, lon) = (self.lat.to_radians(), self.lon.to_radians());
        let (sl, cl) = lat.sin_cos();
        let n = WGS84_A / (1.0 - E2 * sl * sl).sqrt();
        V3::new(
            (n + self.alt) * cl * lon.cos(),
            (n + self.alt) * cl * lon.sin(),
            (n * (1.0 - E2) + self.alt) * sl,
        )
    }

    pub fn from_ecef(r: V3) -> Self {
        let p = (r.x * r.x + r.y * r.y).sqrt();
        let lon = r.y.atan2(r.x);
        // Iterative solution (converges in a few steps for any LEO/MEO/GEO point)
        let mut lat = r.z.atan2(p * (1.0 - E2));
        let mut alt = 0.0;
        for _ in 0..6 {
            let sl = lat.sin();
            let n = WGS84_A / (1.0 - E2 * sl * sl).sqrt();
            alt = if lat.cos().abs() > 1e-9 { p / lat.cos() - n } else { r.z.abs() - WGS84_B };
            lat = r.z.atan2(p * (1.0 - E2 * n / (n + alt)));
        }
        Self { lat: lat.to_degrees(), lon: lon.to_degrees(), alt }
    }

    /// Local "up" unit vector (ellipsoid normal) in ECEF.
    pub fn up(self) -> V3 {
        let (lat, lon) = (self.lat.to_radians(), self.lon.to_radians());
        V3::new(lat.cos() * lon.cos(), lat.cos() * lon.sin(), lat.sin())
    }
    pub fn east(self) -> V3 {
        let lon = self.lon.to_radians();
        V3::new(-lon.sin(), lon.cos(), 0.0)
    }
    pub fn north(self) -> V3 {
        let (lat, lon) = (self.lat.to_radians(), self.lon.to_radians());
        V3::new(-lat.sin() * lon.cos(), -lat.sin() * lon.sin(), lat.cos())
    }
}

/// Azimuth / elevation / range of `target_ecef` seen from `site`.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Look {
    pub az_deg: f64,
    pub el_deg: f64,
    pub range_km: f64,
}

pub fn look_angles(site: Geodetic, target_ecef: V3) -> Look {
    let rho = target_ecef - site.to_ecef();
    let range = rho.norm();
    let u = rho / range;
    let el = u.dot(site.up()).clamp(-1.0, 1.0).asin();
    let az = u.dot(site.east()).atan2(u.dot(site.north()));
    Look { az_deg: az.to_degrees().rem_euclid(360.0), el_deg: el.to_degrees(), range_km: range }
}

/// First intersection of a ray with the WGS84 ellipsoid (inflated by `h` km).
/// Works in TEME or ECEF alike, since the ellipsoid is symmetric about Z.
pub fn ray_ellipsoid(origin: V3, dir: V3, h: f64) -> Option<V3> {
    let (a, b) = (WGS84_A + h, WGS84_B + h);
    let o = V3::new(origin.x / a, origin.y / a, origin.z / b);
    let d = V3::new(dir.x / a, dir.y / a, dir.z / b);
    let qa = d.dot(d);
    let qb = 2.0 * o.dot(d);
    let qc = o.dot(o) - 1.0;
    let disc = qb * qb - 4.0 * qa * qc;
    if disc < 0.0 {
        return None;
    }
    let s = disc.sqrt();
    let t1 = (-qb - s) / (2.0 * qa);
    let t2 = (-qb + s) / (2.0 * qa);
    let t = if t1 > 0.0 { t1 } else if t2 > 0.0 { t2 } else { return None };
    Some(origin + dir * t)
}

/// Great-circle-ish surface distance between two surface points [km]
/// (spherical approximation with mean radius; error < 0.5 %).
pub fn surface_distance(a: V3, b: V3) -> f64 {
    6371.0 * a.angle(b)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn geodetic_roundtrip() {
        for &(lat, lon, alt) in &[(13.75, 100.5, 0.0), (-45.0, -170.0, 700.0), (89.0, 10.0, 0.2), (0.0, 0.0, 35786.0)] {
            let g = Geodetic::new(lat, lon, alt);
            let back = Geodetic::from_ecef(g.to_ecef());
            assert!((back.lat - lat).abs() < 1e-7, "{back:?}");
            assert!((back.lon - lon).abs() < 1e-7, "{back:?}");
            assert!((back.alt - alt).abs() < 1e-5, "{back:?}");
        }
    }

    #[test]
    fn ray_hits_nadir() {
        let o = V3::new(7000.0, 0.0, 0.0);
        let p = ray_ellipsoid(o, V3::new(-1.0, 0.0, 0.0), 0.0).unwrap();
        assert!((p.x - WGS84_A).abs() < 1e-9);
        assert!(ray_ellipsoid(o, V3::new(0.0, 1.0, 0.0), 0.0).is_none());
    }

    #[test]
    fn overhead_elevation_is_90() {
        let site = Geodetic::new(10.0, 20.0, 0.0);
        let sat = Geodetic::new(10.0, 20.0, 500.0).to_ecef();
        let l = look_angles(site, sat);
        assert!((l.el_deg - 90.0).abs() < 1e-6);
        assert!((l.range_km - 500.0).abs() < 1e-6);
    }
}
