import React, { useEffect, useRef, useState } from 'react';
import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import {
  AreaCoverageSummary,
  AreaTargetObject,
  computeBodyAxes,
  computeSensorTelemetry,
  ecefToGeodetic,
  Geodetic,
  geodeticToEcef,
  gmstRad,
  GroundStationObject,
  lookAngles,
  propagateSatellite,
  SatelliteObject,
  SatState,
  SensorTelemetry,
  sunDirInertial,
  TargetPointObject,
  temeToEcef,
  v3,
  Vec3,
  WGS84_A,
} from '../engine/orbitalEngine';

export interface VectorVisConfig {
  showEciAxes: boolean;
  showEcefAxes: boolean;
  showSatBodyVectors: boolean;
  showOrbitalPlane: boolean;
  showDayNightLighting: boolean;
}

export type MapClickMode = 'none' | 'add_target' | 'add_station' | 'add_area_vertex';

interface CesiumWorkspacesProps {
  simTimeMs: number;
  satellites: SatelliteObject[];
  selectedSatId: string;
  onSelectSat: (id: string) => void;
  stations: GroundStationObject[];
  targets: TargetPointObject[];
  areaTarget: AreaTargetObject;
  areaCoverage: AreaCoverageSummary | null;
  vectorVis: VectorVisConfig;
  mapImageryMode: 'hybrid_highres' | 'offline_blue_marble' | 'osm';
  viewLayout: 'split_3d_2d' | 'only_3d' | 'only_2d';
  cameraFollowSat: boolean;
  onToggleCameraFollow: (follow: boolean) => void;
  showSensorPiP: boolean;
  mapClickMode: MapClickMode;
  onMapPickLatLon: (lat: number, lon: number) => void;
}

function hexToCesiumColor(hex: string, alpha = 1.0): Cesium.Color {
  try {
    return Cesium.Color.fromCssColorString(hex).withAlpha(alpha);
  } catch {
    return Cesium.Color.CYAN.withAlpha(alpha);
  }
}

function kmToCartesian(v: Vec3): Cesium.Cartesian3 {
  return new Cesium.Cartesian3(v.x * 1000, v.y * 1000, v.z * 1000);
}

