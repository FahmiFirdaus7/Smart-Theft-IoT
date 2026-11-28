/**
 * SMARTGUARD backend — Node.js + Express + SQLite.
 *
 * Pengganti versi Python/FastAPI (arkip: archive/main.py). API-nya kompatibel penuh:
 * bentuk respons {ok,data,error}, kode status, dan perilaku validasi ikut versi lama,
 * jadi firmware main_1.cpp dan frontend dashboard.html tidak perlu diubah.
 *
 * Mengikuti kontrak di SMARTGUARD_Core v5.1 Bagian 7-8:
 *  - perangkat (ESP32) POST heartbeat / telemetry / events dengan Bearer token per perangkat
 *  - event didedup memakai event_id (retry aman)
 *  - dashboard GET status / location / battery / events, dan acknowledge event
 *  - status offline dihitung dari waktu laporan terakhir, bukan dari isi payload
 *
 * Menjalankan :
 *   npm install
 *   npm start                       -> http://127.0.0.1:8000
 *   npm run dev                     -> reload otomatis saat file diubah
 * Uji (server harus sudah jalan):
 *   node test_api.js
 *   node test_firmware.js
 */
import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

// Dashboard uji web-testing dipasang sebagai sub-app di route tersembunyi
// (lihat blok "Web-testing" di bawah). Import di sini tidak membuka port sendiri.
import { app as testingApp, configureTesting } from '../../web-testing/server.js';

// ---------------------------------------------------------------------------
// Konfigurasi — nama variabel lingkungan sama dengan versi Python.
// ---------------------------------------------------------------------------
const BASE = path.dirname(fileURLToPath(import.meta.url));

// Muat .env bila ada, memakai process.loadEnvFile bawaan Node (>=20.12) — tanpa dependensi.
// Nilai dari environment/shell tetap menang atas isi file. Tanpa .env pun server tetap jalan,
// karena semua variabel di bawah sudah punya default.
try {
  process.loadEnvFile(path.join(BASE, '.env'));
} catch (err) {
  if (err.code !== 'ENOENT') console.warn(`[warn] Gagal memuat .env: ${err.message}`);
}

const DB_PATH = process.env.SMARTGUARD_DB || path.join(BASE, 'smartguard.db');
const WEB_DIR = process.env.SMARTGUARD_WEB_DIR || path.join(BASE, '..', 'Frontend');
// Hanya file/folder ini yang boleh diunduh browser (Backend/, archive/, node_modules, dll. TIDAK ikut)
const STATIC_FILES = new Set(['index.html', 'dashboard.html', 'config.js', 'sw.js', 'manifest.webmanifest', 'favicon.ico']);
const STATIC_DIRS = new Set(['css', 'js', 'assets', 'img', 'icons', 'fonts']);
const NO_CACHE_FILES = new Set(['sw.js', 'index.html', 'config.js']);
const LEGACY_DEVICE_ID = process.env.SMARTGUARD_LEGACY_DEVICE || 'sg-device-001';
const LEGACY_KEY = process.env.SMARTGUARD_LEGACY_KEY || '';
const DEFAULT_INTERVAL_S = 600;              // heartbeat normal: 10 menit
const ALARM_INTERVAL_S = 30;                 // saat alarm aktif, lapor lebih sering
const GRACE_S = 300;                         // toleransi sebelum dianggap offline
const RETENTION_DAYS = parseInt(process.env.LOCATION_RETENTION_DAYS ?? '30', 10);
const PORT = parseInt(process.env.PORT ?? '8000', 10);
const HOST = process.env.HOST || '0.0.0.0';  // 0.0.0.0 supaya ESP32 di WiFi yang sama bisa terhubung
const ACCESS_LOG = process.env.SMARTGUARD_ACCESS_LOG === '1';
const API = '/api/v1';

