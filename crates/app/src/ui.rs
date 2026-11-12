//! egui user interface: time controls, object browser, properties, reports, labels.

use bevy::prelude::*;
use bevy_egui::egui::{self, Align2, Color32, FontId, LayerId, RichText, Ui, UiBuilder};
use bevy_egui::EguiContexts;
use orbitscope_core::access::{imaging_opportunities, station_passes};
use orbitscope_core::frames::{look_angles, teme_to_ecef};
use orbitscope_core::orbit::{raan_for_ltan, sun_sync_inclination};
use orbitscope_core::sensor::{gsd_m, off_nadir_angle};
use orbitscope_core::sun::{in_eclipse, sun_elevation};
use orbitscope_core::time::{add_secs, secs_between};
use orbitscope_core::{Epoch, Fov, Geodetic, Keplerian, Satellite, Sensor};

use crate::scenario::*;
use crate::scene::{occluded_by_earth, to_bevy, MainCamera, OrbitCam, PanelInsets};

static THAI_FONT: &[u8] = include_bytes!("../../../assets/Sarabun-Regular.ttf");

const RATES: [f64; 8] = [1.0, 10.0, 30.0, 60.0, 120.0, 300.0, 1000.0, 3600.0];

fn fmt_t(t: Epoch) -> String {
    t.format("%Y-%m-%d %H:%M:%S").to_string()
}
fn fmt_short(t: Epoch) -> String {
    t.format("%m-%d %H:%M:%S").to_string()
}
fn c32(c: [f32; 3]) -> Color32 {
    Color32::from_rgb((c[0] * 255.0) as u8, (c[1] * 255.0) as u8, (c[2] * 255.0) as u8)
}

#[derive(Clone)]
pub struct Wizard {
    name: String,
    altitude: f64,
    sun_sync: bool,
    ltdn: f64,
    inclination: f64,
    raan: f64,
    mean_anomaly: f64,
    eccentricity: f64,
    sensor: u8, // 0 none, 1 rectangular, 2 conic
    cross_half: f64,
    along_half: f64,
}

impl Default for Wizard {
    fn default() -> Self {
        Self {
            name: "NEW-SAT".into(),
            altitude: 600.0,
            sun_sync: true,
            ltdn: 10.5,
            inclination: 97.8,
            raan: 0.0,
            mean_anomaly: 0.0,
            eccentricity: 0.0001,
            sensor: 1,
            cross_half: 5.0,
            along_half: 1.0,
        }
    }
}

pub struct Dialogs {
    tle_open: bool,
    tle_text: String,
    tle_msg: String,
    wizard_open: bool,
    wizard: Wizard,
    wizard_msg: String,
    point_open: bool,
    point_name: String,
    point_lat: f64,
    point_lon: f64,
    point_is_target: bool,
    help_open: bool,
}

impl Default for Dialogs {
    fn default() -> Self {
        Self {
            tle_open: false,
            tle_text: String::new(),
            tle_msg: String::new(),
            wizard_open: false,
            wizard: Wizard::default(),
            wizard_msg: String::new(),
            point_open: false,
            point_name: "จุดใหม่".into(),
            point_lat: 13.75,
            point_lon: 100.5,
            point_is_target: true,
            help_open: false,
        }
    }
}

fn setup_style(ctx: &egui::Context) {
    use egui::epaint::text::{FontInsert, FontPriority, InsertFontFamily};
    ctx.add_font(FontInsert::new(
        "sarabun",
        egui::FontData::from_static(THAI_FONT),
        vec![
            InsertFontFamily { family: egui::FontFamily::Proportional, priority: FontPriority::Lowest },
            InsertFontFamily { family: egui::FontFamily::Monospace, priority: FontPriority::Lowest },
        ],
    ));
    let mut v = egui::Visuals::dark();
    v.panel_fill = Color32::from_rgb(14, 18, 30);
    v.window_fill = Color32::from_rgb(18, 23, 38);
    v.extreme_bg_color = Color32::from_rgb(8, 11, 20);
    v.selection.bg_fill = Color32::from_rgb(40, 90, 150);
    ctx.set_visuals(v);
}

#[allow(clippy::too_many_arguments)]
pub fn ui_system(
    mut contexts: EguiContexts,
    mut scen: ResMut<Scenario>,
    mut clock: ResMut<Clock>,
    mut view: ResMut<ViewSettings>,
    mut cam: ResMut<OrbitCam>,
    mut reports: ResMut<Reports>,
    mut insets: ResMut<PanelInsets>,
    mut dlg: Local<Dialogs>,
    mut init: Local<bool>,
    camera_q: Single<(&Camera, &GlobalTransform), With<MainCamera>>,
) -> Result {
    let ctx = contexts.ctx_mut()?.clone();
    if !*init {
        setup_style(&ctx);
        *init = true;
    }

    let mut root = Ui::new(ctx.clone(), "root".into(), UiBuilder::new().layer_id(LayerId::background()).max_rect(ctx.viewport_rect()));

    let top = egui::Panel::top("top").show(&mut root, |ui| top_bar(ui, &mut clock, &mut view, &mut dlg)).response.rect.height();
    let bottom = egui::Panel::bottom("bottom")
        .resizable(true)
        .default_size(220.0)
        .show(&mut root, |ui| bottom_panel(ui, &mut clock, &scen, &mut reports))
        .response
        .rect
        .height();
    let left = egui::Panel::left("left")
        .resizable(true)
        .default_size(250.0)
        .show(&mut root, |ui| objects_panel(ui, &mut scen, &mut cam, &mut dlg))
        .response
        .rect
        .width();
    let right = egui::Panel::right("right")
        .resizable(true)
        .default_size(310.0)
        .show(&mut root, |ui| properties_panel(ui, &mut scen, &clock, &mut cam))
        .response
        .rect
        .width();
    *insets = PanelInsets { left, right, top, bottom };

    dialogs(&ctx, &mut dlg, &mut scen, &clock);

    if view.labels {
        let (camera, cam_tf) = *camera_q;
        let vp = egui::Rect::from_min_max(
            egui::pos2(left, top),
            egui::pos2(ctx.viewport_rect().right() - right, ctx.viewport_rect().bottom() - bottom),
        );
        draw_labels(&ctx, vp, camera, cam_tf, &scen, &clock);
    }
    Ok(())
}

