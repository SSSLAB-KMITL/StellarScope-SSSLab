//! Time helpers: Julian date and Greenwich Mean Sidereal Time.
//!
//! UTC is used as an approximation of UT1 (|UT1-UTC| < 0.9 s), which is
//! well below what matters for visualisation and access timing at 1 s level.

use chrono::{DateTime, Utc};

pub type Epoch = DateTime<Utc>;

/// Julian date of a UTC instant.
pub fn julian_date(t: Epoch) -> f64 {
    let secs = t.timestamp() as f64 + t.timestamp_subsec_nanos() as f64 * 1e-9;
    secs / 86_400.0 + 2_440_587.5
}

/// Greenwich Mean Sidereal Time in radians (IAU 1982 model, as used with SGP4/TEME).
pub fn gmst(t: Epoch) -> f64 {
    let jd = julian_date(t);
    let tu = (jd - 2_451_545.0) / 36_525.0;
    let secs = 67_310.548_41
        + (876_600.0 * 3600.0 + 8_640_184.812_866) * tu
        + 0.093_104 * tu * tu
        - 6.2e-6 * tu * tu * tu;
    let deg = (secs.rem_euclid(86_400.0)) / 240.0;
    deg.to_radians()
}

/// Add fractional seconds to an epoch.
pub fn add_secs(t: Epoch, s: f64) -> Epoch {
    t + chrono::Duration::nanoseconds((s * 1e9).round() as i64)
}

/// Seconds from `a` to `b`.
pub fn secs_between(a: Epoch, b: Epoch) -> f64 {
    (b - a).num_nanoseconds().map(|n| n as f64 * 1e-9).unwrap_or(f64::NAN)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn gmst_at_j2000() {
        // GMST at 2000-01-01 12:00 UT1 is 280.46061837 deg
        let t = Utc.with_ymd_and_hms(2000, 1, 1, 12, 0, 0).unwrap();
        let g = gmst(t).to_degrees();
        assert!((g - 280.460_618_37).abs() < 1e-6, "gmst={g}");
    }

    #[test]
    fn jd_unix_epoch() {
        let t = Utc.with_ymd_and_hms(1970, 1, 1, 0, 0, 0).unwrap();
        assert_eq!(julian_date(t), 2_440_587.5);
    }
}