// Token perangkat. Format env: SMARTGUARD_DEVICE_TOKENS="sg-device-001=tokenrahasia,sg-device-002=token2"
function loadTokens() {
  const raw = process.env.SMARTGUARD_DEVICE_TOKENS || 'sg-device-001=dev-token-ganti-ini';
  const out = {};
  for (const pair of raw.split(',')) {
    const i = pair.indexOf('=');
    if (i >= 0) out[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
  }
  return out;
}
const TOKENS = loadTokens();

// ---------------------------------------------------------------------------
// Util waktu — selalu UTC dan detik bulat, sama dengan strftime("%Y-%m-%dT%H:%M:%SZ")
// ---------------------------------------------------------------------------
function fmt(d) {
  return d.toISOString().slice(0, 19) + 'Z';
}

function nowIso() {
  return fmt(new Date());
}

/** parse ISO 8601 -> Date; gagal -> null (setara datetime.fromisoformat + try/except). */
function parseTs(s) {
  if (typeof s !== 'string' || s === '') return null;
  let t = Date.parse(s);
  if (Number.isNaN(t)) {
    // V8 bisa menolak fraksi detik lebih dari 3 digit; potong lalu coba lagi.
    const m = s.match(/^(.*T\d{2}:\d{2}:\d{2})\.(\d+)(.*)$/);
    if (m) t = Date.parse(`${m[1]}.${m[2].slice(0, 3)}${m[3]}`);
  }
  return Number.isNaN(t) ? null : new Date(t);
}

/** Zona waktu wajib ada (setara pydantic AwareDatetime). */
function hasTimeZone(s) {
  return /(?:Z|[+-]\d{2}:?\d{2})$/i.test(String(s).trim());
}

function isAwareDatetime(v) {
  return typeof v === 'string' && hasTimeZone(v) && parseTs(v) !== null;
}

// ---------------------------------------------------------------------------
// Database — satu koneksi dibuka seumur hidup proses (lebih cepat daripada
// membuka/tutup koneksi tiap request seperti versi Python).
// ---------------------------------------------------------------------------
const db = new DatabaseSync(DB_PATH);

function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS devices(
        device_id TEXT PRIMARY KEY, last_seen_at TEXT, interval_s INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS status(
        device_id TEXT PRIMARY KEY, reported_at TEXT NOT NULL, received_at TEXT NOT NULL,
        payload TEXT NOT NULL, last_lat REAL, last_lon REAL, last_fix_at TEXT);
    CREATE TABLE IF NOT EXISTS events(
        event_id TEXT PRIMARY KEY, device_id TEXT NOT NULL, event_type TEXT NOT NULL,
        severity TEXT NOT NULL, occurred_at TEXT NOT NULL, received_at TEXT NOT NULL,
        payload TEXT NOT NULL, acknowledged_at TEXT);
    CREATE INDEX IF NOT EXISTS idx_events_dev ON events(device_id, occurred_at DESC);
    CREATE TABLE IF NOT EXISTS locations(
        id INTEGER PRIMARY KEY AUTOINCREMENT, device_id TEXT NOT NULL,
        recorded_at TEXT NOT NULL, received_at TEXT NOT NULL,
        latitude REAL NOT NULL, longitude REAL NOT NULL,
        speed_kmh REAL, satellites INTEGER, distance_from_home_m REAL,
        alarm INTEGER NOT NULL DEFAULT 0,
        UNIQUE(device_id, recorded_at));
    CREATE INDEX IF NOT EXISTS idx_loc_dev ON locations(device_id, recorded_at DESC);
    CREATE TABLE IF NOT EXISTS device_commands(
        device_id TEXT PRIMARY KEY, relay1 INTEGER NOT NULL DEFAULT 0, relay2 INTEGER NOT NULL DEFAULT 0,
        mode TEXT NOT NULL DEFAULT 'overwatch', geofence_radius_m REAL NOT NULL DEFAULT 30,
        shock_threshold REAL NOT NULL DEFAULT 15, home_valid INTEGER NOT NULL DEFAULT 0,
        home_lat REAL NOT NULL DEFAULT 0, home_lng REAL NOT NULL DEFAULT 0,
        alarm_latched INTEGER NOT NULL DEFAULT 0, updated_at TEXT);
  `);
  const cutoff = fmt(new Date(Date.now() - RETENTION_DAYS * 86400_000));
  db.prepare('DELETE FROM locations WHERE recorded_at < ?').run(cutoff);
}

// ---------------------------------------------------------------------------
// Error & pembungkus respons — bentuknya sama dengan versi Python.
// ---------------------------------------------------------------------------
class ApiError extends Error {
  constructor(status, message, headers) {
    super(message);
    this.status = status;
    this.headers = headers;
  }
}

function bad(msg) {
  return new ApiError(400, 'Payload tidak valid — ' + msg);
}

function collect(errs) {
  if (errs.length) throw bad(errs.join('; '));
}

function ok(data) {
  return { ok: true, data: data ?? null, error: null };
}

function sendEnvelope(res, status, data, error, headers) {
  if (headers) for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.status(status).json({ ok: error == null, data: data ?? null, error: error ?? null });
}

// ---------------------------------------------------------------------------
// Autentikasi
// ---------------------------------------------------------------------------
/** Perbandingan token tanpa membocorkan waktu (setara hmac.compare_digest). */
function safeEqual(a, b) {
  const ba = Buffer.from(String(a), 'utf8');
  const bb = Buffer.from(String(b), 'utf8');
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

function deviceAuth(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) throw new ApiError(401, 'Token perangkat tidak ada');
  const expected = TOKENS[req.params.device_id];
  if (expected === undefined) throw new ApiError(404, 'Device tidak ditemukan');
  if (!safeEqual(auth.slice(7), expected)) throw new ApiError(403, 'Token perangkat tidak valid');
}

function knownDevice(deviceId) {
  if (!(deviceId in TOKENS)) throw new ApiError(404, 'Device tidak ditemukan');
}

function legacyAuth(req) {
  if (LEGACY_KEY && !safeEqual(req.headers['x-api-key'] || '', LEGACY_KEY)) {
    throw new ApiError(401, 'X-Api-Key tidak valid');
  }
}

// ---------------------------------------------------------------------------
// Validasi payload (setara model pydantic di versi Python)
// ---------------------------------------------------------------------------
const DICT_FIELDS = ['power', 'security', 'gps', 'motion', 'battery', 'connectivity', 'health'];
const TELEMETRY_FIELDS = ['schema_version', 'device_id', 'reported_at', ...DICT_FIELDS];
const EVENT_TYPES = new Set([
  'security_alarm', 'battery_low', 'battery_critical', 'device_started',
  'sensor_fault', 'connectivity_restored', 'event_queue_overflow',
]);
const SEVERITIES = new Set(['info', 'medium', 'high']);
const EVENT_FIELDS = ['schema_version', 'event_id', 'device_id', 'event_type', 'severity',
  'occurred_at', 'reason', 'location', 'distance_from_home_m', 'battery'];
const COMMAND_KEYS = ['relay1', 'relay2', 'mode', 'geofence_radius_m', 'shock_threshold',
  'home_lat', 'home_lng', 'home_valid'];
const MODES = new Set(['armed', 'overwatch', 'powersafe']);

function bodyObject(req) {
  // Body kosong (Content-Length: 0) = tidak ada body, sama dengan FastAPI yang memakai default.
  const len = req.headers['content-length'];
  if ((len !== undefined && Number(len) === 0) || req.body === undefined || req.body === null) {
    throw bad('body: Field required');
  }
  if (typeof req.body !== 'object' || Array.isArray(req.body)) throw bad('body: Input should be a valid dictionary');
  return req.body;
}

function isDict(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function validateTelemetry(body) {
  const errs = [];
  if (!isDict(body)) throw bad('body: Input should be a valid dictionary');
  if (!Number.isInteger(body.schema_version)) {
    errs.push(body.schema_version === undefined ? 'schema_version: Field required'
      : 'schema_version: Input should be a valid integer');
  }
  if (typeof body.device_id !== 'string') {
    errs.push(body.device_id === undefined ? 'device_id: Field required'
      : 'device_id: Input should be a valid string');
  }
  if (!isAwareDatetime(body.reported_at)) {
    errs.push(body.reported_at === undefined ? 'reported_at: Field required'
      : 'reported_at: Input should be a valid datetime with timezone');
  }
  for (const k of DICT_FIELDS) {
    if (body[k] !== undefined && body[k] !== null && !isDict(body[k])) {
      errs.push(`${k}: Input should be a valid dictionary`);
    }
  }
  collect(errs);
  return body;
}

function validateEvent(body) {
  const errs = [];
  if (!isDict(body)) throw bad('body: Input should be a valid dictionary');
  if (!Number.isInteger(body.schema_version)) {
    errs.push(body.schema_version === undefined ? 'schema_version: Field required'
      : 'schema_version: Input should be a valid integer');
  }
  if (typeof body.event_id !== 'string') {
    errs.push(body.event_id === undefined ? 'event_id: Field required'
      : 'event_id: Input should be a valid string');
  } else if (body.event_id.length < 1 || body.event_id.length > 100) {
    errs.push('event_id: String should have at least 1 and at most 100 characters');
  }
  if (typeof body.device_id !== 'string') {
    errs.push(body.device_id === undefined ? 'device_id: Field required'
      : 'device_id: Input should be a valid string');
  }
  if (!EVENT_TYPES.has(body.event_type)) {
    errs.push(body.event_type === undefined ? 'event_type: Field required'
      : `event_type: Input should be one of: ${[...EVENT_TYPES].map(x => `'${x}'`).join(', ')}`);
  }
  if (!SEVERITIES.has(body.severity)) {
    errs.push(body.severity === undefined ? 'severity: Field required'
      : `severity: Input should be one of: ${[...SEVERITIES].map(x => `'${x}'`).join(', ')}`);
  }
  if (!isAwareDatetime(body.occurred_at)) {
    errs.push(body.occurred_at === undefined ? 'occurred_at: Field required'
      : 'occurred_at: Input should be a valid datetime with timezone');
  }
  if (body.reason !== undefined && body.reason !== null
      && (!Array.isArray(body.reason) || body.reason.some(r => typeof r !== 'string'))) {
    errs.push('reason: Input should be a valid list');
  }
  for (const k of ['location', 'battery']) {
    if (body[k] !== undefined && body[k] !== null && !isDict(body[k])) {
      errs.push(`${k}: Input should be a valid dictionary`);
    }
  }
  if (body.distance_from_home_m !== undefined && body.distance_from_home_m !== null
      && typeof body.distance_from_home_m !== 'number') {
    errs.push('distance_from_home_m: Input should be a valid number');
  }
  collect(errs);
  return body;
}

/** Bentuk payload yang disimpan — semua field model ikut ada (null bila kosong), seperti model_dump(). */
function normalizeFields(body, fields) {
  const out = {};
  for (const k of fields) out[k] = body[k] === undefined ? null : body[k];
  for (const [k, v] of Object.entries(body)) if (!fields.includes(k)) out[k] = v;
  return out;
}

/**
 * Validasi PUT .../command (setara CommandUpdate: extra="forbid").
 * Mengembalikan daftar perubahan; nilai null dibuang (exclude_none).
 */
function validateCommandUpdate(body) {
  if (!isDict(body)) throw bad('body: Input should be a valid dictionary');
  const errs = [];
  const changes = {};
  for (const [k, v] of Object.entries(body)) {
    if (!COMMAND_KEYS.includes(k)) {
      errs.push(`${k}: Extra inputs are not permitted`);
      continue;
    }
    if (v === null) continue;
    switch (k) {
      case 'relay1':
      case 'relay2':
        if (v === 0 || v === 1) changes[k] = v;
        else if (v === true) changes[k] = 1;
        else if (v === false) changes[k] = 0;
        else errs.push(`${k}: Input should be 0 or 1`);
        break;
      case 'mode':
        if (typeof v === 'string' && MODES.has(v)) changes[k] = v;
        else errs.push(`${k}: Input should be one of: ${[...MODES].map(x => `'${x}'`).join(', ')}`);
        break;
      case 'geofence_radius_m':
        if (typeof v === 'number' && v > 0 && v <= 5000) changes[k] = v;
        else errs.push(`${k}: Input should be greater than 0 and less than or equal to 5000`);
        break;
      case 'shock_threshold':
        if (typeof v === 'number' && v > 0 && v <= 100) changes[k] = v;
        else errs.push(`${k}: Input should be greater than 0 and less than or equal to 100`);
        break;
      case 'home_lat':
        if (typeof v === 'number' && v >= -90 && v <= 90) changes[k] = v;
        else errs.push(`${k}: Input should be greater than or equal to -90 and less than or equal to 90`);
        break;
      case 'home_lng':
        if (typeof v === 'number' && v >= -180 && v <= 180) changes[k] = v;
        else errs.push(`${k}: Input should be greater than or equal to -180 and less than or equal to 180`);
        break;
      case 'home_valid':
        if (typeof v === 'boolean') changes[k] = v;
        else errs.push(`${k}: Input should be a valid boolean`);
        break;
      default:
        break;
    }
  }
  collect(errs);
  if ('home_lat' in changes && 'home_lng' in changes && !('home_valid' in changes)) changes.home_valid = true;
  if (('home_lat' in changes) !== ('home_lng' in changes)) {
    throw bad('home_lat dan home_lng harus dikirim bersamaan');
  }
  return changes;
}

/** Query string bertipe angka dengan batas (setara Query(ge, le)). */
function intQuery(raw, def, min, max, name) {
  if (raw === undefined) return def;
  const n = Number(raw);
  if (!Number.isInteger(n)) throw bad(`${name}: Input should be a valid integer`);
  if (n < min) throw bad(`${name}: Input should be greater than or equal to ${min}`);
  if (n > max) throw bad(`${name}: Input should be less than or equal to ${max}`);
  return n;
}

// ---------------------------------------------------------------------------
// Helper domain
// ---------------------------------------------------------------------------
function intervalFrom(reportedAt, dueAt) {
  const a = parseTs(reportedAt);
  const b = parseTs(dueAt);
  if (a && b) return Math.max(10, Math.min(86400, Math.trunc((b - a) / 1000)));
  return null;
}

function touch(deviceId, now, intervalS = null) {
  db.prepare('INSERT OR IGNORE INTO devices(device_id, last_seen_at, interval_s) VALUES(?,?,?)')
    .run(deviceId, now, DEFAULT_INTERVAL_S);
  db.prepare('UPDATE devices SET last_seen_at=?, interval_s=COALESCE(?, interval_s) WHERE device_id=?')
    .run(now, intervalS, deviceId);
}

function getPayload(deviceId) {
  const r = db.prepare('SELECT payload FROM status WHERE device_id=?').get(deviceId);
  return r ? JSON.parse(r.payload) : null;
}

function alarmActive(deviceId) {
  const p = getPayload(deviceId) || {};
  return Boolean(p.security && p.security.alarm_active);
}

function nextHeartbeat(deviceId) {
  return alarmActive(deviceId) ? ALARM_INTERVAL_S : DEFAULT_INTERVAL_S;
}

/** Titik sambung notifikasi (push/Telegram/email). Hanya dipanggil untuk event BARU. */
function notify(event) {
  console.log(`[NOTIF] ${String(event.severity).toUpperCase()} ${event.event_type} dari ${event.device_id}`);
}

function validCoord(lat, lon) {
  return typeof lat === 'number' && typeof lon === 'number'
    && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

/** Simpan satu titik riwayat. Titik dengan recorded_at sama diabaikan (retry aman). */
function saveLocation(deviceId, recordedAt, now, lat, lon, speed, sats, dist, alarm) {
  db.prepare(`INSERT OR IGNORE INTO locations(device_id,recorded_at,received_at,latitude,
              longitude,speed_kmh,satellites,distance_from_home_m,alarm)
              VALUES(?,?,?,?,?,?,?,?,?)`)
    .run(deviceId, recordedAt, now, lat, lon, speed ?? null, sats ?? null, dist ?? null, alarm ? 1 : 0);
}

/**
 * Simpan status + titik lokasi dari satu laporan (format Bagian 7.2).
 * Mengembalikan interval heartbeat berikutnya.
 */
function storeTelemetry(deviceId, body) {
  const soc = body.battery && body.battery.soc_percent;
  if (soc !== undefined && soc !== null && !(typeof soc === 'number' && soc >= 0 && soc <= 100)) {
    throw new ApiError(400, 'battery.soc_percent harus 0-100');
  }
  const now = nowIso();
  const reportedDate = parseTs(body.reported_at);
  if (!reportedDate) throw bad('reported_at: Input should be a valid datetime with timezone');
  const reported = fmt(reportedDate);
  const payload = normalizeFields(body, TELEMETRY_FIELDS);
  const gps = body.gps || {};
  const lat = gps.latitude;
  const lon = gps.longitude;
  const hasFix = gps.fix === true && lat !== undefined && lat !== null && lon !== undefined && lon !== null;
  if (hasFix && !validCoord(lat, lon)) {
    throw new ApiError(400, 'gps.latitude/longitude di luar rentang yang valid');
  }
  const interval = intervalFrom(reported, body.power && body.power.next_heartbeat_due_at);
  let fixAt = reported;
  if (isAwareDatetime(gps.updated_at)) fixAt = fmt(parseTs(gps.updated_at));

  const old = db.prepare('SELECT last_lat,last_lon,last_fix_at FROM status WHERE device_id=?').get(deviceId);
  let ll;
  if (hasFix) ll = [lat, lon, gps.updated_at || reported];
  else if (old) ll = [old.last_lat, old.last_lon, old.last_fix_at];
  else ll = [null, null, null];

  // Laporan lama yang telat datang tidak menimpa status yang lebih baru.
  db.prepare(`INSERT INTO status(device_id,reported_at,received_at,payload,last_lat,last_lon,last_fix_at)
              VALUES(?,?,?,?,?,?,?)
              ON CONFLICT(device_id) DO UPDATE SET reported_at=excluded.reported_at,
                received_at=excluded.received_at, payload=excluded.payload,
                last_lat=excluded.last_lat, last_lon=excluded.last_lon,
                last_fix_at=excluded.last_fix_at
              WHERE excluded.reported_at >= status.reported_at`)
    .run(deviceId, reported, now, JSON.stringify(payload), ll[0], ll[1], ll[2]);

  if (hasFix) {
    saveLocation(deviceId, fixAt, now, lat, lon, gps.speed_kmh, gps.satellites,
      body.security && body.security.distance_from_home_m,
      (body.security && body.security.alarm_active) === true);
  }
  touch(deviceId, now, interval);
  return nextHeartbeat(deviceId);
}

/** Buat event (Bagian 7.3) dari sisi server. event_id unik per jenis + detik. */
function addEvent(deviceId, etype, severity, occurred, reasons, loc, dist, batt) {
  const eid = `${deviceId}-${etype}-${Math.floor(Date.parse(occurred) / 1000)}`;
  const ev = {
    schema_version: 1, event_id: eid, device_id: deviceId, event_type: etype,
    severity, occurred_at: occurred, reason: reasons, location: loc,
    distance_from_home_m: dist, battery: batt,
  };
  const cur = db.prepare(`INSERT OR IGNORE INTO events(event_id,device_id,event_type,severity,
                          occurred_at,received_at,payload) VALUES(?,?,?,?,?,?,?)`)
    .run(eid, deviceId, etype, severity, occurred, nowIso(), JSON.stringify(ev));
  if (cur.changes === 1 && loc && loc.gps_fix) {
    saveLocation(deviceId, occurred, nowIso(), loc.latitude, loc.longitude, null, null, dist,
      etype === 'security_alarm');
  }
  return cur.changes === 1 ? ev : null;
}

/** Ambil (sekalian membuat bila belum ada) baris command perangkat. */
function getCommand(deviceId) {
  db.prepare('INSERT OR IGNORE INTO device_commands(device_id, updated_at) VALUES(?,?)')
    .run(deviceId, nowIso());
  const r = db.prepare('SELECT * FROM device_commands WHERE device_id=?').get(deviceId);
  return {
    relay1: r.relay1, relay2: r.relay2, alarm_active: Boolean(r.alarm_latched),
    mode: r.mode, geofence_radius_m: r.geofence_radius_m, shock_threshold: r.shock_threshold,
    home_valid: Boolean(r.home_valid), home_lat: r.home_lat, home_lng: r.home_lng,
  };
}

// ---------------------------------------------------------------------------
// Aplikasi
// ---------------------------------------------------------------------------
const app = express();
app.disable('x-powered-by');

// ---------------------------------------------------------------------------
// Web-testing (dashboard uji + halaman Debug) dipasang sebagai sub-app di
// route tersembunyi supaya tidak terlihat dari dashboard publik.
//   Dashboard : http://<ip>:<PORT>/​_testing/
//   Debug     : http://<ip>:<PORT>/​_testing/#/debug
// Ganti lewat env SMARTGUARD_TESTING_ROUTE, matikan dengan SMARTGUARD_TESTING=0.
// ---------------------------------------------------------------------------
const TESTING_ROUTE = (process.env.SMARTGUARD_TESTING_ROUTE || '/_testing').replace(/\/+$/, '') || '/_testing';
if (process.env.SMARTGUARD_TESTING !== '0') {
  // Aset frontend dibangun dengan base relatif, jadi "/​_testing" tanpa garis
  // miring harus dialihkan dulu supaya ./assets resolve ke /​_testing/assets.
  app.use((req, res, next) => {
    if ((req.method === 'GET' || req.method === 'HEAD') && req.path === TESTING_ROUTE) {
      return res.redirect(TESTING_ROUTE + '/');
    }
    next();
  });
  // Jembatan baca menunjuk ke dirinya sendiri: dashboard uji melihat perangkat
  // yang mengirim ke endpoint legacy di root (POST /api/telemetry). Command dari
  // dashboard uji diteruskan ke SQLite supaya ESP32 asli menerimanya.
  const selfHost = (HOST === '0.0.0.0' || HOST === '::' || !HOST) ? '127.0.0.1' : HOST;
  configureTesting({
    backendUrl: process.env.BACKEND_URL ?? `http://${selfHost}:${PORT}`,
    forwardCommands: process.env.SMARTGUARD_TESTING_FORWARD !== '0',
  });
  app.use(TESTING_ROUTE, testingApp);
}

