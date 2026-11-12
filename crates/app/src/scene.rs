//! 3D scene: Earth, Sun light, camera control, satellites, orbits, sensors, swaths.
//!
//! Scene frame = TEME (quasi-inertial), 1 unit = 1 km.
//! Core uses Z-up; Bevy uses Y-up, so core (x, y, z) -> Bevy (x, z, -y).

use bevy::asset::RenderAssetUsages;
use bevy::camera::Viewport;
use bevy::image::{CompressedImageFormats, ImageSampler, ImageType};
use bevy::input::mouse::{AccumulatedMouseMotion, AccumulatedMouseScroll};
use bevy::mesh::{Indices, PrimitiveTopology};
use bevy::prelude::*;
use bevy_egui::input::EguiWantsInput;
use orbitscope_core::frames::{ecef_to_teme, teme_to_ecef, WGS84_A};
use orbitscope_core::sensor::Sensor;
use orbitscope_core::time::{add_secs, gmst};
use orbitscope_core::{Epoch, Geodetic, V3};

use crate::scenario::{Clock, Scenario, Selection, ViewSettings};

static EARTH_PNG: &[u8] = include_bytes!("../../../assets/earth.png");

// ---------------------------------------------------------------- coordinates

/// Core inertial/ECEF vector (km, Z-up) -> Bevy world (Y-up).
pub fn to_bevy(v: V3) -> Vec3 {
    Vec3::new(v.x as f32, v.z as f32, -v.y as f32)
}

/// Rotation of the Earth mesh (built in ECEF) into the scene frame at time `t`.
pub fn earth_rotation(t: Epoch) -> Quat {
    Quat::from_rotation_y(gmst(t) as f32)
}

/// Ground point (ECEF) as seen in the scene at `t`, lifted `lift_km` along the radial.
fn ground_to_scene(p_ecef: V3, t: Epoch, lift_km: f64) -> Vec3 {
    let r = p_ecef.norm();
    to_bevy(ecef_to_teme(p_ecef * ((r + lift_km) / r), t))
}

// ---------------------------------------------------------------- components

#[derive(Component)]
pub struct Earth;

#[derive(Component)]
pub struct SunLight;

#[derive(Component)]
pub struct MainCamera;

/// Overlay camera that only draws the egui UI on top of the 3D view.
#[derive(Component)]
pub struct UiCamera;

/// Marker sphere of satellite `i`.
#[derive(Component)]
pub struct SatMarker(pub usize);

/// Dynamic translucent mesh (sensor cone + swath) of satellite `i`.
#[derive(Component)]
pub struct SatVolume(pub usize);

#[derive(Resource)]
pub struct SceneAssets {
    marker_mesh: Handle<Mesh>,
    volume_material: Handle<StandardMaterial>,
}

/// Orbit-style camera around the Earth or a satellite.
#[derive(Resource)]
pub struct OrbitCam {
    pub yaw: f32,
    pub pitch: f32,
    pub distance: f32,
    pub focus_sat: Option<usize>,
}

impl Default for OrbitCam {
    fn default() -> Self {
        Self { yaw: 0.6, pitch: 0.35, distance: 26_000.0, focus_sat: None }
    }
}

/// Screen-space areas covered by egui panels (logical px), written by the UI.
#[derive(Resource, Default, Clone, Copy)]
pub struct PanelInsets {
    pub left: f32,
    pub right: f32,
    pub top: f32,
    pub bottom: f32,
}

// ---------------------------------------------------------------- setup

