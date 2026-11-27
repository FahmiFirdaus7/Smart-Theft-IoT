/**
 * Uji kompatibilitas firmware main_1.cpp + frontend. Jalankan server dulu, lalu: node test_firmware.js
 * Porting 1-1 dari test_firmware.py (versi Python).
 * Peringatan: skrip ini menulis data uji ke database (event alarm, titik lokasi). Pakai database kosong/uji.
 *
 * Pakai node:http (bukan fetch) supaya path mentah seperti /js/../Backend/main.py
 * dikirim apa adanya ke server — fetch/URL akan menormalkan ".." lebih dulu.
 */
import http from 'node:http';

const OPT = { host: '127.0.0.1', port: 8000 };

function call(method, p, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === null || body === undefined ? null : JSON.stringify(body);
    const req = http.request({
      ...OPT, path: p, method,
      headers: {
        'Content-Type': 'application/json',
        ...(payload !== null ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...headers,
      },
    }, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => resolve([res.statusCode, data]));
    });
    req.on('error', reject);
    if (payload !== null) req.write(payload);
    req.end();
  });
}

async function J(m, p, body = null) {
  const [c, b] = await call(m, p, body);
  return [c, JSON.parse(b)];
}

const D = '/api/v1/devices/sg-device-001';

console.log('== STATIC (200 = boleh, 404 = diblokir)');
for (const p of ['/', '/config.js', '/sw.js', '/css/app.css', '/js/app.js', '/Backend/main.py',
  '/Backend/smartguard.db', '/package.json', '/js/../Backend/main.py', '/api/zzz']) {
  console.log(' ', p, (await call('GET', p))[0]);
}

console.log('== FIRMWARE');
let [c, cmd] = await call('GET', '/api/command');
console.log(' command awal', c, cmd);

const tele = {
  mode: 'armed', gps_fix: true, lat: -7.7971, lng: 110.3702, speed_kmh: 0, satellites: 8,
  mpu_ax: 0.1, mpu_ay: 0.2, mpu_az: 9.8, mpu_vibration: false,
  battery_v: 0.0, relay1: 0, relay2: 0, alarm_active: false,
  geofence_radius_m: 30, dist_home_m: -1,
};
[c] = await call('POST', '/api/telemetry', tele);
console.log(' tele normal', c);

let d = (await J('GET', `${D}/status`))[1].data;
console.log(' status level atas:',
  ['security', 'gps', 'power', 'battery', 'report', 'connection', 'last_seen_at'].filter(k => k in d),
  '| battery.voltage =', d.battery.voltage_v, '| connection =', d.connection);

console.log(' home/current', (await J('POST', `${D}/home/current`))[0],
  '| PUT mode armed ->', (await J('PUT', `${D}/command`, { mode: 'armed', geofence_radius_m: 30 }))[1].data);

const al = { ...tele, alarm_active: true, lat: -7.7975, lng: 110.3711, dist_home_m: 46.2, battery_v: 3.9 };
[c, cmd] = await call('POST', '/api/telemetry', al);
console.log(' tele alarm', c, '| balasan alarm_active =', JSON.parse(cmd).alarm_active);

await call('POST', '/api/telemetry', al);
[c, cmd] = await call('POST', '/api/telemetry', { ...al, alarm_active: false });
console.log(' firmware melapor alarm=false, balasan alarm_active =', JSON.parse(cmd).alarm_active,
  '(harus True = terkunci)');

let ev = (await J('GET', `${D}/events?limit=1`))[1].data;
console.log(' events limit=1: jumlah', ev.items.length, '| next_cursor', ev.next_cursor,
  '|', ev.items[0].event_type, ev.items[0].reason);

console.log(' semua event (alarm 2x tidak boleh ganda):',
  (await J('GET', `${D}/events`))[1].data.items.map(e => e.event_type));

await call('POST', '/api/telemetry', { ...tele, battery_v: 3.4 });
console.log(' setelah baterai 3.4 V:',
  (await J('GET', `${D}/events`))[1].data.items.map(e => e.event_type));

const nc = (await J('GET', `${D}/events?limit=1&cursor=1`))[1].data;
console.log(' cursor=1 ->', nc.items[0].event_type, '| next_cursor', nc.next_cursor);

console.log(' reset alarm -> alarm_active =',
  (await J('POST', `${D}/alarm/reset`))[1].data.alarm_active);

console.log(' PUT mode ngawur ->', (await J('PUT', `${D}/command`, { mode: 'ngawur' }))[0],
  '| home_lat saja ->', (await J('PUT', `${D}/command`, { home_lat: 1 }))[0]);

console.log(' titik lokasi tersimpan:',
  (await J('GET', `${D}/locations`))[1].data.items.length);
