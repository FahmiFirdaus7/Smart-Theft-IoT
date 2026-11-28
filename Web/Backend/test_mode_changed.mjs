// Uji: perpindahan mode harus mencetak event mode_changed (dasar pengelompokan
// riwayat per sesi di dashboard). Hitung RELATIF terhadap jumlah sebelum urutan
// uji, supaya event dari test lain tidak mempengaruhi.
//
//   BASE=http://127.0.0.1:8123 node test_mode_changed.mjs
const BASE = process.env.BASE || 'http://127.0.0.1:8000';
const API = BASE + '/api/v1/devices/sg-device-001';
const H = { 'Content-Type': 'application/json' };
let fails = 0;
const check = (n, ok, x) => { console.log((ok ? 'ok   ' : 'GAGAL') + ' ' + n + (x ? '  [' + x + ']' : '')); if (!ok) fails++; };

const tele = (mode) => fetch(BASE + '/api/telemetry', { method: 'POST', headers: H, body: JSON.stringify({
  mode, gps_fix: true, lat: -7.7971, lng: 110.3702, speed_kmh: 0, satellites: 8,
  mpu_ax: 0, mpu_ay: 0, mpu_az: 9.8, mpu_pitch: 0, mpu_roll: 0, mpu_vibration: false,
  battery_v: 3.9, relay1: 0, relay2: 0, alarm_active: false, reported_at: new Date().toISOString(),
}) });
const modeEvents = async () => {
  const j = await (await fetch(API + '/events?limit=50')).json();
  const items = Array.isArray(j.data) ? j.data : (j.data && j.data.items) || [];
  return items.filter((e) => e.event_type === 'mode_changed');
};

// Stabilkan mode laporan dulu (1-2 laporan pertama bisa saja mencetak event).
await tele('armed');
await tele('armed');
const before = (await modeEvents()).length;

await tele('overwatch'); // -> armed -> overwatch
await tele('overwatch'); // tidak berubah: tidak boleh mencetak event
await tele('powersafe');  // -> overwatch -> powersafe

// events diurutkan terbaru dulu -> yang BARU ada di depan daftar
const all = await modeEvents();
const created = all.slice(0, all.length - before);
console.log('event mode_changed baru:', created.length, JSON.stringify(created.map((e) => [e.mode_from, e.mode_to, e.mode, e.severity])));
check('tepat 2 perpindahan mode tercatat', created.length === 2, 'jumlah=' + created.length);
check('membawa mode_from/mode_to', created.length === 2 && created.every((e) => e.mode_from && e.mode_to));
check('event pertama armed -> overwatch', created.some((e) => e.mode_from === 'armed' && e.mode_to === 'overwatch'));
check('event kedua overwatch -> powersafe', created.some((e) => e.mode_from === 'overwatch' && e.mode_to === 'powersafe'));
check('mode = sesi BARU (dipakai grouping) & severity info',
  created.every((e) => ['overwatch', 'powersafe'].includes(e.mode) && e.severity === 'info'));

console.log(fails === 0 ? 'SEMUA TEST LULUS' : fails + ' TEST GAGAL');
process.exit(fails === 0 ? 0 : 1);
