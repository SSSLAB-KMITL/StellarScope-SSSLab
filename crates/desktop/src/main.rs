// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use chrono::{DateTime, Utc};
use orbitscope_core::access::{
    area_target_coverage, imaging_opportunities, station_passes, AreaCoverageResult,
};
use orbitscope_core::catalog::{
    builtin_orbit_presets, builtin_tle_catalog, CatalogEntry, OrbitPreset,
};
use orbitscope_core::orbit::{raan_for_ltan, sun_sync_inclination};
use orbitscope_core::time::add_secs;
use orbitscope_core::{Geodetic, Keplerian, Satellite, Sensor};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "mode", rename_all = "snake_case")]
pub enum SatSourceInput {
    Tle {
        name: String,
        line1: String,
        line2: String,
    },
    Keplerian {
        name: String,
        epoch_iso: String,
        elements: Keplerian,
    },
}

impl SatSourceInput {
    fn to_satellite(&self) -> Result<Satellite, String> {
        match self {
            SatSourceInput::Tle { name, line1, line2 } => {
                Satellite::from_tle(Some(name), line1, line2).map_err(|e| e.to_string())
            }
            SatSourceInput::Keplerian {
                name,
                epoch_iso,
                elements,
            } => {
                let epoch = DateTime::parse_from_rfc3339(epoch_iso)
                    .map(|d| d.with_timezone(&Utc))
                    .unwrap_or_else(|_| Utc::now());
                Satellite::from_keplerian(name, epoch, *elements).map_err(|e| e.to_string())
            }
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct NamedSiteInput {
    pub id: String,
    pub name: String,
    pub lat: f64,
    pub lon: f64,
    pub alt_km: f64,
    pub min_el_deg: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct GanttEventItem {
    pub id: String,
    pub kind: String, // "station_pass" | "target_imaging"
    pub sat_name: String,
    pub target_id: String,
    pub target_name: String,
    pub start_iso: String,
    pub end_iso: String,
    pub best_iso: String,
    pub duration_s: f64,
    pub metric_value: f64,
    pub sun_el_deg: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CatalogAndPresetsResponse {
    pub catalog: Vec<CatalogEntry>,
    pub presets: Vec<OrbitPreset>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SsoParamsResponse {
    pub inclination_deg: f64,
    pub raan_deg: f64,
}

#[tauri::command]
fn get_catalog_and_presets() -> CatalogAndPresetsResponse {
    CatalogAndPresetsResponse {
        catalog: builtin_tle_catalog(),
        presets: builtin_orbit_presets(Utc::now()),
    }
}

#[tauri::command]
fn compute_sso_params(altitude_km: f64, ltan_hours: f64, epoch_iso: Option<String>) -> SsoParamsResponse {
    let epoch = epoch_iso
        .and_then(|s| DateTime::parse_from_rfc3339(&s).ok())
        .map(|d| d.with_timezone(&Utc))
        .unwrap_or_else(Utc::now);
    SsoParamsResponse {
        inclination_deg: sun_sync_inclination(altitude_km),
        raan_deg: raan_for_ltan(epoch, ltan_hours),
    }
}

#[tauri::command]
fn compute_access_gantt(
    satellites: Vec<SatSourceInput>,
    stations: Vec<NamedSiteInput>,
    targets: Vec<NamedSiteInput>,
    max_off_nadir_deg: f64,
    min_sun_el_deg: f64,
    start_iso: String,
    duration_hours: f64,
) -> Result<Vec<GanttEventItem>, String> {
    let start = DateTime::parse_from_rfc3339(&start_iso)
        .map_err(|e| e.to_string())?
        .with_timezone(&Utc);
    let end = add_secs(start, duration_hours.clamp(0.5, 168.0) * 3600.0);
    let mut events = Vec::new();
    let mut seq = 0usize;

    for sat_in in &satellites {
        let sat = sat_in.to_satellite()?;
        for st in &stations {
            let site = Geodetic::new(st.lat, st.lon, st.alt_km);
            for p in station_passes(&sat, site, st.min_el_deg, start, end) {
                seq += 1;
                events.push(GanttEventItem {
                    id: format!("ev-{seq}"),
                    kind: "station_pass".into(),
                    sat_name: sat.name.clone(),
                    target_id: st.id.clone(),
                    target_name: st.name.clone(),
                    start_iso: p.start.to_rfc3339(),
                    end_iso: p.end.to_rfc3339(),
                    best_iso: p.max_el_time.to_rfc3339(),
                    duration_s: p.duration_s(),
                    metric_value: p.max_el_deg,
                    sun_el_deg: None,
                });
            }
        }
        for tgt in &targets {
            let site = Geodetic::new(tgt.lat, tgt.lon, tgt.alt_km);
            for w in imaging_opportunities(&sat, site, max_off_nadir_deg, min_sun_el_deg, start, end) {
                seq += 1;
                events.push(GanttEventItem {
                    id: format!("ev-{seq}"),
                    kind: "target_imaging".into(),
                    sat_name: sat.name.clone(),
                    target_id: tgt.id.clone(),
                    target_name: tgt.name.clone(),
                    start_iso: w.start.to_rfc3339(),
                    end_iso: w.end.to_rfc3339(),
                    best_iso: w.best_time.to_rfc3339(),
                    duration_s: (w.end - w.start).num_milliseconds() as f64 / 1000.0,
                    metric_value: w.min_off_nadir_deg,
                    sun_el_deg: Some(w.sun_el_deg),
                });
            }
        }
    }

    events.sort_by(|a, b| a.start_iso.cmp(&b.start_iso));
    Ok(events)
}

#[tauri::command]
fn compute_area_coverage_cmd(
    satellite: SatSourceInput,
    sensor: Sensor,
    polygon_lat_lon: Vec<(f64, f64)>,
    grid_res_deg: f64,
    min_sun_el_deg: f64,
    start_iso: String,
    duration_hours: f64,
) -> Result<AreaCoverageResult, String> {
    let sat = satellite.to_satellite()?;
    let start = DateTime::parse_from_rfc3339(&start_iso)
        .map_err(|e| e.to_string())?
        .with_timezone(&Utc);
    let end = add_secs(start, duration_hours.clamp(0.5, 168.0) * 3600.0);
    Ok(area_target_coverage(
        &sat,
        &sensor,
        &polygon_lat_lon,
        grid_res_deg,
        min_sun_el_deg,
        start,
        end,
    ))
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_catalog_and_presets,
            compute_sso_params,
            compute_access_gantt,
            compute_area_coverage_cmd,
        ])
        .run(tauri::generate_context!())
        .expect("error while running OrbitScope Tauri application");
}