fn top_bar(ui: &mut Ui, clock: &mut Clock, view: &mut ViewSettings, dlg: &mut Dialogs) {
    ui.add_space(4.0);
    ui.horizontal(|ui| {
        ui.label(RichText::new("◉ OrbitScope").strong().size(18.0).color(Color32::from_rgb(120, 190, 255)));
        ui.separator();
        ui.label(RichText::new(format!("{} UTC", fmt_t(clock.t))).monospace().size(15.0));
        ui.label(
            RichText::new(format!("(เครื่อง: {})", clock.t.with_timezone(&chrono::Local).format("%H:%M:%S")))
                .weak(),
        );
        ui.separator();
        if ui.button("⏮").on_hover_text("กลับไปเวลาเริ่มต้น").clicked() {
            clock.t = clock.start;
        }
        let reverse = clock.rate < 0.0;
        if ui.selectable_label(reverse, "◀◀").on_hover_text("เล่นย้อนหลัง").clicked() {
            clock.rate = -clock.rate;
        }
        let play_txt = if clock.playing { "⏸ หยุด" } else { "▶ เล่น" };
        if ui.button(play_txt).clicked() {
            clock.playing = !clock.playing;
        }
        let mut speed = clock.rate.abs();
        egui::ComboBox::from_id_salt("rate").selected_text(format!("x{speed}")).width(80.0).show_ui(ui, |ui| {
            for r in RATES {
                ui.selectable_value(&mut speed, r, format!("x{r}"));
            }
        });
        clock.rate = if reverse { -speed } else { speed };
        if ui.button("เวลาปัจจุบัน").on_hover_text("ตั้งเวลาจำลองเป็นเวลาจริงตอนนี้").clicked() {
            clock.t = chrono::Utc::now();
        }
        ui.separator();
        ui.checkbox(&mut view.labels, "ชื่อ");
        ui.checkbox(&mut view.grid, "กริด");
        ui.checkbox(&mut view.sun_lighting, "กลางวัน/กลางคืน");
        ui.checkbox(&mut view.earth_fixed, "หมุนตามโลก").on_hover_text("กล้องหมุนไปพร้อมโลก (มองพื้นที่เดิมตลอด)");
        ui.separator();
        if ui.button("❓").on_hover_text("วิธีใช้").clicked() {
            dlg.help_open = !dlg.help_open;
        }
    });
    ui.add_space(2.0);
}