pub fn setup(
    mut commands: Commands,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    mut images: ResMut<Assets<Image>>,
    mut gizmo_store: ResMut<GizmoConfigStore>,
    mut egui_settings: ResMut<bevy_egui::EguiGlobalSettings>,
) {
    let earth_tex = Image::from_buffer(
        EARTH_PNG,
        ImageType::Extension("png"),
        CompressedImageFormats::NONE,
        true,
        ImageSampler::linear(),
        RenderAssetUsages::default(),
    )
    .expect("embedded earth texture");

    commands.spawn((
        Earth,
        Mesh3d(meshes.add(earth_mesh(160, 320))),
        MeshMaterial3d(materials.add(StandardMaterial {
            base_color_texture: Some(images.add(earth_tex)),
            perceptual_roughness: 0.9,
            reflectance: 0.15,
            ..default()
        })),
        Transform::IDENTITY,
    ));

    commands.spawn((
        SunLight,
        DirectionalLight { illuminance: 9_000.0, shadow_maps_enabled: false, ..default() },
        Transform::IDENTITY,
    ));
    commands.insert_resource(GlobalAmbientLight { color: Color::srgb(0.55, 0.65, 0.9), brightness: 450.0, ..default() });
    commands.insert_resource(ClearColor(Color::srgb(0.012, 0.016, 0.035)));

    commands.spawn((
        MainCamera,
        Camera3d::default(),
        Projection::Perspective(PerspectiveProjection {
            fov: 40f32.to_radians(),
            near: 1.0,
            far: 2_000_000.0,
            ..default()
        }),
        Transform::from_xyz(0.0, 0.0, 26_000.0).looking_at(Vec3::ZERO, Vec3::Y),
    ));

    // The UI gets its own full-window camera so the 3D camera's viewport can shrink
    // to the area between the panels without clipping the panels themselves.
    egui_settings.auto_create_primary_context = false;
    commands.spawn((
        UiCamera,
        bevy_egui::PrimaryEguiContext,
        Camera2d,
        bevy::camera::visibility::RenderLayers::none(),
        Camera {
            order: 1,
            output_mode: bevy::camera::CameraOutputMode::Write {
                blend_state: Some(bevy::render::render_resource::BlendState::ALPHA_BLENDING),
                clear_color: ClearColorConfig::None,
            },
            clear_color: ClearColorConfig::Custom(Color::NONE),
            ..default()
        },
    ));

    commands.insert_resource(SceneAssets {
        marker_mesh: meshes.add(Sphere::new(1.0).mesh().ico(3).expect("ico sphere")),
        volume_material: materials.add(StandardMaterial {
            base_color: Color::WHITE,
            unlit: true,
            alpha_mode: AlphaMode::Blend,
            double_sided: true,
            cull_mode: None,
            ..default()
        }),
    });

    let (config, _) = gizmo_store.config_mut::<DefaultGizmoConfigGroup>();
    config.line.width = 1.6;
}

/// WGS84 ellipsoid mesh in ECEF (Bevy axes) with equirectangular UVs that match
/// `assets/earth.png` by construction (u = (lon+180)/360, v = (90-lat)/180).
fn earth_mesh(lat_segs: usize, lon_segs: usize) -> Mesh {
    let mut pos = Vec::new();
    let mut nrm = Vec::new();
    let mut uv = Vec::new();
    for i in 0..=lat_segs {
        let lat = 90.0 - 180.0 * i as f64 / lat_segs as f64;
        for j in 0..=lon_segs {
            let lon = -180.0 + 360.0 * j as f64 / lon_segs as f64;
            let g = Geodetic::new(lat, lon, 0.0);
            pos.push(to_bevy(g.to_ecef()).to_array());
            nrm.push(to_bevy(g.up()).to_array());
            uv.push([(j as f32) / lon_segs as f32, (i as f32) / lat_segs as f32]);
        }
    }
    let row = lon_segs as u32 + 1;
    let mut idx = Vec::new();
    for i in 0..lat_segs as u32 {
        for j in 0..lon_segs as u32 {
            let a = i * row + j;
            let b = a + row;
            idx.extend_from_slice(&[a, b, a + 1, a + 1, b, b + 1]);
        }
    }
    Mesh::new(PrimitiveTopology::TriangleList, RenderAssetUsages::default())
        .with_inserted_attribute(Mesh::ATTRIBUTE_POSITION, pos)
        .with_inserted_attribute(Mesh::ATTRIBUTE_NORMAL, nrm)
        .with_inserted_attribute(Mesh::ATTRIBUTE_UV_0, uv)
        .with_inserted_indices(Indices::U32(idx))
}

// ---------------------------------------------------------------- systems

pub fn advance_clock(time: Res<Time>, mut clock: ResMut<Clock>) {
    if clock.playing {
        let dt = time.delta_secs_f64() * clock.rate;
        clock.t = add_secs(clock.t, dt);
    }
}