app.use(express.json({ limit: '1mb' }));

// CORS hanya perlu bila frontend di-host di origin lain, mis. SMARTGUARD_CORS_ORIGINS=https://app.contoh.com
const ORIGINS = (process.env.SMARTGUARD_CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
if (ORIGINS.length) {
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && ORIGINS.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT');
      res.setHeader('Access-Control-Allow-Headers', '*');
    }
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
  });
}

if (ACCESS_LOG) {
  app.use((req, res, next) => {
    const started = Date.now();
    res.on('finish', () => console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - started}ms`));
    next();
  });
}

// ---------------------------------------------------------------------------
// Endpoint perangkat (Bagian 7)
// ---------------------------------------------------------------------------
app.post(`${API}/devices/:device_id/heartbeat`, (req, res) => {
  deviceAuth(req);
  const now = nowIso();
  let interval = null;
  if (req.body !== undefined && req.body !== null) {
    if (!isDict(req.body)) throw bad('body: Input should be a valid dictionary');
    interval = intervalFrom(req.body.reported_at, req.body.power && req.body.power.next_heartbeat_due_at);
  }
  touch(req.params.device_id, now, interval);
  res.json(ok({
    device_id: req.params.device_id,
    received_at: now,
    next_heartbeat_seconds: nextHeartbeat(req.params.device_id),
  }));
});

app.post(`${API}/devices/:device_id/telemetry`, (req, res) => {
  deviceAuth(req);
  const body = validateTelemetry(bodyObject(req));
  if (body.device_id !== req.params.device_id) {
    throw new ApiError(400, 'device_id pada body tidak sama dengan URL');
  }
  const nxt = storeTelemetry(req.params.device_id, body);
  res.json(ok({ device_id: req.params.device_id, received_at: nowIso(), next_heartbeat_seconds: nxt }));
});

app.post(`${API}/devices/:device_id/events`, (req, res) => {
  deviceAuth(req);
  const body = validateEvent(bodyObject(req));
  if (body.device_id !== req.params.device_id) {
    throw new ApiError(400, 'device_id pada body tidak sama dengan URL');
  }
  const now = nowIso();
  const payload = normalizeFields(body, EVENT_FIELDS);
  if (payload.reason === null) payload.reason = [];
  const cur = db.prepare(`INSERT OR IGNORE INTO events(event_id,device_id,event_type,severity,
                          occurred_at,received_at,payload) VALUES(?,?,?,?,?,?,?)`)
    .run(body.event_id, req.params.device_id, body.event_type, body.severity,
      fmt(parseTs(body.occurred_at)), now, JSON.stringify(payload));
  const isNew = cur.changes === 1;
  const loc = body.location || {};
  if (loc.gps_fix === true && validCoord(loc.latitude, loc.longitude)) {
    saveLocation(req.params.device_id, fmt(parseTs(body.occurred_at)), now, loc.latitude,
      loc.longitude, null, null, body.distance_from_home_m, body.event_type === 'security_alarm');
  }
  touch(req.params.device_id, now);
  if (isNew) notify(payload);
  res.json(ok({
    event_id: body.event_id, received_at: now, duplicate: !isNew,
    next_heartbeat_seconds: nextHeartbeat(req.params.device_id),
  }));
});

// ---------------------------------------------------------------------------
// Endpoint web app
// ---------------------------------------------------------------------------
app.get(`${API}/devices/:device_id/status`, (req, res) => {
  const deviceId = req.params.device_id;
  knownDevice(deviceId);
  const dev = db.prepare('SELECT * FROM devices WHERE device_id=?').get(deviceId);
  const st = db.prepare('SELECT reported_at, received_at, payload FROM status WHERE device_id=?').get(deviceId);
  if (!dev) {
    return res.json(ok({
      device_id: deviceId, connection: 'never', last_seen_at: null, received_at: null,
      age_seconds: null, reported_at: null, report: null,
    }));
  }
  const lastSeen = parseTs(dev.last_seen_at);
  const age = lastSeen ? Math.trunc((Date.now() - lastSeen.getTime()) / 1000) : null;
  const conn = age !== null && age > dev.interval_s + GRACE_S ? 'offline' : 'online';
  const report = st ? JSON.parse(st.payload) : null;
  // Payload Bagian 7.2 ditaruh di level atas (sesuai README frontend) dan tetap disalin di "report".
  return res.json(ok({
    ...(report || {}),
    device_id: deviceId,
    connection: conn,
    last_seen_at: dev.last_seen_at,
    received_at: st ? st.received_at : null,
    age_seconds: age,
    expected_interval_seconds: dev.interval_s,
    reported_at: st ? st.reported_at : null,
    report,
  }));
});

app.get(`${API}/devices/:device_id/location`, (req, res) => {
  const deviceId = req.params.device_id;
  knownDevice(deviceId);
  const r = db.prepare('SELECT last_lat,last_lon,last_fix_at FROM status WHERE device_id=?').get(deviceId);
  const has = Boolean(r && r.last_lat !== null);
  return res.json(ok({
    device_id: deviceId,
    has_fix: has,
    latitude: has ? r.last_lat : null,
    longitude: has ? r.last_lon : null,
    fix_at: has ? r.last_fix_at : null,
  }));
});

app.get(`${API}/devices/:device_id/locations`, (req, res) => {
  const deviceId = req.params.device_id;
  knownDevice(deviceId);
  const limit = intQuery(req.query.limit, 100, 1, 500, 'limit');
  const since = req.query.since;
  let sinceS = null;
  if (since !== undefined) {
    const dt = parseTs(since);
    if (!dt || !hasTimeZone(since)) {
      throw new ApiError(400, 'since harus ISO 8601 dengan zona waktu, contoh 2026-11-03T00:00:00Z');
    }
    sinceS = fmt(dt);
  }
  const rows = db.prepare(`SELECT recorded_at, latitude, longitude, speed_kmh, satellites,
                           distance_from_home_m, alarm FROM locations
                           WHERE device_id=? AND (? IS NULL OR recorded_at >= ?)
                           ORDER BY recorded_at DESC LIMIT ?`)
    .all(deviceId, sinceS, sinceS, limit);
  return res.json(ok({
    items: rows.map(r => ({ ...r, alarm: Boolean(r.alarm) })),
    limit,
  }));
});

app.get(`${API}/devices/:device_id/battery`, (req, res) => {
  const deviceId = req.params.device_id;
  knownDevice(deviceId);
  const p = getPayload(deviceId);
  return res.json(ok({ device_id: deviceId, battery: (p || {}).battery ?? null }));
});

app.get(`${API}/devices/:device_id/events`, (req, res) => {
  const deviceId = req.params.device_id;
  knownDevice(deviceId);
  const limit = intQuery(req.query.limit, 20, 1, 100, 'limit');
  let offset = intQuery(req.query.offset, 0, 0, Number.MAX_SAFE_INTEGER, 'offset');
  const cursor = req.query.cursor;
  if (cursor !== undefined) {                      // cursor = posisi awal halaman berikutnya (dari next_cursor)
    if (!/^\d+$/.test(String(cursor))) throw bad('cursor: Input should be a valid integer');
    offset = Number(cursor);
  }
  const rows = db.prepare(`SELECT payload, received_at, acknowledged_at FROM events
                           WHERE device_id=? ORDER BY occurred_at DESC LIMIT ? OFFSET ?`)
    .all(deviceId, limit + 1, offset);
  const more = rows.length > limit;
  const items = rows.slice(0, limit).map(r => ({
    ...JSON.parse(r.payload), received_at: r.received_at, acknowledged_at: r.acknowledged_at,
  }));
  return res.json(ok({
    items, limit, offset, next_cursor: more ? String(offset + limit) : null,
  }));
});

app.post(`${API}/devices/:device_id/events/:event_id/acknowledge`, (req, res) => {
  const deviceId = req.params.device_id;
  knownDevice(deviceId);
  const cur = db.prepare(`UPDATE events SET acknowledged_at=COALESCE(acknowledged_at, ?)
                          WHERE event_id=? AND device_id=?`)
    .run(nowIso(), req.params.event_id, deviceId);
  if (cur.changes === 0) throw new ApiError(404, 'Event tidak ditemukan');
  return res.json(ok({ event_id: req.params.event_id, acknowledged: true }));
});

// ---------------------------------------------------------------------------
// Perintah ke perangkat (disimpan di server, diambil perangkat saat polling)
// ---------------------------------------------------------------------------
app.get(`${API}/devices/:device_id/command`, (req, res) => {
  knownDevice(req.params.device_id);
  return res.json(ok(getCommand(req.params.device_id)));
});

app.put(`${API}/devices/:device_id/command`, (req, res) => {
  const deviceId = req.params.device_id;
  knownDevice(deviceId);
  const changes = validateCommandUpdate(bodyObject(req));
  getCommand(deviceId);
  for (const [k, v] of Object.entries(changes)) {
    // k berasal dari daftar COMMAND_KEYS (daftar tetap), aman dipakai sebagai nama kolom.
    db.prepare(`UPDATE device_commands SET ${k}=?, updated_at=? WHERE device_id=?`)
      .run(typeof v === 'boolean' ? (v ? 1 : 0) : v, nowIso(), deviceId);
  }
  return res.json(ok(getCommand(deviceId)));
});

app.post(`${API}/devices/:device_id/alarm/reset`, (req, res) => {
  const deviceId = req.params.device_id;
  knownDevice(deviceId);
  getCommand(deviceId);
  db.prepare('UPDATE device_commands SET alarm_latched=0, updated_at=? WHERE device_id=?')
    .run(nowIso(), deviceId);
  return res.json(ok(getCommand(deviceId)));
});

app.post(`${API}/devices/:device_id/home/current`, (req, res) => {
  const deviceId = req.params.device_id;
  knownDevice(deviceId);
  const r = db.prepare('SELECT last_lat,last_lon FROM status WHERE device_id=?').get(deviceId);
  if (!r || r.last_lat === null) {
    throw new ApiError(409, 'Belum ada posisi GPS yang valid untuk dijadikan titik awal');
  }
  getCommand(deviceId);
  db.prepare('UPDATE device_commands SET home_lat=?, home_lng=?, home_valid=1, updated_at=? WHERE device_id=?')
    .run(r.last_lat, r.last_lon, nowIso(), deviceId);
  return res.json(ok(getCommand(deviceId)));
});

// ---------------------------------------------------------------------------
// Kompatibilitas firmware main_1.cpp: POST /api/telemetry & GET /api/command
// ---------------------------------------------------------------------------
function haversineM(lat1, lon1, lat2, lon2) {
  const toRad = x => x * Math.PI / 180;
  const p1 = toRad(lat1);
  const p2 = toRad(lat2);
  const dp = toRad(lat2 - lat1);
  const dl = toRad(lon2 - lon1);
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 6371000.0 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Payload legacy (JSON datar dari firmware) -> bentuk Bagian 7.2. */
function buildLegacyPayload(deviceId, body, cmd, prev, now, nowMs) {
  const fix = body.gps_fix === true && validCoord(body.lat, body.lng);
  const mag = Math.sqrt(body.mpu_ax ** 2 + body.mpu_ay ** 2 + body.mpu_az ** 2);
  // Pin ADC yang mengambang (pembagi tegangan belum terpasang) membaca nilai acak kecil, dan firmware
  // mengirim 0 V sampai pembacaan baterai pertama. Baterai Li-ion 1S lewat pembagi 2:1 tidak mungkin di bawah ~2 V.
  const measured = body.battery_v >= 2.0;
  const mpuOk = !(body.mpu_ax === 0 && body.mpu_ay === 0 && body.mpu_az === 0); // nol semua = MPU6050 tidak terbaca
  const soc = measured ? Math.max(0, Math.min(100, Math.round((body.battery_v - 3.3) / (4.2 - 3.3) * 100))) : null;

  // Server adalah penentu: jarak dihitung dari titik awal yang tersimpan di server.
  const radius = cmd.geofence_radius_m;
  const dist = fix && cmd.home_valid
    ? haversineM(cmd.home_lat, cmd.home_lng, body.lat, body.lng)
    : null;
  const geo = dist !== null && dist > radius;
  // Alarm dari firmware hanya dipercaya bila server membenarkan (keluar geofence atau ada getaran).
  const alarmOk = body.alarm_active === true && (geo || body.mpu_vibration === true);
  const alarmEff = alarmOk || cmd.alarm_active; // alarm yang sudah terkunci tetap tampil sampai di-reset

  const payload = {
    schema_version: 1,
    device_id: deviceId,
    reported_at: now,
    power: {
      mode: 'ACTIVE', operating_mode: body.mode, last_wake_reason: 'continuous',
      next_heartbeat_due_at: fmt(new Date(nowMs + 10_000)),
    },
    security: {
      state: alarmEff ? 'ALARM' : String(body.mode).toUpperCase(),
      alarm_active: alarmEff,
      geofence_radius_m: radius,
      distance_from_home_m: dist,
      ...(cmd.home_valid ? { home: { latitude: cmd.home_lat, longitude: cmd.home_lng } } : {}),
    },
    gps: {
      fix,
      latitude: fix ? body.lat : null,
      longitude: fix ? body.lng : null,
      speed_kmh: body.speed_kmh,
      satellites: body.satellites,
      updated_at: now,
    },
    motion: {
      available: mpuOk,
      detected: mpuOk ? body.mpu_vibration === true : false,
      acceleration_mps2: mpuOk ? Math.round(Math.abs(mag - 9.81) * 100) / 100 : null,
      updated_at: now,
    },
    battery: {
      voltage_v: measured ? body.battery_v : null,
      soc_percent: soc,
      status: soc === null ? null : (soc < 10 ? 'critical' : soc < 20 ? 'low' : 'normal'),
      charging: null,
      updated_at: now,
    },
    connectivity: {
      wifi_connected: true, api_reachable: true, ble_available: false, last_successful_sync_at: now,
    },
    health: {
      gps: fix ? 'ok' : 'no_fix',
      motion_sensor: mpuOk ? 'ok' : 'fault',
      battery_monitor: measured ? 'ok' : 'unknown',
      event_queue_size: 0,
    },
  };
  return { payload, meta: { fix, geo, alarmOk, mpuOk, measured, soc }, dist };
}

app.post('/api/telemetry', (req, res) => {
  legacyAuth(req);
  const dev = LEGACY_DEVICE_ID;
  knownDevice(dev);
  const body = bodyObject(req);
  const nowMs = Date.now();
  const now = fmt(new Date(nowMs));
  const cmd = getCommand(dev);
  const prev = getPayload(dev) || {};
  const { payload, meta, dist } = buildLegacyPayload(dev, body, cmd, prev, now, nowMs);

  storeTelemetry(dev, payload);

  const loc = meta.fix
    ? { latitude: body.lat, longitude: body.lng, gps_fix: true }
    : { gps_fix: false };
  const batt = meta.measured ? { soc_percent: meta.soc, voltage_v: body.battery_v } : null;
  const newEvents = [];

  if (meta.alarmOk) {
    db.prepare('UPDATE device_commands SET alarm_latched=1, updated_at=? WHERE device_id=?').run(now, dev);
    if (!(prev.security && prev.security.alarm_active)) {      // transisi tidak aktif -> aktif
      const reasons = [];
      if (meta.geo) reasons.push('geofence_exceeded');
      if (body.mpu_vibration === true) reasons.push('motion_detected');
      const ev = addEvent(dev, 'security_alarm', 'high', now,
        reasons.length ? reasons : ['device_reported'], loc, dist, batt);
      if (ev) newEvents.push(ev);
    }
  }
  const prevSoc = prev.battery && prev.battery.soc_percent;
  if (meta.soc !== null && meta.soc < 20 && (prevSoc === null || prevSoc === undefined || prevSoc >= 20)) {
    const ev = addEvent(dev, 'battery_low', 'medium', now, [], loc, dist, batt);
    if (ev) newEvents.push(ev);
  }
  for (const ev of newEvents) notify(ev);
  // Firmware menyimpan balasan ini; bentuknya sama dengan GET /api/command (tanpa pembungkus).
  res.json(getCommand(dev));
});

app.get('/api/command', (req, res) => {
  legacyAuth(req);
  knownDevice(LEGACY_DEVICE_ID);
  // Firmware membaca JSON polos, jadi tanpa {ok,data,error}.
  res.json(getCommand(LEGACY_DEVICE_ID));
});

// ---------------------------------------------------------------------------
// Frontend statis: hanya file/folder pada daftar putih
// ---------------------------------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

/**
 * Cari file frontend yang boleh disajikan. Mengembalikan path absolut, atau null (404).
 * Perlindungan: daftar putih file/folder, tolak path traversal, dan wajib resolusi di dalam WEB_DIR.
 */
function resolveStatic(urlPath) {
  let p = String(urlPath).replace(/^\/+/, '');
  if (!p) p = 'index.html';
  try {
    p = decodeURIComponent(p);
  } catch {
    return null;
  }
  if (p.includes('\\')) return null;
  // Selama css/app.css (hasil build Tailwind frontend utama) belum ada, "/" menampilkan dashboard.html
  if (p === 'index.html'
      && !fs.existsSync(path.join(WEB_DIR, 'css', 'app.css'))
      && fs.existsSync(path.join(WEB_DIR, 'dashboard.html'))) {
    p = 'dashboard.html';
  }
  if (path.isAbsolute(p) || /^[a-zA-Z]:/.test(p)) return null;
  const parts = p.split('/').filter(x => x !== '' && x !== '.');
  if (parts.length === 0 || parts.includes('..')) return null;

  let root;
  try {
    root = fs.realpathSync(WEB_DIR);
  } catch {
    return null;
  }
  let f;
  try {
    f = fs.realpathSync(path.join(root, ...parts)); // gagal (ENOENT) -> tidak ada -> 404
  } catch {
    return null;
  }
  if (parts.length === 1 && STATIC_FILES.has(parts[0])) {
    if (path.dirname(f) !== root) return null;
  } else if (parts.length >= 2 && STATIC_DIRS.has(parts[0])) {
    if (!f.startsWith(path.join(root, parts[0]) + path.sep)) return null;
  } else {
    return null;
  }
  if (!fs.statSync(f).isFile()) return null;
  return { file: f, rel: parts.join('/') };
}

function serveFile(req, res, target) {
  const st = fs.statSync(target.file);
  const etag = `W/"${st.mtimeMs.toString(16)}-${st.size.toString(16)}"`;
  res.setHeader('Content-Type', MIME[path.extname(target.rel).toLowerCase()] || 'application/octet-stream');
  res.setHeader('ETag', etag);
  res.setHeader('Last-Modified', st.mtime.toUTCString());
  if (NO_CACHE_FILES.has(target.rel)) res.setHeader('Cache-Control', 'no-cache');

  const inm = req.headers['if-none-match'];
  const ims = req.headers['if-modified-since'];
  const notModified = (inm && inm.split(',').some(t => t.trim() === etag || t.trim() === '*'))
    || (!inm && ims && Date.parse(ims) >= Math.floor(st.mtimeMs / 1000) * 1000);
  if (notModified) {
    res.status(304).end();
    return;
  }
  res.status(200).setHeader('Content-Length', st.size);
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  fs.createReadStream(target.file).on('error', err => res.destroy(err)).pipe(res);
}

app.use((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return sendEnvelope(res, 404, null, 'Tidak ditemukan');
  }
  const target = resolveStatic(req.path);
  if (!target) return sendEnvelope(res, 404, null, 'Tidak ditemukan');
  return serveFile(req, res, target);
});

// ---------------------------------------------------------------------------
// Penanganan error — semua balasan pakai pembungkus {ok,data,error}
// ---------------------------------------------------------------------------
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err instanceof ApiError) return sendEnvelope(res, err.status, null, err.message, err.headers);
  if (err && err.type === 'entity.parse.failed') {
    return sendEnvelope(res, 400, null, 'Payload tidak valid — body: JSON tidak valid');
  }
  if (err && err.type === 'entity.too.large') {
    return sendEnvelope(res, 413, null, 'Payload terlalu besar');
  }
  if (err instanceof URIError) return sendEnvelope(res, 404, null, 'Tidak ditemukan');
  console.error(err);
  return sendEnvelope(res, 500, null, 'Kesalahan server internal');
});

// ---------------------------------------------------------------------------
// Jalankan
// ---------------------------------------------------------------------------
initDb();

const server = app.listen(PORT, HOST, () => {
  const lan = HOST === '0.0.0.0' ? '0.0.0.0' : HOST;
  console.log(`SMARTGUARD backend (Express + SQLite)`);
  console.log(`  URL      : http://127.0.0.1:${PORT}/   (LAN: http://<ip-komputer>:${PORT}/ dari ${lan})`);
  console.log(`  Database : ${DB_PATH}`);
  console.log(`  Frontend : ${path.resolve(WEB_DIR)}`);
  console.log(`  Perangkat: ${Object.keys(TOKENS).join(', ') || '(tidak ada)'}${LEGACY_KEY ? ' + X-Api-Key' : ''}`);
  console.log(`  Uji      : node test_api.js  |  node test_firmware.js`);
});

server.on('error', err => {
  console.error('Server error:', err.message);
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} sudah dipakai. Jalankan dengan PORT lain, mis. $env:PORT=8001`);
  }
  process.exit(1);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    try {
      db.close();
    } catch { /* sudah tertutup */ }
    process.exit(0);
  });
}
