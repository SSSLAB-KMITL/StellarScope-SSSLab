//! OrbitScope — STK-style 3D satellite orbit and imaging visualiser.

// Hide the console window on Windows release builds
#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]

mod scenario;
mod scene;
mod ui;

use bevy::prelude::*;
use bevy::window::{ExitCondition, PresentMode, WindowResolution};
use bevy_egui::{EguiPlugin, EguiPrimaryContextPass};

/// Size of the off-screen image in headless capture mode.
const CAPTURE_SIZE: (u32, u32) = (1600, 920);

fn main() {
    let start = scenario::now_minute();
    // ORBITSCOPE_SCREENSHOT=<file.png> renders off-screen (no window), saves one frame and exits.
    // Used for smoke tests and documentation screenshots on machines without a display.
    let capture = std::env::var("ORBITSCOPE_SCREENSHOT").ok();

    let mut app = App::new();
    if capture.is_some() {
        app.add_plugins(
            DefaultPlugins
                .set(WindowPlugin { primary_window: None, exit_condition: ExitCondition::DontExit, ..default() })
                .disable::<bevy::winit::WinitPlugin>(),
        )
        .add_plugins(bevy::app::ScheduleRunnerPlugin::run_loop(std::time::Duration::from_secs_f64(1.0 / 30.0)))
        // Software OpenGL can't compile a few unused optional pipelines (e.g. SSAO); keep rendering.
        .insert_resource(bevy::render::error_handler::RenderErrorHandler(|_, _, _| {
            bevy::render::error_handler::RenderErrorPolicy::Ignore
        }))
        .add_systems(PostStartup, headless_target)
        .add_systems(Last, capture_frame);
    } else {
        app.add_plugins(DefaultPlugins.set(WindowPlugin {
            primary_window: Some(Window {
                title: "OrbitScope".into(),
                resolution: WindowResolution::new(1600, 920),
                present_mode: PresentMode::AutoVsync,
                ..default()
            }),
            ..default()
        }));
    }

    app.add_plugins(EguiPlugin::default())
        .insert_resource(scenario::demo(start))
        .insert_resource(scenario::Clock { t: start, start, span_hours: 24.0, rate: 60.0, playing: capture.is_none() })
        .init_resource::<scenario::ViewSettings>()
        .init_resource::<scenario::Reports>()
        .init_resource::<scene::OrbitCam>()
        .init_resource::<scene::PanelInsets>()
        .add_systems(Startup, scene::setup)
        .add_systems(
            Update,
            (
                scene::advance_clock,
                scene::camera_control,
                scene::update_earth_and_sun,
                scene::update_camera,
                scene::sync_entities,
                scene::update_markers,
                scene::update_volumes,
                scene::draw_gizmos,
            )
                .chain(),
        )
        .add_systems(EguiPrimaryContextPass, ui::ui_system)
        .run();
}

#[derive(Resource)]
struct CaptureImage(Handle<Image>);

fn headless_target(
    mut commands: Commands,
    mut images: ResMut<Assets<Image>>,
    cams: Query<Entity, Or<(With<scene::MainCamera>, With<scene::UiCamera>)>>,
    mut cam: ResMut<scene::OrbitCam>,
    scen: Res<scenario::Scenario>,
    clock: Res<scenario::Clock>,
    mut reports: ResMut<scenario::Reports>,
) {
    use bevy::render::render_resource::{TextureFormat, TextureUsages};
    let mut img = Image::new_target_texture(CAPTURE_SIZE.0, CAPTURE_SIZE.1, TextureFormat::Rgba8UnormSrgb, None);
    img.texture_descriptor.usage |= TextureUsages::COPY_SRC;
    let handle = images.add(img);
    for cam in &cams {
        commands.entity(cam).insert(bevy::camera::RenderTarget::Image(handle.clone().into()));
    }
    // simplest shadow sampling path: some software OpenGL drivers reject the default filter shader
    for cam in &cams {
        commands.entity(cam).insert(bevy::light::ShadowFilteringMethod::Hardware2x2);
    }
    commands.insert_resource(CaptureImage(handle));
    // optional close-up: ORBITSCOPE_FOCUS=<satellite index> [ORBITSCOPE_DIST=<km>]
    if let Some(i) = std::env::var("ORBITSCOPE_FOCUS").ok().and_then(|v| v.parse().ok()) {
        cam.focus_sat = Some(i);
        cam.distance = std::env::var("ORBITSCOPE_DIST").ok().and_then(|v| v.parse().ok()).unwrap_or(3000.0);
    }
    // optional: ORBITSCOPE_LOOKAT=<lat>,<lon> points the camera at a place on Earth
    if let Some((lat, lon)) = std::env::var("ORBITSCOPE_LOOKAT").ok().and_then(|v| {
        let (a, b) = v.split_once(',')?;
        Some((a.trim().parse::<f64>().ok()?, b.trim().parse::<f64>().ok()?))
    }) {
        let p = orbitscope_core::frames::ecef_to_teme(orbitscope_core::Geodetic::new(lat, lon, 0.0).to_ecef(), clock.t);
        let d = scene::to_bevy(p).normalize();
        cam.pitch = d.y.asin();
        cam.yaw = d.x.atan2(d.z);
        if let Some(dist) = std::env::var("ORBITSCOPE_DIST").ok().and_then(|v| v.parse().ok()) {
            cam.distance = dist;
        }
    }
    // optional: ORBITSCOPE_REPORT=1 fills the access report
    if std::env::var("ORBITSCOPE_REPORT").is_ok() {
        ui::compute_reports(&scen, &clock, &mut reports);
    }
}

fn capture_frame(
    mut commands: Commands,
    mut frame: Local<u32>,
    mut exit: MessageWriter<AppExit>,
    target: Option<Res<CaptureImage>>,
) {
    let (Ok(path), Some(target)) = (std::env::var("ORBITSCOPE_SCREENSHOT"), target) else { return };
    *frame += 1;
    if *frame == 150 {
        use bevy::render::view::screenshot::{save_to_disk, Screenshot};
        commands.spawn(Screenshot::image(target.0.clone())).observe(save_to_disk(path));
    }
    if *frame == 230 {
        exit.write(AppExit::Success);
    }
}