pub fn update_earth_and_sun(
    clock: Res<Clock>,
    view: Res<ViewSettings>,
    mut earth: Single<&mut Transform, (With<Earth>, Without<SunLight>)>,
    mut sun: Single<(&mut Transform, &mut DirectionalLight), (With<SunLight>, Without<Earth>)>,
    mut ambient: ResMut<GlobalAmbientLight>,
) {
    earth.rotation = earth_rotation(clock.t);
    let s = to_bevy(orbitscope_core::sun::sun_dir_inertial(clock.t));
    *sun.0 = Transform::IDENTITY.looking_to(-s, Vec3::Y);
    sun.1.illuminance = if view.sun_lighting { 9_000.0 } else { 0.0 };
    ambient.brightness = if view.sun_lighting { 450.0 } else { 1_600.0 };
}

pub fn camera_control(
    mut cam: ResMut<OrbitCam>,
    buttons: Res<ButtonInput<MouseButton>>,
    motion: Res<AccumulatedMouseMotion>,
    scroll: Res<AccumulatedMouseScroll>,
    egui_input: Res<EguiWantsInput>,
    keys: Res<ButtonInput<KeyCode>>,
) {
    if egui_input.wants_pointer_input() || egui_input.is_pointer_over_area() {
        return;
    }
    if buttons.pressed(MouseButton::Left) || buttons.pressed(MouseButton::Right) {
        cam.yaw -= motion.delta.x * 0.005;
        cam.pitch = (cam.pitch + motion.delta.y * 0.005).clamp(-1.55, 1.55);
    }
    let min = if cam.focus_sat.is_some() { 60.0 } else { WGS84_A as f32 + 150.0 };
    if scroll.delta.y != 0.0 {
        let k = 1.0 - scroll.delta.y.clamp(-5.0, 5.0) * 0.08;
        let base = if cam.focus_sat.is_some() { 0.0 } else { WGS84_A as f32 };
        // zoom proportionally to the distance from the surface for smooth close-ups
        cam.distance = (base + (cam.distance - base) * k).clamp(min, 400_000.0);
    }
    if keys.just_pressed(KeyCode::Escape) {
        cam.focus_sat = None;
        cam.distance = cam.distance.max(WGS84_A as f32 + 2000.0);
    }
}

pub fn update_camera(
    cam: Res<OrbitCam>,
    clock: Res<Clock>,
    view: Res<ViewSettings>,
    scen: Res<Scenario>,
    insets: Res<PanelInsets>,
    window: Option<Single<&Window, With<bevy::window::PrimaryWindow>>>,
    mut q: Single<(&mut Transform, &mut Camera), With<MainCamera>>,
) {
    let target = cam
        .focus_sat
        .and_then(|i| scen.sats.get(i))
        .and_then(|e| e.sat.state(clock.t))
        .map(|s| to_bevy(s.r))
        .unwrap_or(Vec3::ZERO);
    let yaw = cam.yaw + if view.earth_fixed { gmst(clock.t) as f32 } else { 0.0 };
    let dir = Vec3::new(cam.pitch.cos() * yaw.sin(), cam.pitch.sin(), cam.pitch.cos() * yaw.cos());
    *q.0 = Transform::from_translation(target + dir * cam.distance).looking_at(target, Vec3::Y);

    // keep the 3D view inside the area not covered by panels
    // (no window = headless capture mode, which renders a fixed-size image)
    let (sf, w, h) = match &window {
        Some(win) => (win.scale_factor(), win.physical_width(), win.physical_height()),
        None => (1.0, 1600, 920),
    };
    let x = (insets.left * sf) as u32;
    let y = (insets.top * sf) as u32;
    let r = (insets.right * sf) as u32;
    let b = (insets.bottom * sf) as u32;
    if w > x + r + 16 && h > y + b + 16 {
        q.1.viewport = Some(Viewport {
            physical_position: UVec2::new(x, y),
            physical_size: UVec2::new(w - x - r, h - y - b),
            ..default()
        });
    }
}

/// Keep one marker entity and one translucent volume entity per satellite.
pub fn sync_entities(
    mut commands: Commands,
    scen: Res<Scenario>,
    assets: Res<SceneAssets>,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    markers: Query<(Entity, &SatMarker)>,
    volumes: Query<(Entity, &SatVolume)>,
    mut last_rev: Local<Option<u64>>,
) {
    let n = scen.sats.len();
    let have_m = markers.iter().count();
    let have_v = volumes.iter().count();
    if have_m == n && have_v == n && *last_rev == Some(scen.revision) {
        return;
    }
    *last_rev = Some(scen.revision);
    for (e, _) in &markers {
        commands.entity(e).despawn();
    }
    for (e, _) in &volumes {
        commands.entity(e).despawn();
    }
    for (i, s) in scen.sats.iter().enumerate() {
        commands.spawn((
            SatMarker(i),
            Mesh3d(assets.marker_mesh.clone()),
            MeshMaterial3d(materials.add(StandardMaterial {
                base_color: s.bevy_color(),
                emissive: s.bevy_color().to_linear() * 2.0,
                unlit: true,
                ..default()
            })),
            Transform::IDENTITY,
        ));
        commands.spawn((
            SatVolume(i),
            Mesh3d(meshes.add(empty_mesh())),
            MeshMaterial3d(assets.volume_material.clone()),
            Transform::IDENTITY,
        ));
    }
}

