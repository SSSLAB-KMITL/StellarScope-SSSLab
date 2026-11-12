import {
  AreaTargetObject,
  CatalogEntry,
  GroundStationObject,
  OrbitPreset,
  raanForLtanDeg,
  SatelliteObject,
  sunSyncInclinationDeg,
  TargetPointObject,
} from './orbitalEngine';

export const OFFLINE_SATELLITE_CATALOG: CatalogEntry[] = [
  {
    id: 'theos-2',
    name: 'THEOS-2',
    norad_id: 58017,
    category: 'Thailand EO',
    description_th:
      'ดาวเทียมสำรวจทรัพยากรรายละเอียดสูงมากของไทย (GISTDA) ความละเอียด 0.5 เมตร วงโคจรสัมพันธ์กับดวงอาทิตย์ (SSO)',
    description_en: 'Thailand Very High Resolution Earth Observation Satellite (0.5m GSD, SSO)',
    line1: '1 58017U 23155A   26316.50000000  .00000812  00000-0  42100-4 0  9992',
    line2: '2 58017  97.8712  31.4200 0001450  89.2100 270.9200 14.81892100167428',
    default_sensor: {
      fov: { type: 'rectangular', cross_half_deg: 2.8, along_half_deg: 0.6 },
      roll_deg: 0,
      pitch_deg: 0,
    },
    focal_mm: 5200,
    pixel_um: 4.2,
    max_slew_deg: 35,
  },
  {
    id: 'theos-1',
    name: 'THEOS (THAICHOTE)',
    norad_id: 33396,
    category: 'Thailand EO',
    description_th: 'ดาวเทียมไทยโชติ (THEOS-1) ดาวเทียมสำรวจทรัพยากรดวงแรกของประเทศไทย ที่ความสูง ~822 km',
    description_en: 'Thailand first Earth Observation Satellite (THAICHOTE) at ~822 km SSO',
    line1: '1 33396U 08049A   26316.50000000  .00000210  00000-0  11200-4 0  9995',
    line2: '2 33396  98.7120  34.1500 0001820  94.5000 265.6300 14.21234000941205',
    default_sensor: {
      fov: { type: 'rectangular', cross_half_deg: 4.5, along_half_deg: 0.5 },
      roll_deg: 0,
      pitch_deg: 0,
    },
    focal_mm: 3280,
    pixel_um: 8.0,
    max_slew_deg: 30,
  },
  {
    id: 'sentinel-2a',
    name: 'SENTINEL-2A',
    norad_id: 40697,
    category: 'Earth Observation',
    description_th: 'ดาวเทียมสำรวจโลกของยุโรป (ESA Copernicus) มีความกว้างแนวถ่ายภาพ (Swath) กว้างถึง 290 km',
    description_en: 'ESA Copernicus wide-swath (290 km) multispectral Earth observation satellite',
    line1: '1 40697U 15028A   26316.50000000  .00000180  00000-0  89000-5 0  9991',
    line2: '2 40697  98.5683  34.8120 0001210  91.4200 268.7100 14.30818200594128',
    default_sensor: {
      fov: { type: 'rectangular', cross_half_deg: 10.3, along_half_deg: 0.6 },
      roll_deg: 0,
      pitch_deg: 0,
    },
    focal_mm: 600,
    pixel_um: 7.5,
    max_slew_deg: 20,
  },
  {
    id: 'landsat-9',
    name: 'LANDSAT 9',
    norad_id: 49260,
    category: 'Earth Observation',
    description_th: 'ดาวเทียมสำรวจทรัพยากรแผ่นดินของ NASA/USGS ที่ความสูง 705 km Swath กว้าง 185 km',
    description_en: 'NASA/USGS Earth observation mission at 705 km altitude (185 km swath)',
    line1: '1 49260U 21088A   26316.50000000  .00000340  00000-0  15000-4 0  9994',
    line2: '2 49260  98.2150  29.1040 0001380  87.1000 273.0300 14.57112500273108',
    default_sensor: {
      fov: { type: 'rectangular', cross_half_deg: 7.5, along_half_deg: 0.5 },
      roll_deg: 0,
      pitch_deg: 0,
    },
    focal_mm: 880,
    pixel_um: 12.0,
    max_slew_deg: 15,
  },
  {
    id: 'iss',
    name: 'ISS (ZARYA)',
    norad_id: 25544,
    category: 'Space Station',
    description_th: 'สถานีอวกาศนานาชาติ โคจรที่ความสูง ~420 km ความเอียงวงโคจร 51.6°',
    description_en: 'International Space Station at ~420 km altitude, 51.6° inclination',
    line1: '1 25544U 98067A   26316.50000000  .00012450  00000-0  22100-3 0  9995',
    line2: '2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.50125391563535',
    default_sensor: {
      fov: { type: 'conic', half_angle_deg: 15.0 },
      roll_deg: 0,
      pitch_deg: 0,
    },
    focal_mm: 400,
    pixel_um: 5.5,
    max_slew_deg: 30,
  },
  {
    id: 'sentinel-1a',
    name: 'SENTINEL-1A (SAR)',
    norad_id: 39634,
    category: 'SAR Radar',
    description_th:
      'ดาวเทียมเรดาร์ SAR ของยุโรป ถ่ายภาพทะลุเมฆและถ่ายได้ทั้งกลางวัน-กลางคืน โดยเอียงส่องด้านข้าง (Side-looking)',
    description_en: 'ESA C-Band Synthetic Aperture Radar (SAR) day/night all-weather imaging satellite',
    line1: '1 39634U 14016A   26316.50000000  .00000230  00000-0  11000-4 0  9999',
    line2: '2 39634  98.1815 112.4000 0001350  85.3000 274.8300 14.59198200671232',
    default_sensor: {
      fov: { type: 'rectangular', cross_half_deg: 9.0, along_half_deg: 0.8 },
      roll_deg: 28,
      pitch_deg: 0,
    },
    focal_mm: 500,
    pixel_um: 6.0,
    max_slew_deg: 40,
  },
  {
    id: 'noaa-20',
    name: 'NOAA-20 (JPSS-1)',
    norad_id: 43013,
    category: 'Weather',
    description_th: 'ดาวเทียมอุตุนิยมวิทยาวงโคจรขั้วโลก มีเซนเซอร์ VIIRS กวาดถ่ายภาพเมฆและพายุครอบคลุมทั่วโลกทุกวัน',
    description_en: 'Polar-orbiting weather satellite carrying the wide-swath VIIRS radiometer',
    line1: '1 43013U 17073A   26316.50000000  .00000110  00000-0  72000-5 0  9990',
    line2: '2 43013  98.7420 205.3000 0001420  92.1000 268.0300 14.19541000461202',
    default_sensor: {
      fov: { type: 'rectangular', cross_half_deg: 35.0, along_half_deg: 1.0 },
      roll_deg: 0,
      pitch_deg: 0,
    },
    focal_mm: 150,
    pixel_um: 15.0,
    max_slew_deg: 45,
  },
  // --- GNSS Constellations (GPS, GLONASS, Galileo, BeiDou, QZSS, NavIC) ---
  {
    id: 'gps-biii-1',
    name: 'GPS III SV01 (VESPUCCI)',
    norad_id: 43873,
    category: 'GNSS · GPS',
    description_th: 'ดาวเทียมนำร่อง GPS รุ่นที่ 3 ของสหรัฐฯ วงโคจร MEO ~20,200 km ความเอียง 55°',
    description_en: 'US GPS Block III navigation satellite in MEO (~20,200 km, 55° inclination)',
    line1: '1 43873U 18109A   26316.50000000 -.00000025  00000-0  00000-0 0  9991',
    line2: '2 43873  55.1200  42.3100 0021500 214.1200 145.8000  2.00563500 58102',
    default_sensor: {
      fov: { type: 'conic', half_angle_deg: 13.8 },
      roll_deg: 0,
      pitch_deg: 0,
    },
    focal_mm: 200,
    pixel_um: 10.0,
    max_slew_deg: 15,
  },
  {
    id: 'gps-biir-13',
    name: 'GPS BIIR-2 (PRN 13)',
    norad_id: 24876,
    category: 'GNSS · GPS',
    description_th: 'ดาวเทียมนำร่อง GPS Block IIR ในวงโคจร MEO ระนาบที่ 2',
    description_en: 'US GPS Block IIR navigation satellite in MEO orbital plane B',
    line1: '1 24876U 97035A   26316.50000000 -.00000040  00000-0  00000-0 0  9994',
    line2: '2 24876  55.4300 162.1800 0052100 112.4000 248.1000  2.00564100214502',
    default_sensor: {
      fov: { type: 'conic', half_angle_deg: 13.8 },
      roll_deg: 0,
      pitch_deg: 0,
    },
    focal_mm: 200,
    pixel_um: 10.0,
    max_slew_deg: 15,
  },
  {
    id: 'glonass-m-760',
    name: 'COSMOS 2545 (GLONASS-M)',
    norad_id: 45358,
    category: 'GNSS · GLONASS',
    description_th: 'ดาวเทียมนำร่อง GLONASS ของรัสเซีย วงโคจร MEO ~19,100 km ความเอียง 64.8°',
    description_en: 'Russian GLONASS-M navigation satellite in MEO (~19,100 km, 64.8° inclination)',
    line1: '1 45358U 20018A   26316.50000000 -.00000050  00000-0  00000-0 0  9992',
    line2: '2 45358  64.8100  95.4200 0014200 310.2000  49.8000  2.13101800 51804',
    default_sensor: {
      fov: { type: 'conic', half_angle_deg: 14.2 },
      roll_deg: 0,
      pitch_deg: 0,
    },
    focal_mm: 200,
    pixel_um: 10.0,
    max_slew_deg: 15,
  },
  {
    id: 'galileo-26',
    name: 'GALILEO-26 (GSAT0222)',
    norad_id: 43567,
    category: 'GNSS · Galileo',
    description_th: 'ดาวเทียมนำร่อง Galileo ของสหภาพยุโรป วงโคจร MEO ~23,222 km ความเอียง 56°',
    description_en: 'European Galileo GNSS satellite in MEO (~23,222 km, 56° inclination)',
    line1: '1 43567U 18060D   26316.50000000 -.00000020  00000-0  00000-0 0  9997',
    line2: '2 43567  56.0400 218.6000 0003800  45.1000 314.9000  1.70474800 51209',
    default_sensor: {
      fov: { type: 'conic', half_angle_deg: 12.5 },
      roll_deg: 0,
      pitch_deg: 0,
    },
    focal_mm: 200,
    pixel_um: 10.0,
    max_slew_deg: 15,
  },
  {
    id: 'beidou-3-m1',
    name: 'BEIDOU-3 M1',
    norad_id: 43001,
    category: 'GNSS · BeiDou',
    description_th: 'ดาวเทียมนำร่อง BeiDou-3 ของจีน วงโคจร MEO ~21,528 km ความเอียง 55°',
    description_en: 'Chinese BeiDou-3 MEO navigation satellite (~21,528 km, 55° inclination)',
    line1: '1 43001U 17069A   26316.50000000 -.00000030  00000-0  00000-0 0  9995',
    line2: '2 43001  55.0200 302.1500 0009500 185.2000 174.8000  1.86231200 61240',
    default_sensor: {
      fov: { type: 'conic', half_angle_deg: 13.0 },
      roll_deg: 0,
      pitch_deg: 0,
    },
    focal_mm: 200,
    pixel_um: 10.0,
    max_slew_deg: 15,
  },
  {
    id: 'beidou-3-igso1',
    name: 'BEIDOU-3 IGSO-1',
    norad_id: 44204,
    category: 'GNSS · BeiDou',
    description_th: 'ดาวเทียม BeiDou-3 วงโคจรเอียงค้างฟ้า (IGSO ~35,786 km) ครอบคลุมภูมิภาคเอเชีย-แปซิฟิก',
    description_en: 'Chinese BeiDou-3 Inclined Geosynchronous Orbit (IGSO) over Asia-Pacific',
    line1: '1 44204U 19023A   26316.50000000 -.00000110  00000-0  00000-0 0  9993',
    line2: '2 44204  55.1800 118.4000 0024100 202.5000 157.5000  1.00270500 27401',
    default_sensor: {
      fov: { type: 'conic', half_angle_deg: 8.8 },
      roll_deg: 0,
      pitch_deg: 0,
    },
    focal_mm: 200,
    pixel_um: 10.0,
    max_slew_deg: 15,
  },
  {
    id: 'qzss-1r',
    name: 'QZS-1R (MICHIBIKI-1R)',
    norad_id: 49336,
    category: 'GNSS · QZSS',
    description_th: 'ดาวเทียม QZSS ของญี่ปุ่น วงโคจรเลข 8 (Tundra/IGSO) ค้างเหนือเอเชียและไทย',
    description_en: 'Japanese QZSS Quasi-Zenith figure-8 orbit covering East Asia, ASEAN, and Oceania',
    line1: '1 49336U 21096A   26316.50000000 -.00000140  00000-0  00000-0 0  9996',
    line2: '2 49336  40.8500 142.3000 0752000 270.0000  89.5000  1.00269200 18420',
    default_sensor: {
      fov: { type: 'conic', half_angle_deg: 9.0 },
      roll_deg: 0,
      pitch_deg: 0,
    },
    focal_mm: 200,
    pixel_um: 10.0,
    max_slew_deg: 15,
  },
  {
    id: 'navic-1i',
    name: 'IRNSS-1I (NAVIC)',
    norad_id: 43286,
    category: 'GNSS · NavIC',
    description_th: 'ดาวเทียมนำร่อง NavIC ของอินเดีย วงโคจร IGSO ~35,786 km ความเอียง 29° ครอบคลุมมหาสมุทรอินเดียและไทย',
    description_en: 'Indian NavIC (IRNSS) regional navigation satellite in 29° IGSO over South & SE Asia',
    line1: '1 43286U 18035A   26316.50000000 -.00000100  00000-0  00000-0 0  9998',
    line2: '2 43286  29.1500  82.5000 0019000 180.0000 180.0000  1.00271200 31205',
    default_sensor: {
      fov: { type: 'conic', half_angle_deg: 8.8 },
      roll_deg: 0,
      pitch_deg: 0,
    },
    focal_mm: 200,
    pixel_um: 10.0,
    max_slew_deg: 15,
  },
];

