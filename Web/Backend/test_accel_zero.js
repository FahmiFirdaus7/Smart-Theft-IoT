// Regresi: kalibrasi nol akselerometer — sensor diam harus membaca 0,00 m/s²
// (bukan sisa offset alat seperti 0,50), guncangan tetap terbaca, dan tombol
// "Kalibrasi nol" (POST /motion/zero) mengunci titik nol ke pembacaan sekarang.
//
//   BASE=http://127.0.0.1:8123 node test_accel_zero.js
const BASE = process.env.BASE || 'http://127.0.0.1:8000';
const DEV = 'sg-device-001';
const API = BASE + '/api/v1/devices/' + DEV;
const H = { 'Content-Type': 'application/json' };

let fails = 0;
function check(name, ok, extra) {
  console.log((ok ? 'ok   ' : 'GAGAL') + ' ' + name + (extra ? '  [' + extra + ']' : ''));
  if (!ok) fails++;
}
const tele = async (az, vibration = false) => {
  await fetch(BASE + '/api/telemetry', { method: 'POST', headers: H, body: JSON.stringify({
    mode: 'powersafe', gps_fix: true, lat: -7.79, lng: 110.37, speed_kmh: 0, satellites: 8,
    mpu_ax: 0, mpu_ay: 0, mpu_az: az, mpu_pitch: 0, mpu_roll: 0, mpu_vibration: vibration,
    battery_v: 3.9, relay1: 0, relay2: 0, alarm_active: false, reported_at: new Date().toISOString(),
  }) });
  const st = (await (await fetch(API + '/status')).json()).data;
  return st.report.motion;
};
const command = async () => (await (await fetch(API + '/command')).json()).data || {};

// Sampel acuan: besar-medan 10.31 m/s² (offset alat +0,50 dari 9.81). Titik nol
// dikunci dulu — otomatis bila baseline masih kosong, atau lewat tombol
// "Kalibrasi nol" bila baseline sudah terisi dari pengukuran sebelumnya.
const cmd0 = await command();
let m = await tele(10.31);
if (!Number.isFinite(cmd0.accel_baseline)) {
  check('baseline kosong: sampel pertama langsung jadi titik nol (0,00)',
    m.acceleration_mps2 === 0, `acc=${m.acceleration_mps2}`);
} else {
  await fetch(API + '/motion/zero', { method: 'POST', headers: H });
  m = await tele(10.31);
  check('POST /motion/zero mengunci titik nol ke pembacaan diam',
    m.acceleration_mps2 === 0, `acc=${m.acceleration_mps2}`);
}
check('besar-medan mentah ikut dilaporkan (accel_total)', m.accel_total === 10.31, `total=${m.accel_total}`);

m = await tele(10.31);
check('pembacaan diam berikutnya tetap 0,00', m.acceleration_mps2 === 0, `acc=${m.acceleration_mps2}`);

// Guncangan nyata harus tetap terbaca (baseline dibekukan saat getaran)
m = await tele(12.5, true);
check('getaran tetap terbaca (baseline dibekukan)', m.acceleration_mps2 > 1.5,
  `acc=${m.acceleration_mps2}`);

m = await tele(10.31);
check('kembali diam -> 0,00 lagi', m.acceleration_mps2 === 0, `acc=${m.acceleration_mps2}`);

// Tombol "Kalibrasi nol"
const zero = await (await fetch(API + '/motion/zero', { method: 'POST', headers: H })).json();
const cmd = await command();
check('POST /motion/zero menyimpan titik nol', zero.ok === true && zero.data.accel_baseline === 10.31,
  JSON.stringify(zero.data));
check('GET /command membawa accel_baseline', cmd.accel_baseline === 10.31, `baseline=${cmd.accel_baseline}`);

// Baseline ikut menyesuaikan sendiri perlahan selama tidak ada getaran (EMA 5%)
m = await tele(10.61);
const first = m.acceleration_mps2;
for (let i = 0; i < 9; i++) await tele(10.61);
m = await tele(10.61);
check('baseline menyesuaikan sendiri (selisih menyusut)', m.acceleration_mps2 < first && m.acceleration_mps2 < 0.25,
  `awal=${first} sekarang=${m.acceleration_mps2}`);

console.log(fails === 0 ? 'SEMUA TEST LULUS' : fails + ' TEST GAGAL');
process.exit(fails === 0 ? 0 : 1);
