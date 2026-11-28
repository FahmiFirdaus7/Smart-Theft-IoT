// Regresi: getaran mencurigakan di mode ARMED harus memicu alarm DAN menyalakan
// tlakson (relay2) lewat command; "/alarm/reset" harus mematikannya lagi.
// Mode selain armed TIDAK boleh memicu alarm dari getaran.
//
// Kenapa test ini ada: firmware hanya MENG-ECHO alarm_active dari command, jadi
// syarat lama "(firmware bilang alarm) && getaran" tidak pernah terpenuhi untuk
// perangkat asli — getaran tidak pernah memicu apa pun.
//
// Self-contained seperti test_alarm_reset.js: memakai HOME & radius sendiri dan
// menonaktifkan zona aktif selama test (dipulihkan di akhir).
//
//   BASE=http://127.0.0.1:8788 node test_motion_alarm.js
const BASE = process.env.BASE || 'http://127.0.0.1:8000';
const DEV = 'sg-device-001';
const API = BASE + '/api/v1/devices/' + DEV;
const H = { 'Content-Type': 'application/json' };
const HOME = { lat: -7.7971, lng: 110.3702 }; // acuan test
const NEAR = { lat: -7.79713, lng: 110.37027 }; // ±8 m dari HOME

let fails = 0;
function check(name, ok, extra) {
  console.log((ok ? 'ok   ' : 'GAGAL') + ' ' + name + (extra ? '  [' + extra + ']' : ''));
  if (!ok) fails++;
}
const j = (r) => r.json();
const tele = (body) => fetch(BASE + '/api/telemetry', { method: 'POST', headers: H, body: JSON.stringify({ ...body, home_valid: true, home_lat: HOME.lat, home_lng: HOME.lng, geofence_radius_m: 30 }) });
const status = async () => (await (await fetch(API + '/status')).json()).data;
const command = async () => (await (await fetch(API + '/command')).json()).data || {};
const reset = () => fetch(API + '/alarm/reset', { method: 'POST', headers: H });
const putCmd = (body) => fetch(API + '/command', { method: 'PUT', headers: H, body: JSON.stringify(body) });

// mode + getaran bisa diatur per kasus; alarm_active sengaja false (echo command).
const base = (pos, { mode = 'armed', vibration = false } = {}) => ({
  mode, gps_fix: true, speed_kmh: 0, satellites: 8,
  mpu_ax: 0, mpu_ay: 0, mpu_az: 9.8, mpu_pitch: 0, mpu_roll: 0, mpu_vibration: vibration,
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
  // 1. Kondisi normal: armed tanpa getaran -> tidak ada alarm, tlakson mati
  await tele(base(NEAR)); await tele(base(NEAR));
  let st = await status(), cmd = await command();
  check('armed tanpa getaran: alarm mati', st.security.alarm_active === false);
  check('armed tanpa getaran: tlakson (relay2) mati', cmd.relay2 === 0, 'relay2=' + cmd.relay2);

  // 2. Getaran di ARMED -> alarm menyala + tlakson nyala
  await tele(base(NEAR, { vibration: true }));
  st = await status(); cmd = await command();
  check('getaran di armed memicu alarm', st.security.alarm_active === true, 'alarm=' + st.security.alarm_active);
  check('getaran di armed menyalakan tlakson (relay2=1)', cmd.relay2 === 1, 'relay2=' + cmd.relay2);
  check('status masuk ALARM', st.security.state === 'ALARM', 'state=' + st.security.state);

  // 3. Reset alarm -> alarm & tlakson mati
  //    (status tersimpan baru diperbarui oleh laporan telemetri berikutnya,
  //     sama seperti yang diasumsikan test_alarm_reset.js)
  await reset();
  await tele(base(NEAR));
  st = await status(); cmd = await command();
  check('reset mematikan alarm', st.security.alarm_active === false, 'alarm=' + st.security.alarm_active);
  check('reset mematikan tlakson (relay2=0)', cmd.relay2 === 0, 'relay2=' + cmd.relay2);

  // 4. Getaran di mode BUKAN armed -> tidak boleh memicu apa pun
  await tele(base(NEAR, { mode: 'overwatch', vibration: true }));
  st = await status(); cmd = await command();
  check('getaran di overwatch tidak memicu alarm', st.security.alarm_active === false, 'alarm=' + st.security.alarm_active);
  check('getaran di overwatch tidak menyalakan tlakson', cmd.relay2 === 0, 'relay2=' + cmd.relay2);

  // 5. Episode BARU: kembali ke armed lalu getar lagi -> alarm & tlakson hidup lagi
  await tele(base(NEAR, { mode: 'armed' }));
  await tele(base(NEAR, { mode: 'armed', vibration: true }));
  st = await status(); cmd = await command();
  check('episode baru memicu alarm lagi', st.security.alarm_active === true, 'alarm=' + st.security.alarm_active);
  check('episode baru menyalakan tlakson lagi', cmd.relay2 === 1, 'relay2=' + cmd.relay2);

  // Event alarm tercatat di riwayat (dipakai pengelompokan sesi di dashboard)
  const evs = (await (await fetch(API + '/events?limit=10')).json()).data;
  const items = Array.isArray(evs) ? evs : (evs && evs.items) || [];
  const alarmEv = items.find((e) => e.event_type === 'security_alarm');
  check('event security_alarm tercatat', !!alarmEv);
  check('event alarm membawa mode (dasar grouping sesi)', !!alarmEv && alarmEv.mode === 'armed',
    alarmEv && alarmEv.mode);
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
  console.log('telemetri terakhir dikembalikan ke posisi normal…');
  await tele(base(NEAR));
  console.log('teardown: zona, HOME & alarm dipulihkan');
}

console.log(fails === 0 ? 'SEMUA TEST LULUS' : fails + ' TEST GAGAL');
process.exit(fails === 0 ? 0 : 1);