fn bottom_panel(ui: &mut Ui, clock: &mut Clock, scen: &Scenario, reports: &mut Reports) {
    ui.add_space(4.0);
    let span = clock.span_hours * 3600.0;
    let mut s = secs_between(clock.start, clock.t).clamp(0.0, span);
    ui.horizontal(|ui| {
        ui.label(RichText::new(fmt_short(clock.start)).weak().monospace());
        let w = ui.available_width() - 130.0;
        ui.spacing_mut().slider_width = w.max(100.0);
        let resp = ui.add(egui::Slider::new(&mut s, 0.0..=span).show_value(false));
        if resp.changed() {
            clock.t = add_secs(clock.start, s);
        }
        ui.label(RichText::new(fmt_short(clock.end())).weak().monospace());
    });
    ui.separator();

    ui.horizontal(|ui| {
        ui.label(RichText::new("รายงาน Access").strong());
        ui.label("off-nadir สูงสุด");
        ui.add(egui::DragValue::new(&mut reports.max_off_nadir_deg).range(0.0..=60.0).suffix("°").speed(0.5));
        ui.label("มุมดวงอาทิตย์ขั้นต่ำ");
        ui.add(egui::DragValue::new(&mut reports.min_sun_el_deg).range(-90.0..=60.0).suffix("°").speed(0.5));
        ui.label("ช่วงเวลา");
        ui.add(egui::DragValue::new(&mut clock.span_hours).range(1.0..=240.0).suffix(" ชม.").speed(1.0));
        if ui.button("▶ คำนวณ").on_hover_text("หา pass สถานีภาคพื้นดิน และโอกาสถ่ายภาพเป้าหมาย ทุกดาวเทียม").clicked() {
            compute_reports(scen, clock, reports);
        }
        if !reports.rows.is_empty() && ui.button("คัดลอก CSV").clicked() {
            ui.ctx().copy_text(reports_csv(&reports.rows));
        }
        if let Some(info) = &reports.computed_for {
            ui.label(RichText::new(info).weak());
        }
    });

    egui::ScrollArea::vertical().auto_shrink([false, false]).show(ui, |ui| {
        if reports.rows.is_empty() {
            ui.label(RichText::new("กด “คำนวณ” เพื่อดูช่วงเวลาติดต่อสถานี และช่วงที่ถ่ายภาพเป้าหมายได้").weak());
            return;
        }
        egui::Grid::new("report").striped(true).num_columns(7).show(ui, |ui| {
            for h in ["ประเภท", "ดาวเทียม", "สถานี / เป้าหมาย", "เริ่ม (UTC)", "สิ้นสุด", "นาน", "ค่าสำคัญ"] {
                ui.label(RichText::new(h).strong());
            }
            ui.label("");
            ui.end_row();
            for row in &reports.rows {
                match row {
                    ReportRow::Pass { sat, site, pass } => {
                        ui.label(RichText::new("📡 ติดต่อ").color(Color32::from_rgb(110, 255, 160)));
                        ui.label(sat);
                        ui.label(site);
                        ui.monospace(fmt_short(pass.start));
                        ui.monospace(pass.end.format("%H:%M:%S").to_string());
                        ui.monospace(format!("{:.1} นาที", pass.duration_s() / 60.0));
                        ui.label(format!("มุมเงยสูงสุด {:.1}°", pass.max_el_deg));
                    }
                    ReportRow::Image { sat, target, win } => {
                        ui.label(RichText::new("📷 ถ่ายภาพ").color(Color32::from_rgb(255, 140, 140)));
                        ui.label(sat);
                        ui.label(target);
                        ui.monospace(fmt_short(win.start));
                        ui.monospace(win.end.format("%H:%M:%S").to_string());
                        ui.monospace(format!("{:.1} นาที", secs_between(win.start, win.end) / 60.0));
                        ui.label(format!("off-nadir ต่ำสุด {:.1}° · ดวงอาทิตย์ {:.0}°", win.min_off_nadir_deg, win.sun_el_deg));
                    }
                }
                if ui.small_button("ไปที่เวลา").clicked() {
                    clock.t = row.start();
                    clock.playing = false;
                }
                ui.end_row();
            }
        });
    });
}

pub fn compute_reports(scen: &Scenario, clock: &Clock, reports: &mut Reports) {
    let (start, end) = (clock.start, clock.end());
    let mut rows = Vec::new();
    for e in &scen.sats {
        for site in &scen.sites {
            for pass in station_passes(&e.sat, site.geo, site.min_el_deg, start, end) {
                rows.push(ReportRow::Pass { sat: e.sat.name.clone(), site: site.name.clone(), pass });
            }
        }
        if e.sensor.is_some() {
            for tg in &scen.targets {
                for win in imaging_opportunities(&e.sat, tg.geo, reports.max_off_nadir_deg, reports.min_sun_el_deg, start, end) {
                    rows.push(ReportRow::Image { sat: e.sat.name.clone(), target: tg.name.clone(), win });
                }
            }
        }
    }
    rows.sort_by_key(|r| r.start());
    reports.computed_for = Some(format!("{} รายการ · {} → {}", rows.len(), fmt_short(start), fmt_short(end)));
    reports.rows = rows;
}

fn reports_csv(rows: &[ReportRow]) -> String {
    let mut s = String::from("type,satellite,object,start_utc,end_utc,duration_s,metric\n");
    for r in rows {
        match r {
            ReportRow::Pass { sat, site, pass } => s += &format!(
                "contact,{sat},{site},{},{},{:.0},max_el_deg={:.2}\n",
                pass.start.to_rfc3339(),
                pass.end.to_rfc3339(),
                pass.duration_s(),
                pass.max_el_deg
            ),
            ReportRow::Image { sat, target, win } => s += &format!(
                "imaging,{sat},{target},{},{},{:.0},min_off_nadir_deg={:.2};sun_el_deg={:.1}\n",
                win.start.to_rfc3339(),
                win.end.to_rfc3339(),
                secs_between(win.start, win.end),
                win.min_off_nadir_deg,
                win.sun_el_deg
            ),
        }
    }
    s
}