export const CesiumWorkspaces: React.FC<CesiumWorkspacesProps> = ({
  simTimeMs,
  satellites,
  selectedSatId,
  onSelectSat,
  stations,
  targets,
  areaTarget,
  areaCoverage,
  vectorVis,
  mapImageryMode,
  viewLayout,
  cameraFollowSat,
  onToggleCameraFollow,
  showSensorPiP,
  mapClickMode,
  onMapPickLatLon,
}) => {
  const globeContainerRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<Cesium.Viewer | null>(null);
  const pipContainerRef = useRef<HTMLDivElement | null>(null);
  const pipViewerRef = useRef<Cesium.Viewer | null>(null);
  const map2dCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const earthImgRef = useRef<HTMLImageElement | null>(null);

  const [snapshotUrl, setSnapshotUrl] = useState<string | null>(null);

  // Load offline Earth texture for 2D map canvas
  useEffect(() => {
    const img = new Image();
    img.src = '/assets/earth.png';
    img.onload = () => {
      earthImgRef.current = img;
    };
  }, []);

  // Initialize Primary 3D Globe Viewer
  useEffect(() => {
    if (!globeContainerRef.current || viewerRef.current) return;

    const viewer = new Cesium.Viewer(globeContainerRef.current, {
      animation: false,
      timeline: false,
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      fullscreenButton: false,
      infoBox: false,
      selectionIndicator: false,
      shouldAnimate: true,
      baseLayer: false,
      skyAtmosphere: new Cesium.SkyAtmosphere(),
      contextOptions: {
        webgl: { preserveDrawingBuffer: true },
      },
    });

    // Always add Offline Natural Earth base layer first (100% offline guarantee)
    Cesium.SingleTileImageryProvider.fromUrl('/assets/earth.png', {
      rectangle: Cesium.Rectangle.fromDegrees(-180, -90, 180, 90),
    }).then((offlineProvider) => {
      if (!viewer.isDestroyed()) {
        viewer.imageryLayers.addImageryProvider(offlineProvider, 0);
      }
    });

    viewer.scene.globe.enableLighting = true;
    viewer.scene.globe.showGroundAtmosphere = true;
    viewer.scene.backgroundColor = Cesium.Color.fromCssColorString('#030712');

    // Initial camera looking at Thailand / Asia
    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(100.5, 13.75, 16500000),
    });

    // Click handler on 3D Globe for adding targets/stations/area vertices
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction((click: { position: Cesium.Cartesian2 }) => {
      const cartesian = viewer.camera.pickEllipsoid(
        click.position,
        viewer.scene.globe.ellipsoid
      );
      if (cartesian) {
        const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
        const lat = Cesium.Math.toDegrees(cartographic.latitude);
        const lon = Cesium.Math.toDegrees(cartographic.longitude);
        window.dispatchEvent(
          new CustomEvent('orbitscope-globe-pick', { detail: { lat, lon } })
        );
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    viewerRef.current = viewer;

    return () => {
      handler.destroy();
      if (!viewer.isDestroyed()) viewer.destroy();
      viewerRef.current = null;
    };
  }, []);

  // Forward 3D Globe picks when mapClickMode is active
  useEffect(() => {
    const listener = (e: Event) => {
      if (mapClickMode === 'none') return;
      const custom = e as CustomEvent<{ lat: number; lon: number }>;
      onMapPickLatLon(custom.detail.lat, custom.detail.lon);
    };
    window.addEventListener('orbitscope-globe-pick', listener);
    return () => window.removeEventListener('orbitscope-globe-pick', listener);
  }, [mapClickMode, onMapPickLatLon]);

  // Manage Hybrid Online / Offline Imagery Layers on 3D Globe & PiP
  useEffect(() => {
    const applyLayers = (v: Cesium.Viewer | null) => {
      if (!v || v.isDestroyed()) return;
      while (v.imageryLayers.length > 1) {
        v.imageryLayers.remove(v.imageryLayers.get(1), true);
      }
      if (mapImageryMode === 'hybrid_highres') {
        try {
          const esri = new Cesium.UrlTemplateImageryProvider({
            url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
            maximumLevel: 17,
            credit: 'Esri World Imagery',
          });
          v.imageryLayers.addImageryProvider(esri);
        } catch {
          // Offline fallback remains active automatically
        }
      } else if (mapImageryMode === 'osm') {
        try {
          const osm = new Cesium.UrlTemplateImageryProvider({
            url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
            maximumLevel: 18,
            credit: 'OpenStreetMap',
          });
          v.imageryLayers.addImageryProvider(osm);
        } catch {
          // Offline fallback remains active
        }
      }
    };
    applyLayers(viewerRef.current);
    applyLayers(pipViewerRef.current);
  }, [mapImageryMode]);

  // Initialize Simulated Sensor Camera PiP Viewer
  useEffect(() => {
    if (!showSensorPiP) {
      if (pipViewerRef.current && !pipViewerRef.current.isDestroyed()) {
        pipViewerRef.current.destroy();
        pipViewerRef.current = null;
      }
      return;
    }
    if (!pipContainerRef.current || pipViewerRef.current) return;

    const pipViewer = new Cesium.Viewer(pipContainerRef.current, {
      animation: false,
      timeline: false,
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      fullscreenButton: false,
      infoBox: false,
      selectionIndicator: false,
      baseLayer: false,
      skyAtmosphere: false,
      contextOptions: {
        webgl: { preserveDrawingBuffer: true },
      },
    });

    Cesium.SingleTileImageryProvider.fromUrl('/assets/earth.png', {
      rectangle: Cesium.Rectangle.fromDegrees(-180, -90, 180, 90),
    }).then((offlineProvider) => {
      if (!pipViewer.isDestroyed()) {
        pipViewer.imageryLayers.addImageryProvider(offlineProvider, 0);
        if (mapImageryMode === 'hybrid_highres') {
          const esri = new Cesium.UrlTemplateImageryProvider({
            url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
            maximumLevel: 17,
          });
          pipViewer.imageryLayers.addImageryProvider(esri);
        }
      }
    });

    pipViewer.scene.screenSpaceCameraController.enableInputs = false;
    pipViewer.scene.globe.enableLighting = false;
    pipViewerRef.current = pipViewer;

    return () => {
      if (!pipViewer.isDestroyed()) pipViewer.destroy();
      pipViewerRef.current = null;
    };
  }, [showSensorPiP]);

  // Compute current states & telemetry for all visible satellites
  const currentDate = new Date(simTimeMs);
  const satDataList = satellites
    .filter((s) => s.visible)
    .map((sat) => {
      const state = propagateSatellite(sat, currentDate);
      if (!state) return null;
      const telemetry = computeSensorTelemetry(sat, state, currentDate, targets);
      return { sat, state, telemetry };
    })
    .filter(
      (
        x
      ): x is {
        sat: SatelliteObject;
        state: SatState;
        telemetry: SensorTelemetry;
      } => x !== null
    );

  const selectedBundle =
    satDataList.find((x) => x.sat.id === selectedSatId) || satDataList[0] || null;

  // Update 3D Globe Entities & Vectors on every frame
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;

    viewer.clock.currentTime = Cesium.JulianDate.fromDate(currentDate);
    viewer.scene.globe.enableLighting = vectorVis.showDayNightLighting;

    viewer.entities.suspendEvents();
    viewer.entities.removeAll();

    // 1. Render Ground Stations & LoS links
    for (const gs of stations) {
      const gsPos = Cesium.Cartesian3.fromDegrees(gs.lon, gs.lat, gs.alt_km * 1000);
      viewer.entities.add({
        position: gsPos,
        point: {
          pixelSize: 9,
          color: hexToCesiumColor(gs.color, 1),
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 2,
        },
        label: {
          text: `📡 ${gs.name}`,
          font: '600 12px sans-serif',
          fillColor: hexToCesiumColor(gs.color, 1),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -16),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });

      // Active line-of-sight links to visible satellites
      for (const { sat, state } of satDataList) {
        const look = lookAngles({ lat: gs.lat, lon: gs.lon, alt: gs.alt_km }, state.rEcef);
        if (look.el_deg >= gs.min_el_deg) {
          viewer.entities.add({
            polyline: {
              positions: [gsPos, kmToCartesian(state.rEcef)],
              width: 2.5,
              material: new Cesium.PolylineDashMaterialProperty({
                color: Cesium.Color.fromCssColorString('#34d399'),
                dashLength: 12,
              }),
            },
          });
        }
      }
    }

    // 2. Render Point Targets
    for (const tgt of targets) {
      const tgtPos = Cesium.Cartesian3.fromDegrees(tgt.lon, tgt.lat, tgt.alt_km * 1000);
      viewer.entities.add({
        position: tgtPos,
        point: {
          pixelSize: 9,
          color: hexToCesiumColor(tgt.color, 1),
          outlineColor: Cesium.Color.YELLOW,
          outlineWidth: 2,
        },
        label: {
          text: `🎯 ${tgt.name}`,
          font: '600 12px sans-serif',
          fillColor: Cesium.Color.fromCssColorString('#fdba74'),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -15),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
    }

    // 3. Render Area Target Polygon & Coverage Grid on 3D Globe
    if (areaTarget.vertices.length >= 3) {
      const hierarchy = areaTarget.vertices.map((v) =>
        Cesium.Cartesian3.fromDegrees(v.lon, v.lat, 500)
      );
      viewer.entities.add({
        polygon: {
          hierarchy: new Cesium.PolygonHierarchy(hierarchy),
          material: Cesium.Color.fromCssColorString('#a855f7').withAlpha(0.18),
          outline: true,
          outlineColor: Cesium.Color.fromCssColorString('#c084fc'),
          height: 500,
        },
      });
      if (areaCoverage) {
        for (const cell of areaCoverage.cells) {
          viewer.entities.add({
            position: Cesium.Cartesian3.fromDegrees(cell.lon, cell.lat, 1200),
            point: {
              pixelSize: 5,
              color: cell.covered
                ? Cesium.Color.fromCssColorString('#22c55e').withAlpha(0.9)
                : Cesium.Color.fromCssColorString('#ef4444').withAlpha(0.55),
            },
          });
        }
      }
    }

    // 4. Render Satellites, Orbits, Sensor Cones, Footprints, and Swaths
    for (const { sat, state, telemetry } of satDataList) {
      const isSelected = sat.id === selectedSatId;
      const satCart = kmToCartesian(state.rEcef);
      const satColor = hexToCesiumColor(sat.color, 1);

      // Satellite Marker + Label
      viewer.entities.add({
        position: satCart,
        point: {
          pixelSize: isSelected ? 13 : 9,
          color: satColor,
          outlineColor: isSelected ? Cesium.Color.WHITE : Cesium.Color.BLACK,
          outlineWidth: isSelected ? 3 : 1.5,
        },
        label: {
          text: `🛰️ ${sat.name}`,
          font: isSelected ? 'bold 13px sans-serif' : '12px sans-serif',
          fillColor: satColor,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -18),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });

      // Sub-satellite Nadir Drop Line
      const subCart = Cesium.Cartesian3.fromDegrees(
        state.geodetic.lon,
        state.geodetic.lat,
        0
      );
      viewer.entities.add({
        polyline: {
          positions: [satCart, subCart],
          width: 1.2,
          material: new Cesium.PolylineDashMaterialProperty({
            color: satColor.withAlpha(0.45),
            dashLength: 8,
          }),
        },
      });

      // 3D Orbit Ring (Inertial ring rotated to current ECEF snapshot)
      if (sat.show_orbit) {
        const periodSec = state.periodMin * 60;
        const steps = 96;
        const orbitPositions: Cesium.Cartesian3[] = [];
        for (let i = 0; i <= steps; i++) {
          const dt = (i / steps - 0.5) * periodSec;
          const tSample = new Date(simTimeMs + dt * 1000);
          const stSample = propagateSatellite(sat, tSample);
          if (stSample) {
            // Display inertial ring in current ECEF frame
            const rInCurrentEcef = temeToEcef(stSample.rTeme, currentDate);
            orbitPositions.push(kmToCartesian(rInCurrentEcef));
          }
        }
        viewer.entities.add({
          polyline: {
            positions: orbitPositions,
            width: isSelected ? 2.6 : 1.5,
            material: satColor.withAlpha(isSelected ? 0.88 : 0.45),
          },
        });
      }

      // 3D Sensor Cone + Ground Footprint + Swept Swath
      if (sat.sensor.enabled && sat.show_footprint && telemetry.footprintEcef.length >= 3) {
        const fpCarts = telemetry.footprintEcef.map(kmToCartesian);
        fpCarts.push(fpCarts[0]);

        // Footprint Ground Polygon
        viewer.entities.add({
          polygon: {
            hierarchy: new Cesium.PolygonHierarchy(fpCarts),
            material: satColor.withAlpha(0.24),
            height: 1500,
          },
          polyline: {
            positions: fpCarts,
            width: 2.2,
            material: satColor.withAlpha(0.95),
          },
        });

        // 3D Sensor Frustum Pyramid Edges (from Satellite to Footprint corners)
        const stride = Math.max(1, Math.floor(telemetry.footprintEcef.length / 8));
        for (let i = 0; i < telemetry.footprintEcef.length; i += stride) {
          const cornerCart = kmToCartesian(telemetry.footprintEcef[i]);
          const nextCart = kmToCartesian(
            telemetry.footprintEcef[(i + stride) % telemetry.footprintEcef.length]
          );
          viewer.entities.add({
            polyline: {
              positions: [satCart, cornerCart],
              width: 1.4,
              material: satColor.withAlpha(0.6),
            },
            polygon: {
              hierarchy: new Cesium.PolygonHierarchy([satCart, cornerCart, nextCart]),
              perPositionHeight: true,
              material: satColor.withAlpha(0.11),
            },
          });
        }

        // Boresight Laser Line (especially clear when slewing to track a target!)
        if (telemetry.boresightGroundEcef) {
          viewer.entities.add({
            polyline: {
              positions: [satCart, kmToCartesian(telemetry.boresightGroundEcef)],
              width: telemetry.lockedTargetName ? 3.0 : 1.8,
              material: telemetry.lockedTargetName
                ? Cesium.Color.fromCssColorString('#f97316')
                : satColor.withAlpha(0.85),
            },
          });
        }
      }

      // Swept Swath Ribbon along past ground track
      if (sat.sensor.enabled && sat.show_swath && sat.sensor.swath_history_min > 0) {
        const histSec = sat.sensor.swath_history_min * 60;
        const steps = 28;
        const leftEdge: Cesium.Cartesian3[] = [];
        const rightEdge: Cesium.Cartesian3[] = [];
        const crossHalfRad =
          ((sat.sensor.fov.type === 'conic'
            ? sat.sensor.fov.half_angle_deg
            : sat.sensor.fov.cross_half_deg) *
            Math.PI) /
          180;
        const ty = Math.tan(crossHalfRad);

        for (let i = 0; i <= steps; i++) {
          const tPast = new Date(simTimeMs - (i / steps) * histSec * 1000);
          const stPast = propagateSatellite(sat, tPast);
          if (!stPast) continue;
          const vEcef = temeToEcef(stPast.vTeme, tPast);
          const axes = computeBodyAxes(stPast.rEcef, vEcef);
          const rollDeg = sat.sensor.pointing_mode === 'nadir' ? 0 : sat.sensor.roll_deg;
          const pitchDeg = sat.sensor.pointing_mode === 'nadir' ? 0 : sat.sensor.pitch_deg;

          // Approximate left/right rays
          const rRad = (rollDeg * Math.PI) / 180;
          const lDir = v3.normalize(
            v3.add(
              v3.scale(axes.y, -ty * Math.cos(rRad) + Math.sin(rRad)),
              v3.scale(axes.z, ty * Math.sin(rRad) + Math.cos(rRad))
            )
          );
          const rDir = v3.normalize(
            v3.add(
              v3.scale(axes.y, ty * Math.cos(rRad) + Math.sin(rRad)),
              v3.scale(axes.z, -ty * Math.sin(rRad) + Math.cos(rRad))
            )
          );
          const pDeg = pitchDeg; // unused in cross-track edge approx
          void pDeg;
          const lGeo = ecefToGeodetic(
            v3.add(stPast.rEcef, v3.scale(lDir, stPast.geodetic.alt / Math.max(0.2, Math.cos(rRad))))
          );
          const rGeo = ecefToGeodetic(
            v3.add(stPast.rEcef, v3.scale(rDir, stPast.geodetic.alt / Math.max(0.2, Math.cos(rRad))))
          );
          leftEdge.push(Cesium.Cartesian3.fromDegrees(lGeo.lon, lGeo.lat, 800));
          rightEdge.push(Cesium.Cartesian3.fromDegrees(rGeo.lon, rGeo.lat, 800));
        }
        if (leftEdge.length >= 2) {
          const ribbon = [...leftEdge, ...rightEdge.reverse()];
          viewer.entities.add({
            polygon: {
              hierarchy: new Cesium.PolygonHierarchy(ribbon),
              material: satColor.withAlpha(0.16),
              height: 800,
            },
          });
        }
      }
    }

    // 5. Educational 3D Coordinate Axes & Vector Geometry (VGT Lite)
    const axisLenKm = WGS84_A * 1.55;
    const addVectorArrow = (originKm: Vec3, endKm: Vec3, color: Cesium.Color, labelText: string) => {
      const p0 = kmToCartesian(originKm);
      const p1 = kmToCartesian(endKm);
      viewer.entities.add({
        polyline: {
          positions: [p0, p1],
          width: 8,
          material: new Cesium.PolylineArrowMaterialProperty(color),
        },
        position: p1,
        label: {
          text: labelText,
          font: 'bold 12px monospace',
          fillColor: color,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -10),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
    };

    // 5a. ECI Inertial Axes (rotated into ECEF by -GMST)
    if (vectorVis.showEciAxes) {
      const origin = { x: 0, y: 0, z: 0 };
      const xEci = temeToEcef({ x: axisLenKm, y: 0, z: 0 }, currentDate);
      const yEci = temeToEcef({ x: 0, y: axisLenKm, z: 0 }, currentDate);
      const zEci = { x: 0, y: 0, z: axisLenKm };
      addVectorArrow(origin, xEci, Cesium.Color.fromCssColorString('#ef4444'), 'X_ECI (Vernal Equinox ♈)');
      addVectorArrow(origin, yEci, Cesium.Color.fromCssColorString('#22c55e'), 'Y_ECI');
      addVectorArrow(origin, zEci, Cesium.Color.fromCssColorString('#3b82f6'), 'Z_ECI (Celestial North)');
    }

    // 5b. ECEF Earth-Fixed Axes
    if (vectorVis.showEcefAxes) {
      const origin = { x: 0, y: 0, z: 0 };
      const len = axisLenKm * 0.88;
      addVectorArrow(origin, { x: len, y: 0, z: 0 }, Cesium.Color.fromCssColorString('#f97316'), 'X_ECEF (0° Greenwich)');
      addVectorArrow(origin, { x: 0, y: len, z: 0 }, Cesium.Color.fromCssColorString('#a3e635'), 'Y_ECEF (90°E)');
      addVectorArrow(origin, { x: 0, y: 0, z: len }, Cesium.Color.fromCssColorString('#38bdf8'), 'Z_ECEF (North Pole)');
    }

    // 5c. Selected Satellite Body/LVLH Vectors & Sun Vector
    if (vectorVis.showSatBodyVectors && selectedBundle) {
      const { state } = selectedBundle;
      const vEcef = temeToEcef(state.vTeme, currentDate);
      const axes = computeBodyAxes(state.rEcef, vEcef);
      const vLen = 1800; // km visual vector length
      addVectorArrow(
        state.rEcef,
        v3.add(state.rEcef, v3.scale(axes.x, vLen)),
        Cesium.Color.fromCssColorString('#4ade80'),
        'V (Along-Track / Velocity)'
      );
      addVectorArrow(
        state.rEcef,
        v3.add(state.rEcef, v3.scale(axes.z, vLen * 0.85)),
        Cesium.Color.fromCssColorString('#38bdf8'),
        'Nadir (+Z Body)'
      );
      addVectorArrow(
        state.rEcef,
        v3.add(state.rEcef, v3.scale(axes.y, -vLen * 0.85)),
        Cesium.Color.fromCssColorString('#e879f9'),
        'H (Orbit Normal)'
      );
      const sunEcef = v3.rotZ(sunDirInertial(currentDate), -gmstRad(currentDate));
      addVectorArrow(
        state.rEcef,
        v3.add(state.rEcef, v3.scale(sunEcef, vLen)),
        Cesium.Color.fromCssColorString('#fde047'),
        '☀ Sun Vector'
      );
    }

    // 5d. 3D Orbital Plane Disc + Inclination & RAAN Callouts
    if (vectorVis.showOrbitalPlane && selectedBundle) {
      const { sat, state } = selectedBundle;
      const periodSec = state.periodMin * 60;
      const discPts: Cesium.Cartesian3[] = [];
      for (let i = 0; i <= 64; i++) {
        const dt = (i / 64) * periodSec;
        const stS = propagateSatellite(sat, new Date(simTimeMs + dt * 1000));
        if (stS) {
          discPts.push(kmToCartesian(temeToEcef(stS.rTeme, currentDate)));
        }
      }
      if (discPts.length >= 3) {
        viewer.entities.add({
          polygon: {
            hierarchy: new Cesium.PolygonHierarchy(discPts),
            perPositionHeight: true,
            material: hexToCesiumColor(sat.color, 0.14),
          },
        });
      }
      // Ascending node line & label
      const raanRad = (sat.keplerian.raan_deg * Math.PI) / 180;
      const nodeTeme: Vec3 = {
        x: (WGS84_A + sat.keplerian.altitude_km) * Math.cos(raanRad),
        y: (WGS84_A + sat.keplerian.altitude_km) * Math.sin(raanRad),
        z: 0,
      };
      const nodeEcef = temeToEcef(nodeTeme, currentDate);
      addVectorArrow(
        { x: 0, y: 0, z: 0 },
        nodeEcef,
        Cesium.Color.fromCssColorString('#f43f5e'),
        `Ascending Node Ω=${sat.keplerian.raan_deg.toFixed(1)}° | i=${sat.keplerian.inclination_deg.toFixed(1)}°`
      );
    }

    viewer.entities.resumeEvents();

    // Camera Follow Selected Satellite
    if (cameraFollowSat && selectedBundle) {
      const { state } = selectedBundle;
      const satPos = kmToCartesian(state.rEcef);
      const up = Cesium.Cartesian3.normalize(satPos, new Cesium.Cartesian3());
      const offset = Cesium.Cartesian3.multiplyByScalar(up, 3800000, new Cesium.Cartesian3());
      const camDest = Cesium.Cartesian3.add(satPos, offset, new Cesium.Cartesian3());
      viewer.camera.setView({
        destination: camDest,
        orientation: {
          direction: Cesium.Cartesian3.negate(up, new Cesium.Cartesian3()),
          up: Cesium.Cartesian3.UNIT_Z,
        },
      });
    }
  }, [
    simTimeMs,
    satellites,
    selectedSatId,
    stations,
    targets,
    areaTarget,
    areaCoverage,
    vectorVis,
    cameraFollowSat,
  ]);

  // Update Simulated Sensor Camera PiP View
  useEffect(() => {
    const pipViewer = pipViewerRef.current;
    if (!pipViewer || pipViewer.isDestroyed() || !selectedBundle) return;

    const { sat, state, telemetry } = selectedBundle;
    const camPos = kmToCartesian(state.rEcef);
    const dir = kmToCartesian(telemetry.boresightDirEcef);
    const vEcef = temeToEcef(state.vTeme, currentDate);
    const axes = computeBodyAxes(state.rEcef, vEcef);
    const upVec = kmToCartesian(axes.x); // +X along-track is "up" in sensor frame

    const fovDeg =
      sat.sensor.fov.type === 'conic'
        ? sat.sensor.fov.half_angle_deg * 2
        : Math.max(sat.sensor.fov.cross_half_deg * 2, sat.sensor.fov.along_half_deg * 2);

    if (pipViewer.camera.frustum instanceof Cesium.PerspectiveFrustum) {
      pipViewer.camera.frustum.fov = Cesium.Math.toRadians(Math.max(6, Math.min(90, fovDeg * 1.45)));
    }

    try {
      pipViewer.camera.setView({
        destination: camPos,
        orientation: {
          direction: Cesium.Cartesian3.normalize(dir, new Cesium.Cartesian3()),
          up: Cesium.Cartesian3.normalize(upVec, new Cesium.Cartesian3()),
        },
      });
    } catch {
      // ignore collinear up/direction edge case
    }
  }, [simTimeMs, selectedBundle, showSensorPiP]);

  // Render Synchronized 2D Map Canvas (Ground Track, Footprints, Swath, Terminator, Area Target)
  useEffect(() => {
    const canvas = map2dCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const lonToX = (lon: number) => ((lon + 180) / 360) * w;
    const latToY = (lat: number) => ((90 - lat) / 180) * h;

    // 1. Background Earth Map
    if (earthImgRef.current) {
      ctx.drawImage(earthImgRef.current, 0, 0, w, h);
    } else {
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, w, h);
    }

    // 2. Day/Night Solar Terminator Shading
    if (vectorVis.showDayNightLighting) {
      const sunEcef = v3.rotZ(sunDirInertial(currentDate), -gmstRad(currentDate));
      ctx.fillStyle = 'rgba(2, 6, 23, 0.52)';
      const stepX = 6;
      const stepY = 6;
      for (let py = 0; py < h; py += stepY) {
        const lat = (90 - (py / h) * 180) * (Math.PI / 180);
        const cl = Math.cos(lat);
        const sl = Math.sin(lat);
        for (let px = 0; px < w; px += stepX) {
          const lon = ((px / w) * 360 - 180) * (Math.PI / 180);
          const dot =
            sunEcef.x * cl * Math.cos(lon) +
            sunEcef.y * cl * Math.sin(lon) +
            sunEcef.z * sl;
          if (dot < 0) {
            ctx.fillRect(px, py, stepX, stepY);
          }
        }
      }
    }

    // 3. Lat/Lon Grid Lines
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.18)';
    ctx.lineWidth = 1;
    for (let lon = -150; lon <= 150; lon += 30) {
      const x = lonToX(lon);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let lat = -60; lat <= 60; lat += 30) {
      const y = latToY(lat);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    // Equator highlight
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
    ctx.beginPath();
    ctx.moveTo(0, latToY(0));
    ctx.lineTo(w, latToY(0));
    ctx.stroke();

    // 4. Area Target Polygon & Coverage Grid on 2D Map
    if (areaTarget.vertices.length >= 3) {
      ctx.fillStyle = 'rgba(168, 85, 247, 0.22)';
      ctx.strokeStyle = '#c084fc';
      ctx.lineWidth = 2;
      ctx.beginPath();
      areaTarget.vertices.forEach((v, idx) => {
        const x = lonToX(v.lon);
        const y = latToY(v.lat);
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      if (areaCoverage) {
        for (const cell of areaCoverage.cells) {
          ctx.fillStyle = cell.covered ? '#22c55e' : 'rgba(239, 68, 68, 0.65)';
          ctx.fillRect(lonToX(cell.lon) - 2, latToY(cell.lat) - 2, 4, 4);
        }
      }
    }

    // 5. Ground Stations & Visibility Rings
    for (const gs of stations) {
      const x = lonToX(gs.lon);
      const y = latToY(gs.lat);
      ctx.fillStyle = gs.color;
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.fillStyle = '#e2e8f0';
      ctx.font = 'bold 11px sans-serif';
      ctx.fillText(`📡 ${gs.name}`, x + 8, y + 4);
    }

    // 6. Point Targets
    for (const tgt of targets) {
      const x = lonToX(tgt.lon);
      const y = latToY(tgt.lat);
      ctx.fillStyle = tgt.color;
      ctx.beginPath();
      ctx.arc(x, y, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#fef08a';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.fillStyle = '#fed7aa';
      ctx.font = 'bold 11px sans-serif';
      ctx.fillText(`🎯 ${tgt.name}`, x + 8, y - 4);
    }

    // 7. Satellites: Ground Track, Swath, Footprint & Current Position
    for (const { sat, state, telemetry } of satDataList) {
      const isSelected = sat.id === selectedSatId;

      // Ground track (-0.5 orbit to +1.0 orbit)
      if (sat.show_ground_track) {
        const periodSec = state.periodMin * 60;
        const steps = 140;
        ctx.strokeStyle = sat.color;
        ctx.lineWidth = isSelected ? 2.2 : 1.3;
        ctx.beginPath();
        let prevLon: number | null = null;
        for (let i = 0; i <= steps; i++) {
          const dt = (i / steps - 0.35) * periodSec;
          const stS = propagateSatellite(sat, new Date(simTimeMs + dt * 1000));
          if (!stS) continue;
          const x = lonToX(stS.geodetic.lon);
          const y = latToY(stS.geodetic.lat);
          if (prevLon === null || Math.abs(stS.geodetic.lon - prevLon) > 120) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
          prevLon = stS.geodetic.lon;
        }
        ctx.stroke();
      }

      // Sensor Footprint on 2D Map
      if (sat.sensor.enabled && sat.show_footprint && telemetry.footprintGeodetic.length >= 3) {
        ctx.fillStyle = `${sat.color}38`;
        ctx.strokeStyle = sat.color;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        telemetry.footprintGeodetic.forEach((g, idx) => {
          const x = lonToX(g.lon);
          const y = latToY(g.lat);
          if (idx === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }

      // Current Sub-satellite Point
      const sx = lonToX(state.geodetic.lon);
      const sy = latToY(state.geodetic.lat);
      ctx.fillStyle = sat.color;
      ctx.beginPath();
      ctx.arc(sx, sy, isSelected ? 6.5 : 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = isSelected ? 2.2 : 1.2;
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.font = isSelected ? 'bold 12px sans-serif' : '11px sans-serif';
      ctx.fillText(`🛰️ ${sat.name}`, sx + 9, sy - 6);
    }
  }, [
    simTimeMs,
    satDataList,
    selectedSatId,
    stations,
    targets,
    areaTarget,
    areaCoverage,
    vectorVis.showDayNightLighting,
    viewLayout,
  ]);

  const handle2DMapClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = map2dCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / rect.width;
    const ny = (e.clientY - rect.top) / rect.height;
    const lon = nx * 360 - 180;
    const lat = 90 - ny * 180;
    if (mapClickMode !== 'none') {
      onMapPickLatLon(lat, lon);
      return;
    }
    // Check if user clicked near a satellite on 2D map
    for (const { sat, state } of satDataList) {
      const dLon = Math.abs(state.geodetic.lon - lon);
      const dLat = Math.abs(state.geodetic.lat - lat);
      if (dLon < 5 && dLat < 5) {
        onSelectSat(sat.id);
        return;
      }
    }
  };

  const captureSensorSnapshot = () => {
    const pipViewer = pipViewerRef.current;
    if (!pipViewer || pipViewer.isDestroyed()) return;
    pipViewer.render();
    const dataUrl = pipViewer.scene.canvas.toDataURL('image/png');
    setSnapshotUrl(dataUrl);
  };

  return (
    <div className="relative flex-1 flex h-full w-full bg-slate-950 overflow-hidden">
      {/* 3D GLOBE VIEWPORT */}
      <div
        className={`relative h-full ${
          viewLayout === 'split_3d_2d'
            ? 'w-1/2 border-r border-slate-800'
            : viewLayout === 'only_3d'
            ? 'w-full'
            : 'hidden'
        }`}
      >
        <div ref={globeContainerRef} className="w-full h-full" />

        {/* 3D Viewport Top Badge & Camera Controls */}
        <div className="absolute top-3 left-3 z-10 flex items-center gap-2 bg-slate-900/85 backdrop-blur-md border border-slate-700/80 px-3 py-1.5 rounded-lg text-xs">
          <span className="w-2 h-2 rounded-full bg-sky-400 animate-pulse" />
          <span className="font-semibold text-slate-100">3D WGS84 Globe</span>
          <span className="text-slate-400">|</span>
          <button
            onClick={() => onToggleCameraFollow(!cameraFollowSat)}
            className={`px-2 py-0.5 rounded font-medium transition ${
              cameraFollowSat
                ? 'bg-sky-500 text-slate-950'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            {cameraFollowSat ? '🎥 กำลังเกาะติดดาวเทียม' : '🎥 เกาะติดดาวเทียม'}
          </button>
          <button
            onClick={() => {
              onToggleCameraFollow(false);
              viewerRef.current?.camera.flyTo({
                destination: Cesium.Cartesian3.fromDegrees(100.5, 13.75, 14500000),
                duration: 1.0,
              });
            }}
            className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 hover:bg-slate-700"
          >
            🌏 มองประเทศไทย
          </button>
        </div>

        {/* Educational Vector Legend Overlay when active */}
        {(vectorVis.showEciAxes ||
          vectorVis.showEcefAxes ||
          vectorVis.showSatBodyVectors ||
          vectorVis.showOrbitalPlane) && (
          <div className="absolute bottom-3 left-3 z-10 bg-slate-900/90 backdrop-blur-md border border-slate-700/80 rounded-lg px-3 py-2 text-[11px] space-y-1 max-w-xs">
            <div className="font-semibold text-sky-400">
              📐 สัญลักษณ์เวกเตอร์การสอน (3D Vector Geometry)
            </div>
            {vectorVis.showEciAxes && (
              <div className="text-slate-300">
                • <span className="text-red-400 font-semibold">X_ECI</span> ชี้จุดวสันตวิษุวัต (ไม่หมุนตามโลก)
              </div>
            )}
            {vectorVis.showEcefAxes && (
              <div className="text-slate-300">
                • <span className="text-orange-400 font-semibold">X_ECEF</span> ชี้เมอริเดียนแรก 0° (หมุนตามโลก)
              </div>
            )}
            {vectorVis.showSatBodyVectors && (
              <div className="text-slate-300">
                • <span className="text-green-400 font-semibold">V</span> ความเร็ว |{' '}
                <span className="text-sky-400 font-semibold">Nadir</span> ชี้ศูนย์กลางโลก |{' '}
                <span className="text-yellow-300 font-semibold">☀ Sun</span> ทิศดวงอาทิตย์
              </div>
            )}
            {vectorVis.showOrbitalPlane && selectedBundle && (
              <div className="text-slate-300">
                • ระนาบวงโคจร: <span className="text-rose-400 font-semibold">i = {selectedBundle.sat.keplerian.inclination_deg.toFixed(2)}°</span>,{' '}
                <span className="text-sky-300 font-semibold">RAAN Ω = {selectedBundle.sat.keplerian.raan_deg.toFixed(1)}°</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 2D SYNCHRONIZED TACTICAL MAP VIEWPORT */}
      <div
        className={`relative h-full bg-slate-950 flex flex-col ${
          viewLayout === 'split_3d_2d'
            ? 'w-1/2'
            : viewLayout === 'only_2d'
            ? 'w-full'
            : 'hidden'
        }`}
      >
        <div className="absolute top-3 left-3 z-10 flex items-center gap-2 bg-slate-900/85 backdrop-blur-md border border-slate-700/80 px-3 py-1.5 rounded-lg text-xs">
          <span className="w-2 h-2 rounded-full bg-emerald-400" />
          <span className="font-semibold text-slate-100">
            2D Ground Track & Coverage Map
          </span>
          {mapClickMode !== 'none' && (
            <span className="px-2 py-0.5 rounded bg-amber-500/20 border border-amber-400 text-amber-300 font-medium">
              คลิกบนแผนที่เพื่อวางจุด ({mapClickMode})
            </span>
          )}
        </div>

        <canvas
          ref={map2dCanvasRef}
          width={1200}
          height={600}
          onClick={handle2DMapClick}
          className={`w-full h-full object-fill ${
            mapClickMode !== 'none' ? 'cursor-crosshair' : 'cursor-pointer'
          }`}
        />

        {/* Area Coverage Badge on 2D Map */}
        {areaCoverage && (
          <div className="absolute bottom-3 left-3 z-10 bg-slate-900/90 backdrop-blur-md border border-purple-500/50 rounded-lg px-3 py-2 text-xs flex items-center gap-3">
            <div>
              <div className="text-purple-300 font-semibold">{areaTarget.name}</div>
              <div className="text-slate-400 text-[11px]">
                ครอบคลุม {areaCoverage.covered_cells}/{areaCoverage.total_cells} กริดย่อย
              </div>
            </div>
            <div className="text-lg font-bold text-emerald-400">
              {areaCoverage.coverage_percent.toFixed(1)}%
            </div>
          </div>
        )}
      </div>

      {/* SIMULATED SENSOR / PAYLOAD CAMERA VIEW (Picture-in-Picture) */}
      {showSensorPiP && selectedBundle && (
        <div className="absolute bottom-3 right-3 z-20 w-80 h-60 bg-slate-950/95 border-2 border-sky-500/80 rounded-xl shadow-2xl overflow-hidden flex flex-col">
          {/* PiP Header */}
          <div className="bg-slate-900/95 px-3 py-1.5 border-b border-slate-800 flex items-center justify-between text-[11px]">
            <div className="flex items-center gap-1.5 font-semibold text-sky-300 truncate">
              <span>📷 มุมมองกล้องดาวเทียม:</span>
              <span className="text-white truncate">{selectedBundle.sat.name}</span>
            </div>
            <button
              onClick={captureSensorSnapshot}
              className="px-2 py-0.5 rounded bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-[10px] transition"
              title="ถ่ายภาพจำลองจากกล้องดาวเทียม ณ เวลานี้"
            >
              📸 ถ่ายภาพ
            </button>
          </div>

          {/* 3D Sensor Camera Canvas */}
          <div className="relative flex-1 w-full h-full">
            <div ref={pipContainerRef} className="w-full h-full" />

            {/* Optical / SAR Reticle Crosshair HUD Overlay */}
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="w-36 h-24 border border-sky-400/70 relative">
                <div className="absolute -top-1 -left-1 w-3 h-3 border-t-2 border-l-2 border-sky-300" />
                <div className="absolute -top-1 -right-1 w-3 h-3 border-t-2 border-r-2 border-sky-300" />
                <div className="absolute -bottom-1 -left-1 w-3 h-3 border-b-2 border-l-2 border-sky-300" />
                <div className="absolute -bottom-1 -right-1 w-3 h-3 border-b-2 border-r-2 border-sky-300" />
                <div className="absolute inset-x-0 top-1/2 h-px bg-sky-400/40" />
                <div className="absolute inset-y-0 left-1/2 w-px bg-sky-400/40" />
              </div>
            </div>

            {/* Target Lock Banner */}
            {selectedBundle.telemetry.lockedTargetName && (
              <div className="pointer-events-none absolute top-2 left-2 bg-amber-500/90 text-slate-950 font-bold text-[10px] px-2 py-0.5 rounded shadow">
                🎯 LOCKED: {selectedBundle.telemetry.lockedTargetName}
              </div>
            )}

            {/* Telemetry Readout Footer inside PiP */}
            <div className="pointer-events-none absolute bottom-0 inset-x-0 bg-slate-950/85 backdrop-blur-sm px-2.5 py-1 text-[10px] text-slate-200 grid grid-cols-3 gap-1 border-t border-slate-800/80">
              <div>
                <span className="text-slate-400">GSD: </span>
                <span className="font-mono text-emerald-400 font-semibold">
                  {selectedBundle.telemetry.gsdMeters
                    ? `${selectedBundle.telemetry.gsdMeters.toFixed(2)} m`
                    : '—'}
                </span>
              </div>
              <div>
                <span className="text-slate-400">Off-Nadir: </span>
                <span className="font-mono text-sky-300 font-semibold">
                  {selectedBundle.telemetry.offNadirDeg.toFixed(1)}°
                </span>
              </div>
              <div>
                <span className="text-slate-400">Swath: </span>
                <span className="font-mono text-amber-300 font-semibold">
                  {selectedBundle.telemetry.swathWidthKm
                    ? `${selectedBundle.telemetry.swathWidthKm.toFixed(0)} km`
                    : '—'}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Captured Snapshot Modal */}
      {snapshotUrl && selectedBundle && (
        <div className="absolute inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="bg-slate-900 border border-slate-700 rounded-xl max-w-lg w-full p-4 shadow-2xl space-y-3">
            <div className="flex items-center justify-between">
              <div className="font-bold text-sky-400 text-sm">
                📸 ภาพถ่ายจำลองจากดาวเทียม {selectedBundle.sat.name}
              </div>
              <button
                onClick={() => setSnapshotUrl(null)}
                className="text-slate-400 hover:text-white text-xs px-2 py-1"
              >
                ✕ ปิด
              </button>
            </div>
            <img
              src={snapshotUrl}
              alt="Simulated Satellite Capture"
              className="w-full rounded-lg border border-slate-700"
            />
            <div className="grid grid-cols-2 gap-2 text-xs bg-slate-950 p-2.5 rounded-lg border border-slate-800">
              <div>
                เวลาถ่ายภาพ: <span className="font-mono text-slate-200">{currentDate.toISOString().slice(0, 19)} UTC</span>
              </div>
              <div>
                ความละเอียด GSD:{' '}
                <span className="font-mono text-emerald-400">
                  {selectedBundle.telemetry.gsdMeters?.toFixed(2) ?? '—'} m/px
                </span>
              </div>
              <div>
                มุมเอียง Slew (Roll/Pitch):{' '}
                <span className="font-mono text-sky-300">
                  {selectedBundle.telemetry.activeRollDeg.toFixed(1)}° /{' '}
                  {selectedBundle.telemetry.activePitchDeg.toFixed(1)}°
                </span>
              </div>
              <div>
                มุมเงยดวงอาทิตย์:{' '}
                <span className="font-mono text-amber-300">
                  {selectedBundle.telemetry.sunElevationAtTargetDeg?.toFixed(1) ?? '—'}°
                </span>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <a
                href={snapshotUrl}
                download={`orbitscope-capture-${Date.now()}.png`}
                className="px-3 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold text-xs"
              >
                💾 ดาวน์โหลดภาพ PNG
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
