// Regresi: "Reset alarm" harus bertahan, dan episode pelanggaran BARU
// (setelah kondisi normal lalu melanggar lagi) harus memicu alarm lagi.
//
// Self-contained: memakai HOME & radius yang ditetapkan sendiri, menonaktifkan
// zona aktif selama test (dipulihkan lagi di akhir), sehingga aman dijalankan
// terhadap database yang sama dengan dashboard.
//
//   BASE=http://127.0.0.1:8788 node test_alarm_reset.js
const BASE = process.env.BASE || 'http://127.0.0.1:8000';
const DEV = 'sg-device-001';
const API = BASE + '/api/v1/devices/' + DEV;
const H = { 'Content-Type': 'application/json' };
const HOME = { lat: -7.7971, lng: 110.3702 }; // acuan test
const NEAR = { lat: -7.79713, lng: 110.37027 }; // ±8 m dari HOME
const FAR = { lat: -7.71, lng: 110.37 };        // ±9.7 km dari HOME

let fails = 0;
function check(name, ok, extra) {
  console.log((ok ? 'ok   ' : 'GAGAL') + ' ' + name + (extra ? '  [' + extra + ']' : ''));
  if (!ok) fails++;
}
const j = (r) => r.json();
const tele = (body) => fetch(BASE + '/api/telemetry', { method: 'POST', headers: H, body: JSON.stringify({ ...body, home_valid: true, home_lat: HOME.lat, home_lng: HOME.lng, geofence_radius_m: 30 }) });
const status = async () => (await (await fetch(API + '/status')).json()).data;
const reset = () => fetch(API + '/alarm/reset', { method: 'POST', headers: H });
const putCmd = (body) => fetch(API + '/command', { method: 'PUT', headers: H, body: JSON.stringify(body) });

const base = (pos) => ({
  mode: 'armed', gps_fix: true, speed_kmh: 0, satellites: 8,
  mpu_ax: 0, mpu_ay: 0, mpu_az: 9.8, mpu_pitch: 0, mpu_roll: 0, mpu_vibration: false,
  battery_v: 3.9, relay1: 0, relay2: 0, alarm_active: false,
  lat: pos.lat, lng: pos.lng,
});

// ---------- setup: amankan kondisi awal ----------
const origCmd = (await (await fetch(API + '/command')).json()).data || {};
const origZones = (await (await fetch(API + '/zones')).json()).data || [];
const wasActive = origZones.filter((z) => z.active);
for (const z of wasActive) {
  await fetch(API + '/zones/' + z.zone_id, { method: 'PATCH', headers: H, body: JSON.stringify({ active: false }) });
}
await putCmd({ home_valid: true, home_lat: HOME.lat, home_lng: HOME.lng, geofence_radius_m: 30 });
await reset();
console.log(`setup: HOME test ${HOME.lat},${HOME.lng} · ${wasActive.length} zona dinonaktifkan sementara`);

try {
  // 1. Kondisi normal: tanpa alarm
  await tele(base(NEAR)); await tele(base(NEAR));
  check('kondisi normal tanpa alarm', (await status()).security.alarm_active === false);

  // 2. Episode 1: keluar zona -> alarm menyala
  await tele(base(FAR)); await tele(base(FAR));
  check('pelanggaran memicu alarm', (await status()).security.alarm_active === true);

  // 3. RESET harus bersih dan BERTAHAN walau pelanggaran berlanjut
  await reset();
  await tele(base(FAR)); await tele(base(FAR));
  const afterReset = (await status()).security.alarm_active;
  check('reset bertahan walau pelanggaran masih berlangsung', afterReset === false, 'alarm_active=' + afterReset);

  // 4. Episode BARU (normal lalu melanggar lagi) harus memicu alarm lagi
  await tele(base(NEAR)); await tele(base(NEAR));
  check('kembali normal tetap tanpa alarm', (await status()).security.alarm_active === false);
  await tele(base(FAR)); await tele(base(FAR));
  check('episode baru memicu alarm lagi', (await status()).security.alarm_active === true);
} finally {
  // ---------- teardown: pulihkan kondisi semula ----------
  await reset();
  for (const z of wasActive) {
    await fetch(API + '/zones/' + z.zone_id, { method: 'PATCH', headers: H, body: JSON.stringify({ active: true }) });
  }
  await putCmd({
    home_valid: origCmd.home_valid === true,
    home_lat: origCmd.home_lat ?? 0, home_lng: origCmd.home_lng ?? 0,
    geofence_radius_m: origCmd.geofence_radius_m ?? 30,
  });
  console.log('teardown: zona & HOME dipulihkan');
}

console.log(fails === 0 ? 'SEMUA TEST LULUS' : fails + ' TEST GAGAL');
process.exit(fails === 0 ? 0 : 1);