fn objects_panel(ui: &mut Ui, scen: &mut Scenario, cam: &mut OrbitCam, dlg: &mut Dialogs) {
    ui.add_space(6.0);
    ui.heading("วัตถุในฉาก");
    ui.horizontal_wrapped(|ui| {
        if ui.button("+ TLE").on_hover_text("วาง TLE ของดาวเทียมจริง").clicked() {
            dlg.tle_open = true;
        }
        if ui.button("+ วงโคจร").on_hover_text("สร้างดาวเทียมจากค่าวงโคจร").clicked() {
            dlg.wizard_open = true;
        }
        if ui.button("+ จุดบนพื้นโลก").clicked() {
            dlg.point_open = true;
        }
    });
    ui.separator();
    egui::ScrollArea::vertical().show(ui, |ui| {
        ui.label(RichText::new("ดาวเทียม").strong());
        let mut changed = false;
        for i in 0..scen.sats.len() {
            let selected = scen.selection == Selection::Sat(i);
            ui.horizontal(|ui| {
                let e = &mut scen.sats[i];
                ui.checkbox(&mut e.visible, "");
                let (rect, _) = ui.allocate_exact_size(egui::vec2(10.0, 10.0), egui::Sense::hover());
                ui.painter().circle_filled(rect.center(), 5.0, c32(e.color));
                let name = e.sat.name.clone();
                let r = ui.selectable_label(selected, name);
                if r.clicked() {
                    scen.selection = Selection::Sat(i);
                }
                if r.double_clicked() {
                    cam.focus_sat = Some(i);
                    cam.distance = 2_500.0;
                }
            });
        }
        ui.add_space(6.0);
        ui.label(RichText::new("สถานีภาคพื้นดิน").strong());
        for i in 0..scen.sites.len() {
            let selected = scen.selection == Selection::Site(i);
            if ui.selectable_label(selected, format!("📡 {}", scen.sites[i].name)).clicked() {
                scen.selection = Selection::Site(i);
            }
        }
        ui.add_space(6.0);
        ui.label(RichText::new("เป้าหมายถ่ายภาพ").strong());
        for i in 0..scen.targets.len() {
            let selected = scen.selection == Selection::Target(i);
            if ui.selectable_label(selected, format!("🎯 {}", scen.targets[i].name)).clicked() {
                scen.selection = Selection::Target(i);
            }
        }
        ui.add_space(10.0);
        if scen.selection != Selection::None && ui.button("🗑 ลบที่เลือก").clicked() {
            match scen.selection {
                Selection::Sat(i) => {
                    scen.sats.remove(i);
                    cam.focus_sat = None;
                    changed = true;
                }
                Selection::Site(i) => {
                    scen.sites.remove(i);
                }
                Selection::Target(i) => {
                    scen.targets.remove(i);
                }
                Selection::None => {}
            }
            scen.selection = Selection::None;
        }
        if changed {
            scen.revision += 1;
        }
        ui.add_space(8.0);
        ui.label(RichText::new("ดับเบิลคลิกชื่อดาวเทียม = กล้องตามดาวเทียม · Esc = กลับมามองโลก").weak().small());
    });
}

fn properties_panel(ui: &mut Ui, scen: &mut Scenario, clock: &Clock, cam: &mut OrbitCam) {
    ui.add_space(6.0);
    egui::ScrollArea::vertical().show(ui, |ui| match scen.selection {
        Selection::Sat(i) if i < scen.sats.len() => sat_properties(ui, scen, i, clock, cam),
        Selection::Site(i) if i < scen.sites.len() => site_properties(ui, scen, i, clock),
        Selection::Target(i) if i < scen.targets.len() => target_properties(ui, scen, i, clock),
        _ => {
            ui.heading("คุณสมบัติ");
            ui.label(RichText::new("เลือกวัตถุทางซ้ายเพื่อดูรายละเอียด").weak());
        }
    });
}

fn kv(ui: &mut Ui, k: &str, v: String) {
    ui.label(RichText::new(k).weak());
    ui.monospace(v);
    ui.end_row();
}

