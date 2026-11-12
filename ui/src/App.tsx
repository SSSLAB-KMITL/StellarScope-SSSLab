import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowDownToLine,
  Camera,
  Check,
  Compass,
  Crosshair,
  FastForward,
  GraduationCap,
  Layers,
  Lightbulb,
  Moon,
  Orbit,
  Pause,
  Pentagon,
  Play,
  Plus,
  Radio,
  Rewind,
  RotateCcw,
  Ruler,
  Satellite,
  Search,
  SkipBack,
  Sliders,
  Sun,
  Upload,
  X,
} from 'lucide-react';
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
  CelestrakGnssGroup,
  createInitialScenario,
  fetchCelestrakGnssGroup,
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
      const dtRealSec = Math.min(0.05, Math.max(0, (now - lastFrame) / 1000));
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
            color: '#ea580c',
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
            color: '#059669',
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
    const palette = ['#0284c7', '#059669', '#d97706', '#e11d48', '#7c3aed', '#0d9488'];
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

  const handleLoadGnssGroup = async (group: CelestrakGnssGroup | 'offline_all') => {
    if (group === 'offline_all') {
      setCatalogResults(OFFLINE_SATELLITE_CATALOG);
      return;
    }
    setCatalogLoading(true);
    const res = await fetchCelestrakGnssGroup(group);
    setCatalogResults(res);
    setCatalogLoading(false);
  };

  const handleLoadMultiGnssStarter = () => {
    const gnssEntries = OFFLINE_SATELLITE_CATALOG.filter((c) => c.category.startsWith('GNSS'));
    const palette = ['#0284c7', '#059669', '#d97706', '#e11d48', '#7c3aed', '#0d9488'];
    const existingNames = new Set(satellites.map((s) => s.name));
    const added: SatelliteObject[] = [];
    gnssEntries.forEach((entry, idx) => {
      if (existingNames.has(entry.name)) return;
      added.push({
        id: `sat-${entry.id}-${Date.now()}-${idx}`,
        name: entry.name,
        color: palette[(satellites.length + idx) % palette.length],
        visible: true,
        source_mode: 'tle',
        tle_line1: entry.line1,
        tle_line2: entry.line2,
        keplerian: {
          altitude_km: 20200,
          eccentricity: 0.001,
          inclination_deg: 55.0,
          raan_deg: 30,
          arg_perigee_deg: 0,
          mean_anomaly_deg: 0,
        },
        epoch_iso: new Date(simTimeMs).toISOString(),
        sensor: {
          enabled: true,
          fov: entry.default_sensor.fov,
          pointing_mode: 'nadir',
          roll_deg: 0,
          pitch_deg: 0,
          target_id: null,
          max_slew_deg: entry.max_slew_deg,
          focal_mm: entry.focal_mm,
          pixel_um: entry.pixel_um,
          swath_history_min: 20,
        },
        show_orbit: true,
        show_ground_track: true,
        show_footprint: false,
        show_swath: false,
      });
    });
    if (added.length > 0) {
      setSatellites((prev) => [...prev, ...added]);
      setSelectedSatId(added[0].id);
    }
    setShowCatalogModal(false);
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
      description_th: 'Custom TLE import',
      description_en: 'Custom TLE import',
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
    <div className="h-screen w-screen flex flex-col bg-[var(--color-paper)] text-[var(--color-ink)] overflow-hidden">
      {/* TOP COMMAND & PLAYBACK RIBBON */}
      <header className="h-14 bg-[var(--color-surface)] border-b border-[var(--color-rule)] px-4 flex items-center justify-between gap-3 shrink-0">
        {/* Brand & Add Catalog Button */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 font-display font-bold text-base tracking-tight text-[var(--color-ink)]">
            <div className="w-7 h-7 rounded-lg bg-[var(--color-accent)] text-[var(--color-accent-ink)] flex items-center justify-center">
              <Satellite className="w-4 h-4" />
            </div>
            <span>StellarScope-SSSLab</span>
          </div>

          <button
            type="button"
            onClick={() => setShowCatalogModal(true)}
            className="px-3 py-1.5 rounded-lg bg-[var(--color-accent)] hover:bg-[var(--color-accent-deep)] text-[var(--color-accent-ink)] font-medium text-xs transition-colors flex items-center gap-1.5 shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Satellite</span>
          </button>
        </div>

        {/* Simulation Clock & Transport Controls */}
        <div className="flex items-center gap-1.5 bg-[var(--color-paper)] border border-[var(--color-rule)] px-2.5 py-1 rounded-xl text-xs">
          <span className="font-mono-num text-[var(--color-ink)] font-medium w-40 px-1">
            {new Date(simTimeMs).toISOString().slice(0, 19).replace('T', ' ')} UTC
          </span>
          <button
            type="button"
            onClick={() => setSimTimeMs(windowStartMs)}
            className="p-1.5 rounded-lg hover:bg-[var(--color-paper-2)] text-[var(--color-ink-2)] transition-colors"
            title="Reset to scenario start"
            aria-label="Reset to scenario start"
          >
            <SkipBack className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setTimeSpeed((s) => -Math.abs(s))}
            className={`p-1.5 rounded-lg transition-colors ${
              timeSpeed < 0
                ? 'bg-amber-100 text-amber-800'
                : 'hover:bg-[var(--color-paper-2)] text-[var(--color-ink-2)]'
            }`}
            title="Reverse time"
            aria-label="Reverse time"
          >
            <Rewind className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setIsPlaying((p) => !p)}
            className={`px-3 py-1 rounded-lg font-medium flex items-center gap-1.5 transition-colors ${
              isPlaying
                ? 'bg-amber-100 text-amber-900 border border-amber-300'
                : 'bg-[var(--color-accent)] text-[var(--color-accent-ink)]'
            }`}
          >
            {isPlaying ? (
              <>
                <Pause className="w-3.5 h-3.5" />
                <span>Pause</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5" />
                <span>Play</span>
              </>
            )}
          </button>
          <button
            type="button"
            onClick={() => setTimeSpeed((s) => Math.abs(s))}
            className={`p-1.5 rounded-lg transition-colors ${
              timeSpeed > 0
                ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent-deep)]'
                : 'hover:bg-[var(--color-paper-2)] text-[var(--color-ink-2)]'
            }`}
            title="Forward time"
            aria-label="Forward time"
          >
            <FastForward className="w-3.5 h-3.5" />
          </button>
          <select
            aria-label="Simulation speed multiplier"
            value={Math.abs(timeSpeed)}
            onChange={(e) => {
              const sign = timeSpeed < 0 ? -1 : 1;
              setTimeSpeed(sign * Number(e.target.value));
            }}
            className="bg-[var(--color-surface)] border border-[var(--color-rule)] rounded-lg px-2 py-1 text-xs font-mono-num text-[var(--color-ink)]"
          >
            <option value={1}>1x (Real-time)</option>
            <option value={10}>10x</option>
            <option value={30}>30x</option>
            <option value={60}>60x (1m/s)</option>
            <option value={300}>300x (5m/s)</option>
            <option value={900}>900x (15m/s)</option>
          </select>
          <button
            type="button"
            onClick={() => {
              const now = Date.now();
              setWindowStartMs(now);
              setSimTimeMs(now);
            }}
            className="px-2.5 py-1 rounded-lg bg-[var(--color-surface)] hover:bg-[var(--color-paper-2)] border border-[var(--color-rule)] text-[var(--color-ink-2)] text-xs font-medium transition-colors"
          >
            Now
          </button>
        </div>

        {/* Viewport Layout, Imagery & Educational Vector Toggles */}
        <div className="flex items-center gap-2 text-xs">
          {/* Split 3D/2D Switcher */}
          <div className="flex bg-[var(--color-paper)] border border-[var(--color-rule)] rounded-lg p-0.5">
            <button
              type="button"
              onClick={() => setViewLayout('split_3d_2d')}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                viewLayout === 'split_3d_2d'
                  ? 'bg-[var(--color-surface)] text-[var(--color-ink)] shadow-sm border border-[var(--color-rule)]'
                  : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]'
              }`}
            >
              Split
            </button>
            <button
              type="button"
              onClick={() => setViewLayout('only_3d')}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                viewLayout === 'only_3d'
                  ? 'bg-[var(--color-surface)] text-[var(--color-ink)] shadow-sm border border-[var(--color-rule)]'
                  : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]'
              }`}
            >
              3D
            </button>
            <button
              type="button"
              onClick={() => setViewLayout('only_2d')}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                viewLayout === 'only_2d'
                  ? 'bg-[var(--color-surface)] text-[var(--color-ink)] shadow-sm border border-[var(--color-rule)]'
                  : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]'
              }`}
            >
              2D
            </button>
          </div>

          {/* Hybrid Imagery Selector */}
          <select
            aria-label="Map imagery layer"
            value={mapImageryMode}
            onChange={(e) => setMapImageryMode(e.target.value as typeof mapImageryMode)}
            className="bg-[var(--color-surface)] border border-[var(--color-rule)] rounded-lg px-2.5 py-1.5 text-xs text-[var(--color-ink)]"
            title="Select Earth map imagery source"
          >
            <option value="hybrid_highres">Hybrid Satellite + Offline</option>
            <option value="offline_blue_marble">Offline Blue Marble</option>
            <option value="osm">OpenStreetMap</option>
          </select>

          {/* 3D Vector Quick Toggles */}
          <div className="flex items-center gap-1 bg-[var(--color-paper)] border border-[var(--color-rule)] rounded-lg p-0.5">
            <button
              type="button"
              onClick={() => setVectorVis((v) => ({ ...v, showEciAxes: !v.showEciAxes }))}
              className={`px-2 py-1 rounded-md text-xs font-medium transition-colors ${
                vectorVis.showEciAxes
                  ? 'bg-red-100 text-red-800'
                  : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]'
              }`}
              title="Toggle ECI inertial coordinate axes"
            >
              ECI
            </button>
            <button
              type="button"
              onClick={() => setVectorVis((v) => ({ ...v, showEcefAxes: !v.showEcefAxes }))}
              className={`px-2 py-1 rounded-md text-xs font-medium transition-colors ${
                vectorVis.showEcefAxes
                  ? 'bg-orange-100 text-orange-800'
                  : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]'
              }`}
              title="Toggle ECEF Earth-fixed coordinate axes"
            >
              ECEF
            </button>
            <button
              type="button"
              onClick={() =>
                setVectorVis((v) => ({ ...v, showSatBodyVectors: !v.showSatBodyVectors }))
              }
              className={`px-2 py-1 rounded-md text-xs font-medium transition-colors ${
                vectorVis.showSatBodyVectors
                  ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent-deep)]'
                  : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]'
              }`}
              title="Toggle satellite Velocity, Nadir, Normal, and Sun vectors"
            >
              Vectors
            </button>
            <button
              type="button"
              onClick={() =>
                setVectorVis((v) => ({ ...v, showOrbitalPlane: !v.showOrbitalPlane }))
              }
              className={`px-2 py-1 rounded-md text-xs font-medium transition-colors ${
                vectorVis.showOrbitalPlane
                  ? 'bg-sky-100 text-sky-800'
                  : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]'
              }`}
              title="Toggle 3D orbital plane disc"
            >
              Plane
            </button>
          </div>

          <button
            type="button"
            onClick={() => setShowSensorPiP((p) => !p)}
            className={`px-2.5 py-1.5 rounded-lg border text-xs font-medium flex items-center gap-1.5 transition-colors ${
              showSensorPiP
                ? 'bg-[var(--color-accent-soft)] border-[var(--color-accent)] text-[var(--color-accent-deep)]'
                : 'bg-[var(--color-surface)] border-[var(--color-rule)] text-[var(--color-muted)] hover:text-[var(--color-ink)]'
            }`}
          >
            <Camera className="w-3.5 h-3.5" />
            <span>Sensor PiP</span>
          </button>
        </div>
      </header>

      {/* MAIN WORKSPACE ROW: LEFT OBJECT BROWSER | CENTER 3D+2D VIEWPORTS | RIGHT INSPECTOR */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* LEFT PANEL: OBJECT BROWSER */}
        <aside className="w-68 bg-[var(--color-surface)] border-r border-[var(--color-rule)] flex flex-col shrink-0 text-xs overflow-y-auto">
          <div className="p-3.5 border-b border-[var(--color-rule)] flex items-center gap-2">
            <Layers className="w-4 h-4 text-[var(--color-accent)]" />
            <span className="font-display font-semibold text-sm text-[var(--color-ink)]">
              Object Browser
            </span>
          </div>

          {/* Satellites Section */}
          <div className="p-3.5 border-b border-[var(--color-rule)] space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-medium text-[var(--color-muted)] flex items-center gap-1.5">
                <Satellite className="w-3.5 h-3.5" />
                <span>Satellites ({satellites.length})</span>
              </span>
              <button
                type="button"
                onClick={() => setShowCatalogModal(true)}
                className="text-[var(--color-accent-deep)] hover:underline font-medium flex items-center gap-0.5"
              >
                <Plus className="w-3 h-3" />
                <span>Add</span>
              </button>
            </div>
            <div className="space-y-1">
              {satellites.map((sat) => {
                const isSel = sat.id === selectedSatId;
                return (
                  <div
                    key={sat.id}
                    onClick={() => setSelectedSatId(sat.id)}
                    className={`flex items-center justify-between px-2.5 py-2 rounded-lg cursor-pointer transition-colors ${
                      isSel
                        ? 'bg-[var(--color-accent-soft)]/70 border border-[var(--color-accent)]/50 text-[var(--color-ink)] font-medium'
                        : 'hover:bg-[var(--color-paper-2)] text-[var(--color-ink-2)] border border-transparent'
                    }`}
                  >
                    <div className="flex items-center gap-2 truncate">
                      <input
                        type="checkbox"
                        checked={sat.visible}
                        aria-label={`Toggle visibility for ${sat.name}`}
                        onChange={(e) => {
                          e.stopPropagation();
                          setSatellites((prev) =>
                            prev.map((s) =>
                              s.id === sat.id ? { ...s, visible: e.target.checked } : s
                            )
                          );
                        }}
                        className="accent-[var(--color-accent)]"
                      />
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: sat.color }}
                      />
                      <span className="truncate">{sat.name}</span>
                    </div>
                    {satellites.length > 1 && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          const rem = satellites.filter((s) => s.id !== sat.id);
                          setSatellites(rem);
                          if (isSel && rem[0]) setSelectedSatId(rem[0].id);
                        }}
                        className="text-[var(--color-muted)] hover:text-red-600 p-0.5 rounded"
                        title="Remove satellite"
                        aria-label={`Remove ${sat.name}`}
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Ground Stations Section */}
          <div className="p-3.5 border-b border-[var(--color-rule)] space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-medium text-[var(--color-muted)] flex items-center gap-1.5">
                <Radio className="w-3.5 h-3.5" />
                <span>Ground Stations ({stations.length})</span>
              </span>
              <button
                type="button"
                onClick={() =>
                  setMapClickMode((m) => (m === 'add_station' ? 'none' : 'add_station'))
                }
                className={`px-2 py-0.5 rounded-md text-xs font-medium transition-colors ${
                  mapClickMode === 'add_station'
                    ? 'bg-[var(--color-accent)] text-[var(--color-accent-ink)]'
                    : 'bg-[var(--color-surface-muted)] text-[var(--color-accent-deep)] hover:bg-[var(--color-paper-2)]'
                }`}
              >
                {mapClickMode === 'add_station' ? 'Click map...' : '+ Place'}
              </button>
            </div>
            <div className="space-y-1">
              {stations.map((gs) => (
                <div
                  key={gs.id}
                  className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-[var(--color-paper)] border border-[var(--color-rule)]/70 text-[var(--color-ink-2)]"
                >
                  <span className="truncate">
                    {gs.name}{' '}
                    <span className="font-mono-num text-[var(--color-muted)]">
                      ({gs.lat.toFixed(1)}°, {gs.lon.toFixed(1)}°)
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setStations((prev) => prev.filter((x) => x.id !== gs.id))}
                    className="text-[var(--color-muted)] hover:text-red-600 p-0.5 rounded"
                    aria-label={`Remove ${gs.name}`}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Imaging Point Targets Section */}
          <div className="p-3.5 border-b border-[var(--color-rule)] space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-medium text-[var(--color-muted)] flex items-center gap-1.5">
                <Crosshair className="w-3.5 h-3.5" />
                <span>Point Targets ({targets.length})</span>
              </span>
              <button
                type="button"
                onClick={() =>
                  setMapClickMode((m) => (m === 'add_target' ? 'none' : 'add_target'))
                }
                className={`px-2 py-0.5 rounded-md text-xs font-medium transition-colors ${
                  mapClickMode === 'add_target'
                    ? 'bg-amber-600 text-white'
                    : 'bg-[var(--color-surface-muted)] text-amber-700 hover:bg-[var(--color-paper-2)]'
                }`}
              >
                {mapClickMode === 'add_target' ? 'Click map...' : '+ Place'}
              </button>
            </div>
            <div className="space-y-1">
              {targets.map((tgt) => (
                <div
                  key={tgt.id}
                  className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-[var(--color-paper)] border border-[var(--color-rule)]/70 text-[var(--color-ink-2)]"
                >
                  <span className="truncate">
                    {tgt.name}{' '}
                    <span className="font-mono-num text-[var(--color-muted)]">
                      ({tgt.lat.toFixed(1)}°, {tgt.lon.toFixed(1)}°)
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setTargets((prev) => prev.filter((x) => x.id !== tgt.id))}
                    className="text-[var(--color-muted)] hover:text-red-600 p-0.5 rounded"
                    aria-label={`Remove ${tgt.name}`}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Polygon Area Target Section */}
          <div className="p-3.5 space-y-2.5">
            <div className="font-medium text-[var(--color-muted)] flex items-center gap-1.5">
              <Pentagon className="w-3.5 h-3.5" />
              <span>Area Target</span>
            </div>
            <div className="p-3 rounded-xl bg-[var(--color-paper)] border border-[var(--color-rule)] space-y-2.5">
              <div className="font-medium text-[var(--color-ink)]">{areaTarget.name}</div>
              <div className="flex items-center justify-between text-[var(--color-muted)]">
                <span className="font-mono-num">{areaTarget.vertices.length} vertices</span>
                <span className="font-mono-num font-semibold text-[var(--color-accent-deep)]">
                  {areaCoverage ? `${areaCoverage.coverage_percent.toFixed(1)}% covered` : '—'}
                </span>
              </div>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() =>
                    setMapClickMode((m) =>
                      m === 'add_area_vertex' ? 'none' : 'add_area_vertex'
                    )
                  }
                  className={`flex-1 py-1.5 px-2 rounded-lg font-medium flex items-center justify-center gap-1 transition-colors ${
                    mapClickMode === 'add_area_vertex'
                      ? 'bg-[var(--color-accent)] text-[var(--color-accent-ink)]'
                      : 'bg-[var(--color-surface)] border border-[var(--color-rule)] text-[var(--color-ink)] hover:bg-[var(--color-paper-2)]'
                  }`}
                >
                  {mapClickMode === 'add_area_vertex' ? (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      <span>Done</span>
                    </>
                  ) : (
                    <>
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add Vertex</span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setAreaTarget((prev) => ({ ...prev, vertices: [] }))
                  }
                  className="px-2.5 py-1.5 rounded-lg bg-[var(--color-surface)] border border-[var(--color-rule)] hover:bg-red-50 hover:text-red-700 text-[var(--color-muted)] transition-colors"
                  title="Clear polygon vertices"
                  aria-label="Clear polygon vertices"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
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
        <aside className="w-88 bg-[var(--color-surface)] border-l border-[var(--color-rule)] flex flex-col shrink-0 text-xs overflow-y-auto">
          {selectedSat && currentTelemetry && (
            <>
              {/* Selected Satellite Header & Live Telemetry Card */}
              <div className="p-3.5 border-b border-[var(--color-rule)] bg-[var(--color-paper)] space-y-3">
                <div className="flex items-center gap-2.5">
                  <span
                    className="w-3 h-3 rounded-full shrink-0"
                    style={{ backgroundColor: selectedSat.color }}
                  />
                  <input
                    aria-label="Selected satellite name"
                    type="text"
                    value={selectedSat.name}
                    onChange={(e) =>
                      updateSelectedSat((s) => ({ ...s, name: e.target.value }))
                    }
                    className="bg-transparent font-display font-bold text-sm text-[var(--color-ink)] border-b border-transparent focus:border-[var(--color-accent)] outline-none flex-1"
                  />
                </div>

                {/* Live State Grid */}
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs bg-[var(--color-surface)] p-3 rounded-xl border border-[var(--color-rule)]">
                  <div className="flex justify-between">
                    <span className="text-[var(--color-muted)]">Lat</span>
                    <span className="font-mono-num text-[var(--color-ink)] font-medium">
                      {currentTelemetry.state.geodetic.lat.toFixed(2)}°
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--color-muted)]">Lon</span>
                    <span className="font-mono-num text-[var(--color-ink)] font-medium">
                      {currentTelemetry.state.geodetic.lon.toFixed(2)}°
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--color-muted)]">Alt</span>
                    <span className="font-mono-num text-[var(--color-accent-deep)] font-semibold">
                      {currentTelemetry.state.geodetic.alt.toFixed(1)} km
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--color-muted)]">Vel</span>
                    <span className="font-mono-num text-[var(--color-ink)] font-medium">
                      {currentTelemetry.state.speedKmS.toFixed(2)} km/s
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--color-muted)]">Period</span>
                    <span className="font-mono-num text-[var(--color-ink)] font-medium">
                      {currentTelemetry.state.periodMin.toFixed(1)} min
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[var(--color-muted)]">Solar</span>
                    <span
                      className={`inline-flex items-center gap-1 font-medium ${
                        currentTelemetry.state.inSunlight
                          ? 'text-amber-700'
                          : 'text-[var(--color-muted)]'
                      }`}
                    >
                      {currentTelemetry.state.inSunlight ? (
                        <>
                          <Sun className="w-3 h-3" />
                          <span>Sunlit</span>
                        </>
                      ) : (
                        <>
                          <Moon className="w-3 h-3" />
                          <span>Eclipse</span>
                        </>
                      )}
                    </span>
                  </div>
                </div>

                {/* Inspector Mode Tabs */}
                <div className="grid grid-cols-3 bg-[var(--color-surface-muted)] border border-[var(--color-rule)] rounded-xl p-0.5 text-xs">
                  <button
                    type="button"
                    onClick={() => setRightTab('kepler')}
                    className={`py-1.5 rounded-lg font-medium flex items-center justify-center gap-1.5 transition-colors ${
                      rightTab === 'kepler'
                        ? 'bg-[var(--color-surface)] text-[var(--color-ink)] shadow-sm border border-[var(--color-rule)]'
                        : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]'
                    }`}
                  >
                    <Orbit className="w-3.5 h-3.5" />
                    <span>Orbit</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setRightTab('sensor')}
                    className={`py-1.5 rounded-lg font-medium flex items-center justify-center gap-1.5 transition-colors ${
                      rightTab === 'sensor'
                        ? 'bg-[var(--color-surface)] text-[var(--color-ink)] shadow-sm border border-[var(--color-rule)]'
                        : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]'
                    }`}
                  >
                    <Camera className="w-3.5 h-3.5" />
                    <span>Sensor</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setRightTab('coverage')}
                    className={`py-1.5 rounded-lg font-medium flex items-center justify-center gap-1.5 transition-colors ${
                      rightTab === 'coverage'
                        ? 'bg-[var(--color-surface)] text-[var(--color-ink)] shadow-sm border border-[var(--color-rule)]'
                        : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]'
                    }`}
                  >
                    <Compass className="w-3.5 h-3.5" />
                    <span>Guide</span>
                  </button>
                </div>
              </div>

              {/* TAB 1: INTERACTIVE KEPLERIAN SANDBOX & ORBIT PRESETS */}
              {rightTab === 'kepler' && (
                <div className="p-3.5 space-y-4">
                  <div className="flex items-center gap-1.5 font-display font-semibold text-sm text-[var(--color-ink)]">
                    <Sliders className="w-4 h-4 text-[var(--color-accent)]" />
                    <span>Keplerian Orbit Sandbox</span>
                  </div>

                  {selectedSat.source_mode === 'tle' && (
                    <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-center justify-between gap-2">
                      <span>Using live SGP4 TLE propagation</span>
                      <button
                        type="button"
                        onClick={() =>
                          updateSelectedSat((s) => ({ ...s, source_mode: 'keplerian' }))
                        }
                        className="px-2.5 py-1 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-medium shrink-0 transition-colors"
                      >
                        Switch to Kepler
                      </button>
                    </div>
                  )}

                  {/* 6 Classical Orbital Element Sliders */}
                  <div className="space-y-3 bg-[var(--color-paper)] p-3 rounded-xl border border-[var(--color-rule)]">
                    {/* Altitude */}
                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-[var(--color-ink-2)]">Altitude (h)</span>
                        <span className="font-mono-num text-[var(--color-accent-deep)] font-semibold">
                          {selectedSat.keplerian.altitude_km.toFixed(0)} km
                        </span>
                      </div>
                      <input
                        aria-label="Orbital altitude"
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
                        className="w-full"
                      />
                    </div>

                    {/* Eccentricity */}
                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-[var(--color-ink-2)]">Eccentricity (e)</span>
                        <span className="font-mono-num text-[var(--color-accent-deep)] font-semibold">
                          {selectedSat.keplerian.eccentricity.toFixed(4)}
                        </span>
                      </div>
                      <input
                        aria-label="Orbital eccentricity"
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
                        className="w-full"
                      />
                    </div>

                    {/* Inclination */}
                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-[var(--color-ink-2)]">Inclination (i)</span>
                        <span className="font-mono-num text-[var(--color-accent-deep)] font-semibold">
                          {selectedSat.keplerian.inclination_deg.toFixed(2)}°
                        </span>
                      </div>
                      <input
                        aria-label="Orbital inclination"
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
                        className="w-full"
                      />
                    </div>

                    {/* RAAN */}
                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-[var(--color-ink-2)]">RAAN (Ω)</span>
                        <span className="font-mono-num text-[var(--color-accent-deep)] font-semibold">
                          {selectedSat.keplerian.raan_deg.toFixed(1)}°
                        </span>
                      </div>
                      <input
                        aria-label="RAAN"
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
                        className="w-full"
                      />
                    </div>

                    {/* Argument of Perigee */}
                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-[var(--color-ink-2)]">Arg of Perigee (ω)</span>
                        <span className="font-mono-num text-[var(--color-accent-deep)] font-semibold">
                          {selectedSat.keplerian.arg_perigee_deg.toFixed(1)}°
                        </span>
                      </div>
                      <input
                        aria-label="Argument of perigee"
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
                        className="w-full"
                      />
                    </div>

                    {/* Mean Anomaly */}
                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-[var(--color-ink-2)]">Mean Anomaly (M)</span>
                        <span className="font-mono-num text-[var(--color-accent-deep)] font-semibold">
                          {selectedSat.keplerian.mean_anomaly_deg.toFixed(1)}°
                        </span>
                      </div>
                      <input
                        aria-label="Mean anomaly"
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
                        className="w-full"
                      />
                    </div>

                    {/* 1-Click Sun-Synchronous Calculator */}
                    <button
                      type="button"
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
                      className="w-full py-2 px-3 rounded-lg bg-[var(--color-accent-soft)] hover:bg-[var(--color-accent)] hover:text-[var(--color-accent-ink)] border border-[var(--color-accent)]/40 text-[var(--color-accent-deep)] font-medium text-xs flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <Sun className="w-3.5 h-3.5" />
                      <span>Compute SSO (10:30 LTDN)</span>
                    </button>
                  </div>

                  {/* Educational Orbit Presets */}
                  <div className="space-y-2">
                    <div className="font-medium text-[var(--color-muted)] flex items-center gap-1.5">
                      <GraduationCap className="w-3.5 h-3.5" />
                      <span>Standard Orbit Presets</span>
                    </div>
                    {orbitPresets.map((preset) => (
                      <button
                        type="button"
                        key={preset.id}
                        onClick={() =>
                          updateSelectedSat((s) => ({
                            ...s,
                            source_mode: 'keplerian',
                            color: preset.color,
                            keplerian: { ...preset.keplerian },
                          }))
                        }
                        className="w-full text-left p-2.5 rounded-xl bg-[var(--color-paper)] hover:bg-[var(--color-paper-2)] border border-[var(--color-rule)] transition-colors space-y-1"
                      >
                        <div className="font-medium text-[var(--color-ink)] flex items-center justify-between">
                          <span>{preset.name_en}</span>
                          <span
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: preset.color }}
                          />
                        </div>
                        <div className="text-xs text-[var(--color-muted)] leading-relaxed">
                          {preset.description_en}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* TAB 2: SENSOR FOV, AUTO-TARGET SLEW & GSD */}
              {rightTab === 'sensor' && (
                <div className="p-3.5 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 font-display font-semibold text-sm text-[var(--color-ink)]">
                      <Camera className="w-4 h-4 text-[var(--color-accent)]" />
                      <span>Payload Sensor & Slew</span>
                    </div>
                    <input
                      aria-label="Enable payload sensor"
                      type="checkbox"
                      checked={selectedSat.sensor.enabled}
                      onChange={(e) =>
                        updateSelectedSat((s) => ({
                          ...s,
                          sensor: { ...s.sensor, enabled: e.target.checked },
                        }))
                      }
                      className="accent-[var(--color-accent)]"
                    />
                  </div>

                  {/* Pointing Mode Selector */}
                  <div className="bg-[var(--color-paper)] p-3 rounded-xl border border-[var(--color-rule)] space-y-2.5">
                    <div className="font-medium text-[var(--color-ink)]">
                      Attitude & Slew Pointing Mode
                    </div>
                    <div className="grid grid-cols-1 gap-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          updateSelectedSat((s) => ({
                            ...s,
                            sensor: { ...s.sensor, pointing_mode: 'target_track' },
                          }))
                        }
                        className={`px-3 py-2 rounded-lg text-left text-xs border flex items-center gap-2 transition-colors ${
                          selectedSat.sensor.pointing_mode === 'target_track'
                            ? 'bg-amber-50 border-amber-400 text-amber-900 font-medium'
                            : 'bg-[var(--color-surface)] border-[var(--color-rule)] text-[var(--color-ink-2)] hover:bg-[var(--color-paper-2)]'
                        }`}
                      >
                        <Crosshair className="w-3.5 h-3.5 shrink-0" />
                        <span>Auto Target Tracking</span>
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          updateSelectedSat((s) => ({
                            ...s,
                            sensor: { ...s.sensor, pointing_mode: 'nadir', roll_deg: 0, pitch_deg: 0 },
                          }))
                        }
                        className={`px-3 py-2 rounded-lg text-left text-xs border flex items-center gap-2 transition-colors ${
                          selectedSat.sensor.pointing_mode === 'nadir'
                            ? 'bg-[var(--color-accent-soft)] border-[var(--color-accent)] text-[var(--color-accent-deep)] font-medium'
                            : 'bg-[var(--color-surface)] border-[var(--color-rule)] text-[var(--color-ink-2)] hover:bg-[var(--color-paper-2)]'
                        }`}
                      >
                        <ArrowDownToLine className="w-3.5 h-3.5 shrink-0" />
                        <span>Nadir Pointing (0° Roll/Pitch)</span>
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          updateSelectedSat((s) => ({
                            ...s,
                            sensor: { ...s.sensor, pointing_mode: 'fixed_slew' },
                          }))
                        }
                        className={`px-3 py-2 rounded-lg text-left text-xs border flex items-center gap-2 transition-colors ${
                          selectedSat.sensor.pointing_mode === 'fixed_slew'
                            ? 'bg-sky-50 border-sky-400 text-sky-900 font-medium'
                            : 'bg-[var(--color-surface)] border-[var(--color-rule)] text-[var(--color-ink-2)] hover:bg-[var(--color-paper-2)]'
                        }`}
                      >
                        <Sliders className="w-3.5 h-3.5 shrink-0" />
                        <span>Fixed Roll/Pitch (SAR Slew)</span>
                      </button>
                    </div>

                    {/* Manual Roll / Pitch Sliders */}
                    {selectedSat.sensor.pointing_mode === 'fixed_slew' && (
                      <div className="space-y-2.5 pt-2.5 border-t border-[var(--color-rule)]">
                        <div>
                          <div className="flex justify-between text-xs mb-1">
                            <span className="text-[var(--color-ink-2)]">Roll (Cross-Track)</span>
                            <span className="font-mono-num text-[var(--color-accent-deep)] font-medium">
                              {selectedSat.sensor.roll_deg.toFixed(1)}°
                            </span>
                          </div>
                          <input
                            aria-label="Sensor roll angle"
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
                            className="w-full"
                          />
                        </div>
                        <div>
                          <div className="flex justify-between text-xs mb-1">
                            <span className="text-[var(--color-ink-2)]">Pitch (Along-Track)</span>
                            <span className="font-mono-num text-[var(--color-accent-deep)] font-medium">
                              {selectedSat.sensor.pitch_deg.toFixed(1)}°
                            </span>
                          </div>
                          <input
                            aria-label="Sensor pitch angle"
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
                            className="w-full"
                          />
                        </div>
                      </div>
                    )}

                    {/* Max Agility Slew Angle */}
                    <div className="pt-1">
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-[var(--color-ink-2)]">Max Off-Nadir Slew Limit</span>
                        <span className="font-mono-num text-amber-700 font-semibold">
                          ±{selectedSat.sensor.max_slew_deg.toFixed(0)}°
                        </span>
                      </div>
                      <input
                        aria-label="Maximum slew angle"
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
                        className="w-full"
                      />
                    </div>
                  </div>

                  {/* Sensor FOV Geometry */}
                  <div className="bg-[var(--color-paper)] p-3 rounded-xl border border-[var(--color-rule)] space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-[var(--color-ink)]">Sensor FOV</span>
                      <div className="flex gap-1">
                        <button
                          type="button"
                          onClick={() =>
                            updateSelectedSat((s) => ({
                              ...s,
                              sensor: {
                                ...s.sensor,
                                fov: { type: 'rectangular', cross_half_deg: 8.5, along_half_deg: 1.0 },
                              },
                            }))
                          }
                          className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                            selectedSat.sensor.fov.type === 'rectangular'
                              ? 'bg-[var(--color-accent)] text-[var(--color-accent-ink)]'
                              : 'bg-[var(--color-surface)] border border-[var(--color-rule)] text-[var(--color-ink-2)]'
                          }`}
                        >
                          Pushbroom
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            updateSelectedSat((s) => ({
                              ...s,
                              sensor: {
                                ...s.sensor,
                                fov: { type: 'conic', half_angle_deg: 12.0 },
                              },
                            }))
                          }
                          className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                            selectedSat.sensor.fov.type === 'conic'
                              ? 'bg-[var(--color-accent)] text-[var(--color-accent-ink)]'
                              : 'bg-[var(--color-surface)] border border-[var(--color-rule)] text-[var(--color-ink-2)]'
                          }`}
                        >
                          Conic
                        </button>
                      </div>
                    </div>

                    {selectedSat.sensor.fov.type === 'rectangular' ? (
                      <div>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-[var(--color-ink-2)]">Cross-Track Half FOV</span>
                          <span className="font-mono-num text-[var(--color-accent-deep)] font-medium">
                            {selectedSat.sensor.fov.cross_half_deg.toFixed(1)}°
                          </span>
                        </div>
                        <input
                          aria-label="Cross-track half FOV"
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
                          className="w-full"
                        />
                      </div>
                    ) : (
                      <div>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-[var(--color-ink-2)]">Cone Half-Angle</span>
                          <span className="font-mono-num text-[var(--color-accent-deep)] font-medium">
                            {selectedSat.sensor.fov.half_angle_deg.toFixed(1)}°
                          </span>
                        </div>
                        <input
                          aria-label="Cone half angle"
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
                          className="w-full"
                        />
                      </div>
                    )}

                    {/* Optics GSD Parameters */}
                    <div className="pt-2.5 border-t border-[var(--color-rule)] space-y-2.5">
                      <div className="font-medium text-[var(--color-ink)]">
                        Optics & GSD Calculator
                      </div>
                      <div>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-[var(--color-ink-2)]">Focal Length (f)</span>
                          <span className="font-mono-num text-[var(--color-accent-deep)] font-medium">
                            {selectedSat.sensor.focal_mm.toFixed(0)} mm
                          </span>
                        </div>
                        <input
                          aria-label="Sensor focal length"
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
                          className="w-full"
                        />
                      </div>

                      <div className="p-2.5 rounded-lg bg-[var(--color-surface)] border border-[var(--color-rule)] space-y-1 text-xs">
                        <div className="flex justify-between">
                          <span className="text-[var(--color-muted)]">Ground Sample Distance</span>
                          <span className="font-mono-num font-semibold text-[var(--color-accent-deep)]">
                            {currentTelemetry.sensor.gsdMeters
                              ? `${currentTelemetry.sensor.gsdMeters.toFixed(2)} m/px`
                              : '—'}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[var(--color-muted)]">Swath Width</span>
                          <span className="font-mono-num font-semibold text-[var(--color-ink)]">
                            {currentTelemetry.sensor.swathWidthKm
                              ? `${currentTelemetry.sensor.swathWidthKm.toFixed(1)} km`
                              : '—'}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[var(--color-muted)]">Current Off-Nadir</span>
                          <span className="font-mono-num font-semibold text-[var(--color-ink)]">
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
                <div className="p-3.5 space-y-4">
                  <div className="flex items-center gap-1.5 font-display font-semibold text-sm text-[var(--color-ink)]">
                    <Compass className="w-4 h-4 text-[var(--color-accent)]" />
                    <span>3D Vectors & Orbital Guide</span>
                  </div>

                  <div className="bg-[var(--color-paper)] p-3 rounded-xl border border-[var(--color-rule)] space-y-2.5 text-xs">
                    <div className="font-medium text-[var(--color-ink)]">
                      3D Globe Reference Layers
                    </div>
                    <label className="flex items-center gap-2 cursor-pointer text-[var(--color-ink-2)]">
                      <input
                        type="checkbox"
                        checked={vectorVis.showEciAxes}
                        onChange={(e) =>
                          setVectorVis((v) => ({ ...v, showEciAxes: e.target.checked }))
                        }
                        className="accent-[var(--color-accent)]"
                      />
                      <span>ECI Inertial Axes (Vernal Equinox)</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer text-[var(--color-ink-2)]">
                      <input
                        type="checkbox"
                        checked={vectorVis.showEcefAxes}
                        onChange={(e) =>
                          setVectorVis((v) => ({ ...v, showEcefAxes: e.target.checked }))
                        }
                        className="accent-[var(--color-accent)]"
                      />
                      <span>ECEF Earth-Fixed Axes (0° Greenwich)</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer text-[var(--color-ink-2)]">
                      <input
                        type="checkbox"
                        checked={vectorVis.showSatBodyVectors}
                        onChange={(e) =>
                          setVectorVis((v) => ({ ...v, showSatBodyVectors: e.target.checked }))
                        }
                        className="accent-[var(--color-accent)]"
                      />
                      <span>Satellite Body Vectors (Velocity, Nadir, Sun)</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer text-[var(--color-ink-2)]">
                      <input
                        type="checkbox"
                        checked={vectorVis.showOrbitalPlane}
                        onChange={(e) =>
                          setVectorVis((v) => ({ ...v, showOrbitalPlane: e.target.checked }))
                        }
                        className="accent-[var(--color-accent)]"
                      />
                      <span>3D Orbital Plane Disc (Inclination & RAAN)</span>
                    </label>
                  </div>

                  {/* Educational Concept Notes */}
                  <div className="space-y-2.5 text-xs">
                    <div className="p-3 rounded-xl bg-[var(--color-paper)] border border-[var(--color-rule)] space-y-1.5">
                      <div className="font-medium text-[var(--color-ink)] flex items-center gap-1.5">
                        <Lightbulb className="w-3.5 h-3.5 text-amber-600" />
                        <span>Why Sun-Synchronous Orbits (SSO)?</span>
                      </div>
                      <p className="text-[var(--color-ink-2)] leading-relaxed">
                        Earth's equatorial bulge (<span className="font-mono-num">J2 = 1.0826×10⁻³</span>)
                        precesses an orbit at inclination <span className="font-mono-num">i ≈ 98°</span> by{' '}
                        <span className="font-mono-num">0.9856°/day</span>, keeping local solar lighting
                        consistent across every daily revisit.
                      </p>
                    </div>

                    <div className="p-3 rounded-xl bg-[var(--color-paper)] border border-[var(--color-rule)] space-y-1.5">
                      <div className="font-medium text-[var(--color-ink)] flex items-center gap-1.5">
                        <Ruler className="w-3.5 h-3.5 text-[var(--color-accent)]" />
                        <span>Ground Sample Distance (GSD)</span>
                      </div>
                      <p className="text-[var(--color-ink)] font-mono-num text-xs bg-[var(--color-surface)] border border-[var(--color-rule)] p-2 rounded-lg">
                        GSD = (Slant Range × Pixel Pitch) / Focal Length
                      </p>
                      <p className="text-[var(--color-ink-2)] leading-relaxed">
                        Increasing off-nadir slew lengthens the slant range, trading slightly coarser GSD
                        for faster target revisit opportunities.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </aside>
      </div>

      {/* BOTTOM: MISSION TIMELINE & ACCESS REPORT */}
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
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="bg-[var(--color-surface)] border border-[var(--color-rule)] rounded-2xl max-w-2xl w-full p-5 shadow-2xl space-y-4 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-[var(--color-rule)] pb-3">
              <div>
                <h2 className="font-display font-bold text-lg text-[var(--color-ink)] flex items-center gap-2">
                  <Satellite className="w-4 h-4 text-[var(--color-accent)]" />
                  <span>Satellite Catalog & CelesTrak Search</span>
                </h2>
                <p className="text-xs text-[var(--color-muted)] mt-0.5">
                  Select an offline Earth observation satellite or query live TLE data from CelesTrak.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowCatalogModal(false)}
                className="p-1.5 rounded-lg text-[var(--color-muted)] hover:text-[var(--color-ink)] hover:bg-[var(--color-paper-2)] transition-colors"
                aria-label="Close catalog modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Search Input */}
            <div className="flex gap-2">
              <input
                aria-label="Search satellite name or NORAD ID"
                type="text"
                value={catalogQuery}
                onChange={(e) => setCatalogQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearchCatalog()}
                placeholder="Search name or NORAD ID (e.g. THEOS, SENTINEL, LANDSAT, ISS, 25544)..."
                className="flex-1 bg-[var(--color-paper)] border border-[var(--color-rule)] rounded-xl px-3.5 py-2 text-xs text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)]"
              />
              <button
                type="button"
                onClick={handleSearchCatalog}
                disabled={catalogLoading}
                className="px-4 py-2 rounded-xl bg-[var(--color-accent)] hover:bg-[var(--color-accent-deep)] text-[var(--color-accent-ink)] font-medium text-xs flex items-center gap-1.5 transition-colors"
              >
                <Search className="w-3.5 h-3.5" />
                <span>{catalogLoading ? 'Searching...' : 'Search CelesTrak'}</span>
              </button>
            </div>

            {/* GNSS Constellation Quick-Load Bar */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1.5">
                {(
                  [
                    { id: 'offline_all', label: 'All Catalog' },
                    { id: 'gps-ops', label: 'GPS' },
                    { id: 'glo-ops', label: 'GLONASS' },
                    { id: 'galileo', label: 'Galileo' },
                    { id: 'beidou', label: 'BeiDou' },
                    { id: 'qzss', label: 'QZSS' },
                    { id: 'gnss', label: 'All GNSS (Live)' },
                  ] as const
                ).map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    disabled={catalogLoading}
                    onClick={() => handleLoadGnssGroup(g.id)}
                    className="px-2.5 py-1 rounded-lg bg-[var(--color-paper)] hover:bg-[var(--color-paper-2)] border border-[var(--color-rule)] text-xs font-medium text-[var(--color-ink-2)] transition-colors"
                  >
                    {g.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={handleLoadMultiGnssStarter}
                className="px-3 py-1 rounded-lg bg-[var(--color-accent-soft)] hover:bg-[var(--color-accent)] hover:text-[var(--color-accent-ink)] text-[var(--color-accent-deep)] text-xs font-medium transition-colors"
              >
                + Load Multi-GNSS Set
              </button>
            </div>

            {/* Catalog List */}
            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              {catalogResults.map((entry) => (
                <div
                  key={entry.id}
                  className="p-3 rounded-xl bg-[var(--color-paper)] border border-[var(--color-rule)] hover:border-[var(--color-accent)] flex items-center justify-between gap-4 transition-colors"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-display font-semibold text-sm text-[var(--color-ink)]">
                        {entry.name}
                      </span>
                      <span className="px-2 py-0.5 rounded-md bg-[var(--color-surface)] border border-[var(--color-rule)] text-[var(--color-ink-2)] font-mono-num text-xs">
                        NORAD {entry.norad_id}
                      </span>
                      <span className="px-2 py-0.5 rounded-md bg-[var(--color-accent-soft)] text-[var(--color-accent-deep)] text-xs font-medium">
                        {entry.category}
                      </span>
                    </div>
                    <p className="text-xs text-[var(--color-muted)]">{entry.description_en}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleAddFromCatalog(entry)}
                    className="px-3 py-1.5 rounded-lg bg-[var(--color-accent)] hover:bg-[var(--color-accent-deep)] text-[var(--color-accent-ink)] font-medium text-xs shrink-0 flex items-center gap-1 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add</span>
                  </button>
                </div>
              ))}
            </div>

            {/* Paste Custom 2-Line / 3-Line TLE */}
            <div className="pt-3 border-t border-[var(--color-rule)] space-y-2">
              <div className="text-xs font-medium text-[var(--color-ink)]">
                Or paste a 2-line / 3-line TLE directly:
              </div>
              <div className="flex gap-2">
                <textarea
                  rows={2}
                  value={customTleText}
                  onChange={(e) => setCustomTleText(e.target.value)}
                  placeholder={'THEOS-2\n1 58017U 23155A ...\n2 58017  97.8712 ...'}
                  className="flex-1 bg-[var(--color-paper)] border border-[var(--color-rule)] rounded-xl p-2.5 text-xs font-mono-num text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)]"
                />
                <button
                  type="button"
                  onClick={handleAddCustomTle}
                  className="px-3.5 py-2 rounded-xl bg-[var(--color-surface-muted)] hover:bg-[var(--color-paper-2)] border border-[var(--color-rule)] text-[var(--color-ink)] font-medium text-xs flex items-center gap-1.5 transition-colors"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Import TLE</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
