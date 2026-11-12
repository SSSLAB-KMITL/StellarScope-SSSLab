# OrbitScope 2.0 (STK-Style 2D/3D Satellite Tracking & Earth Observation Simulator)

ซอฟต์แวร์จำลองวงโคจรดาวเทียมและการวางแผนถ่ายภาพสำรวจโลกแบบ **2D / 3D สไตล์ Ansys STK** พัฒนาด้วยสถาปัตยกรรม **Tauri v2 (Rust Core) + CesiumJS + React/TypeScript** รองรับทั้ง **Windows** และ **macOS** ออกแบบมาเพื่อใช้เป็นทั้งเครื่องมือวิเคราะห์ภารกิจและ**สื่อการเรียนการสอนด้านวิศวกรรมอวกาศ**

---

## ฟีเจอร์หลักใน OrbitScope 2.0

### 1. ระบบติดตามดาวเทียมแบบคู่ขนาน 3D Globe + 2D Map
- **ลูกโลก 3D (CesiumJS WGS84)**: แสดงชั้นบรรยากาศ, แสงอาทิตย์ตามเวลาจริง (Day/Night Terminator), เส้นวงโคจร 3D, เส้น Nadir, และโหมดกล้องเกาะติดดาวเทียม
- **แผนที่ 2D (Synchronized Tactical Map)**: แสดงเส้นทางดาวเทียมบนพื้นโลก (Ground Track), ขอบเขตการมองเห็นของสถานีภาคพื้นดิน, และเส้นแบ่งกลางวัน-กลางคืน
- **ระบบแผนที่ Hybrid (Offline-first + High-Res Online)**:
  - มีแผนที่โลก Blue Marble ฝังในตัวโปรแกรม เปิดใช้งานได้ทันทีแม้ไม่มีอินเทอร์เน็ตหรือ API Key
  - เมื่อเชื่อมต่ออินเทอร์เน็ต จะโหลดภาพถ่ายดาวเทียมความละเอียดสูง (Esri World Imagery / OpenStreetMap) อัตโนมัติ

### 2. การจำลองดาวเทียมถ่ายภาพสำรวจโลก (Earth Observation Simulation)
- **3D Sensor Cone, Footprint & Swath**: วาดกรวยมุมมองเซนเซอร์ 3D (ทั้งแบบสี่เหลี่ยม Pushbroom และแบบกรวยกลม Conic), กรอบพื้นที่ตกกระทบพื้นโลก (Footprint), และแถบพื้นที่ที่ถ่ายผ่านมาแล้ว (Swath)
- **หน้าต่างภาพจากมุมมองกล้องดาวเทียม (Simulated Sensor / Payload PiP View)**:
  - หน้าต่างย่อยแสดงภาพพื้นโลกจริงจากตำแหน่งและมุมเอียง (Roll/Pitch) ของกล้องดาวเทียมแบบเรียลไทม์
  - แสดงเส้นเล็ง (Crosshair Reticle), ค่าความละเอียดภาพ **GSD (เมตร/พิกเซล)**, มุม **Off-Nadir (°)**, และปุ่ม **📸 ถ่ายภาพจำลอง (Capture PNG)**
- **ระบบหันกล้องเล็งเป้าหมายอัตโนมัติ (Auto Target Tracking / Roll-Pitch Slew)**:
  - เลือกโหมด **Auto Target Tracking** เพื่อให้ดาวเทียมเอียงตัวหันกล้องล็อกเป้าหมายบนพื้นโลกอัตโนมัติเมื่อบินเข้าสู่ระยะทำการ
- **พื้นที่เป้าหมายแบบหลายเหลี่ยม (Area Target & Multi-Pass Coverage)**:
  - คลิกวาดกรอบพื้นที่หลายเหลี่ยมบนแผนที่ และคำนวณเปอร์เซ็นต์ความครอบคลุมของการถ่ายภาพ (**% Coverage**) แยกตามกริดย่อย