fn sat_properties(ui: &mut Ui, scen: &mut Scenario, i: usize, clock: &Clock, cam: &mut OrbitCam) {
    let t = clock.t;
    let mut recolor = false;
    let e = &mut scen.sats[i];
    ui.horizontal(|ui| {
        recolor |= ui.color_edit_button_rgb(&mut e.color).changed();
        ui.heading(&e.sat.name);
    });
    ui.horizontal(|ui| {
        if ui.button("🎥 กล้องตาม").clicked() {
            cam.focus_sat = Some(i);
            cam.distance = 2_500.0;
        }
        if cam.focus_sat.is_some() && ui.button("🌍 มองโลก").clicked() {
            cam.focus_sat = None;
            cam.distance = cam.distance.max(14_000.0);
        }
    });
    ui.separator();

    let state = e.sat.state(t);
    egui::CollapsingHeader::new("สถานะปัจจุบัน").default_open(true).show(ui, |ui| match state {
        Some(s) => {
            let g = Geodetic::from_ecef(teme_to_ecef(s.r, t));
            egui::Grid::new("sat_state").num_columns(2).show(ui, |ui| {
                kv(ui, "ละติจูด", format!("{:.3}°", g.lat));
                kv(ui, "ลองจิจูด", format!("{:.3}°", g.lon));
                kv(ui, "ความสูง", format!("{:.1} km", g.alt));
                kv(ui, "ความเร็ว", format!("{:.3} km/s", s.v.norm()));
                kv(ui, "คาบ", format!("{:.2} นาที", e.sat.period_s() / 60.0));
                kv(ui, "แสงอาทิตย์", if in_eclipse(s.r, t) { "🌑 อยู่ในเงาโลก".into() } else { "☀ รับแสง".into() });
                kv(ui, "ความเอียง", format!("{:.3}°", e.sat.elements.inclination));
                kv(ui, "RAAN", format!("{:.3}°", e.sat.elements.right_ascension));
                kv(ui, "Epoch", fmt_t(e.sat.epoch()));
                let age_days = secs_between(e.sat.epoch(), t) / 86_400.0;
                if age_days.abs() > 14.0 {
                    ui.label(RichText::new("⚠ อายุ TLE").color(Color32::YELLOW));
                    ui.label(RichText::new(format!("{age_days:.0} วัน · ความแม่นยำลดลง")).color(Color32::YELLOW));
                    ui.end_row();
                }
            });
        }
        None => {
            ui.colored_label(Color32::LIGHT_RED, "คำนวณตำแหน่งไม่ได้ (วงโคจรอาจเสื่อมแล้ว หรือเวลาห่างจาก epoch มากเกินไป)");
        }
    });

    egui::CollapsingHeader::new("การแสดงผล").default_open(true).show(ui, |ui| {
        ui.checkbox(&mut e.visible, "แสดงดาวเทียม");
        ui.checkbox(&mut e.show_orbit, "เส้นวงโคจร");
        ui.checkbox(&mut e.show_ground_track, "Ground track");
        ui.checkbox(&mut e.show_sensor, "กรวยเซนเซอร์ + footprint");
        ui.checkbox(&mut e.show_swath, "แถบ swath ที่ถ่ายผ่านมา");
        ui.add(egui::Slider::new(&mut e.swath_minutes, 1.0..=180.0).text("นาที (ความยาว swath)"));
    });

    egui::CollapsingHeader::new("เซนเซอร์ / กล้อง").default_open(true).show(ui, |ui| {
        let mut has = e.sensor.is_some();
        if ui.checkbox(&mut has, "มีเซนเซอร์ถ่ายภาพ").changed() {
            e.sensor = if has { Some(Sensor::default()) } else { None };
        }
        let Some(sensor) = e.sensor.as_mut() else { return };
        let mut conic = matches!(sensor.fov, Fov::Conic { .. });
        ui.horizontal(|ui| {
            ui.label("รูปทรง FOV");
            if ui.selectable_label(!conic, "สี่เหลี่ยม").clicked() && conic {
                sensor.fov = Fov::Rectangular { cross_half_deg: 5.0, along_half_deg: 1.0 };
                conic = false;
            }
            if ui.selectable_label(conic, "กรวยกลม").clicked() && !conic {
                sensor.fov = Fov::Conic { half_angle_deg: 5.0 };
            }
        });
        match &mut sensor.fov {
            Fov::Conic { half_angle_deg } => {
                ui.add(egui::Slider::new(half_angle_deg, 0.05..=60.0).logarithmic(true).text("ครึ่งมุมกรวย (°)"));
            }
            Fov::Rectangular { cross_half_deg, along_half_deg } => {
                ui.add(egui::Slider::new(cross_half_deg, 0.05..=60.0).logarithmic(true).text("ครึ่งมุมขวาง (°)"));
                ui.add(egui::Slider::new(along_half_deg, 0.05..=60.0).logarithmic(true).text("ครึ่งมุมตามแนวบิน (°)"));
            }
        }
        ui.add(egui::Slider::new(&mut sensor.roll_deg, -60.0..=60.0).text("Roll (°)  + = ขวา"));
        ui.add(egui::Slider::new(&mut sensor.pitch_deg, -60.0..=60.0).text("Pitch (°) + = หน้า"));
        if ui.small_button("ชี้ลงตรง (nadir)").clicked() {
            sensor.roll_deg = 0.0;
            sensor.pitch_deg = 0.0;
        }
        ui.separator();
        ui.label(RichText::new("ออปติกส์ (คำนวณ GSD)").strong());
        egui::Grid::new("optics").num_columns(2).show(ui, |ui| {
            ui.label("ความยาวโฟกัส");
            ui.add(egui::DragValue::new(&mut e.optics.focal_mm).range(1.0..=20_000.0).suffix(" mm"));
            ui.end_row();
            ui.label("ขนาดพิกเซล");
            ui.add(egui::DragValue::new(&mut e.optics.pixel_um).range(0.5..=100.0).speed(0.1).suffix(" µm"));
            ui.end_row();
        });
        if let Some(s) = state {
            let sensor = *sensor;
            egui::Grid::new("sensor_derived").num_columns(2).show(ui, |ui| {
                if let Some(w) = sensor.swath_width_km(&s) {
                    kv(ui, "ความกว้าง swath", format!("{w:.1} km"));
                }
                if let Some(p) = sensor.boresight_ground(&s) {
                    let g = Geodetic::from_ecef(teme_to_ecef(p, t));
                    let range = (p - s.r).norm();
                    kv(ui, "จุดเล็ง", format!("{:.3}°, {:.3}°", g.lat, g.lon));
                    kv(ui, "ระยะเอียง", format!("{range:.1} km"));
                    kv(ui, "off-nadir", format!("{:.2}°", off_nadir_angle(&s, p)));
                    kv(ui, "GSD ที่จุดเล็ง", format!("{:.2} m", gsd_m(range, e.optics.focal_mm, e.optics.pixel_um)));
                    kv(ui, "แสงที่จุดเล็ง", format!("{:.1}°", sun_elevation(g, t)));
                } else {
                    ui.colored_label(Color32::LIGHT_RED, "แกนกล้องเลยขอบโลก");
                    ui.end_row();
                }
                let alt = Geodetic::from_ecef(teme_to_ecef(s.r, t)).alt;
                kv(ui, "GSD ที่ nadir", format!("{:.2} m", gsd_m(alt, e.optics.focal_mm, e.optics.pixel_um)));
            });
        }
    });
    if recolor {
        scen.revision += 1;
    }
}

