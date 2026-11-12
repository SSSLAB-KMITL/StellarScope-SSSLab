//! Satellites: creation from TLE or Keplerian elements, SGP4 propagation.

use crate::frames::{teme_to_ecef, Geodetic, J2, MU_EARTH, WGS84_A};
use crate::math::V3;
use crate::time::Epoch;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct State {
    /// Position, TEME [km]
    pub r: V3,
    /// Velocity, TEME [km/s]
    pub v: V3,
}

#[derive(Debug)]
pub enum OrbitError {
    Tle(String),
    Elements(String),
}

impl std::fmt::Display for OrbitError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            OrbitError::Tle(s) => write!(f, "TLE error: {s}"),
            OrbitError::Elements(s) => write!(f, "invalid elements: {s}"),
        }
    }
}
impl std::error::Error for OrbitError {}

/// Classical orbital elements used by the "orbit wizard".
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Keplerian {
    /// Altitude of a circular orbit above the equatorial radius [km] (semi-major axis - Re)
    pub altitude_km: f64,
    pub eccentricity: f64,
    pub inclination_deg: f64,
    pub raan_deg: f64,
    pub arg_perigee_deg: f64,
    pub mean_anomaly_deg: f64,
}

pub struct Satellite {
    pub name: String,
    pub elements: sgp4::Elements,
    constants: sgp4::Constants,
}

impl Clone for Satellite {
    fn clone(&self) -> Self {
        Satellite::from_elements(self.name.clone(), self.elements.clone()).expect("valid elements")
    }
}

impl Satellite {
    pub fn from_elements(name: String, elements: sgp4::Elements) -> Result<Self, OrbitError> {
        let constants = sgp4::Constants::from_elements(&elements).map_err(|e| OrbitError::Elements(e.to_string()))?;
        Ok(Self { name, elements, constants })
    }

    /// Parse a TLE (2 lines, optionally preceded by a name line).
    pub fn from_tle(name: Option<&str>, line1: &str, line2: &str) -> Result<Self, OrbitError> {
        let el = sgp4::Elements::from_tle(name.map(str::to_owned), line1.trim().as_bytes(), line2.trim().as_bytes())
            .map_err(|e| OrbitError::Tle(e.to_string()))?;
        let name = name
            .map(|s| s.trim().to_owned())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| format!("NORAD {}", el.norad_id));
        Self::from_elements(name, el)
    }

    /// Parse every satellite in a block of TLE text (2-line or 3-line format).
    pub fn parse_tle_text(text: &str) -> Vec<Result<Self, OrbitError>> {
        let lines: Vec<&str> = text.lines().map(str::trim_end).filter(|l| !l.trim().is_empty()).collect();
        let mut out = Vec::new();
        let mut i = 0;
        while i < lines.len() {
            let l = lines[i].trim_start();
            if l.starts_with("1 ") && i + 1 < lines.len() && lines[i + 1].trim_start().starts_with("2 ") {
                out.push(Self::from_tle(None, l, lines[i + 1]));
                i += 2;
            } else if i + 2 < lines.len()
                && lines[i + 1].trim_start().starts_with("1 ")
                && lines[i + 2].trim_start().starts_with("2 ")
            {
                let name = l.strip_prefix("0 ").unwrap_or(l);
                out.push(Self::from_tle(Some(name), lines[i + 1], lines[i + 2]));
                i += 3;
            } else {
                i += 1;
            }
        }
        out
    }

    /// Build a satellite from Keplerian elements at `epoch` (no drag).
    pub fn from_keplerian(name: &str, epoch: Epoch, k: Keplerian) -> Result<Self, OrbitError> {
        let a = WGS84_A + k.altitude_km;
        if !(a > WGS84_A + 80.0) {
            return Err(OrbitError::Elements("altitude must be above 80 km".into()));
        }
        let n_rad_s = (MU_EARTH / (a * a * a)).sqrt();
        let mean_motion = n_rad_s * 86_400.0 / std::f64::consts::TAU;
        let elements = sgp4::Elements {
            object_name: Some(name.to_owned()),
            international_designator: None,
            norad_id: 0,
            classification: sgp4::Classification::Unclassified,
            datetime: epoch.naive_utc(),
            mean_motion_dot: 0.0,
            mean_motion_ddot: 0.0,
            drag_term: 0.0,
            element_set_number: 0,
            inclination: k.inclination_deg,
            right_ascension: k.raan_deg.rem_euclid(360.0),
            eccentricity: k.eccentricity,
            argument_of_perigee: k.arg_perigee_deg.rem_euclid(360.0),
            mean_anomaly: k.mean_anomaly_deg.rem_euclid(360.0),
            mean_motion,
            revolution_number: 0,
            ephemeris_type: 0,
        };
        Self::from_elements(name.to_owned(), elements)
    }

    pub fn epoch(&self) -> Epoch {
        self.elements.datetime.and_utc()
    }

    /// Orbital period [s].
    pub fn period_s(&self) -> f64 {
        86_400.0 / self.elements.mean_motion
    }

    /// State in TEME at time `t`, or None if SGP4 fails (e.g. decayed orbit).
    pub fn state(&self, t: Epoch) -> Option<State> {
        let m = self.elements.datetime_to_minutes_since_epoch(&t.naive_utc()).ok()?;
        let p = self.constants.propagate(m).ok()?;
        Some(State { r: V3::from_array(p.position), v: V3::from_array(p.velocity) })
    }

    pub fn geodetic(&self, t: Epoch) -> Option<Geodetic> {
        self.state(t).map(|s| Geodetic::from_ecef(teme_to_ecef(s.r, t)))
    }
}

