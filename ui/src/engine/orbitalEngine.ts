import * as satellite from 'satellite.js';

export type Vec3 = { x: number; y: number; z: number };

export interface Geodetic {
  lat: number;
  lon: number;
  alt: number; // km
}

export interface Keplerian {
  altitude_km: number;
  eccentricity: number;
  inclination_deg: number;
  raan_deg: number;
  arg_perigee_deg: number;
  mean_anomaly_deg: number;
}

export type FovSpec =
  | { type: 'conic'; half_angle_deg: number }
  | { type: 'rectangular'; cross_half_deg: number; along_half_deg: number };

export type PointingMode = 'nadir' | 'fixed_slew' | 'target_track';

export interface SensorConfig {
  enabled: boolean;
  fov: FovSpec;
  pointing_mode: PointingMode;
  roll_deg: number;
  pitch_deg: number;
  target_id: string | null;
  max_slew_deg: number;
  focal_mm: number;
  pixel_um: number;
  swath_history_min: number;
}

export interface SatelliteObject {
  id: string;
  name: string;
  color: string;
  visible: boolean;
  source_mode: 'tle' | 'keplerian';
  tle_line1?: string;
  tle_line2?: string;
  keplerian: Keplerian;
  epoch_iso: string;
  sensor: SensorConfig;
  show_orbit: boolean;
  show_ground_track: boolean;
  show_footprint: boolean;
  show_swath: boolean;
}

export interface GroundStationObject {
  id: string;
  name: string;
  lat: number;
  lon: number;
  alt_km: number;
  min_el_deg: number;
  color: string;
}

export interface TargetPointObject {
  id: string;
  name: string;
  lat: number;
  lon: number;
  alt_km: number;
  color: string;
}

export interface AreaTargetObject {
  id: string;
  name: string;
  vertices: Array<{ lat: number; lon: number }>;
  color: string;
}

export interface GridCellCoverage {
  lat: number;
  lon: number;
  covered: boolean;
  hit_count: number;
  first_hit_iso?: string | null;
}

export interface AreaCoverageSummary {
  total_cells: number;
  covered_cells: number;
  coverage_percent: number;
  cells: GridCellCoverage[];
}

export interface GanttEventItem {
  id: string;
  kind: 'station_pass' | 'target_imaging';
  sat_id: string;
  sat_name: string;
  sat_color: string;
  target_id: string;
  target_name: string;
  start_ms: number;
  end_ms: number;
  best_ms: number;
  duration_s: number;
  metric_value: number; // max_el_deg or min_off_nadir_deg
  sun_el_deg?: number;
}

export interface CatalogEntry {
  id: string;
  name: string;
  norad_id: number;
  category: string;
  description_th: string;
  description_en: string;
  line1: string;
  line2: string;
  default_sensor: {
    fov: FovSpec;
    roll_deg: number;
    pitch_deg: number;
  };
  focal_mm: number;
  pixel_um: number;
  max_slew_deg: number;
}

export interface OrbitPreset {
  id: string;
  name_th: string;
  name_en: string;
  description_th: string;
  description_en: string;
  keplerian: Keplerian;
  color: string;
  default_sensor: {
    fov: FovSpec;
    roll_deg: number;
    pitch_deg: number;
  };
  focal_mm: number;
  pixel_um: number;
}

// Constants matching crates/core/src/frames.rs
export const WGS84_A = 6378.137;
export const WGS84_F = 1.0 / 298.257223563;
export const WGS84_B = WGS84_A * (1.0 - WGS84_F);
const E2 = WGS84_F * (2.0 - WGS84_F);
export const MU_EARTH = 398600.4418;
export const J2 = 1.08262668e-3;
const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