export function getEducationalOrbitPresets(epoch: Date): OrbitPreset[] {
  return [
    {
      id: 'sso-eo',
      name_th: 'SSO สำรวจโลก (ผ่านไทย ~10:30 น.)',
      name_en: 'Sun-Synchronous EO (10:30 LTDN)',
      description_th:
        'วงโคจรสัมพันธ์กับดวงอาทิตย์ที่ความสูง 620 km ทำให้ดาวเทียมบินผ่านในเวลาท้องถิ่นเดิมทุกวัน ได้มุมแสงอาทิตย์คงที่สำหรับการถ่ายภาพ',
      description_en: 'Sun-synchronous orbit at 620 km altitude with 10:30 AM local solar time descending node',
      keplerian: {
        altitude_km: 620,
        eccentricity: 0.0001,
        inclination_deg: Number(sunSyncInclinationDeg(620).toFixed(3)),
        raan_deg: Number(raanForLtanDeg(epoch, 22.5).toFixed(2)),
        arg_perigee_deg: 90,
        mean_anomaly_deg: 14,
      },
      color: '#38bdf8',
      default_sensor: {
        fov: { type: 'rectangular', cross_half_deg: 6.5, along_half_deg: 0.8 },
        roll_deg: 0,
        pitch_deg: 0,
      },
      focal_mm: 1800,
      pixel_um: 5.5,
    },
    {
      id: 'leo-iss',
      name_th: 'LEO วงโคจรต่ำ (สไตล์ ISS 420 km)',
      name_en: 'Low Earth Orbit (ISS-like 420 km)',
      description_th: 'วงโคจรต่ำที่ความสูง 420 km ความเอียง 51.6° คาบการโคจร ~93 นาทีต่อรอบ',
      description_en: 'Low Earth Orbit at 420 km altitude, 51.6° inclination (~93 min period)',
      keplerian: {
        altitude_km: 420,
        eccentricity: 0.0005,
        inclination_deg: 51.64,
        raan_deg: 110,
        arg_perigee_deg: 0,
        mean_anomaly_deg: 0,
      },
      color: '#4ade80',
      default_sensor: {
        fov: { type: 'conic', half_angle_deg: 14.0 },
        roll_deg: 0,
        pitch_deg: 0,
      },
      focal_mm: 500,
      pixel_um: 6.0,
    },
    {
      id: 'sso-dawn-dusk',
      name_th: 'SSO Dawn-Dusk (เรดาร์ SAR เกาะเส้นแบ่งวัน/คืน)',
      name_en: 'SSO Dawn-Dusk (SAR / Constant Sunlight)',
      description_th:
        'วงโคจร SSO ที่ตั้งค่า LTAN = 06:00 น. ทำให้ระนาบวงโคจรขนานกับเส้นแบ่งกลางวัน-กลางคืน รับแสงอาทิตย์เกือบตลอดเวลา',
      description_en: 'Dawn-dusk sun-synchronous orbit (06:00 LTAN) riding the day/night terminator',
      keplerian: {
        altitude_km: 550,
        eccentricity: 0.0001,
        inclination_deg: Number(sunSyncInclinationDeg(550).toFixed(3)),
        raan_deg: Number(raanForLtanDeg(epoch, 6.0).toFixed(2)),
        arg_perigee_deg: 0,
        mean_anomaly_deg: 60,
      },
      color: '#fb7185',
      default_sensor: {
        fov: { type: 'rectangular', cross_half_deg: 8.5, along_half_deg: 0.8 },
        roll_deg: 25,
        pitch_deg: 0,
      },
      focal_mm: 600,
      pixel_um: 6.5,
    },
    {
      id: 'geo-asia',
      name_th: 'GEO วงโคจรค้างฟ้า (35,786 km เหนือไทย)',
      name_en: 'Geostationary Orbit (GEO 35,786 km)',
      description_th:
        'วงโคจรค้างฟ้าที่ความสูง 35,786 km ความเอียง 0° คาบโคจรเท่ากับโลกหมุนรอบตัวเอง ลอยนิ่งเหนือลองจิจูด 100.5°E',
      description_en: 'Geostationary orbit at 35,786 km altitude, 0° inclination over 100.5°E',
      keplerian: {
        altitude_km: 35786,
        eccentricity: 0.0001,
        inclination_deg: 0.05,
        raan_deg: 0,
        arg_perigee_deg: 0,
        mean_anomaly_deg: 100.5,
      },
      color: '#facc15',
      default_sensor: {
        fov: { type: 'conic', half_angle_deg: 8.5 },
        roll_deg: 0,
        pitch_deg: 0,
      },
      focal_mm: 2000,
      pixel_um: 10.0,
    },
    {
      id: 'molniya',
      name_th: 'Molniya วงโคจรรีสูง (e=0.72, i=63.4°)',
      name_en: 'Molniya Highly Elliptical Orbit (e=0.72, i=63.4°)',
      description_th:
        'วงโคจรรีสูงมากที่มุมเอียงวิกฤต 63.4° ดาวเทียมจะเคลื่อนที่ช้ามากเมื่ออยู่ใกล้จุด Apogee เหนือซีกโลกเหนือ',
      description_en: 'Highly elliptical orbit at critical inclination 63.4° for high-latitude dwell',
      keplerian: {
        altitude_km: 20180,
        eccentricity: 0.72,
        inclination_deg: 63.4,
        raan_deg: 200,
        arg_perigee_deg: 270,
        mean_anomaly_deg: 180,
      },
      color: '#c084fc',
      default_sensor: {
        fov: { type: 'conic', half_angle_deg: 10.0 },
        roll_deg: 0,
        pitch_deg: 0,
      },
      focal_mm: 1000,
      pixel_um: 8.0,
    },
    {
      id: 'gnss-gps-meo',
      name_th: 'GNSS: GPS MEO (20,200 km, i=55°)',
      name_en: 'GNSS: GPS MEO (20,200 km, 55°)',
      description_th: 'วงโคจรมาตรฐานดาวเทียม GPS คาบโคจร 11 ชม. 58 นาที',
      description_en: 'Standard US GPS MEO orbit (20,200 km altitude, 55° inclination, ~12h period)',
      keplerian: {
        altitude_km: 20200,
        eccentricity: 0.002,
        inclination_deg: 55.0,
        raan_deg: 42,
        arg_perigee_deg: 0,
        mean_anomaly_deg: 30,
      },
      color: '#0284c7',
      default_sensor: {
        fov: { type: 'conic', half_angle_deg: 13.8 },
        roll_deg: 0,
        pitch_deg: 0,
      },
      focal_mm: 200,
      pixel_um: 10.0,
    },
    {
      id: 'gnss-glonass-meo',
      name_th: 'GNSS: GLONASS MEO (19,100 km, i=64.8°)',
      name_en: 'GNSS: GLONASS MEO (19,100 km, 64.8°)',
      description_th: 'วงโคจรดาวเทียม GLONASS ความเอียงสูง 64.8° ครอบคลุมขั้วโลก',
      description_en: 'Russian GLONASS MEO orbit (19,100 km altitude, 64.8° high-latitude inclination)',
      keplerian: {
        altitude_km: 19100,
        eccentricity: 0.001,
        inclination_deg: 64.8,
        raan_deg: 95,
        arg_perigee_deg: 0,
        mean_anomaly_deg: 60,
      },
      color: '#e11d48',
      default_sensor: {
        fov: { type: 'conic', half_angle_deg: 14.2 },
        roll_deg: 0,
        pitch_deg: 0,
      },
      focal_mm: 200,
      pixel_um: 10.0,
    },
    {
      id: 'gnss-galileo-meo',
      name_th: 'GNSS: Galileo MEO (23,222 km, i=56°)',
      name_en: 'GNSS: Galileo MEO (23,222 km, 56°)',
      description_th: 'วงโคจรดาวเทียม Galileo ของยุโรป ที่ความสูง 23,222 km',
      description_en: 'European Galileo MEO orbit (23,222 km altitude, 56° inclination, ~14h period)',
      keplerian: {
        altitude_km: 23222,
        eccentricity: 0.0004,
        inclination_deg: 56.0,
        raan_deg: 218,
        arg_perigee_deg: 0,
        mean_anomaly_deg: 90,
      },
      color: '#059669',
      default_sensor: {
        fov: { type: 'conic', half_angle_deg: 12.5 },
        roll_deg: 0,
        pitch_deg: 0,
      },
      focal_mm: 200,
      pixel_um: 10.0,
    },
    {
      id: 'gnss-beidou-meo',
      name_th: 'GNSS: BeiDou-3 MEO (21,528 km, i=55°)',
      name_en: 'GNSS: BeiDou-3 MEO (21,528 km, 55°)',
      description_th: 'วงโคจรดาวเทียม BeiDou-3 MEO ของจีน ที่ความสูง 21,528 km',
      description_en: 'Chinese BeiDou-3 MEO orbit (21,528 km altitude, 55° inclination)',
      keplerian: {
        altitude_km: 21528,
        eccentricity: 0.001,
        inclination_deg: 55.0,
        raan_deg: 302,
        arg_perigee_deg: 0,
        mean_anomaly_deg: 120,
      },
      color: '#d97706',
      default_sensor: {
        fov: { type: 'conic', half_angle_deg: 13.0 },
        roll_deg: 0,
        pitch_deg: 0,
      },
      focal_mm: 200,
      pixel_um: 10.0,
    },
    {
      id: 'gnss-qzss-igso',
      name_th: 'GNSS: QZSS Quasi-Zenith (35,786 km, i=41°, e=0.075)',
      name_en: 'GNSS: QZSS Quasi-Zenith (35,786 km, 41°)',
      description_th: 'วงโคจรเลข 8 อสมมาตรเหนือเอเชีย-ไทย ช่วยเพิ่มความแม่นยำตำแหน่งในเขตเมือง',
      description_en: 'Japanese QZSS asymmetric figure-8 IGSO (41° inclination, e=0.075) over Asia-Oceania',
      keplerian: {
        altitude_km: 35786,
        eccentricity: 0.075,
        inclination_deg: 40.85,
        raan_deg: 142,
        arg_perigee_deg: 270,
        mean_anomaly_deg: 90,
      },
      color: '#7c3aed',
      default_sensor: {
        fov: { type: 'conic', half_angle_deg: 9.0 },
        roll_deg: 0,
        pitch_deg: 0,
      },
      focal_mm: 200,
      pixel_um: 10.0,
    },
  ];
}