/// Inclination [deg] that makes a circular orbit at `altitude_km` sun-synchronous.
pub fn sun_sync_inclination(altitude_km: f64) -> f64 {
    let a = WGS84_A + altitude_km;
    // Required nodal precession: 360 deg per tropical year
    let omega_dot = std::f64::consts::TAU / (365.242_19 * 86_400.0);
    let cos_i = -2.0 * a.powf(3.5) * omega_dot / (3.0 * J2 * WGS84_A * WGS84_A * MU_EARTH.sqrt());
    cos_i.clamp(-1.0, 1.0).acos().to_degrees()
}

/// RAAN [deg] that gives a local time of ascending node `ltan_hours` (e.g. 22.5 for 10:30 descending).
pub fn raan_for_ltan(epoch: Epoch, ltan_hours: f64) -> f64 {
    (crate::sun::sun_right_ascension(epoch) + (ltan_hours - 12.0) * 15.0).rem_euclid(360.0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{TimeZone, Utc};

    const L1: &str = "1 25544U 98067A   08264.51782528 -.00002182  00000-0 -11606-4 0  2927";
    const L2: &str = "2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.72125391563537";

    #[test]
    fn tle_parses_and_propagates() {
        let sat = Satellite::from_tle(Some("ISS (ZARYA)"), L1, L2).unwrap();
        let s = sat.state(sat.epoch()).unwrap();
        let r = s.r.norm();
        assert!(r > 6600.0 && r < 6800.0, "r={r}");
        assert!((sat.period_s() / 60.0 - 91.6).abs() < 0.5);
    }

    #[test]
    fn parse_three_line_block() {
        let text = format!("ISS (ZARYA)\n{L1}\n{L2}\n\n{L1}\n{L2}\n");
        let v = Satellite::parse_tle_text(&text);
        assert_eq!(v.len(), 2);
        assert_eq!(v[0].as_ref().unwrap().name, "ISS (ZARYA)");
        assert_eq!(v[1].as_ref().unwrap().name, "NORAD 25544");
    }

    #[test]
    fn sun_sync_786km() {
        let i = sun_sync_inclination(786.0);
        assert!((i - 98.6).abs() < 0.15, "i={i}");
    }

    #[test]
    fn keplerian_altitude_matches() {
        let t = Utc.with_ymd_and_hms(2026, 11, 12, 0, 0, 0).unwrap();
        let k = Keplerian {
            altitude_km: 786.0,
            eccentricity: 0.0001,
            inclination_deg: sun_sync_inclination(786.0),
            raan_deg: raan_for_ltan(t, 22.5),
            arg_perigee_deg: 0.0,
            mean_anomaly_deg: 0.0,
        };
        let sat = Satellite::from_keplerian("EO", t, k).unwrap();
        for h in 0..24 {
            let g = sat.geodetic(crate::time::add_secs(t, h as f64 * 3600.0)).unwrap();
            assert!(g.alt > 770.0 && g.alt < 830.0, "alt={}", g.alt);
        }
    }

    #[test]
    fn ltdn_1030_crosses_equator_mid_morning() {
        // A descending-node crossing should occur near 10:30 local solar time
        let t0 = Utc.with_ymd_and_hms(2026, 11, 12, 0, 0, 0).unwrap();
        let k = Keplerian {
            altitude_km: 786.0,
            eccentricity: 0.0,
            inclination_deg: sun_sync_inclination(786.0),
            raan_deg: raan_for_ltan(t0, 22.5),
            arg_perigee_deg: 0.0,
            mean_anomaly_deg: 0.0,
        };
        let sat = Satellite::from_keplerian("EO", t0, k).unwrap();
        let mut prev = sat.geodetic(t0).unwrap();
        let mut found = false;
        for s in 1..12_000 {
            let t = crate::time::add_secs(t0, s as f64);
            let g = sat.geodetic(t).unwrap();
            if prev.lat > 0.0 && g.lat <= 0.0 {
                // local mean solar time ≈ UTC + lon/15
                let utc_h = (t.timestamp().rem_euclid(86_400)) as f64 / 3600.0;
                let lmst = (utc_h + g.lon / 15.0).rem_euclid(24.0);
                // equation of time in November is ~ +16 min, allow margin
                assert!((lmst - 10.5).abs() < 0.6, "local time={lmst}");
                found = true;
                break;
            }
            prev = g;
        }
        assert!(found);
    }
}