// Vector math helpers
export const v3 = {
  create: (x: number, y: number, z: number): Vec3 => ({ x, y, z }),
  add: (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }),
  sub: (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }),
  scale: (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s }),
  dot: (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z,
  cross: (a: Vec3, b: Vec3): Vec3 => ({
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  }),
  norm: (a: Vec3): number => Math.hypot(a.x, a.y, a.z),
  normalize: (a: Vec3): Vec3 => {
    const n = Math.hypot(a.x, a.y, a.z);
    return n > 0 ? { x: a.x / n, y: a.y / n, z: a.z / n } : { x: 0, y: 0, z: 0 };
  },
  angle: (a: Vec3, b: Vec3): number => {
    const d = v3.dot(v3.normalize(a), v3.normalize(b));
    return Math.acos(Math.max(-1, Math.min(1, d)));
  },
  rotZ: (a: Vec3, rad: number): Vec3 => {
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    return { x: c * a.x - s * a.y, y: s * a.x + c * a.y, z: a.z };
  },
};

export function julianDate(date: Date): number {
  return date.getTime() / 86400000 + 2440587.5;
}

export function gmstRad(date: Date): number {
  const jd = julianDate(date);
  const tu = (jd - 2451545.0) / 36525.0;
  const secs =
    67310.54841 +
    (876600.0 * 3600.0 + 8640184.812866) * tu +
    0.093104 * tu * tu -
    6.2e-6 * tu * tu * tu;
  const rem = ((secs % 86400.0) + 86400.0) % 86400.0;
  return (rem / 240.0) * DEG2RAD;
}

export function temeToEcef(rTeme: Vec3, date: Date): Vec3 {
  return v3.rotZ(rTeme, -gmstRad(date));
}

export function ecefToTeme(rEcef: Vec3, date: Date): Vec3 {
  return v3.rotZ(rEcef, gmstRad(date));
}

export function geodeticToEcef(g: Geodetic): Vec3 {
  const lat = g.lat * DEG2RAD;
  const lon = g.lon * DEG2RAD;
  const sl = Math.sin(lat);
  const cl = Math.cos(lat);
  const n = WGS84_A / Math.sqrt(1.0 - E2 * sl * sl);
  return {
    x: (n + g.alt) * cl * Math.cos(lon),
    y: (n + g.alt) * cl * Math.sin(lon),
    z: (n * (1.0 - E2) + g.alt) * sl,
  };
}

export function ecefToGeodetic(r: Vec3): Geodetic {
  const p = Math.hypot(r.x, r.y);
  const lon = Math.atan2(r.y, r.x);
  let lat = Math.atan2(r.z, p * (1.0 - E2));
  let alt = 0;
  for (let i = 0; i < 6; i++) {
    const sl = Math.sin(lat);
    const n = WGS84_A / Math.sqrt(1.0 - E2 * sl * sl);
    alt = Math.abs(Math.cos(lat)) > 1e-9 ? p / Math.cos(lat) - n : Math.abs(r.z) - WGS84_B;
    lat = Math.atan2(r.z, p * (1.0 - (E2 * n) / (n + alt)));
  }
  return { lat: lat * RAD2DEG, lon: lon * RAD2DEG, alt };
}

export function sunDirInertial(date: Date): Vec3 {
  const n = julianDate(date) - 2451545.0;
  const l = (280.46 + 0.9856474 * n) * DEG2RAD;
  const g = (357.528 + 0.9856003 * n) * DEG2RAD;
  const lambda = l + 1.915 * DEG2RAD * Math.sin(g) + 0.02 * DEG2RAD * Math.sin(2 * g);
  const eps = (23.439 - 0.0000004 * n) * DEG2RAD;
  return {
    x: Math.cos(lambda),
    y: Math.cos(eps) * Math.sin(lambda),
    z: Math.sin(eps) * Math.sin(lambda),
  };
}

export function sunRightAscensionDeg(date: Date): number {
  const s = sunDirInertial(date);
  return ((Math.atan2(s.y, s.x) * RAD2DEG) % 360 + 360) % 360;
}

export function sunElevationDeg(site: Geodetic, date: Date): number {
  const sEcef = v3.rotZ(sunDirInertial(date), -gmstRad(date));
  const lat = site.lat * DEG2RAD;
  const lon = site.lon * DEG2RAD;
  const up = {
    x: Math.cos(lat) * Math.cos(lon),
    y: Math.cos(lat) * Math.sin(lon),
    z: Math.sin(lat),
  };
  return Math.asin(Math.max(-1, Math.min(1, v3.dot(sEcef, up)))) * RAD2DEG;
}

