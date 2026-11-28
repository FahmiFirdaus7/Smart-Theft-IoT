// Regresi: Relay 1 (kontak mesin) dikelola server —
//   auto  : ON saat powersafe & di dalam zona aman; OFF saat armed/overwatch
//           atau di luar semua zona aktif.
//   manual: tombol emergency / "Aktifkan motor" (relay1_manual=1) menang sampai
//           kembali ke auto atau mode berubah.
//   plus  : POST /alarm/reset mengakui kejadian alarm yang masih belum diakui.
//
// Jalankan terhadap instance terpisah (DB sementara), sama seperti test_alarm_reset:
//   BASE=http://127.0.0.1:8123 node test_relay1.js
const BASE = process.env.BASE || 'http://127.0.0.1:8000';
const DEV = 'sg-device-001';
const API = BASE + '/api/v1/devices/' + DEV;
const H = { 'Content-Type': 'application/json' };
const HOME = { lat: -7.7971, lng: 110.3702 };
const INSIDE = { lat: -7.79713, lng: 110.37027 }; // ±8 m dari HOME (dalam zona)
const OUTSIDE = { lat: -7.71, lng: 110.37 };      // ±9.7 km (di luar zona)

let fails = 0;
function check(name, ok, extra) {
  console.log((ok ? 'ok   ' : 'GAGAL') + ' ' + name + (extra ? '  [' + extra + ']' : ''));
  if (!ok) fails++;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Laporan dikirim 2x: server menolak SEKALI lompatan posisi yang mencurigakan
// (anti-outlier), jadi posisi baru baru benar-benar diterima pada laporan kedua.
const sendOnce = (body) => fetch(BASE + '/api/telemetry', { method: 'POST', headers: H, body: JSON.stringify({ ...body, home_valid: true, home_lat: HOME.lat, home_lng: HOME.lng, geofence_radius_m: 30 }) });
const tele = async (body) => { await sendOnce(body); await sendOnce(body); };
const command = async () => (await (await fetch(API + '/command')).json()).data || {};
const putCmd = (body) => fetch(API + '/command', { method: 'PUT', headers: H, body: JSON.stringify(body) });
const reset = () => fetch(API + '/alarm/reset', { method: 'POST', headers: H });
const events = async () => {
  const j = await (await fetch(API + '/events?limit=30')).json();
  return Array.isArray(j.data) ? j.data : (j.data && j.data.items) || [];
};
// Mode otoritatif ada di command server (dashboard juga mengubahnya lewat PUT).
const setMode = (m) => putCmd({ mode: m });

const base = (pos, mode) => ({
  mode, gps_fix: true, speed_kmh: 0, satellites: 8,
  mpu_ax: 0, mpu_ay: 0, mpu_az: 9.8, mpu_pitch: 0, mpu_roll: 0, mpu_vibration: false,
  battery_v: 3.9, relay1: 0, relay2: 0, alarm_active: false,
  lat: pos.lat, lng: pos.lng,
});

// ---------- setup: zona uji sendiri, zona asli dinonaktifkan sementara ----------
const origCmd = (await (await fetch(API + '/command')).json()).data || {};
const origZones = (await (await fetch(API + '/zones')).json()).data || [];
const wasActive = origZones.filter((z) => z.active);
for (const z of wasActive) {
  await fetch(API + '/zones/' + z.zone_id, { method: 'PATCH', headers: H, body: JSON.stringify({ active: false }) });
}
const zone = await (await fetch(API + '/zones', {
  method: 'POST', headers: H,
  body: JSON.stringify({ name: 'ZONA-RELAY-TEST', lat: HOME.lat, lng: HOME.lng, radius_m: 30 }),
})).json();
const zoneId = zone.data && zone.data.zone_id;
console.log(`setup: zona uji ${zoneId ? 'dibuat' : 'GAGAL'} · ${wasActive.length} zona asli dinonaktifkan sementara`);

try {
  // --- aturan otomatis ---
  await setMode('powersafe');
  await tele(base(INSIDE, 'powersafe'));
  let c = await command();
  check('powersafe + di dalam zona -> relay1 ON', c.relay1 === 1 && c.relay1_manual === false,
    `relay1=${c.relay1} manual=${c.relay1_manual}`);

  await setMode('armed');
  await tele(base(INSIDE, 'armed'));
  c = await command();
  check('armed -> relay1 OFF', c.relay1 === 0, `relay1=${c.relay1}`);

  await setMode('overwatch');
  await tele(base(INSIDE, 'overwatch'));
  c = await command();
  check('overwatch -> relay1 OFF', c.relay1 === 0, `relay1=${c.relay1}`);

  await setMode('powersafe');
  await tele(base(OUTSIDE, 'powersafe'));
  c = await command();
  check('powersafe + di luar zona -> relay1 OFF', c.relay1 === 0, `relay1=${c.relay1}`);

  await tele(base(INSIDE, 'powersafe'));
  c = await command();
  check('kembali ke dalam zona + powersafe -> relay1 ON lagi', c.relay1 === 1, `relay1=${c.relay1}`);

  // --- override manual (emergency / Aktifkan motor) ---
  await putCmd({ relay1: 0, relay1_manual: true });
  await tele(base(INSIDE, 'powersafe'));
  c = await command();
  check('override manual bertahan walau aturan auto bilang ON',
    c.relay1 === 0 && c.relay1_manual === true, `relay1=${c.relay1} manual=${c.relay1_manual}`);

  await putCmd({ relay1_manual: false });
  c = await command();
  check('kembali ke auto langsung menerapkan aturan', c.relay1 === 1 && c.relay1_manual === false,
    `relay1=${c.relay1} manual=${c.relay1_manual}`);

  await putCmd({ relay1: 1, relay1_manual: true });
  await putCmd({ mode: 'armed' });
  c = await command();
  check('ganti mode membuang override (armed tetap terkunci)',
    c.relay1 === 0 && c.relay1_manual === false && c.mode === 'armed',
    `relay1=${c.relay1} manual=${c.relay1_manual} mode=${c.mode}`);

  // --- reset alarm mengakui kejadian alarm ---
  await reset(); // bersihkan latch dulu
  await sleep(1200); // event alarm di-dedupe per detik — jauhkan dari alarm sebelumnya
  await tele(base(OUTSIDE, 'armed')); // di luar zona -> alarm
  await tele(base(OUTSIDE, 'armed'));
  let evs = await events();
  const alarmEv = evs.find((e) => e.event_type === 'security_alarm' && !e.acknowledged_at);
  check('pelanggaran zona membuat kejadian alarm', !!alarmEv, alarmEv && alarmEv.event_id);

  await reset();
  evs = await events();
  const target = evs.find((e) => e.event_type === 'security_alarm' && e.event_id === (alarmEv && alarmEv.event_id));
  check('reset alarm mengakui kejadian alarm itu', !!target && !!target.acknowledged_at,
    target && String(target.acknowledged_at));
  const stillUnacked = evs.filter((e) => e.event_type === 'security_alarm' && !e.acknowledged_at).length;
  check('tidak ada kejadian alarm tersisa yang belum diakui', stillUnacked === 0, 'sisa=' + stillUnacked);
} finally {
  // ---------- teardown ----------
  await reset();
  if (zoneId) await fetch(API + '/zones/' + zoneId, { method: 'DELETE', headers: H });
  for (const z of wasActive) {
    await fetch(API + '/zones/' + z.zone_id, { method: 'PATCH', headers: H, body: JSON.stringify({ active: true }) });
  }
  await putCmd({
    home_valid: origCmd.home_valid === true,
    home_lat: origCmd.home_lat ?? 0, home_lng: origCmd.home_lng ?? 0,
    geofence_radius_m: origCmd.geofence_radius_m ?? 30,
    mode: origCmd.mode || 'overwatch',
    relay1_manual: false,
  });
  await tele(base(INSIDE, origCmd.mode || 'overwatch'));
  console.log('teardown: zona, mode, HOME & relay dipulihkan');
}

console.log(fails === 0 ? 'SEMUA TEST LULUS' : fails + ' TEST GAGAL');
process.exit(fails === 0 ? 0 : 1);