fn site_properties(ui: &mut Ui, scen: &mut Scenario, i: usize, clock: &Clock) {
    let t = clock.t;
    {
        let site = &mut scen.sites[i];
        ui.heading(format!("📡 {}", site.name));
        egui::Grid::new("site").num_columns(2).show(ui, |ui| {
            ui.label("ชื่อ");
            ui.text_edit_singleline(&mut site.name);
            ui.end_row();
            ui.label("ละติจูด");
            ui.add(egui::DragValue::new(&mut site.geo.lat).range(-90.0..=90.0).speed(0.01).suffix("°"));
            ui.end_row();
            ui.label("ลองจิจูด");
            ui.add(egui::DragValue::new(&mut site.geo.lon).range(-180.0..=180.0).speed(0.01).suffix("°"));
            ui.end_row();
            ui.label("มุมเงยขั้นต่ำ");
            ui.add(egui::DragValue::new(&mut site.min_el_deg).range(0.0..=45.0).speed(0.1).suffix("°"));
            ui.end_row();
        });
    }
    ui.separator();
    ui.label(RichText::new("มุมมองไปยังดาวเทียมตอนนี้").strong());
    let site = scen.sites[i].clone();
    egui::Grid::new("site_look").striped(true).num_columns(4).show(ui, |ui| {
        for h in ["ดาวเทียม", "Az", "El", "ระยะ"] {
            ui.label(RichText::new(h).strong());
        }
        ui.end_row();
        for e in &scen.sats {
            if let Some(s) = e.sat.state(t) {
                let l = look_angles(site.geo, teme_to_ecef(s.r, t));
                let col = if l.el_deg >= site.min_el_deg { Color32::from_rgb(110, 255, 160) } else { Color32::GRAY };
                ui.colored_label(c32(e.color), &e.sat.name);
                ui.colored_label(col, format!("{:.1}°", l.az_deg));
                ui.colored_label(col, format!("{:.1}°", l.el_deg));
                ui.colored_label(col, format!("{:.0} km", l.range_km));
                ui.end_row();
            }
        }
    });
}

fn target_properties(ui: &mut Ui, scen: &mut Scenario, i: usize, clock: &Clock) {
    let t = clock.t;
    {
        let tg = &mut scen.targets[i];
        ui.heading(format!("🎯 {}", tg.name));
        egui::Grid::new("tgt").num_columns(2).show(ui, |ui| {
            ui.label("ชื่อ");
            ui.text_edit_singleline(&mut tg.name);
            ui.end_row();
            ui.label("ละติจูด");
            ui.add(egui::DragValue::new(&mut tg.geo.lat).range(-90.0..=90.0).speed(0.01).suffix("°"));
            ui.end_row();
            ui.label("ลองจิจูด");
            ui.add(egui::DragValue::new(&mut tg.geo.lon).range(-180.0..=180.0).speed(0.01).suffix("°"));
            ui.end_row();
        });
    }
    let tg = scen.targets[i].clone();
    ui.label(format!("มุมดวงอาทิตย์ที่เป้าหมาย: {:.1}°", sun_elevation(tg.geo, t)));
    ui.separator();
    ui.label(RichText::new("ต้องเอียงกล้องเท่าไรถึงจะถ่ายได้ตอนนี้").strong());
    egui::Grid::new("tgt_look").striped(true).num_columns(2).show(ui, |ui| {
        for e in &scen.sats {
            if let Some(s) = e.sat.state(t) {
                let tgt = orbitscope_core::frames::ecef_to_teme(tg.geo.to_ecef(), t);
                let visible = look_angles(tg.geo, teme_to_ecef(s.r, t)).el_deg > 0.0;
                ui.colored_label(c32(e.color), &e.sat.name);
                if visible {
                    ui.label(format!("off-nadir {:.1}°", off_nadir_angle(&s, tgt)));
                } else {
                    ui.label(RichText::new("อยู่หลังขอบโลก").weak());
                }
                ui.end_row();
            }
        }
    });
}

