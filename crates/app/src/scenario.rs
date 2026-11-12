//! Scenario state shared by the renderer and the UI.

use bevy::prelude::*;
use chrono::{DurationRound, Utc};
use orbitscope_core::access::{ImagingWindow, Pass};
use orbitscope_core::orbit::{raan_for_ltan, sun_sync_inclination};
use orbitscope_core::{Epoch, Fov, Geodetic, Keplerian, Satellite, Sensor};

/// Imaging payload parameters used for the GSD estimate.
#[derive(Clone, Copy, Debug)]
pub struct Optics {
    pub focal_mm: f64,
    pub pixel_um: f64,
}

#[derive(Clone)]
pub struct SatEntry {
    pub sat: Satellite,
    pub sensor: Option<Sensor>,
    pub optics: Optics,
    pub color: [f32; 3],
    pub visible: bool,
    pub show_orbit: bool,
    pub show_ground_track: bool,
    pub show_sensor: bool,
    pub show_swath: bool,
    /// How much past ground coverage to draw [min]
    pub swath_minutes: f64,
}

impl SatEntry {
    pub fn new(sat: Satellite, sensor: Option<Sensor>, color: [f32; 3]) -> Self {
        Self {
            sat,
            sensor,
            optics: Optics { focal_mm: 600.0, pixel_um: 7.5 },
            color,
            visible: true,
            show_orbit: true,
            show_ground_track: true,
            show_sensor: true,
            show_swath: true,
            swath_minutes: 20.0,
        }
    }
    pub fn bevy_color(&self) -> Color {
        Color::srgb(self.color[0], self.color[1], self.color[2])
    }
}

#[derive(Clone)]
pub struct Site {
    pub name: String,
    pub geo: Geodetic,
    /// Minimum elevation for contact [deg]
    pub min_el_deg: f64,
}

#[derive(Clone)]
pub struct Target {
    pub name: String,
    pub geo: Geodetic,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Selection {
    None,
    Sat(usize),
    Site(usize),
    Target(usize),
}

#[derive(Resource)]
pub struct Scenario {
    pub sats: Vec<SatEntry>,
    pub sites: Vec<Site>,
    pub targets: Vec<Target>,
    pub selection: Selection,
    /// Bumped whenever objects are added/removed/recoloured so the scene re-syncs.
    pub revision: u64,
}

#[derive(Resource)]
pub struct Clock {
    pub t: Epoch,
    pub start: Epoch,
    /// Length of the scenario window [h] (timeline + reports)
    pub span_hours: f64,
    /// Simulated seconds per real second (negative = reverse)
    pub rate: f64,
    pub playing: bool,
}

impl Clock {
    pub fn end(&self) -> Epoch {
        orbitscope_core::time::add_secs(self.start, self.span_hours * 3600.0)
    }
}

/// Global view toggles.
#[derive(Resource)]
pub struct ViewSettings {
    pub labels: bool,
    pub grid: bool,
    pub earth_fixed: bool,
    pub sun_lighting: bool,
}

impl Default for ViewSettings {
    fn default() -> Self {
        Self { labels: true, grid: true, earth_fixed: false, sun_lighting: true }
    }
}

#[derive(Clone)]
pub enum ReportRow {
    Pass { sat: String, site: String, pass: Pass },
    Image { sat: String, target: String, win: ImagingWindow },
}

impl ReportRow {
    pub fn start(&self) -> Epoch {
        match self {
            ReportRow::Pass { pass, .. } => pass.start,
            ReportRow::Image { win, .. } => win.start,
        }
    }
}

/// Parameters and results of the access report.
#[derive(Resource)]
pub struct Reports {
    pub max_off_nadir_deg: f64,
    pub min_sun_el_deg: f64,
    pub rows: Vec<ReportRow>,
    pub computed_for: Option<String>,
}

impl Default for Reports {
    fn default() -> Self {
        Self { max_off_nadir_deg: 30.0, min_sun_el_deg: 10.0, rows: Vec::new(), computed_for: None }
    }
}

pub const PALETTE: [[f32; 3]; 8] = [
    [1.00, 0.78, 0.20],
    [0.35, 0.85, 1.00],
    [1.00, 0.45, 0.55],
    [0.60, 1.00, 0.45],
    [0.80, 0.60, 1.00],
    [1.00, 0.60, 0.25],
    [0.40, 1.00, 0.85],
    [0.95, 0.95, 0.95],
];

pub fn now_minute() -> Epoch {
    Utc::now().duration_trunc(chrono::Duration::minutes(1)).unwrap_or_else(|_| Utc::now())
}

/// Demo scenario: three Earth-observation satellites built from orbital
/// elements at the scenario start (no TLE download needed), plus a crewed-station-like orbit.
pub fn demo(start: Epoch) -> Scenario {
    let sso = |name: &str, alt: f64, ltan: f64, ma: f64| {
        Satellite::from_keplerian(
            name,
            start,
            Keplerian {
                altitude_km: alt,
                eccentricity: 0.0001,
                inclination_deg: sun_sync_inclination(alt),
                raan_deg: raan_for_ltan(start, ltan),
                arg_perigee_deg: 90.0,
                mean_anomaly_deg: ma,
            },
        )
        .expect("valid demo orbit")
    };

    let mut eo1 = SatEntry::new(sso("EO-1 · SSO 786 km", 786.0, 22.5, 0.0), Some(Sensor::default()), PALETTE[0]);
    eo1.optics = Optics { focal_mm: 600.0, pixel_um: 7.5 };

    let mut eo2 = SatEntry::new(
        sso("EO-2 · SSO 620 km", 620.0, 22.0, 120.0),
        Some(Sensor {
            fov: Fov::Rectangular { cross_half_deg: 1.0, along_half_deg: 1.0 },
            roll_deg: 0.0,
            pitch_deg: 0.0,
        }),
        PALETTE[1],
    );
    eo2.optics = Optics { focal_mm: 3600.0, pixel_um: 3.0 };
    eo2.swath_minutes = 30.0;

    let mut sar = SatEntry::new(
        sso("SAR-1 · dawn-dusk 520 km", 520.0, 18.0, 240.0),
        Some(Sensor { fov: Fov::Rectangular { cross_half_deg: 2.5, along_half_deg: 1.5 }, roll_deg: 30.0, pitch_deg: 0.0 }),
        PALETTE[2],
    );
    sar.optics = Optics { focal_mm: 1000.0, pixel_um: 5.0 };

    let mut station = SatEntry::new(
        Satellite::from_keplerian(
            "STATION · 420 km 51.6°",
            start,
            Keplerian {
                altitude_km: 420.0,
                eccentricity: 0.0005,
                inclination_deg: 51.6,
                raan_deg: 40.0,
                arg_perigee_deg: 0.0,
                mean_anomaly_deg: 0.0,
            },
        )
        .expect("valid demo orbit"),
        None,
        PALETTE[3],
    );
    station.show_ground_track = false;

    Scenario {
        sats: vec![eo1, eo2, sar, station],
        sites: vec![
            Site { name: "Bangkok GS".into(), geo: Geodetic::new(13.73, 100.52, 0.01), min_el_deg: 5.0 },
            Site { name: "Svalbard GS".into(), geo: Geodetic::new(78.23, 15.40, 0.5), min_el_deg: 5.0 },
        ],
        targets: vec![
            Target { name: "Chiang Mai".into(), geo: Geodetic::new(18.79, 98.98, 0.3) },
            Target { name: "Phuket".into(), geo: Geodetic::new(7.88, 98.39, 0.0) },
        ],
        selection: Selection::Sat(0),
        revision: 0,
    }
}