/// A single invisible degenerate triangle at the Earth's centre (avoids zero-vertex meshes).
fn empty_mesh() -> Mesh {
    Mesh::new(PrimitiveTopology::TriangleList, RenderAssetUsages::default())
        .with_inserted_attribute(Mesh::ATTRIBUTE_POSITION, vec![[0.0f32; 3]; 3])
        .with_inserted_attribute(Mesh::ATTRIBUTE_COLOR, vec![[0.0f32; 4]; 3])
        .with_inserted_indices(Indices::U32(vec![0, 1, 2]))
}

pub fn update_markers(
    clock: Res<Clock>,
    scen: Res<Scenario>,
    cam_q: Single<&Transform, (With<MainCamera>, Without<SatMarker>)>,
    mut q: Query<(&SatMarker, &mut Transform, &mut Visibility)>,
) {
    let cam_pos = cam_q.translation;
    for (m, mut tf, mut vis) in &mut q {
        let Some(e) = scen.sats.get(m.0) else { continue };
        match e.sat.state(clock.t) {
            Some(s) if e.visible => {
                let p = to_bevy(s.r);
                let size = (cam_pos.distance(p) * 0.0045).clamp(0.4, 180.0);
                let sel = scen.selection == Selection::Sat(m.0);
                *tf = Transform::from_translation(p).with_scale(Vec3::splat(if sel { size * 1.5 } else { size }));
                *vis = Visibility::Visible;
            }
            _ => *vis = Visibility::Hidden,
        }
    }
}

/// Rebuild the translucent sensor cone + swath strip for every satellite.
pub fn update_volumes(
    clock: Res<Clock>,
    scen: Res<Scenario>,
    mut meshes: ResMut<Assets<Mesh>>,
    q: Query<(&SatVolume, &Mesh3d)>,
) {
    for (v, handle) in &q {
        let Some(mut mesh) = meshes.get_mut(&handle.0) else { continue };
        let mut pos: Vec<[f32; 3]> = Vec::new();
        let mut col: Vec<[f32; 4]> = Vec::new();
        let mut idx: Vec<u32> = Vec::new();
        if let Some(e) = scen.sats.get(v.0).filter(|e| e.visible) {
            if let Some(sensor) = e.sensor {
                let c = e.color;
                if e.show_swath {
                    swath_strip(&e.sat, &sensor, clock.t, e.swath_minutes, [c[0], c[1], c[2], 0.38], &mut pos, &mut col, &mut idx);
                }
                if e.show_sensor {
                    cone_fan(&e.sat, &sensor, clock.t, [c[0], c[1], c[2], 0.16], &mut pos, &mut col, &mut idx);
                }
            }
        }
        if idx.is_empty() {
            pos = vec![[0.0; 3]; 3];
            col = vec![[0.0; 4]; 3];
            idx = vec![0, 1, 2];
        }
        mesh.insert_attribute(Mesh::ATTRIBUTE_POSITION, pos);
        mesh.insert_attribute(Mesh::ATTRIBUTE_COLOR, col);
        mesh.insert_indices(Indices::U32(idx));
    }
}

fn cone_fan(
    sat: &orbitscope_core::Satellite,
    sensor: &Sensor,
    t: Epoch,
    rgba: [f32; 4],
    pos: &mut Vec<[f32; 3]>,
    col: &mut Vec<[f32; 4]>,
    idx: &mut Vec<u32>,
) {
    let Some(s) = sat.state(t) else { return };
    let ring = sensor.footprint(&s, 16);
    if ring.len() < 3 {
        return;
    }
    let base = pos.len() as u32;
    pos.push(to_bevy(s.r).to_array());
    col.push(rgba);
    for p in &ring {
        // lift slightly so the fan edge does not z-fight with the ground
        pos.push(to_bevy(*p * ((p.norm() + 3.0) / p.norm())).to_array());
        col.push(rgba);
    }
    let n = ring.len() as u32;
    for k in 0..n {
        idx.extend_from_slice(&[base, base + 1 + k, base + 1 + (k + 1) % n]);
    }
}

