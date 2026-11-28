// Regresi: penghalusan posisi GPS di server (tanpa flash firmware) —
//   1. saat diam, posisi yang dipakai (geofence/riwayat/peta) = rata-rata jendela
//      sampel, jadi goyangan receiver ±3 m tidak menggeser jarak ke zona
//   2. accuracy_m terisi setelah cukup sampel (dipakai lingkaran akurasi di peta)
//   3. lompatan >30 m saat diam ditolak sekali; 2x berturut dianggap pindah
//   4. saat bergerak (speed >= 1.5 km/h) jendela dibuang -> nilai mentah, tanpa lag
//
//   BASE=http://127.0.0.1:8123 node test_gps_smooth.js
const BASE = process.env.BASE || 'http://127.0.0.1:8000';
const DEV = 'sg-device-001';
const API = BASE + '/api/v1/devices/' + DEV;
const H = { 'Content-Type': 'application/json' };
const C = { lat: -7.7971, lng: 110.3702 }; // titik acuan (utara)
const M_PER_DEG_LAT = 111320;
const M_PER_DEG_LNG = 111320 * Math.cos((C.lat * Math.PI) / 180);

let fails = 0;
function check(name, ok, extra) {
  console.log((ok ? 'ok   ' : 'GAGAL') + ' ' + name + (extra ? '  [' + extra + ']' : ''));
  if (!ok) fails++;
}
const shift = (mEast, mNorth) => ({
  lat: +(C.lat + mNorth / M_PER_DEG_LAT).toFixed(6),
  lng: +(C.lng + mEast / M_PER_DEG_LNG).toFixed(6),
});
const havM = (a, b) => {
  const toRad = (x) => (x * Math.PI) / 180;
  const dp = toRad(b.lat - a.lat), dl = toRad(b.lng - a.lng);
  const h = Math.sin(dp / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dl / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
};
const tele = async (pos, speed = 0) => {
  await fetch(BASE + '/api/telemetry', { method: 'POST', headers: H, body: JSON.stringify({
    mode: 'armed', gps_fix: true, lat: pos.lat, lng: pos.lng, speed_kmh: speed, satellites: 8,
    mpu_ax: 0, mpu_ay: 0, mpu_az: 9.8, mpu_pitch: 0, mpu_roll: 0, mpu_vibration: false,
    battery_v: 3.9, relay1: 0, relay2: 0, alarm_active: false, reported_at: new Date().toISOString(),
  }) });
  const st = (await (await fetch(API + '/status')).json()).data;
  return st.report.gps;
};

// --- 1. diam dengan jitter khas receiver (±3 m) ---
const jitter = [[0, 0], [3, 0], [-3, 0], [0, 3], [0, -3], [2, 2], [-2, -2], [1, -1], [-1, 1], [3, 0]];
let lastRaw = null, g = null;
for (const [e, n] of jitter) { lastRaw = shift(e, n); g = await tele(lastRaw); }

check('accuracy_m terhitung setelah cukup sampel', Number.isFinite(g.accuracy_m) && g.accuracy_m > 0,
  `accuracy=${g.accuracy_m} samples=${jitter.length}`);
check('laporan terakhir memakai rata-rata (bukan sampel mentah)', g.smoothed === true, `smoothed=${g.smoothed}`);
const dTrue = havM({ lat: g.latitude, lng: g.longitude }, C);
const dRaw = havM(lastRaw, C);
check('posisi dilaporkan jauh lebih dekat ke titik asli daripada sampel mentah',
  dTrue < 1.5 && dRaw > 2.5, `laporan=${dTrue.toFixed(2)} m vs mentah=${dRaw.toFixed(2)} m`);

// --- 2. lompatan saat diam: tolak sekali ---
const far = shift(60, 0);
g = await tele(far);
check('lompatan 60 m saat diam DITOLAK', g.rejected === true, `rejected=${g.rejected}`);
check('posisi tetap di sekitar titik sebelumnya', havM({ lat: g.latitude, lng: g.longitude }, C) < 2,
  `jarak=${havM({ lat: g.latitude, lng: g.longitude }, C).toFixed(2)} m`);

// --- 3. lompatan kedua berturut = perpindahan nyata, jendela di-reset ---
g = await tele(far);
check('lompatan kedua berturut DITERIMA (kendaraan dipindah)', g.rejected === false && g.smoothed === false,
  `rejected=${g.rejected} smoothed=${g.smoothed}`);
check('posisi pindah ke titik baru', havM({ lat: g.latitude, lng: g.longitude }, far) < 1,
  `jarak=${havM({ lat: g.latitude, lng: g.longitude }, far).toFixed(2)} m`);

// --- 4. bergerak: nilai mentah, tanpa lag, akurasi tidak diklaim ---
const home = shift(0, 0);
g = await tele(home, 20);
check('bergerak -> jendela dibuang, pakai nilai mentah',
  g.smoothed === false && g.latitude === home.lat && g.longitude === home.lng,
  `smoothed=${g.smoothed} lat=${g.latitude}`);
check('bergerak -> accuracy_m tidak diklaim (null)', g.accuracy_m === null, `accuracy=${g.accuracy_m}`);

console.log(fails === 0 ? 'SEMUA TEST LULUS' : fails + ' TEST GAGAL');
process.exit(fails === 0 ? 0 : 1);
