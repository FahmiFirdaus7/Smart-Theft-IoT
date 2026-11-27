/**
 * Uji cepat backend tanpa ESP32. Jalankan server dulu, lalu: node test_api.js
 * Porting 1-1 dari test_api.py (versi Python) — urutan & pesan yang dicetak sama.
 */
const BASE = 'http://127.0.0.1:8000';
const DEV = 'sg-device-001';
const TOKEN = 'dev-token-ganti-ini';

function ts(delta = 0) {
  return new Date(Date.now() + delta * 1000).toISOString().slice(0, 19) + 'Z';
}

async function call(method, path, body = null, token = TOKEN) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const opt = { method, headers };
  if (body !== null && body !== undefined) opt.body = JSON.stringify(body);
  const r = await fetch(BASE + path, opt);
  return [r.status, await r.json()];
}

function show(title, res) {
  console.log(`\n== ${title} -> ${res[0]}`);
  console.log(JSON.stringify(res[1], null, 2).slice(0, 700));
}

const telemetry = {
  schema_version: 1, device_id: DEV, reported_at: ts(),
  power: { mode: 'ARMED_SLEEP', last_wake_reason: 'timer', next_heartbeat_due_at: ts(600) },
  security: { state: 'ARMED', alarm_active: false,
    home: { latitude: -7.797, longitude: 110.370 },
    geofence_radius_m: 30, distance_from_home_m: 4.8 },
  gps: { fix: true, latitude: -7.7971, longitude: 110.3702, speed_kmh: 0.2,
    satellites: 8, updated_at: ts(-2) },
  motion: { available: true, detected: false, acceleration_mps2: 0.14, updated_at: ts(-1) },
  battery: { voltage_v: 3.91, soc_percent: 72, status: 'normal', charging: null,
    updated_at: ts(-5) },
  connectivity: { wifi_connected: true, api_reachable: true, ble_available: true,
    last_successful_sync_at: ts() },
  health: { gps: 'ok', motion_sensor: 'ok', battery_monitor: 'ok', event_queue_size: 0 },
};

const alarm = {
  schema_version: 1, event_id: 'TEST-ALARM-' + ts().replaceAll(':', ''), device_id: DEV,
  event_type: 'security_alarm', severity: 'high', occurred_at: ts(),
  reason: ['motion_detected', 'geofence_exceeded'],
  location: { latitude: -7.7975, longitude: 110.3711, gps_fix: true },
  distance_from_home_m: 46.2, battery: { soc_percent: 71, voltage_v: 3.89 },
};

show('telemetry', await call('POST', `/api/v1/devices/${DEV}/telemetry`, telemetry));
show('event pertama', await call('POST', `/api/v1/devices/${DEV}/events`, alarm));
show('event dikirim ulang (harus duplicate=true)', await call('POST', `/api/v1/devices/${DEV}/events`, alarm));
show('heartbeat', await call('POST', `/api/v1/devices/${DEV}/heartbeat`));
show('tanpa token (harus 401)', await call('POST', `/api/v1/devices/${DEV}/heartbeat`, null, null));
show('token salah (harus 403)', await call('POST', `/api/v1/devices/${DEV}/heartbeat`, null, 'salah'));
show('payload rusak (harus 400)', await call('POST', `/api/v1/devices/${DEV}/events`, { event_id: 'x' }));
show('status', await call('GET', `/api/v1/devices/${DEV}/status`, null, null));
show('location', await call('GET', `/api/v1/devices/${DEV}/location`, null, null));
show('events', await call('GET', `/api/v1/devices/${DEV}/events?limit=5`, null, null));
show('acknowledge', await call('POST', `/api/v1/devices/${DEV}/events/${alarm.event_id}/acknowledge`, null, null));