export function createInitialScenario(now: Date) {
  const epochIso = now.toISOString();
  const ssoRaan = Number(raanForLtanDeg(now, 22.5).toFixed(2));
  const satellites: SatelliteObject[] = [
    {
      id: 'sat-theos2',
      name: 'THEOS-2 · VHR Optical (SSO 620 km)',
      color: '#38bdf8',
      visible: true,
      source_mode: 'keplerian',
      keplerian: {
        altitude_km: 620,
        eccentricity: 0.0001,
        inclination_deg: Number(sunSyncInclinationDeg(620).toFixed(3)),
        raan_deg: ssoRaan,
        arg_perigee_deg: 0,
        mean_anomaly_deg: 162,
      },
      epoch_iso: epochIso,
      sensor: {
        enabled: true,
        fov: { type: 'rectangular', cross_half_deg: 8.5, along_half_deg: 1.2 },
        pointing_mode: 'target_track',
        roll_deg: 0,
        pitch_deg: 0,
        target_id: null, // auto-tracks nearest target in range
        max_slew_deg: 35,
        focal_mm: 2400,
        pixel_um: 5.0,
        swath_history_min: 22,
      },
      show_orbit: true,
      show_ground_track: true,
      show_footprint: true,
      show_swath: true,
    },
    {
      id: 'sat-sentinel2',
      name: 'SENTINEL-2 · Wide Swath (SSO 786 km)',
      color: '#facc15',
      visible: true,
      source_mode: 'keplerian',
      keplerian: {
        altitude_km: 786,
        eccentricity: 0.0001,
        inclination_deg: Number(sunSyncInclinationDeg(786).toFixed(3)),
        raan_deg: (ssoRaan + 18) % 360,
        arg_perigee_deg: 0,
        mean_anomaly_deg: 145,
      },
      epoch_iso: epochIso,
      sensor: {
        enabled: true,
        fov: { type: 'rectangular', cross_half_deg: 10.3, along_half_deg: 0.8 },
        pointing_mode: 'nadir',
        roll_deg: 0,
        pitch_deg: 0,
        target_id: null,
        max_slew_deg: 25,
        focal_mm: 600,
        pixel_um: 7.5,
        swath_history_min: 25,
      },
      show_orbit: true,
      show_ground_track: true,
      show_footprint: true,
      show_swath: true,
    },
    {
      id: 'sat-sar1',
      name: 'SAR-1 · Dawn-Dusk Radar (550 km)',
      color: '#fb7185',
      visible: true,
      source_mode: 'keplerian',
      keplerian: {
        altitude_km: 550,
        eccentricity: 0.0001,
        inclination_deg: Number(sunSyncInclinationDeg(550).toFixed(3)),
        raan_deg: Number(raanForLtanDeg(now, 6.0).toFixed(2)),
        arg_perigee_deg: 0,
        mean_anomaly_deg: 40,
      },
      epoch_iso: epochIso,
      sensor: {
        enabled: true,
        fov: { type: 'rectangular', cross_half_deg: 7.5, along_half_deg: 0.9 },
        pointing_mode: 'fixed_slew',
        roll_deg: 24,
        pitch_deg: 0,
        target_id: null,
        max_slew_deg: 40,
        focal_mm: 500,
        pixel_um: 6.5,
        swath_history_min: 20,
      },
      show_orbit: true,
      show_ground_track: false,
      show_footprint: true,
      show_swath: false,
    },
  ];

  const stations: GroundStationObject[] = [
    {
      id: 'gs-siracha',
      name: 'Si Racha GISTDA GS',
      lat: 13.102,
      lon: 100.928,
      alt_km: 0.05,
      min_el_deg: 5.0,
      color: '#34d399',
    },
    {
      id: 'gs-svalbard',
      name: 'Svalbard Polar GS',
      lat: 78.229,
      lon: 15.407,
      alt_km: 0.45,
      min_el_deg: 5.0,
      color: '#60a5fa',
    },
  ];

  const targets: TargetPointObject[] = [
    {
      id: 'tgt-bkk',
      name: 'Bangkok (กรุงเทพฯ)',
      lat: 13.7563,
      lon: 100.5018,
      alt_km: 0.01,
      color: '#f97316',
    },
    {
      id: 'tgt-cnx',
      name: 'Chiang Mai (เชียงใหม่)',
      lat: 18.7883,
      lon: 98.9853,
      alt_km: 0.31,
      color: '#fb923c',
    },
    {
      id: 'tgt-hkt',
      name: 'Phuket (ภูเก็ต)',
      lat: 7.8804,
      lon: 98.3923,
      alt_km: 0.02,
      color: '#f43f5e',
    },
  ];

  const areaTarget: AreaTargetObject = {
    id: 'area-th-central',
    name: 'ลุ่มน้ำเจ้าพระยา & ภาคกลาง (Chao Phraya Basin)',
    color: '#a855f7',
    vertices: [
      { lat: 13.3, lon: 99.6 },
      { lat: 13.3, lon: 101.2 },
      { lat: 16.0, lon: 101.0 },
      { lat: 16.0, lon: 99.5 },
    ],
  };

  return { satellites, stations, targets, areaTarget };
}