export function inEclipse(rTeme: Vec3, date: Date): boolean {
  const s = sunDirInertial(date);
  const along = v3.dot(rTeme, s);
  if (along > 0) return false;
  const perp = v3.norm(v3.sub(rTeme, v3.scale(s, along)));
  return perp < WGS84_A;
}

export function sunSyncInclinationDeg(altitude_km: number): number {
  const a = WGS84_A + altitude_km;
  const omegaDot = (2 * Math.PI) / (365.24219 * 86400.0);
  const cosI =
    (-2.0 * Math.pow(a, 3.5) * omegaDot) /
    (3.0 * J2 * WGS84_A * WGS84_A * Math.sqrt(MU_EARTH));
  return Math.acos(Math.max(-1, Math.min(1, cosI))) * RAD2DEG;
}

export function raanForLtanDeg(date: Date, ltan_hours: number): number {
  return ((sunRightAscensionDeg(date) + (ltan_hours - 12.0) * 15.0) % 360 + 360) % 360;
}

export function lookAngles(site: Geodetic, targetEcef: Vec3): { az_deg: number; el_deg: number; range_km: number } {
  const siteEcef = geodeticToEcef(site);
  const rho = v3.sub(targetEcef, siteEcef);
  const range = v3.norm(rho);
  const u = v3.scale(rho, 1 / range);
  const lat = site.lat * DEG2RAD;
  const lon = site.lon * DEG2RAD;
  const up = { x: Math.cos(lat) * Math.cos(lon), y: Math.cos(lat) * Math.sin(lon), z: Math.sin(lat) };
  const east = { x: -Math.sin(lon), y: Math.cos(lon), z: 0 };
  const north = { x: -Math.sin(lat) * Math.cos(lon), y: -Math.sin(lat) * Math.sin(lon), z: Math.cos(lat) };
  const el = Math.asin(Math.max(-1, Math.min(1, v3.dot(u, up)))) * RAD2DEG;
  const az = ((Math.atan2(v3.dot(u, east), v3.dot(u, north)) * RAD2DEG) % 360 + 360) % 360;
  return { az_deg: az, el_deg: el, range_km: range };
}

export function rayEllipsoid(origin: Vec3, dir: Vec3, h = 0): Vec3 | null {
  const a = WGS84_A + h;
  const b = WGS84_B + h;
  const o = { x: origin.x / a, y: origin.y / a, z: origin.z / b };
  const d = { x: dir.x / a, y: dir.y / a, z: dir.z / b };
  const qa = v3.dot(d, d);
  const qb = 2 * v3.dot(o, d);
  const qc = v3.dot(o, o) - 1;
  const disc = qb * qb - 4 * qa * qc;
  if (disc < 0) return null;
  const s = Math.sqrt(disc);
  const t1 = (-qb - s) / (2 * qa);
  const t2 = (-qb + s) / (2 * qa);
  const t = t1 > 0 ? t1 : t2 > 0 ? t2 : -1;
  if (t <= 0) return null;
  return v3.add(origin, v3.scale(dir, t));
}

export interface SatState {
  rTeme: Vec3;
  vTeme: Vec3;
  rEcef: Vec3;
  geodetic: Geodetic;
  speedKmS: number;
  periodMin: number;
  inSunlight: boolean;
}

/**
 * Propagate a SatelliteObject at `date` using either SGP4 (TLE) or J2-perturbed Keplerian.
 */
