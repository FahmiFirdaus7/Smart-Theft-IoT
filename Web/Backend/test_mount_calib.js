// Regresi: kalibrasi mounting + ARAH sudut di server.
// Papan MPU terpasang terbalik, jadi selain offset (tegak = 0°) arah putarannya
// juga harus dibalik: roll kanan/kiri kebalik sebelum diperbaiki (MPU_ROLL_SIGN).
//
//   BASE=http://127.0.0.1:8123 node test_mount_calib.js
const BASE = process.env.BASE || 'http://127.0.0.1:8000';
const DEV = 'sg-device-001';
const API = BASE + '/api/v1/devices/' + DEV;
const H = { 'Content-Type': 'application/json' };

// Nilai default di server.js (lihat blok "Kalibrasi mounting MPU6050")
const PITCH0 = -1.3, ROLL0 = -175.5;

let fails = 0;
function check(name, ok, extra) {
  console.log((ok ? 'ok   ' : 'GAGAL') + ' ' + name + (extra ? '  [' + extra + ']' : ''));
  if (!ok) fails++;
}
const near = (a, b) => Math.abs(a - b) < 0.051;

/** Kirim telemetri. `raw` = {pitch, roll} mentah firmware; null -> pakai ax/ay/az. */
async function tele(raw) {
  const body = {
    mode: 'armed', gps_fix: true, lat: -7.7971, lng: 110.3702, speed_kmh: 0, satellites: 8,
    mpu_ax: 0, mpu_ay: 0, mpu_az: 9.8, mpu_vibration: false,
    battery_v: 3.9, relay1: 0, relay2: 0, alarm_active: false, reported_at: new Date().toISOString(),
  };
  if (raw) { body.mpu_pitch = raw.pitch; body.mpu_roll = raw.roll; }
  await fetch(BASE + '/api/telemetry', { method: 'POST', headers: H, body: JSON.stringify(body) });
  const st = (await (await fetch(API + '/status')).json()).data;
  return st.report.motion;
}

// 1. Posisi tegak = titik nol
let m = await tele({ pitch: PITCH0, roll: ROLL0 });
check('tegak -> pitch 0.0 & roll 0.0', near(m.pitch_deg, 0) && near(m.roll_deg, 0),
  `pitch=${m.pitch_deg} roll=${m.roll_deg}`);

// 2. Arah ROLL harus terbalik terhadap nilai mentah (MPU_ROLL_SIGN = -1)
m = await tele({ pitch: PITCH0, roll: ROLL0 - 1 });
check('roll mentah -1 -> ditampilkan +1 (arah dibalik)', near(m.roll_deg, 1),
  `roll=${m.roll_deg}`);
m = await tele({ pitch: PITCH0, roll: ROLL0 + 1 });
check('roll mentah +1 -> ditampilkan -1 (arah dibalik)', near(m.roll_deg, -1),
  `roll=${m.roll_deg}`);

// 3. Arah PITCH masih ikut mentah (MPU_PITCH_SIGN = 1)
m = await tele({ pitch: PITCH0 + 1, roll: ROLL0 });
check('pitch mentah +1 -> ditampilkan +1 (tidak dibalik)', near(m.pitch_deg, 1),
  `pitch=${m.pitch_deg}`);

// 4. Lompatan lewat ±180 harus tetap kecil (wrap sebelum dibalik)
m = await tele({ pitch: PITCH0, roll: 179 });
check('roll 179 (melewati ±180) tidak jadi lompatan ~360', near(m.roll_deg, 5.5),
  `roll=${m.roll_deg}`);
m = await tele({ pitch: PITCH0, roll: -180 });
check('roll -180 tetap di dekat titik nol', near(m.roll_deg, 4.5), `roll=${m.roll_deg}`);

// 5. Tanpa mpu_pitch/mpu_roll: fallback hitung dari akselerometer ikut terkalibrasi
m = await tele(null);
check('fallback ax/ay/az ikut kalibrasi (az=9.8 -> roll -175.5)',
  near(m.pitch_deg, 1.3) && near(m.roll_deg, -175.5), `pitch=${m.pitch_deg} roll=${m.roll_deg}`);

console.log(fails === 0 ? 'SEMUA TEST LULUS' : fails + ' TEST GAGAL');
process.exit(fails === 0 ? 0 : 1);