export async function searchCelestrakOnline(query: string): Promise<CatalogEntry[]> {
  const q = query.trim();
  if (!q) return OFFLINE_SATELLITE_CATALOG;

  // Filter offline catalog first
  const localMatches = OFFLINE_SATELLITE_CATALOG.filter(
    (c) =>
      c.name.toLowerCase().includes(q.toLowerCase()) ||
      String(c.norad_id).includes(q) ||
      c.category.toLowerCase().includes(q.toLowerCase())
  );

  try {
    const isNum = /^\d+$/.test(q);
    const param = isNum ? `CATNR=${encodeURIComponent(q)}` : `NAME=${encodeURIComponent(q)}`;
    const res = await fetch(`https://celestrak.org/NORAD/elements/gp.php?${param}&FORMAT=TLE`, {
      signal: AbortSignal.timeout(4500),
    });
    if (!res.ok) return localMatches;
    const text = await res.text();
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const remote: CatalogEntry[] = [];
    for (let i = 0; i + 2 < lines.length; i += 3) {
      if (lines[i + 1].startsWith('1 ') && lines[i + 2].startsWith('2 ')) {
        const name = lines[i];
        const l1 = lines[i + 1];
        const l2 = lines[i + 2];
        const norad = parseInt(l1.substring(2, 7).trim(), 10) || 0;
        remote.push({
          id: `celestrak-${norad}-${i}`,
          name,
          norad_id: norad,
          category: 'CelesTrak Live',
          description_th: `ข้อมูล TLE สดจาก CelesTrak (NORAD ${norad})`,
          description_en: `Live TLE fetched from CelesTrak (NORAD ${norad})`,
          line1: l1,
          line2: l2,
          default_sensor: {
            fov: { type: 'rectangular', cross_half_deg: 6.0, along_half_deg: 0.8 },
            roll_deg: 0,
            pitch_deg: 0,
          },
          focal_mm: 1200,
          pixel_um: 6.0,
          max_slew_deg: 30,
        });
      }
    }
    return remote.length > 0 ? remote.slice(0, 25) : localMatches;
  } catch {
    return localMatches;
  }
}