fn dialogs(ctx: &egui::Context, dlg: &mut Dialogs, scen: &mut Scenario, clock: &Clock) {
    // ---- TLE import
    let mut open = dlg.tle_open;
    egui::Window::new("เพิ่มดาวเทียมจาก TLE").open(&mut open).default_width(560.0).show(ctx, |ui| {
        ui.label("วาง TLE แบบ 2 หรือ 3 บรรทัด (ใส่ได้หลายดวงพร้อมกัน)");
        ui.horizontal(|ui| {
            ui.label("หา TLE ล่าสุดได้ที่");
            ui.hyperlink_to("CelesTrak", "https://celestrak.org/NORAD/elements/");
        });
        ui.add(
            egui::TextEdit::multiline(&mut dlg.tle_text)
                .font(egui::TextStyle::Monospace)
                .desired_rows(8)
                .desired_width(f32::INFINITY)
                .hint_text("SENTINEL-2A\n1 40697U 15028A   ...\n2 40697  98.5...."),
        );
        if ui.button("เพิ่ม").clicked() {
            let parsed = Satellite::parse_tle_text(&dlg.tle_text);
            let (mut ok, mut bad) = (0, Vec::new());
            for r in parsed {
                match r {
                    Ok(sat) => {
                        let color = PALETTE[scen.sats.len() % PALETTE.len()];
                        scen.sats.push(SatEntry::new(sat, Some(Sensor::default()), color));
                        ok += 1;
                    }
                    Err(e) => bad.push(e.to_string()),
                }
            }
            if ok > 0 {
                scen.revision += 1;
                scen.selection = Selection::Sat(scen.sats.len() - 1);
            }
            dlg.tle_msg = if bad.is_empty() && ok == 0 {
                "ไม่พบ TLE ในข้อความ".into()
            } else if bad.is_empty() {
                format!("เพิ่มแล้ว {ok} ดวง")
            } else {
                format!("เพิ่มแล้ว {ok} ดวง · ผิดพลาด {}: {}", bad.len(), bad.join("; "))
            };
        }
        if !dlg.tle_msg.is_empty() {
            ui.label(&dlg.tle_msg);
        }
    });
    dlg.tle_open = open;

    // ---- Orbit wizard
    let mut open = dlg.wizard_open;
    egui::Window::new("สร้างดาวเทียมจากค่าวงโคจร").open(&mut open).default_width(380.0).show(ctx, |ui| {
        let w = &mut dlg.wizard;
        egui::Grid::new("wiz").num_columns(2).show(ui, |ui| {
            ui.label("ชื่อ");
            ui.text_edit_singleline(&mut w.name);
            ui.end_row();
            ui.label("ความสูง");
            ui.add(egui::DragValue::new(&mut w.altitude).range(160.0..=40_000.0).suffix(" km"));
            ui.end_row();
            ui.label("Sun-synchronous");
            ui.checkbox(&mut w.sun_sync, "คำนวณความเอียงให้อัตโนมัติ");
            ui.end_row();
            if w.sun_sync {
                ui.label("เวลาผ่านเส้นศูนย์สูตร (ขาลง)");
                ui.add(egui::DragValue::new(&mut w.ltdn).range(0.0..=24.0).speed(0.05).suffix(" น."));
                ui.end_row();
                ui.label(RichText::new("ความเอียงที่ได้").weak());
                ui.monospace(format!("{:.3}°", sun_sync_inclination(w.altitude)));
                ui.end_row();
            } else {
                ui.label("ความเอียง");
                ui.add(egui::DragValue::new(&mut w.inclination).range(0.0..=180.0).speed(0.1).suffix("°"));
                ui.end_row();
                ui.label("RAAN");
                ui.add(egui::DragValue::new(&mut w.raan).range(0.0..=360.0).speed(0.5).suffix("°"));
                ui.end_row();
            }
            ui.label("Eccentricity");
            ui.add(egui::DragValue::new(&mut w.eccentricity).range(0.0..=0.9).speed(0.0005));
            ui.end_row();
            ui.label("Mean anomaly");
            ui.add(egui::DragValue::new(&mut w.mean_anomaly).range(0.0..=360.0).speed(1.0).suffix("°"));
            ui.end_row();
            ui.label("เซนเซอร์");
            ui.horizontal(|ui| {
                ui.selectable_value(&mut w.sensor, 0, "ไม่มี");
                ui.selectable_value(&mut w.sensor, 1, "สี่เหลี่ยม");
                ui.selectable_value(&mut w.sensor, 2, "กรวยกลม");
            });
            ui.end_row();
            if w.sensor > 0 {
                ui.label("ครึ่งมุมขวาง");
                ui.add(egui::DragValue::new(&mut w.cross_half).range(0.05..=60.0).speed(0.05).suffix("°"));
                ui.end_row();
                if w.sensor == 1 {
                    ui.label("ครึ่งมุมตามแนวบิน");
                    ui.add(egui::DragValue::new(&mut w.along_half).range(0.05..=60.0).speed(0.05).suffix("°"));
                    ui.end_row();
                }
            }
        });
        ui.label(RichText::new(format!("Epoch = เวลาจำลองตอนนี้ ({} UTC)", fmt_t(clock.t))).weak().small());
        if ui.button("สร้าง").clicked() {
            let ltan = (w.ltdn + 12.0).rem_euclid(24.0);
            let k = Keplerian {
                altitude_km: w.altitude,
                eccentricity: w.eccentricity,
                inclination_deg: if w.sun_sync { sun_sync_inclination(w.altitude) } else { w.inclination },
                raan_deg: if w.sun_sync { raan_for_ltan(clock.t, ltan) } else { w.raan },
                arg_perigee_deg: 0.0,
                mean_anomaly_deg: w.mean_anomaly,
            };
            match Satellite::from_keplerian(&w.name, clock.t, k) {
                Ok(sat) => {
                    let sensor = match w.sensor {
                        1 => Some(Sensor {
                            fov: Fov::Rectangular { cross_half_deg: w.cross_half, along_half_deg: w.along_half },
                            roll_deg: 0.0,
                            pitch_deg: 0.0,
                        }),
                        2 => Some(Sensor { fov: Fov::Conic { half_angle_deg: w.cross_half }, roll_deg: 0.0, pitch_deg: 0.0 }),
                        _ => None,
                    };
                    let color = PALETTE[scen.sats.len() % PALETTE.len()];
                    scen.sats.push(SatEntry::new(sat, sensor, color));
                    scen.selection = Selection::Sat(scen.sats.len() - 1);
                    scen.revision += 1;
                    dlg.wizard_msg = format!("สร้าง {} แล้ว", w.name);
                }
                Err(e) => dlg.wizard_msg = e.to_string(),
            }
        }
        if !dlg.wizard_msg.is_empty() {
            ui.label(&dlg.wizard_msg);
        }
    });
    dlg.wizard_open = open;

    // ---- Ground point
    let mut open = dlg.point_open;
    egui::Window::new("เพิ่มจุดบนพื้นโลก").open(&mut open).show(ctx, |ui| {
        egui::Grid::new("pt").num_columns(2).show(ui, |ui| {
            ui.label("ชื่อ");
            ui.text_edit_singleline(&mut dlg.point_name);
            ui.end_row();
            ui.label("ละติจูด");
            ui.add(egui::DragValue::new(&mut dlg.point_lat).range(-90.0..=90.0).speed(0.01).suffix("°"));
            ui.end_row();
            ui.label("ลองจิจูด");
            ui.add(egui::DragValue::new(&mut dlg.point_lon).range(-180.0..=180.0).speed(0.01).suffix("°"));
            ui.end_row();
            ui.label("ประเภท");
            ui.horizontal(|ui| {
                ui.selectable_value(&mut dlg.point_is_target, true, "🎯 เป้าหมายถ่ายภาพ");
                ui.selectable_value(&mut dlg.point_is_target, false, "📡 สถานีภาคพื้นดิน");
            });
            ui.end_row();
        });
        if ui.button("เพิ่ม").clicked() {
            let geo = Geodetic::new(dlg.point_lat, dlg.point_lon, 0.0);
            if dlg.point_is_target {
                scen.targets.push(Target { name: dlg.point_name.clone(), geo });
                scen.selection = Selection::Target(scen.targets.len() - 1);
            } else {
                scen.sites.push(Site { name: dlg.point_name.clone(), geo, min_el_deg: 5.0 });
                scen.selection = Selection::Site(scen.sites.len() - 1);
            }
        }
    });
    dlg.point_open = open;

    // ---- Help
    let mut open = dlg.help_open;
    egui::Window::new("วิธีใช้").open(&mut open).default_width(420.0).show(ctx, |ui| {
        ui.label("🖱 ลากเมาส์ = หมุนกล้อง · ล้อเมาส์ = ซูม");
        ui.label("ดับเบิลคลิกชื่อดาวเทียม = กล้องตามดาวเทียม · Esc = กลับมามองโลก");
        ui.label("แถบด้านล่าง = เลื่อนเวลา · ปุ่ม ▶ / ความเร็ว = เล่นการจำลอง");
        ui.separator();
        ui.label("สีโปร่งแสงบนพื้น = แถบที่กล้องถ่ายผ่านมาแล้ว (swath)");
        ui.label("กรวยโปร่งแสง = มุมมองกล้อง (FOV) ปรับ roll/pitch ได้ที่แผงขวา");
        ui.label("เส้นสีเขียวจากพื้นถึงดาวเทียม = กำลังติดต่อสถานีภาคพื้นดิน");
        ui.separator();
        ui.label(RichText::new("ดาวเทียมตัวอย่างสร้างจากค่าวงโคจร ณ เวลาเริ่ม ไม่ใช่ดาวเทียมจริง — ใช้ “+ TLE” เพื่อใส่ดาวเทียมจริง").weak());
    });
    dlg.help_open = open;
}