#[allow(clippy::too_many_arguments)]
fn swath_strip(
    sat: &orbitscope_core::Satellite,
    sensor: &Sensor,
    t: Epoch,
    minutes: f64,
    rgba: [f32; 4],
    pos: &mut Vec<[f32; 3]>,
    col: &mut Vec<[f32; 4]>,
    idx: &mut Vec<u32>,
) {
    let steps = ((minutes * 60.0 / 8.0).ceil() as usize).clamp(2, 600);
    let mut prev: Option<u32> = None;
    for k in 0..=steps {
        let tk = add_secs(t, -minutes * 60.0 * (1.0 - k as f64 / steps as f64));
        let edges = sat.state(tk).and_then(|s| sensor.swath_edges(&s));
        let Some((l, r)) = edges else {
            prev = None;
            continue;
        };
        // fade the trail towards its tail
        let a = rgba[3] * (0.25 + 0.75 * k as f32 / steps as f32);
        let base = pos.len() as u32;
        for p in [l, r] {
            pos.push(ground_to_scene(teme_to_ecef(p, tk), t, 2.0).to_array());
            col.push([rgba[0], rgba[1], rgba[2], a]);
        }
        if let Some(pb) = prev {
            idx.extend_from_slice(&[pb, pb + 1, base, base, pb + 1, base + 1]);
        }
        prev = Some(base);
    }
}

/// Lines: orbits, ground tracks, sensor outlines, lat/lon grid, ground sites.
pub fn draw_gizmos(mut gizmos: Gizmos, clock: Res<Clock>, scen: Res<Scenario>, view: Res<ViewSettings>) {
    let t = clock.t;
    if view.grid {
        let grid = Color::srgba(0.6, 0.75, 1.0, 0.13);
        for lat in (-60..=60).step_by(30) {
            let pts = (0..=180).map(|j| {
                ground_to_scene(Geodetic::new(lat as f64, -180.0 + 2.0 * j as f64, 0.0).to_ecef(), t, 4.0)
            });
            gizmos.linestrip(pts, grid);
        }
        for lon in (-180..180).step_by(30) {
            let pts = (0..=90).map(|i| {
                ground_to_scene(Geodetic::new(-90.0 + 2.0 * i as f64, lon as f64, 0.0).to_ecef(), t, 4.0)
            });
            gizmos.linestrip(pts, grid);
        }
    }

    for (i, e) in scen.sats.iter().enumerate() {
        if !e.visible {
            continue;
        }
        let selected = scen.selection == Selection::Sat(i);
        let c = e.color;
        let period = e.sat.period_s();
        let Some(s_now) = e.sat.state(t) else { continue };

        if e.show_orbit {
            let n = 240;
            let pts = (0..=n).filter_map(|k| e.sat.state(add_secs(t, period * k as f64 / n as f64)).map(|s| to_bevy(s.r)));
            gizmos.linestrip(pts, Color::srgba(c[0], c[1], c[2], if selected { 0.95 } else { 0.6 }));
        }

        if e.show_ground_track {
            let n = 200;
            let track = |from: f64, to: f64| {
                (0..=n).filter_map(move |k| {
                    let tk = add_secs(t, from + (to - from) * k as f64 / n as f64);
                    e.sat.state(tk).map(|s| {
                        let g = Geodetic::from_ecef(teme_to_ecef(s.r, tk));
                        ground_to_scene(Geodetic::new(g.lat, g.lon, 0.0).to_ecef(), t, 6.0)
                    })
                })
            };
            gizmos.linestrip(track(-period, 0.0), Color::srgba(c[0], c[1], c[2], 0.35));
            gizmos.linestrip(track(0.0, period), Color::srgba(c[0], c[1], c[2], 0.8));
            // nadir line
            let sub = Geodetic::from_ecef(teme_to_ecef(s_now.r, t));
            let p_ground = ground_to_scene(Geodetic::new(sub.lat, sub.lon, 0.0).to_ecef(), t, 0.0);
            gizmos.line(to_bevy(s_now.r), p_ground, Color::srgba(c[0], c[1], c[2], 0.25));
        }

        if let (true, Some(sensor)) = (e.show_sensor, e.sensor) {
            let fp = sensor.footprint(&s_now, 24);
            if fp.len() > 2 {
                let lifted: Vec<Vec3> = fp.iter().map(|p| to_bevy(*p * ((p.norm() + 5.0) / p.norm()))).collect();
                let mut loop_pts = lifted.clone();
                loop_pts.push(lifted[0]);
                gizmos.linestrip(loop_pts, Color::srgb(c[0], c[1], c[2]));
                let sp = to_bevy(s_now.r);
                let step = (lifted.len() / 4).max(1);
                for p in lifted.iter().step_by(step) {
                    gizmos.line(sp, *p, Color::srgba(c[0], c[1], c[2], 0.55));
                }
            }
        }

        // contact lines to ground stations in view
        let sat_ecef = teme_to_ecef(s_now.r, t);
        for site in &scen.sites {
            let look = orbitscope_core::frames::look_angles(site.geo, sat_ecef);
            if look.el_deg >= site.min_el_deg {
                gizmos.line(
                    ground_to_scene(site.geo.to_ecef(), t, 0.0),
                    to_bevy(s_now.r),
                    Color::srgba(0.4, 1.0, 0.6, 0.9),
                );
            }
        }
    }

    // ground stations (triangle) and targets (cross), drawn in the local tangent plane
    for (i, site) in scen.sites.iter().enumerate() {
        let sel = scen.selection == Selection::Site(i);
        let col = if sel { Color::srgb(1.0, 1.0, 1.0) } else { Color::srgb(0.4, 1.0, 0.6) };
        ground_symbol(&mut gizmos, site.geo, t, 3, 45.0, col);
    }
    for (i, tg) in scen.targets.iter().enumerate() {
        let sel = scen.selection == Selection::Target(i);
        let col = if sel { Color::srgb(1.0, 1.0, 1.0) } else { Color::srgb(1.0, 0.35, 0.35) };
        ground_symbol(&mut gizmos, tg.geo, t, 4, 40.0, col);
    }
}