export type CelestrakGnssGroup = 'gps-ops' | 'glo-ops' | 'galileo' | 'beidou' | 'qzss' | 'gnss';

function parseTleFeed(text: string, category: string): CatalogEntry[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const items: CatalogEntry[] = [];
  for (let i = 0; i + 2 < lines.length; i += 3) {
    if (lines[i + 1].startsWith('1 ') && lines[i + 2].startsWith('2 ')) {
      const name = lines[i];
      const l1 = lines[i + 1];
      const l2 = lines[i + 2];
      const norad = parseInt(l1.substring(2, 7).trim(), 10) || 0;
      items.push({
        id: `celestrak-${category}-${norad}-${i}`,
        name,
        norad_id: norad,
        category,
        description_th: `ข้อมูล TLE สดจาก CelesTrak (${category})`,
        description_en: `Live ${category} TLE from CelesTrak (NORAD ${norad})`,
        line1: l1,
        line2: l2,
        default_sensor: {
          fov: { type: 'conic', half_angle_deg: 13.0 },
          roll_deg: 0,
          pitch_deg: 0,
        },
        focal_mm: 200,
        pixel_um: 10.0,
        max_slew_deg: 15,
      });
    }
  }
  return items;
}

export async function fetchCelestrakGnssGroup(group: CelestrakGnssGroup): Promise<CatalogEntry[]> {
  const groupMap: Record<CelestrakGnssGroup, { label: string; filterKey: string }> = {
    'gps-ops': { label: 'GNSS · GPS', filterKey: 'gps' },
    'glo-ops': { label: 'GNSS · GLONASS', filterKey: 'glonass' },
    galileo: { label: 'GNSS · Galileo', filterKey: 'galileo' },
    beidou: { label: 'GNSS · BeiDou', filterKey: 'beidou' },
    qzss: { label: 'GNSS · QZSS', filterKey: 'qzss' },
    gnss: { label: 'GNSS', filterKey: 'gnss' },
  };
  const info = groupMap[group];
  const localFallback = OFFLINE_SATELLITE_CATALOG.filter((c) =>
    c.category.toLowerCase().includes(info.filterKey)
  );
  try {
    const res = await fetch(
      `https://celestrak.org/NORAD/elements/gp.php?GROUP=${group}&FORMAT=TLE`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return localFallback;
    const text = await res.text();
    const parsed = parseTleFeed(text, info.label);
    return parsed.length > 0 ? parsed.slice(0, 36) : localFallback;
  } catch {
    return localFallback;
  }
}
