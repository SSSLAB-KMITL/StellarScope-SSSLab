import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AreaCoverageSummary,
  CatalogEntry,
  computeAreaCoverage,
  computeGanttEvents,
  computeSensorTelemetry,
  propagateSatellite,
  raanForLtanDeg,
  SatelliteObject,
  sunSyncInclinationDeg,
} from './engine/orbitalEngine';
import {
  createInitialScenario,
  getEducationalOrbitPresets,
  OFFLINE_SATELLITE_CATALOG,
  searchCelestrakOnline,
} from './engine/catalogAndScenarios';
import { CesiumWorkspaces, MapClickMode, VectorVisConfig } from './components/CesiumWorkspaces';
import { GanttTimelineBar } from './components/GanttTimelineBar';

export const App: React.FC = () => {
  const initial = useMemo(() => createInitialScenario(new Date()), []);

  const [simTimeMs, setSimTimeMs] = useState<number>(() => Date.now());
  const [windowStartMs, setWindowStartMs] = useState<number>(() => Date.now());
  const [windowHours] = useState<number>(24);
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [timeSpeed, setTimeSpeed] = useState<number>(60);

  const [satellites, setSatellites] = useState<SatelliteObject[]>(initial.satellites);
  const [selectedSatId, setSelectedSatId] = useState<string>(initial.satellites[0].id);
  const [stations, setStations] = useState(initial.stations);
  const [targets, setTargets] = useState(initial.targets);
  const [areaTarget, setAreaTarget] = useState(initial.areaTarget);
  const [areaCoverage, setAreaCoverage] = useState<AreaCoverageSummary | null>(null);

  const [viewLayout, setViewLayout] = useState<'split_3d_2d' | 'only_3d' | 'only_2d'>('split_3d_2d');
  const [mapImageryMode, setMapImageryMode] = useState<
    'hybrid_highres' | 'offline_blue_marble' | 'osm'
  >('hybrid_highres');
  const [cameraFollowSat, setCameraFollowSat] = useState<boolean>(false);
  const [showSensorPiP, setShowSensorPiP] = useState<boolean>(true);
  const [mapClickMode, setMapClickMode] = useState<MapClickMode>('none');

  const [vectorVis, setVectorVis] = useState<VectorVisConfig>({
    showEciAxes: false,
    showEcefAxes: false,
    showSatBodyVectors: true,
    showOrbitalPlane: false,
    showDayNightLighting: true,
  });

  const [rightTab, setRightTab] = useState<'kepler' | 'sensor' | 'coverage'>('kepler');

  // CelesTrak / Catalog Modal State
  const [showCatalogModal, setShowCatalogModal] = useState<boolean>(false);
  const [catalogQuery, setCatalogQuery] = useState<string>('');
  const [catalogResults, setCatalogResults] = useState<CatalogEntry[]>(OFFLINE_SATELLITE_CATALOG);
  const [catalogLoading, setCatalogLoading] = useState<boolean>(false);
  const [customTleText, setCustomTleText] = useState<string>('');

  const orbitPresets = useMemo(() => getEducationalOrbitPresets(new Date(windowStartMs)), [windowStartMs]);

  const selectedSat = useMemo(
    () => satellites.find((s) => s.id === selectedSatId) || satellites[0] || null,
    [satellites, selectedSatId]
  );

  // Simulation Animation Loop
  useEffect(() => {
    if (!isPlaying) return;
    let lastFrame = performance.now();
    let rafId = 0;
    const tick = (now: number) => {
      const dtRealSec = (now - lastFrame) / 1000;
      lastFrame = now;
      setSimTimeMs((prev) => prev + dtRealSec * timeSpeed * 1000);
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [isPlaying, timeSpeed]);

  // Compute Access & Imaging Gantt Events
  const [ganttVersion, setGanttVersion] = useState(0);
  const ganttEvents = useMemo(() => {
    void ganttVersion;
    return computeGanttEvents(satellites, stations, targets, windowStartMs, windowHours);
  }, [satellites, stations, targets, windowStartMs, windowHours, ganttVersion]);

  // Compute Area Coverage when requested or when selected satellite changes
  useEffect(() => {
    if (!selectedSat) return;
    const cov = computeAreaCoverage(selectedSat, areaTarget, windowStartMs, windowHours, 0.45);
    setAreaCoverage(cov);
  }, [selectedSat?.id, areaTarget, windowStartMs, windowHours]);

  const updateSelectedSat = useCallback(
    (updater: (sat: SatelliteObject) => SatelliteObject) => {
      setSatellites((prev) =>
        prev.map((s) => (s.id === selectedSatId ? updater(s) : s))
      );
    },
    [selectedSatId]
  );

  // Live telemetry for right-hand inspector
  const currentTelemetry = useMemo(() => {
    if (!selectedSat) return null;
    const date = new Date(simTimeMs);
    const state = propagateSatellite(selectedSat, date);
    if (!state) return null;
    const sensor = computeSensorTelemetry(selectedSat, state, date, targets);
    return { state, sensor };
  }, [selectedSat, simTimeMs, targets]);

  const handleMapPickLatLon = useCallback(
    (lat: number, lon: number) => {
      if (mapClickMode === 'add_target') {
        const id = `tgt-${Date.now()}`;
        setTargets((prev) => [
          ...prev,
          {
            id,
            name: `Target (${lat.toFixed(1)}°, ${lon.toFixed(1)}°)`,
            lat: Number(lat.toFixed(4)),
            lon: Number(lon.toFixed(4)),
            alt_km: 0,
            color: '#f97316',
          },
        ]);
        setMapClickMode('none');
      } else if (mapClickMode === 'add_station') {
        const id = `gs-${Date.now()}`;
        setStations((prev) => [
          ...prev,
          {
            id,
            name: `GS (${lat.toFixed(1)}°, ${lon.toFixed(1)}°)`,
            lat: Number(lat.toFixed(4)),
            lon: Number(lon.toFixed(4)),
            alt_km: 0.05,
            min_el_deg: 5.0,
            color: '#34d399',
          },
        ]);
        setMapClickMode('none');
      } else if (mapClickMode === 'add_area_vertex') {
        setAreaTarget((prev) => ({
          ...prev,
          vertices: [
            ...prev.vertices,
            { lat: Number(lat.toFixed(3)), lon: Number(lon.toFixed(3)) },
          ],
        }));
      }
    },
    [mapClickMode]
  );

  const handleAddFromCatalog = (entry: CatalogEntry) => {
    const palette = ['#38bdf8', '#4ade80', '#facc15', '#fb7185', '#c084fc', '#2dd4bf'];
    const color = palette[satellites.length % palette.length];
    const newSat: SatelliteObject = {
      id: `sat-${entry.id}-${Date.now()}`,
      name: entry.name,
      color,
      visible: true,
      source_mode: 'tle',
      tle_line1: entry.line1,
      tle_line2: entry.line2,
      keplerian: {
        altitude_km: 650,
        eccentricity: 0.001,
        inclination_deg: 98.0,
        raan_deg: 30,
        arg_perigee_deg: 0,
        mean_anomaly_deg: 0,
      },
      epoch_iso: new Date(simTimeMs).toISOString(),
      sensor: {
        enabled: true,
        fov: entry.default_sensor.fov,
        pointing_mode: entry.default_sensor.roll_deg !== 0 ? 'fixed_slew' : 'target_track',
        roll_deg: entry.default_sensor.roll_deg,
        pitch_deg: entry.default_sensor.pitch_deg,
        target_id: null,
        max_slew_deg: entry.max_slew_deg,
        focal_mm: entry.focal_mm,
        pixel_um: entry.pixel_um,
        swath_history_min: 20,
      },
      show_orbit: true,
      show_ground_track: true,
      show_footprint: true,
      show_swath: true,
    };
    setSatellites((prev) => [...prev, newSat]);
    setSelectedSatId(newSat.id);
    setShowCatalogModal(false);
  };

  const handleSearchCatalog = async () => {
    setCatalogLoading(true);
    const res = await searchCelestrakOnline(catalogQuery);
    setCatalogResults(res);
    setCatalogLoading(false);
  };

  const handleAddCustomTle = () => {
    const lines = customTleText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    let name = `TLE-${satellites.length + 1}`;
    let l1 = '';
    let l2 = '';
    if (lines.length >= 3 && lines[1].startsWith('1 ') && lines[2].startsWith('2 ')) {
      name = lines[0];
      l1 = lines[1];
      l2 = lines[2];
    } else if (lines.length >= 2 && lines[0].startsWith('1 ') && lines[1].startsWith('2 ')) {
      l1 = lines[0];
      l2 = lines[1];
    }
    if (!l1 || !l2) return;
    handleAddFromCatalog({
      id: `custom-${Date.now()}`,
      name,
      norad_id: 0,
      category: 'Custom TLE',
      description_th: 'เพิ่มจากข้อความ TLE',
      description_en: 'Custom TLE',
      line1: l1,
      line2: l2,
      default_sensor: {
        fov: { type: 'rectangular', cross_half_deg: 6.5, along_half_deg: 0.8 },
        roll_deg: 0,
        pitch_deg: 0,
      },
      focal_mm: 1200,
      pixel_um: 6.0,
      max_slew_deg: 30,
    });
    setCustomTleText('');
  };

  return (
    <div className="h-screen w-screen flex flex-col bg-slate-950 text-slate-100 overflow-hidden font-sans">
      {/* TOP STK COMMAND & PLAYBACK RIBBON */}
      <header className="h-12 bg-slate-900 border-b border-slate-800 px-3 flex items-center justify-between gap-2 shrink-0">
        {/* Brand & Add Catalog Button */}
        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-1.5 font-extrabold text-sm tracking-tight text-sky-400">
            <span className="text-lg">🛰️</span>
            <span>OrbitScope 2.0</span>
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-300 border border-sky-500/30">
              STK-Edu Edition
            </span>
          </div>

          <button
            onClick={() => setShowCatalogModal(true)}
            className="px-2.5 py-1 rounded-md bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs transition flex items-center gap-1 shadow"
          >
            <span>+ ดึงดาวเทียมจริง (CelesTrak / TLE)</span>
          </button>
        </div>

        {/* Simulation Clock & Transport Controls */}
        <div className="flex items-center gap-1.5 bg-slate-950 border border-slate-800 px-2.5 py-1 rounded-lg text-xs">
          <span className="font-mono text-sky-300 font-semibold w-40">
            {new Date(simTimeMs).toISOString().slice(0, 19).replace('T', ' ')} UTC
          </span>
          <button
            onClick={() => setSimTimeMs(windowStartMs)}
            className="px-1.5 py-0.5 rounded hover:bg-slate-800 text-slate-300"
            title="กลับไปจุดเริ่มต้นฉาก"
          >
            ⏮
          </button>
          <button
            onClick={() => setTimeSpeed((s) => -Math.abs(s))}
            className={`px-1.5 py-0.5 rounded ${
              timeSpeed < 0 ? 'bg-amber-500/20 text-amber-300' : 'hover:bg-slate-800 text-slate-300'
            }`}
            title="เดินเวลาย้อนกลับ"
          >
            ⏪
          </button>
          <button
            onClick={() => setIsPlaying((p) => !p)}
            className={`px-2.5 py-0.5 rounded font-bold ${
              isPlaying
                ? 'bg-amber-500 text-slate-950'
                : 'bg-emerald-500 text-slate-950'
            }`}
          >
            {isPlaying ? '⏸ หยุด' : '▶ เล่น'}
          </button>
          <button
            onClick={() => setTimeSpeed((s) => Math.abs(s))}
            className={`px-1.5 py-0.5 rounded ${
              timeSpeed > 0 ? 'bg-sky-500/20 text-sky-300' : 'hover:bg-slate-800 text-slate-300'
            }`}
            title="เดินเวลาไปข้างหน้า"
          >
            ⏩
          </button>
          <select
            value={Math.abs(timeSpeed)}
            onChange={(e) => {
              const sign = timeSpeed < 0 ? -1 : 1;
              setTimeSpeed(sign * Number(e.target.value));
            }}
            className="bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-[11px] font-mono text-slate-200"
          >
            <option value={1}>1x (เวลาจริง)</option>
            <option value={10}>10x</option>
            <option value={30}>30x</option>
            <option value={60}>60x (1 นาที/วิ)</option>
            <option value={300}>300x (5 นาที/วิ)</option>
            <option value={900}>900x (15 นาที/วิ)</option>
          </select>
          <button
            onClick={() => {
              const now = Date.now();
              setWindowStartMs(now);
              setSimTimeMs(now);
            }}
            className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px]"
          >
            เวลาปัจจุบัน
          </button>
        </div>

        {/* Viewport Layout, Imagery & Educational Vector Toggles */}
        <div className="flex items-center gap-1.5 text-xs">
          {/* Split 3D/2D Switcher */}
          <div className="flex bg-slate-950 border border-slate-800 rounded-md p-0.5">
            <button
              onClick={() => setViewLayout('split_3d_2d')}
              className={`px-2 py-0.5 rounded text-[11px] font-medium ${
                viewLayout === 'split_3d_2d'
                  ? 'bg-sky-500 text-slate-950 font-bold'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              3D + 2D
            </button>
            <button
              onClick={() => setViewLayout('only_3d')}
              className={`px-2 py-0.5 rounded text-[11px] font-medium ${
                viewLayout === 'only_3d'
                  ? 'bg-sky-500 text-slate-950 font-bold'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              3D ล้วน
            </button>
            <button
              onClick={() => setViewLayout('only_2d')}
              className={`px-2 py-0.5 rounded text-[11px] font-medium ${
                viewLayout === 'only_2d'
                  ? 'bg-sky-500 text-slate-950 font-bold'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              2D ล้วน
            </button>
          </div>

          {/* Hybrid Imagery Selector */}
          <select
            value={mapImageryMode}
            onChange={(e) => setMapImageryMode(e.target.value as typeof mapImageryMode)}
            className="bg-slate-950 border border-slate-800 rounded-md px-2 py-1 text-[11px] text-slate-200"
            title="เลือกรูปแบบแผนที่โลก (Hybrid ออฟไลน์ + ออนไลน์ความละเอียดสูง)"
          >
            <option value="hybrid_highres">🗺️ แผนที่ Hybrid (ดาวเทียมละเอียดสูง + Offline)</option>
            <option value="offline_blue_marble">🌏 แผนที่ Offline Blue Marble 100%</option>
            <option value="osm">🏙️ แผนที่ถนน OpenStreetMap</option>
          </select>

          {/* 3D Educational Vector Quick Toggles */}
          <button
            onClick={() =>
              setVectorVis((v) => ({ ...v, showEciAxes: !v.showEciAxes }))
            }
            className={`px-2 py-1 rounded border text-[11px] font-medium transition ${
              vectorVis.showEciAxes
                ? 'bg-red-500/20 border-red-400 text-red-300'
                : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
            }`}
            title="แสดงแกนพิกัดเฉื่อย ECI (ชี้จุดวสันตวิษุวัต)"
          >
            แกน ECI
          </button>
          <button
            onClick={() =>
              setVectorVis((v) => ({ ...v, showEcefAxes: !v.showEcefAxes }))
            }
            className={`px-2 py-1 rounded border text-[11px] font-medium transition ${
              vectorVis.showEcefAxes
                ? 'bg-orange-500/20 border-orange-400 text-orange-300'
                : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
            }`}
            title="แสดงแกนพิกัดหมุนตามโลก ECEF (0° Greenwich)"
          >
            แกน ECEF
          </button>
          <button
            onClick={() =>
              setVectorVis((v) => ({ ...v, showSatBodyVectors: !v.showSatBodyVectors }))
            }
            className={`px-2 py-1 rounded border text-[11px] font-medium transition ${
              vectorVis.showSatBodyVectors
                ? 'bg-emerald-500/20 border-emerald-400 text-emerald-300'
                : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
            }`}
            title="แสดงเวกเตอร์ความเร็ว (V), Nadir, Orbit Normal และดวงอาทิตย์บนตัวดาวเทียม"
          >
            เวกเตอร์ดาวเทียม
          </button>
          <button
            onClick={() =>
              setVectorVis((v) => ({ ...v, showOrbitalPlane: !v.showOrbitalPlane }))
            }
            className={`px-2 py-1 rounded border text-[11px] font-medium transition ${
              vectorVis.showOrbitalPlane
                ? 'bg-purple-500/20 border-purple-400 text-purple-300'
                : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
            }`}
            title="แสดงแผ่นระนาบวงโคจร 3D พร้อมมุม Inclination (i) และ RAAN (Ω)"
          >
            ระนาบวงโคจร
          </button>
          <button
            onClick={() => setShowSensorPiP((p) => !p)}
            className={`px-2 py-1 rounded border text-[11px] font-semibold transition ${
              showSensorPiP
                ? 'bg-sky-500/25 border-sky-400 text-sky-300'
                : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
            }`}
          >
            📷 จอกล้อง PiP
          </button>
        </div>
      </header>

      {/* MAIN WORKSPACE ROW: LEFT OBJECT BROWSER | CENTER 3D+2D VIEWPORTS | RIGHT INSPECTOR */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* LEFT PANEL: STK OBJECT BROWSER TREE */}
        <aside className="w-64 bg-slate-900 border-r border-slate-800 flex flex-col shrink-0 text-xs overflow-y-auto">
          <div className="p-3 border-b border-slate-800 space-y-2">
            <div className="font-bold text-slate-200 flex items-center justify-between">
              <span>📂 วัตถุในฉาก (Object Browser)</span>
            </div>

            {/* Satellites Section */}
            <div className="space-y-1">
              <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center justify-between">
                <span>ดาวเทียม ({satellites.length})</span>
                <button
                  onClick={() => setShowCatalogModal(true)}
                  className="text-sky-400 hover:underline text-[11px]"
                >
                  + เพิ่ม
                </button>
              </div>
              {satellites.map((sat) => {
                const isSel = sat.id === selectedSatId;
                return (
                  <div
                    key={sat.id}
                    onClick={() => setSelectedSatId(sat.id)}
                    className={`flex items-center justify-between px-2 py-1.5 rounded-md cursor-pointer transition ${
                      isSel
                        ? 'bg-sky-500/20 border border-sky-500/50 text-white font-semibold'
                        : 'hover:bg-slate-800/70 text-slate-300'
                    }`}
                  >
                    <div className="flex items-center gap-2 truncate">
                      <input
                        type="checkbox"
                        checked={sat.visible}
                        onChange={(e) => {
                          e.stopPropagation();
                          setSatellites((prev) =>
                            prev.map((s) =>
                              s.id === sat.id ? { ...s, visible: e.target.checked } : s
                            )
                          );
                        }}
                        className="accent-sky-400"
                      />
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: sat.color }}
                      />
                      <span className="truncate">{sat.name}</span>
                    </div>
                    {satellites.length > 1 && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          const rem = satellites.filter((s) => s.id !== sat.id);
                          setSatellites(rem);
                          if (isSel && rem[0]) setSelectedSatId(rem[0].id);
                        }}
                        className="text-slate-500 hover:text-rose-400 px-1"
                        title="ลบดาวเทียม"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Ground Stations Section */}
          <div className="p-3 border-b border-slate-800 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-slate-400 uppercase">
                📡 สถานีภาคพื้นดิน ({stations.length})
              </span>
              <button
                onClick={() =>
                  setMapClickMode((m) => (m === 'add_station' ? 'none' : 'add_station'))
                }
                className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                  mapClickMode === 'add_station'
                    ? 'bg-emerald-500 text-slate-950'
                    : 'bg-slate-800 text-emerald-400 hover:bg-slate-700'
                }`}
              >
                {mapClickMode === 'add_station' ? 'คลิกบนแผนที่...' : '+ คลิกวางสถานี'}
              </button>
            </div>
            {stations.map((gs) => (
              <div
                key={gs.id}
                className="flex items-center justify-between px-2 py-1 rounded bg-slate-950/60 text-slate-300 text-[11px]"
              >
                <span className="truncate">
                  📡 {gs.name} ({gs.lat.toFixed(1)}°, {gs.lon.toFixed(1)}°)
                </span>
                <button
                  onClick={() => setStations((prev) => prev.filter((x) => x.id !== gs.id))}
                  className="text-slate-500 hover:text-rose-400 px-1"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>

          {/* Imaging Point Targets Section */}
          <div className="p-3 border-b border-slate-800 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-slate-400 uppercase">
                🎯 เป้าหมายถ่ายภาพ ({targets.length})
              </span>
              <button
                onClick={() =>
                  setMapClickMode((m) => (m === 'add_target' ? 'none' : 'add_target'))
                }
                className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                  mapClickMode === 'add_target'
                    ? 'bg-amber-500 text-slate-950'
                    : 'bg-slate-800 text-amber-400 hover:bg-slate-700'
                }`}
              >
                {mapClickMode === 'add_target' ? 'คลิกบนแผนที่...' : '+ คลิกวางเป้าหมาย'}
              </button>
            </div>
            {targets.map((tgt) => (
              <div
                key={tgt.id}
                className="flex items-center justify-between px-2 py-1 rounded bg-slate-950/60 text-slate-300 text-[11px]"
              >
                <span className="truncate">
                  🎯 {tgt.name} ({tgt.lat.toFixed(1)}°, {tgt.lon.toFixed(1)}°)
                </span>
                <button
                  onClick={() => setTargets((prev) => prev.filter((x) => x.id !== tgt.id))}
                  className="text-slate-500 hover:text-rose-400 px-1"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>

          {/* Polygon Area Target Section */}
          <div className="p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-purple-300 uppercase">
                🗺️ พื้นที่เป้าหมาย (Area Target)
              </span>
            </div>
            <div className="p-2 rounded-lg bg-slate-950 border border-purple-500/30 space-y-2 text-[11px]">
              <div className="font-semibold text-purple-200">{areaTarget.name}</div>
              <div className="text-slate-400">
                จุดยอด (Vertices): {areaTarget.vertices.length} จุด | ความครอบคลุม:{' '}
                <span className="text-emerald-400 font-bold">
                  {areaCoverage ? `${areaCoverage.coverage_percent.toFixed(1)}%` : '—'}
                </span>
              </div>
              <div className="flex gap-1.5">
                <button
                  onClick={() =>
                    setMapClickMode((m) =>
                      m === 'add_area_vertex' ? 'none' : 'add_area_vertex'
                    )
                  }
                  className={`flex-1 py-1 rounded font-semibold text-center ${
                    mapClickMode === 'add_area_vertex'
                      ? 'bg-purple-500 text-slate-950'
                      : 'bg-slate-800 text-purple-300 hover:bg-slate-700'
                  }`}
                >
                  {mapClickMode === 'add_area_vertex'
                    ? '✅ เสร็จสิ้นการวาด'
                    : '✏️ คลิกเพิ่มจุดขอบเขต'}
                </button>
                <button
                  onClick={() =>
                    setAreaTarget((prev) => ({ ...prev, vertices: [] }))
                  }
                  className="px-2 py-1 rounded bg-slate-800 hover:bg-rose-950 text-slate-300"
                  title="ล้างกรอบพื้นที่เพื่อวาดใหม่"
                >
                  ล้าง
                </button>
              </div>
            </div>
          </div>
        </aside>

        {/* CENTER: 3D GLOBE + 2D MAP + SENSOR CAMERA PIP */}
        <CesiumWorkspaces
          simTimeMs={simTimeMs}
          satellites={satellites}
          selectedSatId={selectedSatId}
          onSelectSat={setSelectedSatId}
          stations={stations}
          targets={targets}
          areaTarget={areaTarget}
          areaCoverage={areaCoverage}
          vectorVis={vectorVis}
          mapImageryMode={mapImageryMode}
          viewLayout={viewLayout}
          cameraFollowSat={cameraFollowSat}
          onToggleCameraFollow={setCameraFollowSat}
          showSensorPiP={showSensorPiP}
          mapClickMode={mapClickMode}
          onMapPickLatLon={handleMapPickLatLon}
        />

        {/* RIGHT PANEL: INTERACTIVE KEPLERIAN SANDBOX & SENSOR SLEW INSPECTOR */}
        <aside className="w-80 bg-slate-900 border-l border-slate-800 flex flex-col shrink-0 text-xs overflow-y-auto">
          {selectedSat && currentTelemetry && (
            <>
              {/* Selected Satellite Header & Live Telemetry Card */}
              <div className="p-3 border-b border-slate-800 bg-slate-950/60 space-y-2">
                <div className="flex items-center gap-2">
                  <span
                    className="w-3 h-3 rounded-full shrink-0"
                    style={{ backgroundColor: selectedSat.color }}
                  />
                  <input
                    type="text"
                    value={selectedSat.name}
                    onChange={(e) =>
                      updateSelectedSat((s) => ({ ...s, name: e.target.value }))
                    }
                    className="bg-transparent font-bold text-sm text-white border-b border-transparent focus:border-sky-500 outline-none flex-1"
                  />
                </div>

                {/* Live State Grid */}
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] bg-slate-900/90 p-2.5 rounded-lg border border-slate-800">
                  <div className="text-slate-400">
                    ละติจูด:{' '}
                    <span className="font-mono text-slate-100">
                      {currentTelemetry.state.geodetic.lat.toFixed(2)}°
                    </span>
                  </div>
                  <div className="text-slate-400">
                    ลองจิจูด:{' '}
                    <span className="font-mono text-slate-100">
                      {currentTelemetry.state.geodetic.lon.toFixed(2)}°
                    </span>
                  </div>
                  <div className="text-slate-400">
                    ความสูง:{' '}
                    <span className="font-mono text-sky-300 font-semibold">
                      {currentTelemetry.state.geodetic.alt.toFixed(1)} km
                    </span>
                  </div>
                  <div className="text-slate-400">
                    ความเร็ว:{' '}
                    <span className="font-mono text-slate-100">
                      {currentTelemetry.state.speedKmS.toFixed(2)} km/s
                    </span>
                  </div>
                  <div className="text-slate-400">
                    คาบโคจร:{' '}
                    <span className="font-mono text-slate-100">
                      {currentTelemetry.state.periodMin.toFixed(1)} นาที
                    </span>
                  </div>
                  <div className="text-slate-400">
                    สถานะแสง:{' '}
                    <span
                      className={
                        currentTelemetry.state.inSunlight
                          ? 'text-amber-300 font-semibold'
                          : 'text-slate-400'
                      }
                    >
                      {currentTelemetry.state.inSunlight ? '☀ รับแสงอาทิตย์' : '🌑 ในเงาโลก'}
                    </span>
                  </div>
                </div>

                {/* Inspector Mode Tabs */}
                <div className="grid grid-cols-3 bg-slate-900 border border-slate-800 rounded-lg p-0.5 text-[11px]">
                  <button
                    onClick={() => setRightTab('kepler')}
                    className={`py-1 rounded font-semibold transition ${
                      rightTab === 'kepler'
                        ? 'bg-sky-500 text-slate-950'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    🪐 วงโคจร (Kepler)
                  </button>
                  <button
                    onClick={() => setRightTab('sensor')}
                    className={`py-1 rounded font-semibold transition ${
                      rightTab === 'sensor'
                        ? 'bg-sky-500 text-slate-950'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    📷 กล้อง & Slew
                  </button>
                  <button
                    onClick={() => setRightTab('coverage')}
                    className={`py-1 rounded font-semibold transition ${
                      rightTab === 'coverage'
                        ? 'bg-sky-500 text-slate-950'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    📐 สื่อการสอน
                  </button>
                </div>
              </div>

              {/* TAB 1: INTERACTIVE KEPLERIAN SANDBOX & ORBIT PRESETS */}
              {rightTab === 'kepler' && (
                <div className="p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-sky-400">
                      🎛️ ปรับค่าวงโคจรแบบเห็นผลทันที (Kepler Sandbox)
                    </span>
                  </div>

                  {selectedSat.source_mode === 'tle' && (
                    <div className="p-2 rounded bg-amber-500/15 border border-amber-500/40 text-amber-200 text-[11px] flex items-center justify-between">
                      <span>ดาวเทียมนี้ใช้ข้อมูล TLE จริง (SGP4)</span>
                      <button
                        onClick={() =>
                          updateSelectedSat((s) => ({ ...s, source_mode: 'keplerian' }))
                        }
                        className="px-2 py-0.5 rounded bg-amber-400 text-slate-950 font-bold"
                      >
                        ปลดล็อกเป็น Kepler
                      </button>
                    </div>
                  )}

                  {/* 6 Classical Orbital Element Sliders */}
                  <div className="space-y-2.5 bg-slate-950/70 p-2.5 rounded-lg border border-slate-800">
                    {/* Altitude */}
                    <div>
                      <div className="flex justify-between text-[11px] mb-0.5">
                        <span className="text-slate-300" title="ความสูงวงโคจรเหนือเส้นศูนย์สูตร">
                          ความสูง (Altitude h)
                        </span>
                        <span className="font-mono text-sky-300 font-semibold">
                          {selectedSat.keplerian.altitude_km.toFixed(0)} km
                        </span>
                      </div>
                      <input
                        type="range"
                        min={200}
                        max={36000}
                        step={10}
                        value={selectedSat.keplerian.altitude_km}
                        onChange={(e) =>
                          updateSelectedSat((s) => ({
                            ...s,
                            source_mode: 'keplerian',
                            keplerian: {
                              ...s.keplerian,
                              altitude_km: Number(e.target.value),
                            },
                          }))
                        }
                        className="w-full accent-sky-400"
                      />
                    </div>

                    {/* Eccentricity */}
                    <div>
                      <div className="flex justify-between text-[11px] mb-0.5">
                        <span className="text-slate-300" title="ความรีของวงโคจร (0 = วงกลม, >0 = วงรี)">
                          ความรีวงโคจร (Eccentricity e)
                        </span>
                        <span className="font-mono text-sky-300 font-semibold">
                          {selectedSat.keplerian.eccentricity.toFixed(4)}
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={0.78}
                        step={0.005}
                        value={selectedSat.keplerian.eccentricity}
                        onChange={(e) =>
                          updateSelectedSat((s) => ({
                            ...s,
                            source_mode: 'keplerian',
                            keplerian: {
                              ...s.keplerian,
                              eccentricity: Number(e.target.value),
                            },
                          }))
                        }
                        className="w-full accent-sky-400"
                      />
                    </div>

                    {/* Inclination */}
                    <div>
                      <div className="flex justify-between text-[11px] mb-0.5">
                        <span className="text-slate-300" title="มุมเอียงของระนาบวงโคจรเทียบกับเส้นศูนย์สูตร">
                          ความเอียงวงโคจร (Inclination i)
                        </span>
                        <span className="font-mono text-sky-300 font-semibold">
                          {selectedSat.keplerian.inclination_deg.toFixed(2)}°
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={140}
                        step={0.1}
                        value={selectedSat.keplerian.inclination_deg}
                        onChange={(e) =>
                          updateSelectedSat((s) => ({
                            ...s,
                            source_mode: 'keplerian',
                            keplerian: {
                              ...s.keplerian,
                              inclination_deg: Number(e.target.value),
                            },
                          }))
                        }
                        className="w-full accent-sky-400"
                      />
                    </div>

                    {/* RAAN */}
                    <div>
                      <div className="flex justify-between text-[11px] mb-0.5">
                        <span className="text-slate-300" title="Right Ascension of Ascending Node (มุมจุดตัดขาขึ้น)">
                          มุมจุดตัดขาขึ้น (RAAN Ω)
                        </span>
                        <span className="font-mono text-sky-300 font-semibold">
                          {selectedSat.keplerian.raan_deg.toFixed(1)}°
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={360}
                        step={1}
                        value={selectedSat.keplerian.raan_deg}
                        onChange={(e) =>
                          updateSelectedSat((s) => ({
                            ...s,
                            source_mode: 'keplerian',
                            keplerian: {
                              ...s.keplerian,
                              raan_deg: Number(e.target.value),
                            },
                          }))
                        }
                        className="w-full accent-sky-400"
                      />
                    </div>

                    {/* Argument of Perigee */}
                    <div>
                      <div className="flex justify-between text-[11px] mb-0.5">
                        <span className="text-slate-300">มุมจุดใกล้โลกที่สุด (Arg of Perigee ω)</span>
                        <span className="font-mono text-sky-300 font-semibold">
                          {selectedSat.keplerian.arg_perigee_deg.toFixed(1)}°
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={360}
                        step={1}
                        value={selectedSat.keplerian.arg_perigee_deg}
                        onChange={(e) =>
                          updateSelectedSat((s) => ({
                            ...s,
                            source_mode: 'keplerian',
                            keplerian: {
                              ...s.keplerian,
                              arg_perigee_deg: Number(e.target.value),
                            },
                          }))
                        }
                        className="w-full accent-sky-400"
                      />
                    </div>

                    {/* Mean Anomaly */}
                    <div>
                      <div className="flex justify-between text-[11px] mb-0.5">
                        <span className="text-slate-300">ตำแหน่งในวงโคจร (Mean Anomaly M)</span>
                        <span className="font-mono text-sky-300 font-semibold">
                          {selectedSat.keplerian.mean_anomaly_deg.toFixed(1)}°
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={360}
                        step={1}
                        value={selectedSat.keplerian.mean_anomaly_deg}
                        onChange={(e) =>
                          updateSelectedSat((s) => ({
                            ...s,
                            source_mode: 'keplerian',
                            keplerian: {
                              ...s.keplerian,
                              mean_anomaly_deg: Number(e.target.value),
                            },
                          }))
                        }
                        className="w-full accent-sky-400"
                      />
                    </div>

                    {/* 1-Click Sun-Synchronous Calculator */}
                    <button
                      onClick={() => {
                        const alt = Math.min(1200, Math.max(400, selectedSat.keplerian.altitude_km));
                        const ssoI = Number(sunSyncInclinationDeg(alt).toFixed(3));
                        const ssoRaan = Number(raanForLtanDeg(new Date(simTimeMs), 22.5).toFixed(2));
                        updateSelectedSat((s) => ({
                          ...s,
                          source_mode: 'keplerian',
                          keplerian: {
                            ...s.keplerian,
                            altitude_km: alt,
                            eccentricity: 0.0001,
                            inclination_deg: ssoI,
                            raan_deg: ssoRaan,
                          },
                        }));
                      }}
                      className="w-full py-1.5 rounded bg-sky-500/20 hover:bg-sky-500 hover:text-slate-950 border border-sky-500/40 text-sky-300 font-semibold text-[11px] transition"
                    >
                      ☀️ คำนวณวงโคจรสัมพันธ์ดวงอาทิตย์ (SSO 10:30 น.) อัตโนมัติ
                    </button>
                  </div>

                  {/* Educational Orbit Presets */}
                  <div className="space-y-1.5">
                    <div className="font-bold text-slate-300 text-[11px]">
                      🎓 ชุดวงโคจรมาตรฐานสำหรับเปรียบเทียบและสอน (Presets)
                    </div>
                    {orbitPresets.map((preset) => (
                      <button
                        key={preset.id}
                        onClick={() =>
                          updateSelectedSat((s) => ({
                            ...s,
                            source_mode: 'keplerian',
                            color: preset.color,
                            keplerian: { ...preset.keplerian },
                          }))
                        }
                        className="w-full text-left p-2 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 transition space-y-0.5"
                      >
                        <div className="font-semibold text-sky-300 text-[11px] flex items-center justify-between">
                          <span>{preset.name_th}</span>
                          <span
                            className="w-2.5 h-2.5 rounded-full"
                            style={{ backgroundColor: preset.color }}
                          />
                        </div>
                        <div className="text-[10px] text-slate-400 leading-relaxed">
                          {preset.description_th}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* TAB 2: SENSOR FOV, AUTO-TARGET SLEW & GSD */}
              {rightTab === 'sensor' && (
                <div className="p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-sky-400">
                      📷 ตั้งค่าเซนเซอร์ถ่ายภาพ & การหันกล้อง (Slew)
                    </span>
                    <input
                      type="checkbox"
                      checked={selectedSat.sensor.enabled}
                      onChange={(e) =>
                        updateSelectedSat((s) => ({
                          ...s,
                          sensor: { ...s.sensor, enabled: e.target.checked },
                        }))
                      }
                      className="accent-sky-400"
                    />
                  </div>

                  {/* Pointing Mode Selector */}
                  <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800 space-y-2">
                    <div className="text-[11px] font-semibold text-slate-300">
                      โหมดการหันเล็งของกล้อง (Attitude / Slew Pointing)
                    </div>
                    <div className="grid grid-cols-1 gap-1.5">
                      <button
                        onClick={() =>
                          updateSelectedSat((s) => ({
                            ...s,
                            sensor: { ...s.sensor, pointing_mode: 'target_track' },
                          }))
                        }
                        className={`px-2.5 py-1.5 rounded text-left text-[11px] border transition ${
                          selectedSat.sensor.pointing_mode === 'target_track'
                            ? 'bg-amber-500/20 border-amber-400 text-amber-200 font-semibold'
                            : 'bg-slate-900 border-slate-800 text-slate-400'
                        }`}
                      >
                        🎯 Auto Target Tracking — เอียงกล้องเกาะเป้าหมายอัตโนมัติขณะบินผ่าน
                      </button>
                      <button
                        onClick={() =>
                          updateSelectedSat((s) => ({
                            ...s,
                            sensor: { ...s.sensor, pointing_mode: 'nadir', roll_deg: 0, pitch_deg: 0 },
                          }))
                        }
                        className={`px-2.5 py-1.5 rounded text-left text-[11px] border transition ${
                          selectedSat.sensor.pointing_mode === 'nadir'
                            ? 'bg-sky-500/20 border-sky-400 text-sky-200 font-semibold'
                            : 'bg-slate-900 border-slate-800 text-slate-400'
                        }`}
                      >
                        ⬇️ Nadir Pointing — ชี้ตั้งฉากลงพื้นโลกเสมอ (0° Roll/Pitch)
                      </button>
                      <button
                        onClick={() =>
                          updateSelectedSat((s) => ({
                            ...s,
                            sensor: { ...s.sensor, pointing_mode: 'fixed_slew' },
                          }))
                        }
                        className={`px-2.5 py-1.5 rounded text-left text-[11px] border transition ${
                          selectedSat.sensor.pointing_mode === 'fixed_slew'
                            ? 'bg-purple-500/20 border-purple-400 text-purple-200 font-semibold'
                            : 'bg-slate-900 border-slate-800 text-slate-400'
                        }`}
                      >
                        📐 Fixed Roll/Pitch — กำหนดมุมเอียงกล้องเอง (เช่น SAR Side-Looking)
                      </button>
                    </div>

                    {/* Manual Roll / Pitch Sliders */}
                    {selectedSat.sensor.pointing_mode === 'fixed_slew' && (
                      <div className="space-y-2 pt-2 border-t border-slate-800">
                        <div>
                          <div className="flex justify-between text-[11px]">
                            <span>มุมเอียงข้าง (Roll Cross-Track)</span>
                            <span className="font-mono text-sky-300">
                              {selectedSat.sensor.roll_deg.toFixed(1)}°
                            </span>
                          </div>
                          <input
                            type="range"
                            min={-45}
                            max={45}
                            step={0.5}
                            value={selectedSat.sensor.roll_deg}
                            onChange={(e) =>
                              updateSelectedSat((s) => ({
                                ...s,
                                sensor: { ...s.sensor, roll_deg: Number(e.target.value) },
                              }))
                            }
                            className="w-full accent-sky-400"
                          />
                        </div>
                        <div>
                          <div className="flex justify-between text-[11px]">
                            <span>มุมเอียงหน้า-หลัง (Pitch Along-Track)</span>
                            <span className="font-mono text-sky-300">
                              {selectedSat.sensor.pitch_deg.toFixed(1)}°
                            </span>
                          </div>
                          <input
                            type="range"
                            min={-45}
                            max={45}
                            step={0.5}
                            value={selectedSat.sensor.pitch_deg}
                            onChange={(e) =>
                              updateSelectedSat((s) => ({
                                ...s,
                                sensor: { ...s.sensor, pitch_deg: Number(e.target.value) },
                              }))
                            }
                            className="w-full accent-sky-400"
                          />
                        </div>
                      </div>
                    )}

                    {/* Max Agility Slew Angle */}
                    <div>
                      <div className="flex justify-between text-[11px]">
                        <span>ขีดจำกัดมุมเอียงสูงสุด (Max Off-Nadir Slew)</span>
                        <span className="font-mono text-amber-300">
                          ±{selectedSat.sensor.max_slew_deg.toFixed(0)}°
                        </span>
                      </div>
                      <input
                        type="range"
                        min={5}
                        max={50}
                        step={1}
                        value={selectedSat.sensor.max_slew_deg}
                        onChange={(e) =>
                          updateSelectedSat((s) => ({
                            ...s,
                            sensor: { ...s.sensor, max_slew_deg: Number(e.target.value) },
                          }))
                        }
                        className="w-full accent-amber-400"
                      />
                    </div>
                  </div>

                  {/* Sensor FOV Geometry */}
                  <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-300">รูปทรงกรวยเซนเซอร์ (FOV)</span>
                      <div className="flex gap-1">
                        <button
                          onClick={() =>
                            updateSelectedSat((s) => ({
                              ...s,
                              sensor: {
                                ...s.sensor,
                                fov: { type: 'rectangular', cross_half_deg: 8.5, along_half_deg: 1.0 },
                              },
                            }))
                          }
                          className={`px-2 py-0.5 rounded text-[10px] ${
                            selectedSat.sensor.fov.type === 'rectangular'
                              ? 'bg-sky-500 text-slate-950 font-bold'
                              : 'bg-slate-800 text-slate-400'
                          }`}
                        >
                          สี่เหลี่ยม (Pushbroom)
                        </button>
                        <button
                          onClick={() =>
                            updateSelectedSat((s) => ({
                              ...s,
                              sensor: {
                                ...s.sensor,
                                fov: { type: 'conic', half_angle_deg: 12.0 },
                              },
                            }))
                          }
                          className={`px-2 py-0.5 rounded text-[10px] ${
                            selectedSat.sensor.fov.type === 'conic'
                              ? 'bg-sky-500 text-slate-950 font-bold'
                              : 'bg-slate-800 text-slate-400'
                          }`}
                        >
                          กรวยกลม (Conic)
                        </button>
                      </div>
                    </div>

                    {selectedSat.sensor.fov.type === 'rectangular' ? (
                      <>
                        <div>
                          <div className="flex justify-between text-[11px]">
                            <span>ครึ่งมุมกว้างแนวขวาง (Cross-Track Half FOV)</span>
                            <span className="font-mono text-sky-300">
                              {selectedSat.sensor.fov.cross_half_deg.toFixed(1)}°
                            </span>
                          </div>
                          <input
                            type="range"
                            min={1}
                            max={35}
                            step={0.5}
                            value={selectedSat.sensor.fov.cross_half_deg}
                            onChange={(e) =>
                              updateSelectedSat((s) => ({
                                ...s,
                                sensor: {
                                  ...s.sensor,
                                  fov: {
                                    type: 'rectangular',
                                    cross_half_deg: Number(e.target.value),
                                    along_half_deg:
                                      s.sensor.fov.type === 'rectangular'
                                        ? s.sensor.fov.along_half_deg
                                        : 1.0,
                                  },
                                },
                              }))
                            }
                            className="w-full accent-sky-400"
                          />
                        </div>
                      </>
                    ) : (
                      <div>
                        <div className="flex justify-between text-[11px]">
                          <span>รัศมีกรวยเซนเซอร์ (Cone Half-Angle)</span>
                          <span className="font-mono text-sky-300">
                            {selectedSat.sensor.fov.half_angle_deg.toFixed(1)}°
                          </span>
                        </div>
                        <input
                          type="range"
                          min={1}
                          max={35}
                          step={0.5}
                          value={selectedSat.sensor.fov.half_angle_deg}
                          onChange={(e) =>
                            updateSelectedSat((s) => ({
                              ...s,
                              sensor: {
                                ...s.sensor,
                                fov: { type: 'conic', half_angle_deg: Number(e.target.value) },
                              },
                            }))
                          }
                          className="w-full accent-sky-400"
                        />
                      </div>
                    )}

                    {/* Optics GSD Parameters */}
                    <div className="pt-2 border-t border-slate-800 space-y-2">
                      <div className="font-semibold text-slate-300 text-[11px]">
                        เลนส์ออปติกส์ & คำนวณความละเอียดภาพ (GSD)
                      </div>
                      <div>
                        <div className="flex justify-between text-[11px]">
                          <span>ความยาวโฟกัส (Focal Length f)</span>
                          <span className="font-mono text-emerald-400">
                            {selectedSat.sensor.focal_mm.toFixed(0)} mm
                          </span>
                        </div>
                        <input
                          type="range"
                          min={100}
                          max={6000}
                          step={50}
                          value={selectedSat.sensor.focal_mm}
                          onChange={(e) =>
                            updateSelectedSat((s) => ({
                              ...s,
                              sensor: { ...s.sensor, focal_mm: Number(e.target.value) },
                            }))
                          }
                          className="w-full accent-emerald-400"
                        />
                      </div>

                      <div className="p-2 rounded bg-slate-900 border border-slate-800 space-y-1 text-[11px]">
                        <div className="flex justify-between">
                          <span className="text-slate-400">ความละเอียดภาพ (GSD):</span>
                          <span className="font-mono font-bold text-emerald-400">
                            {currentTelemetry.sensor.gsdMeters
                              ? `${currentTelemetry.sensor.gsdMeters.toFixed(2)} เมตร/พิกเซล`
                              : '—'}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400">ความกว้างแนวถ่ายภาพ (Swath):</span>
                          <span className="font-mono font-bold text-amber-300">
                            {currentTelemetry.sensor.swathWidthKm
                              ? `${currentTelemetry.sensor.swathWidthKm.toFixed(1)} km`
                              : '—'}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400">มุมเอียงปัจจุบัน (Off-Nadir):</span>
                          <span className="font-mono font-bold text-sky-300">
                            {currentTelemetry.sensor.offNadirDeg.toFixed(1)}°
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 3: EDUCATIONAL VECTORS & FORMULA GUIDE */}
              {rightTab === 'coverage' && (
                <div className="p-3 space-y-3">
                  <div className="font-bold text-sky-400">
                    📐 ตัวช่วยสื่อการสอน (3D Vectors & Orbital Formulas)
                  </div>

                  <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800 space-y-2 text-[11px]">
                    <div className="font-semibold text-slate-200">
                      เปิด/ปิดเลเยอร์การสอนบนลูกโลก 3D
                    </div>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={vectorVis.showEciAxes}
                        onChange={(e) =>
                          setVectorVis((v) => ({ ...v, showEciAxes: e.target.checked }))
                        }
                        className="accent-sky-400"
                      />
                      <span>แกนพิกัดเฉื่อย ECI (ชี้จุด Vernal Equinox ♈)</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={vectorVis.showEcefAxes}
                        onChange={(e) =>
                          setVectorVis((v) => ({ ...v, showEcefAxes: e.target.checked }))
                        }
                        className="accent-sky-400"
                      />
                      <span>แกนพิกัดหมุนตามโลก ECEF (ชี้เมอริเดียน 0°)</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={vectorVis.showSatBodyVectors}
                        onChange={(e) =>
                          setVectorVis((v) => ({ ...v, showSatBodyVectors: e.target.checked }))
                        }
                        className="accent-sky-400"
                      />
                      <span>เวกเตอร์ประจำตัวดาวเทียม (Velocity, Nadir, Sun)</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={vectorVis.showOrbitalPlane}
                        onChange={(e) =>
                          setVectorVis((v) => ({ ...v, showOrbitalPlane: e.target.checked }))
                        }
                        className="accent-sky-400"
                      />
                      <span>แผ่นระนาบวงโคจร 3D (แสดงมุม i และ RAAN Ω)</span>
                    </label>
                  </div>

                  {/* Educational Concept Cards */}
                  <div className="space-y-2 text-[11px]">
                    <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 space-y-1">
                      <div className="font-bold text-amber-300">
                        💡 ทำไมดาวเทียมสำรวจโลกจึงใช้วงโคจร SSO?
                      </div>
                      <p className="text-slate-300 leading-relaxed">
                        โลกแป้นที่เส้นศูนย์สูตร (<span className="font-mono">J2 = 1.0826×10⁻³</span>)
                        เมื่อตั้งมุมเอียงวงโคจร <span className="font-mono">i ≈ 98°</span>{' '}
                        ระนาบวงโคจรจะหมุนตามดวงอาทิตย์วันละ <span className="font-mono">0.9856°</span>{' '}
                        พอดี ทำให้ดาวเทียมบินผ่านประเทศไทยในเวลาท้องถิ่นเดิมทุกวัน!
                      </p>
                    </div>

                    <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 space-y-1">
                      <div className="font-bold text-emerald-300">
                        📏 สูตรความละเอียดภาพถ่ายดาวเทียม (GSD)
                      </div>
                      <p className="text-slate-300 font-mono text-[10px] bg-slate-900 p-1.5 rounded">
                        GSD = (Slant Range × Pixel Pitch) / Focal Length
                      </p>
                      <p className="text-slate-400 leading-relaxed">
                        ยิ่งดาวเทียมเอียงกล้อง (Off-Nadir Slew) มากเท่าไร ระยะห่างตามแนวสายตา (Slant Range)
                        จะเพิ่มขึ้น ทำให้ค่า GSD กว้างขึ้นเล็กน้อยแลกกับการถ่ายซ้ำเป้าหมายได้เร็วขึ้น
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </aside>
      </div>

      {/* BOTTOM: STK GANTT TIMELINE & ACCESS REPORT */}
      <GanttTimelineBar
        simTimeMs={simTimeMs}
        windowStartMs={windowStartMs}
        windowHours={windowHours}
        onSeekTimeMs={(ms) => setSimTimeMs(ms)}
        events={ganttEvents}
        onRecomputeEvents={() => setGanttVersion((v) => v + 1)}
      />

      {/* CELESTRAK LIVE SEARCH & OFFLINE SATELLITE CATALOG MODAL */}
      {showCatalogModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="bg-slate-900 border border-slate-700 rounded-xl max-w-2xl w-full p-5 shadow-2xl space-y-4 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h2 className="font-bold text-base text-sky-400">
                  🛰️ คลังดาวเทียมจริง (CelesTrak Live Search & Offline Catalog)
                </h2>
                <p className="text-xs text-slate-400">
                  เลือกดาวเทียมสำรวจโลกจากฐานข้อมูลในเครื่อง หรือค้นหาออนไลน์จาก CelesTrak
                </p>
              </div>
              <button
                onClick={() => setShowCatalogModal(false)}
                className="text-slate-400 hover:text-white px-2 py-1 text-sm"
              >
                ✕
              </button>
            </div>

            {/* Search Input */}
            <div className="flex gap-2">
              <input
                type="text"
                value={catalogQuery}
                onChange={(e) => setCatalogQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearchCatalog()}
                placeholder="พิมพ์ชื่อดาวเทียมหรือ NORAD ID เช่น THEOS, SENTINEL, LANDSAT, ISS, 25544..."
                className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white outline-none focus:border-sky-400"
              />
              <button
                onClick={handleSearchCatalog}
                disabled={catalogLoading}
                className="px-4 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs"
              >
                {catalogLoading ? 'กำลังค้นหา...' : '🔍 ค้นหา CelesTrak'}
              </button>
            </div>

            {/* Catalog List */}
            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              {catalogResults.map((entry) => (
                <div
                  key={entry.id}
                  className="p-3 rounded-lg bg-slate-950 border border-slate-800 hover:border-sky-500/50 flex items-center justify-between gap-4"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm text-white">{entry.name}</span>
                      <span className="px-2 py-0.5 rounded bg-slate-800 text-sky-300 font-mono text-[10px]">
                        NORAD {entry.norad_id}
                      </span>
                      <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 text-[10px]">
                        {entry.category}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400">{entry.description_th}</p>
                  </div>
                  <button
                    onClick={() => handleAddFromCatalog(entry)}
                    className="px-3 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs shrink-0"
                  >
                    + เพิ่มเข้าฉาก
                  </button>
                </div>
              ))}
            </div>

            {/* Paste Custom 2-Line / 3-Line TLE */}
            <div className="pt-3 border-t border-slate-800 space-y-2">
              <div className="text-xs font-semibold text-slate-300">
                หรือวางข้อความ TLE (2 หรือ 3 บรรทัด) โดยตรง:
              </div>
              <div className="flex gap-2">
                <textarea
                  rows={2}
                  value={customTleText}
                  onChange={(e) => setCustomTleText(e.target.value)}
                  placeholder={'THEOS-2\n1 58017U 23155A ...\n2 58017  97.8712 ...'}
                  className="flex-1 bg-slate-950 border border-slate-700 rounded-lg p-2 text-[11px] font-mono text-slate-200"
                />
                <button
                  onClick={handleAddCustomTle}
                  className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-sky-300 font-semibold text-xs"
                >
                  + นำเข้า TLE
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