export function propagateSatellite(sat: SatelliteObject, date: Date): SatState | null {
  if (sat.source_mode === 'tle' && sat.tle_line1 && sat.tle_line2) {
    try {
      const satrec = satellite.twoline2satrec(sat.tle_line1.trim(), sat.tle_line2.trim());
      const pv = satellite.propagate(satrec, date);
      if (pv.position && typeof pv.position !== 'boolean' && pv.velocity && typeof pv.velocity !== 'boolean') {
        const rTeme: Vec3 = { x: pv.position.x, y: pv.position.y, z: pv.position.z };
        const vTeme: Vec3 = { x: pv.velocity.x, y: pv.velocity.y, z: pv.velocity.z };
        const rEcef = temeToEcef(rTeme, date);
        const geodetic = ecefToGeodetic(rEcef);
        const speedKmS = v3.norm(vTeme);
        const meanMotionRadMin = satrec.no; // rad/min
        const periodMin = (2 * Math.PI) / meanMotionRadMin;
        return {
          rTeme,
          vTeme,
          rEcef,
          geodetic,
          speedKmS,
          periodMin,
          inSunlight: !inEclipse(rTeme, date),
        };
      }
    } catch {
      // fall through to Keplerian if TLE fails
    }
  }

  // J2 Secular + Keplerian propagation matching crates/core/src/orbit.rs
  const k = sat.keplerian;
  const a = Math.max(WGS84_A + 100, WGS84_A + k.altitude_km);
  const e = Math.max(0, Math.min(0.92, k.eccentricity));
  const iRad = k.inclination_deg * DEG2RAD;
  const epochMs = Date.parse(sat.epoch_iso) || Date.now();
  const dtSec = (date.getTime() - epochMs) / 1000.0;

  const n = Math.sqrt(MU_EARTH / (a * a * a)); // rad/s
  const p = a * (1 - e * e);
  const j2Factor = 1.5 * J2 * Math.pow(WGS84_A / p, 2) * n;

  // Secular J2 nodal regression & apsidal precession
  const raanDot = -j2Factor * Math.cos(iRad);
  const argPerigeeDot = 0.5 * j2Factor * (5 * Math.cos(iRad) * Math.cos(iRad) - 1);
  const meanAnomalyDot = n + 0.5 * j2Factor * Math.sqrt(1 - e * e) * (3 * Math.cos(iRad) * Math.cos(iRad) - 1);

  const raan = k.raan_deg * DEG2RAD + raanDot * dtSec;
  const omega = k.arg_perigee_deg * DEG2RAD + argPerigeeDot * dtSec;
  const M = k.mean_anomaly_deg * DEG2RAD + meanAnomalyDot * dtSec;

  // Solve Kepler's Equation M = E - e sin(E)
  let E = M;
  for (let iter = 0; iter < 8; iter++) {
    E = E - (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  }

  const sinE = Math.sin(E);
  const cosE = Math.cos(E);
  const sqrt1me2 = Math.sqrt(1 - e * e);
  const nu = Math.atan2(sqrt1me2 * sinE, cosE - e);
  const rMag = a * (1 - e * cosE);

  // Perifocal position & velocity
  const rP = rMag * Math.cos(nu);
  const rQ = rMag * Math.sin(nu);
  const vFactor = Math.sqrt(MU_EARTH * a) / rMag;
  const vP = -vFactor * sinE;
  const vQ = vFactor * sqrt1me2 * cosE;

  // Rotate Perifocal -> Inertial (TEME)
  const cO = Math.cos(raan);
  const sO = Math.sin(raan);
  const co = Math.cos(omega);
  const so = Math.sin(omega);
  const ci = Math.cos(iRad);
  const si = Math.sin(iRad);

  const P: Vec3 = {
    x: cO * co - sO * so * ci,
    y: sO * co + cO * so * ci,
    z: so * si,
  };
  const Q: Vec3 = {
    x: -cO * so - sO * co * ci,
    y: -sO * so + cO * co * ci,
    z: co * si,
  };

  const rTeme = v3.add(v3.scale(P, rP), v3.scale(Q, rQ));
  const vTeme = v3.add(v3.scale(P, vP), v3.scale(Q, vQ));
  const rEcef = temeToEcef(rTeme, date);
  const geodetic = ecefToGeodetic(rEcef);
  const periodMin = (2 * Math.PI) / n / 60.0;

  return {
    rTeme,
    vTeme,
    rEcef,
    geodetic,
    speedKmS: v3.norm(vTeme),
    periodMin,
    inSunlight: !inEclipse(rTeme, date),
  };
}

export interface BodyAxes {
  x: Vec3; // Along-track (~velocity)
  y: Vec3; // Cross-track right
  z: Vec3; // Nadir (towards Earth center)
}

export function computeBodyAxes(r: Vec3, v: Vec3): BodyAxes {
  const z = v3.normalize(v3.scale(r, -1));
  const y = v3.normalize(v3.scale(v3.cross(r, v), -1));
  const x = v3.cross(y, z);
  return { x, y, z };
}

export function slewAnglesToTarget(
  rEcef: Vec3,
  vEcefApprox: Vec3,
  targetEcef: Vec3,
  maxSlewDeg: number
): { roll_deg: number; pitch_deg: number; off_nadir_deg: number } | null {
  const nadir = v3.normalize(v3.scale(rEcef, -1));
  const toTgt = v3.sub(targetEcef, rEcef);
  const offNadirDeg = v3.angle(nadir, toTgt) * RAD2DEG;
  if (offNadirDeg > maxSlewDeg) return null;

  const axes = computeBodyAxes(rEcef, vEcefApprox);
  const u = v3.normalize(toTgt);
  const bx = v3.dot(u, axes.x);
  const by = v3.dot(u, axes.y);
  const bz = v3.dot(u, axes.z);
  if (bz <= 0.05) return null;

  const roll_deg = Math.asin(Math.max(-1, Math.min(1, by))) * RAD2DEG;
  const pitch_deg = Math.atan2(bx, bz) * RAD2DEG;
  return { roll_deg, pitch_deg, off_nadir_deg: offNadirDeg };
}

export interface SensorTelemetry {
  activeRollDeg: number;
  activePitchDeg: number;
  lockedTargetName: string | null;
  boresightDirEcef: Vec3;
  boresightGroundEcef: Vec3 | null;
  boresightGeodetic: Geodetic | null;
  slantRangeKm: number | null;
  offNadirDeg: number;
  gsdMeters: number | null;
  swathWidthKm: number | null;
  sunElevationAtTargetDeg: number | null;
  footprintEcef: Vec3[];
  footprintGeodetic: Geodetic[];
}

export function sensorRayEcef(axes: BodyAxes, rollDeg: number, pitchDeg: number, tx: number, ty: number): Vec3 {
  const rRad = rollDeg * DEG2RAD;
  const pRad = pitchDeg * DEG2RAD;
  const sr = Math.sin(rRad);
  const cr = Math.cos(rRad);
  const sp = Math.sin(pRad);
  const cp = Math.cos(pRad);

  let x = tx;
  let y = ty;
  let z = 1.0;

  // Roll about X
  const y1 = y * cr + z * sr;
  const z1 = -y * sr + z * cr;
  y = y1;
  z = z1;

  // Pitch about Y
  const x2 = x * cp + z * sp;
  const z2 = -x * sp + z * cp;
  x = x2;
  z = z2;

  return v3.normalize(
    v3.add(v3.add(v3.scale(axes.x, x), v3.scale(axes.y, y)), v3.scale(axes.z, z))
  );
}

export function computeSensorTelemetry(
  sat: SatelliteObject,
  state: SatState,
  date: Date,
  targets: TargetPointObject[]
): SensorTelemetry {
  const vEcef = temeToEcef(state.vTeme, date);
  const axes = computeBodyAxes(state.rEcef, vEcef);

  let activeRollDeg = sat.sensor.pointing_mode === 'nadir' ? 0 : sat.sensor.roll_deg;
  let activePitchDeg = sat.sensor.pointing_mode === 'nadir' ? 0 : sat.sensor.pitch_deg;
  let lockedTargetName: string | null = null;

  if (sat.sensor.pointing_mode === 'target_track') {
    const candidates = sat.sensor.target_id
      ? targets.filter((t) => t.id === sat.sensor.target_id)
      : targets;
    let bestOff = Infinity;
    for (const t of candidates) {
      const tGeo: Geodetic = { lat: t.lat, lon: t.lon, alt: t.alt_km };
      const tEcef = geodeticToEcef(tGeo);
      const look = lookAngles(tGeo, state.rEcef);
      if (look.el_deg <= 2.0) continue;
      const slew = slewAnglesToTarget(state.rEcef, vEcef, tEcef, sat.sensor.max_slew_deg);
      if (slew && slew.off_nadir_deg < bestOff) {
        bestOff = slew.off_nadir_deg;
        activeRollDeg = slew.roll_deg;
        activePitchDeg = slew.pitch_deg;
        lockedTargetName = t.name;
      }
    }
  }

  const boresightDirEcef = sensorRayEcef(axes, activeRollDeg, activePitchDeg, 0, 0);
  const boresightGroundEcef = rayEllipsoid(state.rEcef, boresightDirEcef, 0);
  const boresightGeodetic = boresightGroundEcef ? ecefToGeodetic(boresightGroundEcef) : null;

  const slantRangeKm = boresightGroundEcef
    ? v3.norm(v3.sub(boresightGroundEcef, state.rEcef))
    : null;

  const nadir = v3.normalize(v3.scale(state.rEcef, -1));
  const offNadirDeg = v3.angle(nadir, boresightDirEcef) * RAD2DEG;

  const gsdMeters =
    slantRangeKm !== null
      ? (slantRangeKm * 1000.0 * (sat.sensor.pixel_um * 1e-6)) / (sat.sensor.focal_mm * 1e-3)
      : null;

  const sunElevationAtTargetDeg = boresightGeodetic
    ? sunElevationDeg(boresightGeodetic, date)
    : null;

  // Edge rays & ground footprint
  const nSamples = 8;
  const edgeDirs: Vec3[] = [];
  if (sat.sensor.fov.type === 'conic') {
    const t = Math.tan(sat.sensor.fov.half_angle_deg * DEG2RAD);
    const total = 4 * nSamples;
    for (let i = 0; i < total; i++) {
      const a = (2 * Math.PI * i) / total;
      edgeDirs.push(sensorRayEcef(axes, activeRollDeg, activePitchDeg, t * Math.cos(a), t * Math.sin(a)));
    }
  } else {
    const ty = Math.tan(sat.sensor.fov.cross_half_deg * DEG2RAD);
    const tx = Math.tan(sat.sensor.fov.along_half_deg * DEG2RAD);
    const corners: Array<[number, number]> = [
      [tx, -ty],
      [tx, ty],
      [-tx, ty],
      [-tx, -ty],
    ];
    for (let k = 0; k < 4; k++) {
      const [ax, ay] = corners[k];
      const [bx, by] = corners[(k + 1) % 4];
      for (let i = 0; i < nSamples; i++) {
        const f = i / nSamples;
        edgeDirs.push(
          sensorRayEcef(axes, activeRollDeg, activePitchDeg, ax + (bx - ax) * f, ay + (by - ay) * f)
        );
      }
    }
  }

  const footprintEcef: Vec3[] = [];
  const footprintGeodetic: Geodetic[] = [];
  for (const d of edgeDirs) {
    const hit = rayEllipsoid(state.rEcef, d, 0);
    if (hit) {
      footprintEcef.push(hit);
      footprintGeodetic.push(ecefToGeodetic(hit));
    }
  }

  // Swath width
  const crossHalfDeg =
    sat.sensor.fov.type === 'conic'
      ? sat.sensor.fov.half_angle_deg
      : sat.sensor.fov.cross_half_deg;
  const tySwath = Math.tan(crossHalfDeg * DEG2RAD);
  const leftHit = rayEllipsoid(
    state.rEcef,
    sensorRayEcef(axes, activeRollDeg, activePitchDeg, 0, -tySwath),
    0
  );
  const rightHit = rayEllipsoid(
    state.rEcef,
    sensorRayEcef(axes, activeRollDeg, activePitchDeg, 0, tySwath),
    0
  );
  const swathWidthKm =
    leftHit && rightHit ? 6371.0 * v3.angle(leftHit, rightHit) : null;

  return {
    activeRollDeg,
    activePitchDeg,
    lockedTargetName,
    boresightDirEcef,
    boresightGroundEcef,
    boresightGeodetic,
    slantRangeKm,
    offNadirDeg,
    gsdMeters,
    swathWidthKm,
    sunElevationAtTargetDeg,
    footprintEcef,
    footprintGeodetic,
  };
}

/**
 * Compute Access & Imaging windows for the STK Gantt Timeline Bar.
 */
export function computeGanttEvents(
  satellites: SatelliteObject[],
  stations: GroundStationObject[],
  targets: TargetPointObject[],
  startMs: number,
  durationHours: number,
  minSunElDeg = 5.0
): GanttEventItem[] {
  const endMs = startMs + durationHours * 3600_000;
  const stepMs = 25_000; // 25s step
  const events: GanttEventItem[] = [];
  let seq = 0;

  for (const sat of satellites) {
    if (!sat.visible) continue;

    // Ground Station Passes
    for (const st of stations) {
      const siteGeo: Geodetic = { lat: st.lat, lon: st.lon, alt: st.alt_km };
      let inPass = false;
      let passStart = startMs;
      let maxEl = -90;
      let bestMs = startMs;

      for (let t = startMs; t <= endMs; t += stepMs) {
        const state = propagateSatellite(sat, new Date(t));
        const el = state ? lookAngles(siteGeo, state.rEcef).el_deg : -90;
        if (el >= st.min_el_deg) {
          if (!inPass) {
            inPass = true;
            passStart = t;
            maxEl = el;
            bestMs = t;
          } else if (el > maxEl) {
            maxEl = el;
            bestMs = t;
          }
        } else if (inPass) {
          inPass = false;
          seq++;
          events.push({
            id: `pass-${seq}`,
            kind: 'station_pass',
            sat_id: sat.id,
            sat_name: sat.name,
            sat_color: sat.color,
            target_id: st.id,
            target_name: st.name,
            start_ms: passStart,
            end_ms: t,
            best_ms: bestMs,
            duration_s: (t - passStart) / 1000,
            metric_value: maxEl,
          });
        }
      }
    }

    // Target Imaging Windows
    for (const tgt of targets) {
      const tgtGeo: Geodetic = { lat: tgt.lat, lon: tgt.lon, alt: tgt.alt_km };
      const tgtEcef = geodeticToEcef(tgtGeo);
      let inWin = false;
      let winStart = startMs;
      let minOff = 180;
      let bestMs = startMs;
      let bestSun = 0;

      for (let t = startMs; t <= endMs; t += stepMs) {
        const d = new Date(t);
        const state = propagateSatellite(sat, d);
        if (!state) continue;
        const look = lookAngles(tgtGeo, state.rEcef);
        const nadir = v3.normalize(v3.scale(state.rEcef, -1));
        const offDeg = v3.angle(nadir, v3.sub(tgtEcef, state.rEcef)) * RAD2DEG;
        const sunEl = sunElevationDeg(tgtGeo, d);

        const canImage =
          look.el_deg > 5.0 &&
          offDeg <= sat.sensor.max_slew_deg &&
          sunEl >= minSunElDeg;

        if (canImage) {
          if (!inWin) {
            inWin = true;
            winStart = t;
            minOff = offDeg;
            bestMs = t;
            bestSun = sunEl;
          } else if (offDeg < minOff) {
            minOff = offDeg;
            bestMs = t;
            bestSun = sunEl;
          }
        } else if (inWin) {
          inWin = false;
          seq++;
          events.push({
            id: `img-${seq}`,
            kind: 'target_imaging',
            sat_id: sat.id,
            sat_name: sat.name,
            sat_color: sat.color,
            target_id: tgt.id,
            target_name: tgt.name,
            start_ms: winStart,
            end_ms: t,
            best_ms: bestMs,
            duration_s: (t - winStart) / 1000,
            metric_value: minOff,
            sun_el_deg: bestSun,
          });
        }
      }
    }
  }

  return events.sort((a, b) => a.start_ms - b.start_ms);
}

function pointInPolygon(lat: number, lon: number, poly: Array<{ lat: number; lon: number }>): boolean {
  if (poly.length < 3) return false;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const yi = poly[i].lat;
    const xi = poly[i].lon;
    const yj = poly[j].lat;
    const xj = poly[j].lon;
    const intersect =
      yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Multi-pass Area Target Polygon Coverage computation.
 */
export function computeAreaCoverage(
  sat: SatelliteObject,
  area: AreaTargetObject,
  startMs: number,
  durationHours: number,
  gridResDeg = 0.45
): AreaCoverageSummary {
  const poly = area.vertices;
  if (poly.length < 3) {
    return { total_cells: 0, covered_cells: 0, coverage_percent: 0, cells: [] };
  }
  const lats = poly.map((p) => p.lat);
  const lons = poly.map((p) => p.lon);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);

  const cells: GridCellCoverage[] = [];
  for (let lat = minLat + gridResDeg * 0.4; lat <= maxLat; lat += gridResDeg) {
    for (let lon = minLon + gridResDeg * 0.4; lon <= maxLon; lon += gridResDeg) {
      if (pointInPolygon(lat, lon, poly)) {
        cells.push({ lat, lon, covered: false, hit_count: 0, first_hit_iso: null });
      }
    }
  }
  if (cells.length === 0) {
    const cLat = lats.reduce((a, b) => a + b, 0) / lats.length;
    const cLon = lons.reduce((a, b) => a + b, 0) / lons.length;
    cells.push({ lat: cLat, lon: cLon, covered: false, hit_count: 0, first_hit_iso: null });
  }

  const cellEcefs = cells.map((c) => geodeticToEcef({ lat: c.lat, lon: c.lon, alt: 0 }));
  const crossHalfRad =
    (sat.sensor.fov.type === 'conic'
      ? sat.sensor.fov.half_angle_deg
      : sat.sensor.fov.cross_half_deg) * DEG2RAD;
  const alongHalfRad = Math.max(
    0.04,
    (sat.sensor.fov.type === 'conic'
      ? sat.sensor.fov.half_angle_deg
      : sat.sensor.fov.along_half_deg) * DEG2RAD
  );
  const rollRad = (sat.sensor.pointing_mode === 'nadir' ? 0 : sat.sensor.roll_deg) * DEG2RAD;
  const pitchRad = (sat.sensor.pointing_mode === 'nadir' ? 0 : sat.sensor.pitch_deg) * DEG2RAD;

  const endMs = startMs + durationHours * 3600_000;
  const dtMs = 10_000;
  for (let t = startMs; t <= endMs; t += dtMs) {
    const d = new Date(t);
    const st = propagateSatellite(sat, d);
    if (!st) continue;
    const vEcef = temeToEcef(st.vTeme, d);
    const axes = computeBodyAxes(st.rEcef, vEcef);
    for (let i = 0; i < cells.length; i++) {
      const toCell = v3.sub(cellEcefs[i], st.rEcef);
      const u = v3.normalize(toCell);
      const bz = v3.dot(u, axes.z);
      if (bz <= 0.15) continue;
      const bx = v3.dot(u, axes.x);
      const by = v3.dot(u, axes.y);
      const cRoll = Math.asin(Math.max(-1, Math.min(1, by)));
      const cPitch = Math.atan2(bx, bz);
      if (
        Math.abs(cRoll - rollRad) <= crossHalfRad &&
        Math.abs(cPitch - pitchRad) <= alongHalfRad
      ) {
        cells[i].covered = true;
        cells[i].hit_count += 1;
        if (!cells[i].first_hit_iso) {
          cells[i].first_hit_iso = d.toISOString();
        }
      }
    }
  }

  const covered_cells = cells.filter((c) => c.covered).length;
  const total_cells = cells.length;
  return {
    total_cells,
    covered_cells,
    coverage_percent: total_cells > 0 ? (covered_cells / total_cells) * 100 : 0,
    cells,
  };
}