### 3. ฟีเจอร์สื่อการเรียนการสอน (Educational & Visualization Tools)
- **3D Coordinate Axes & Vector Geometry (VGT Lite)**:
  - เปิด/ปิดลูกศรแกนพิกัดเฉื่อย **ECI** (ชี้จุดวสันตวิษุวัต ♈) เทียบกับแกนหมุนตามโลก **ECEF** (0° Greenwich)
  - แสดงเวกเตอร์ประจำตัวดาวเทียม: **Velocity ($V$)**, **Nadir**, **Orbit Normal ($H$)**, และ **Sun Vector**
  - แสดงแผ่นระนาบวงโคจร 3D กึ่งโปร่งแสงพร้อมป้ายมุม **Inclination ($i$)** และ **RAAN ($\Omega$)**
- **Interactive Keplerian Sandbox & Orbit Presets**:
  - ลากแถบเลื่อนปรับค่าพารามิเตอร์วงโคจร ($h, e, i, \Omega, \omega, M$) แล้วเห็นเส้นวงโคจร 3D และ Ground Track 2D เปลี่ยนรูปร่างทันที
  - ปุ่มคำนวณวงโคจรสัมพันธ์กับดวงอาทิตย์ (**Sun-Synchronous Orbit: SSO**) อัตโนมัติ และชุด **Orbit Presets** (SSO 10:30, LEO ISS, Dawn-Dusk SAR, GEO ค้างฟ้า, Molniya)
- **คลังดาวเทียมจริง CelesTrak + Offline Catalog**:
  - มีดาวเทียมจริงฝังในเครื่อง (`THEOS-2`, `THEOS-1`, `SENTINEL-2A`, `SENTINEL-1A SAR`, `LANDSAT 9`, `ISS`, `NOAA-20`) และค้นหาดาวเทียมออนไลน์จาก CelesTrak ได้โดยตรง
- **แถบเวลา STK Gantt Timeline & รายงาน Access**:
  - แถบเวลาด้านล่างแสดงแถบสี (Gantt Bars) ของช่วงติดต่อสถานีและช่วงถ่ายภาพเป้าหมาย คลิกที่แถบสีเพื่อกระโดดไปดูจังหวะถ่ายภาพได้ทันที และส่งออกเป็น CSV ได้

---

## วิธีรันโปรแกรม

### 1. รันโหมดพัฒนาผ่าน Vite + Browser หรือ Tauri Desktop
```bash
# ติดตั้งแพ็กเกจ UI (ครั้งแรกครั้งเดียว)
cd ui && npm install

# รันเซิร์ฟเวอร์พัฒนา (เปิดได้ที่ http://localhost:1420)
npm run dev
```

หรือรันเป็นหน้าต่างโปรแกรม **Native Desktop (macOS / Windows)** ด้วย Tauri v2:
```bash
# สร้างไฟล์ UI และเปิดหน้าต่างโปรแกรม Native Desktop
npm --prefix ui run build
PATH="/opt/homebrew/opt/rustup/bin:$PATH" cargo run -p orbitscope-desktop
```

### 2. รันชุดทดสอบโมดูลคำนวณดาราศาสตร์ (`orbitscope-core`)
```bash
cargo test -p orbitscope-core
```

---

## โครงสร้างโปรเจกต์
```
crates/
  core/       เอนจินคำนวณดาราศาสตร์ภาษา Rust (SGP4, Keplerian+J2, WGS84, Sensor Slew, Access, Area Coverage)
  desktop/    Tauri v2 Native Desktop App (เชื่อม Rust Core เข้ากับ UI สำหรับ Windows/macOS)
  app/        (Legacy MVP) รุ่นจำลองด้วย Bevy + egui ดั้งเดิม
ui/           Frontend สไตล์ STK (React + TypeScript + CesiumJS + Tailwind CSS)
  src/
    engine/       ตัวคำนวณ 60fps Isomorphic + คลังดาวเทียม CelesTrak / Presets
    components/   Cesium 3D Globe, 2D Tactical Map, Sensor Camera PiP, STK Gantt Timeline Bar
assets/       แผนที่โลก Natural Earth แบบ Offline และฟอนต์ภาษาไทย
```