fn draw_labels(ctx: &egui::Context, vp: egui::Rect, camera: &Camera, cam_tf: &GlobalTransform, scen: &Scenario, clock: &Clock) {
    let painter = ctx.layer_painter(LayerId::new(egui::Order::Background, egui::Id::new("labels"))).with_clip_rect(vp);
    let cam_pos = cam_tf.translation();
    let font = FontId::proportional(13.0);
    let put = |world: Vec3, text: &str, color: Color32, offset: egui::Vec2| {
        if occluded_by_earth(cam_pos, world) {
            return;
        }
        if let Ok(p) = camera.world_to_viewport(cam_tf, world) {
            // world_to_viewport already includes the viewport's offset inside the render target
            let pos = egui::pos2(p.x, p.y) + offset;
            painter.text(pos + egui::vec2(1.0, 1.0), Align2::LEFT_CENTER, text, font.clone(), Color32::from_black_alpha(200));
            painter.text(pos, Align2::LEFT_CENTER, text, font.clone(), color);
        }
    };
    let t = clock.t;
    for e in scen.sats.iter().filter(|e| e.visible) {
        if let Some(s) = e.sat.state(t) {
            put(to_bevy(s.r), &e.sat.name, c32(e.color), egui::vec2(10.0, -8.0));
        }
    }
    let ground = |g: Geodetic| to_bevy(orbitscope_core::frames::ecef_to_teme(Geodetic::new(g.lat, g.lon, 8.0).to_ecef(), t));
    for s in &scen.sites {
        put(ground(s.geo), &s.name, Color32::from_rgb(110, 255, 160), egui::vec2(8.0, 0.0));
    }
    for tg in &scen.targets {
        put(ground(tg.geo), &tg.name, Color32::from_rgb(255, 130, 130), egui::vec2(8.0, 0.0));
    }
}
