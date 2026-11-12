//! Low-precision solar position (Astronomical Almanac, ~0.01 deg accuracy).

use crate::frames::Geodetic;
use crate::math::V3;
use crate::time::{gmst, julian_date, Epoch};

/// Unit vector from Earth to Sun in the inertial (TEME ≈ mean-of-date) frame.
pub fn sun_dir_inertial(t: Epoch) -> V3 {
    let n = julian_date(t) - 2_451_545.0;
    let l = (280.460 + 0.985_647_4 * n).to_radians();
    let g = (357.528 + 0.985_600_3 * n).to_radians();
    let lambda = l + (1.915f64.to_radians()) * g.sin() + (0.020f64.to_radians()) * (2.0 * g).sin();
    let eps = (23.439 - 0.000_000_4 * n).to_radians();
    V3::new(lambda.cos(), eps.cos() * lambda.sin(), eps.sin() * lambda.sin())
}

/// Right ascension of the Sun [deg].
pub fn sun_right_ascension(t: Epoch) -> f64 {
    let s = sun_dir_inertial(t);
    s.y.atan2(s.x).to_degrees().rem_euclid(360.0)
}

/// Solar elevation angle at a ground site [deg] (no refraction).
pub fn sun_elevation(site: Geodetic, t: Epoch) -> f64 {
    let s_ecef = sun_dir_inertial(t).rot_z(-gmst(t));
    s_ecef.dot(site.up()).clamp(-1.0, 1.0).asin().to_degrees()
}

/// True if a point (inertial frame, km) is in Earth's cylindrical shadow.
pub fn in_eclipse(r: V3, t: Epoch) -> bool {
    let s = sun_dir_inertial(t);
    let along = r.dot(s);
    if along > 0.0 {
        return false;
    }
    let perp = (r - s * along).norm();
    perp < crate::frames::WGS84_A
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{TimeZone, Utc};

    #[test]
    fn equinox_ra_near_zero() {
        // March equinox 2026 ≈ Mar 20 14:46 UTC
        let t = Utc.with_ymd_and_hms(2026, 3, 20, 14, 46, 0).unwrap();
        let ra = sun_right_ascension(t);
        let d = ra.min(360.0 - ra);
        assert!(d < 0.1, "ra={ra}");
    }

    #[test]
    fn noon_sun_is_high_at_equator() {
        // 12:00 UTC on equinox at lon 0 -> sun nearly overhead
        let t = Utc.with_ymd_and_hms(2026, 3, 20, 12, 7, 0).unwrap();
        let el = sun_elevation(Geodetic::new(0.0, 0.0, 0.0), t);
        assert!(el > 88.0, "el={el}");
    }
}