fn ground_symbol(gizmos: &mut Gizmos, g: Geodetic, t: Epoch, sides: usize, size_km: f64, color: Color) {
    let c = g.to_ecef();
    let (e, n) = (g.east(), g.north());
    let pts: Vec<Vec3> = (0..=sides)
        .map(|k| {
            let a = std::f64::consts::TAU * k as f64 / sides as f64 + std::f64::consts::FRAC_PI_2;
            ground_to_scene(c + e * (size_km * a.cos()) + n * (size_km * a.sin()), t, 6.0)
        })
        .collect();
    gizmos.linestrip(pts, color);
}

/// True if the straight segment camera -> point passes through the Earth.
pub fn occluded_by_earth(cam: Vec3, p: Vec3) -> bool {
    let d = p - cam;
    let len = d.length();
    let dir = d / len;
    let r = WGS84_A as f32 - 10.0;
    let b = cam.dot(dir);
    let c = cam.length_squared() - r * r;
    let disc = b * b - c;
    if disc < 0.0 {
        return false;
    }
    let t = -b - disc.sqrt();
    t > 0.0 && t < len
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{TimeZone, Utc};

    #[test]
    fn earth_quat_matches_core_rotation() {
        let t = Utc.with_ymd_and_hms(2026, 11, 12, 15, 30, 0).unwrap();
        let p = Geodetic::new(13.75, 100.5, 0.0).to_ecef();
        let via_core = to_bevy(ecef_to_teme(p, t));
        let via_quat = earth_rotation(t) * to_bevy(p);
        assert!(via_core.distance(via_quat) < 0.05, "{via_core} vs {via_quat}");
    }

    #[test]
    fn axis_mapping_is_right_handed() {
        let x = to_bevy(V3::new(1.0, 0.0, 0.0));
        let y = to_bevy(V3::new(0.0, 1.0, 0.0));
        let z = to_bevy(V3::new(0.0, 0.0, 1.0));
        assert!(x.cross(y).distance(z) < 1e-6);
    }

    #[test]
    fn occlusion() {
        let cam = Vec3::new(0.0, 0.0, 20_000.0);
        assert!(occluded_by_earth(cam, Vec3::new(0.0, 0.0, -7000.0)));
        assert!(!occluded_by_earth(cam, Vec3::new(0.0, 0.0, 7000.0)));
    }
}
