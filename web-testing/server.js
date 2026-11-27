import express from "express";
import cors from "cors";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json({ limit: "16kb" }));

// ---- Sajikan frontend hasil build (dist/) di port yang sama ----
// Jalankan `npm run serve` -> buka http://localhost:3001  (dashboard)
//                             atau http://localhost:3001/#/debug (halaman Debug)
const distDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "dist");
const hasDist = fs.existsSync(path.join(distDir, "index.html"));
if (hasDist) app.use(express.static(distDir));

// ---- Haversine formula (meter) ----
function haversineM(lat1, lon1, lat2, lon2) {
  const R = 6371000.0; // Earth radius in meters
  const phi1 = lat1 * Math.PI / 180;
  const phi2 = lat2 * Math.PI / 180;
  const dphi = (lat2 - lat1) * Math.PI / 180;
  const dlambda = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dphi / 2) ** 2 +
            Math.cos(phi1) * Math.cos(phi2) *
            Math.sin(dlambda / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// ---- Check if point is inside ANY geofence (OR logic: safe if inside ANY) ----
function checkGeofences(lat, lng, geofences) {
  if (!geofences || geofences.length === 0) return { inside: true, violated: null };
  let anyInside = false;
  for (const gf of geofences) {
    if (!gf.valid) continue;
    const dist = haversineM(lat, lng, gf.lat, gf.lng);
    if (dist <= gf.radius_m) {
      anyInside = true; // inside this geofence = safe
    }
  }
  if (anyInside) {
    return { inside: true, violated: null };
  }
  // Not inside any valid geofence - find the closest one for violation info
  let closest = null;
  let minDist = Infinity;
  for (const gf of geofences) {
    if (!gf.valid) continue;
    const dist = haversineM(lat, lng, gf.lat, gf.lng);
    if (dist < minDist) {
      minDist = dist;
      closest = gf;
    }
  }
  return {
    inside: false,
    violated: closest ? { ...closest, distance_m: Math.round(minDist) } : null
  };
}

// ---- In-memory state (per device_id) ----
const deviceStates = new Map(); // device_id -> { telemetry, command, commandAcked, geofences }

function getState(deviceId) {
  if (!deviceStates.has(deviceId)) {
    deviceStates.set(deviceId, {
      telemetry: null,
      command: null,
      commandAcked: false,
      commandAt: 0, // epoch ms kapan command terakhir dikirim dashboard
      geofences: [] // array of { id, name, lat, lng, radius_m, valid }
    });
  }
  return deviceStates.get(deviceId);
}

// ---- Middleware: extract device_id from header or query ----
function deviceIdMiddleware(req, res, next) {
  // Prioritas: header x-device-id > query device_id > default "default"
  const deviceId = req.headers["x-device-id"] || req.query.device_id || "default";
  req.deviceId = deviceId;
  req.state = getState(deviceId);
  next();
}

app.use(deviceIdMiddleware);

// ============================================================================
// SSE — push perubahan ke dashboard sehingga tombol/UI ikut berubah seketika
// (tanpa menunggu siklus polling 2 detik). Polling tetap ada sebagai cadangan.
// ============================================================================
const sseClients = new Set();

function broadcast(event, data) {
  const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(frame);
    } catch {
      sseClients.delete(res);
    }
  }
}

app.get("/api/events", (req, res) => {
  res.status(200);
  res.set({
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
  res.write("retry: 2000\n\n");

  sseClients.add(res);
  const heartbeat = setInterval(() => {
    try {
      res.write(": ping\n\n");
    } catch {
      /* koneksi sudah mati; dibersihkan lewat event close */
    }
  }, 15000);

  req.on("close", () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  });
});

// ============================================================================
// JEMBATAN KE BACKEND (hanya baca)
// ESP32 yang mengirim ke backend (port 8000) tidak mengirim apa pun ke server ini.
// Supaya dashboard & halaman Debug tetap menampilkan datanya, GET /api/telemetry dan
// GET /api/status ikut membaca status perangkat dari backend.
//   BACKEND_URL    default http://127.0.0.1:8000   (isi "" untuk mematikan jembatan)
//   BACKEND_DEVICE default sg-device-001           (dipakai bila device_id = "default")
// Data dari POST /api/telemetry (simulator) tetap menang selama lebih baru dari data backend.
// ============================================================================
const BACKEND_URL = (process.env.BACKEND_URL ?? "http://127.0.0.1:8000").replace(/\/+$/, "");
const BACKEND_DEVICE = process.env.BACKEND_DEVICE || "sg-device-001";
const bridgeCache = new Map(); // device_id backend -> { at, value }

// Penerusan command ke backend (ESP32 asli akan menerimanya) — MATI secara bawaan.
// Nyalakan dengan `npm run serve:control` (atau BACKEND_COMMANDS=1). Relay 1 = kontak mesin, Relay 2 = alarm.
const FORWARD_COMMANDS = !!BACKEND_URL && (process.argv.includes("--control") || process.env.BACKEND_COMMANDS === "1");
const BACKEND_COMMAND_KEYS = new Set(["relay1", "relay2", "mode", "geofence_radius_m", "shock_threshold", "home_lat", "home_lng", "home_valid"]);
const backendIdFor = (req) => (req.deviceId === "default" ? BACKEND_DEVICE : req.deviceId);

function mapBackendStatus(st, cmd) {
  const r = st.report || {};
  const gps = r.gps || {}, sec = r.security || {}, bat = r.battery || {}, pw = r.power || {}, mo = r.motion || {};
  const fix = gps.fix === true && typeof gps.latitude === "number" && typeof gps.longitude === "number";
  return {
    mode: pw.operating_mode ?? "overwatch",
    lat: fix ? gps.latitude : null,
    lng: fix ? gps.longitude : null,
    ...(fix ? { gps_fix_at: gps.updated_at } : {}),
    speed: gps.speed_kmh ?? 0,
    satellites: gps.satellites ?? 0,
    battery_v: bat.voltage_v ?? null,
    battery_soc: bat.soc_percent ?? null,
    dist_home_m: sec.distance_from_home_m ?? -1,
    geofence_radius_m: sec.geofence_radius_m ?? null,
    alarm_active: sec.alarm_active === true,
    mpu_vibration: mo.detected === true,
    ...(cmd ? { relay1: cmd.relay1, relay2: cmd.relay2 } : {}),
    esp_ip: "via backend",
    source: "backend",
    received_at: st.received_at,
    backend_age_seconds: st.age_seconds,
  };
}

async function fetchBackendTelemetry(deviceId) {
  if (!BACKEND_URL) return null;
  const cached = bridgeCache.get(deviceId);
  if (cached && Date.now() - cached.at < 1000) return cached.value;
  let value = null;
  try {
    const base = `${BACKEND_URL}/api/v1/devices/${encodeURIComponent(deviceId)}`;
    const opt = { signal: AbortSignal.timeout(1500) };
    const [stRes, cmdRes] = await Promise.all([
      fetch(`${base}/status`, opt),
      fetch(`${base}/command`, opt).catch(() => null),
    ]);
    if (stRes.ok) {
      const st = (await stRes.json()).data;
      if (st && st.connection === "online" && st.report) { // offline/never -> dianggap tidak ada data
        const cmd = cmdRes && cmdRes.ok ? (await cmdRes.json()).data : null;
        value = mapBackendStatus(st, cmd);
      }
    }
  } catch {
    // backend mati / timeout / bukan JSON: abaikan, pakai data lokal saja
  }
  bridgeCache.set(deviceId, { at: Date.now(), value });
  return value;
}

// Kunci dari command yang boleh ditampilkan langsung ke dashboard (optimistic)
// sampai ESP32 mengirim telemetri yang sudah mencerminkan command tersebut.
const COMMAND_ECHO_KEYS = ["relay1", "relay2", "mode", "alarm_active", "geofence_radius_m", "shock_threshold"];
// Batas waktu: kalau ESP32 tidak pernah mengonfirmasi, jangan menampilkan state palsu selamanya.
const COMMAND_ECHO_TTL_MS = 20000;

function withPendingCommand(t, state) {
  if (!t || !state.command || !state.commandAt) return t;
  if (Date.now() - state.commandAt > COMMAND_ECHO_TTL_MS) return t;

  const out = { ...t };
  let pending = false;
  for (const key of COMMAND_ECHO_KEYS) {
    if (!(key in state.command)) continue;
    if (out[key] === state.command[key]) continue; // ESP32 sudah mencerminkan nilai ini
    out[key] = state.command[key];
    pending = true;
  }
  if (pending) out.pending_command = true;
  return out;
}

// Telemetri yang ditampilkan: yang paling baru antara data lokal (:3001) dan backend (:8000)
async function effectiveTelemetry(req) {
  const local = req.state.telemetry ? { ...req.state.telemetry, source: "local" } : null;
  const remote = await fetchBackendTelemetry(backendIdFor(req));
  let t;
  if (!remote) t = local;
  else if (!local) t = remote;
  else t = new Date(local.received_at) >= new Date(remote.received_at) ? local : remote;
  return withPendingCommand(t, req.state);
}

// POST /api/telemetry  <- ESP32 nembak telemetri terus-menerus ke sini
app.post("/api/telemetry", (req, res) => {
  const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
  const { lat, lng } = body;
  const state = req.state;

  // Get client IP (ESP32 IP)
  const clientIp = req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress || 'unknown';

  // Update telemetry
  state.telemetry = {
    ...body,
    esp_ip: clientIp,
    received_at: new Date().toISOString(),
  };

  // Geofence check (only if GPS fix valid)
  if (lat != null && lng != null && typeof lat === "number" && typeof lng === "number") {
    const { inside, violated } = checkGeofences(lat, lng, state.geofences);
    state.telemetry.geofence_inside = inside;
    state.telemetry.geofence_violated = violated; // null kalau aman, detail geofence kalau melanggar
  }

  // Auto-generate alarm command if violated
  if (state.telemetry.geofence_inside === false && state.telemetry.geofence_violated) {
    const violated = state.telemetry.geofence_violated;
    // Gabung, jangan timpa: command geofence tidak boleh mereset relay/mode yang sedang aktif.
    state.command = {
      ...state.command,
      alarm_active: true,
      reason: "geofence_violated",
      geofence: violated.name || "unknown",
      distance_m: violated.distance_m,
      radius_m: violated.radius_m,
    };
    state.commandAcked = false; // kirim ke ESP pada polling berikutnya
    state.commandAt = Date.now();
    broadcast("command", { device_id: req.deviceId, command: state.command });
    console.log(`🚨 GEOFENCE VIOLATED [${req.deviceId}]: ${violated.name} (${violated.distance_m}m > ${violated.radius_m}m)`);
  }

  res.json({ ok: true, received_at: state.telemetry.received_at });
  broadcast("telemetry", { device_id: req.deviceId, received_at: state.telemetry.received_at });
});

// GET /api/telemetry  <- dashboard baca telemetri terbaru
app.get("/api/telemetry", async (req, res) => {
  const t = await effectiveTelemetry(req);
  if (!t) {
    return res.status(204).end();
  }
  res.json(t);
});

// GET /api/command  <- ESP32 polling ambil command terbaru
app.get("/api/command", (req, res) => {
  if (!req.state.command || req.state.commandAcked) {
    return res.status(204).end(); // tidak ada command baru
  }
  req.state.commandAcked = true;
  res.json(req.state.command);
});

// POST /api/command  <- dashboard kirim command manual ke ESP32
app.post("/api/command", async (req, res) => {
  const incoming = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};

  // GABUNGKAN dengan command sebelumnya. Command parsial (mis. hanya {relay2: 1})
  // tidak boleh mereset field lain — ESP32 membaca command sebagai state lengkap,
  // jadi mengirim {relay2:1} saja akan mematikan relay1 di perangkat.
  // Body kosong (tanpa Content-Type JSON) diabaikan, jangan membuat command kosong.
  if (Object.keys(incoming).length > 0) {
    req.state.command = { ...req.state.command, ...incoming };
    req.state.commandAcked = false;
    req.state.commandAt = Date.now();
    broadcast("command", { device_id: req.deviceId, command: req.state.command });
  }

  if (!FORWARD_COMMANDS) return res.json({ ok: true, forwarded: false });

  // Teruskan ke backend FastAPI (PUT .../command). Hanya kunci yang dikenal backend; sisanya diabaikan.
  const payload = {};
  const ignored = [];
  for (const [k, v] of Object.entries(incoming)) {
    if (!BACKEND_COMMAND_KEYS.has(k)) ignored.push(k);
    else payload[k] = typeof v === "boolean" && k.startsWith("relay") ? Number(v) : v;
  }
  if (Object.keys(payload).length === 0) {
    return res.status(400).json({ ok: false, forwarded: false, ignored_keys: ignored, error: "Tidak ada kunci yang bisa diteruskan ke backend" });
  }
  const id = backendIdFor(req);
  try {
    const r = await fetch(`${BACKEND_URL}/api/v1/devices/${encodeURIComponent(id)}/command`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(3000),
    });
    const j = await r.json().catch(() => null);
    bridgeCache.delete(id); // tampilan langsung ikut berubah
    if (!r.ok) {
      return res.status(r.status === 400 ? 400 : 502).json({ ok: false, forwarded: false, ignored_keys: ignored, error: j?.error ?? `Backend membalas HTTP ${r.status}` });
    }
    console.log(`➡ COMMAND diteruskan ke backend [${id}]: ${JSON.stringify(payload)}`);
    res.json({ ok: true, forwarded: true, ignored_keys: ignored, backend: j?.data ?? null });
  } catch (e) {
    res.status(502).json({ ok: false, forwarded: false, error: `Backend tidak terjangkau: ${e.message}` });
  }
});

// GET /api/status  <- ringkasan untuk dashboard
app.get("/api/status", async (req, res) => {
  const t = await effectiveTelemetry(req);
  res.json({
    hasTelemetry: !!t,
    lastReceived: t ? t.received_at : null,
    source: t ? t.source : null,
    forwardCommands: FORWARD_COMMANDS,
    geofenceInside: t?.geofence_inside ?? null,
    geofenceCount: req.state.geofences.filter(g => g.valid).length,
  });
});

// ============================================================================
// GEOFENCE MANAGEMENT ENDPOINTS (dashboard bisa CRUD)
// ============================================================================

// GET /api/geofences  <- list semua geofence device
app.get("/api/geofences", (req, res) => {
  res.json(req.state.geofences);
});

// POST /api/geofences  <- tambah geofence baru
app.post("/api/geofences", (req, res) => {
  const { name, lat, lng, radius_m } = req.body;
  if (typeof name !== "string" || typeof lat !== "number" || typeof lng !== "number" || typeof radius_m !== "number") {
    return res.status(400).json({ error: "Field wajib: name(string), lat(number), lng(number), radius_m(number)" });
  }
  const id = `gf_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const geofence = { id, name, lat, lng, radius_m, valid: true };
  req.state.geofences.push(geofence);
  res.status(201).json(geofence);
});

// PATCH /api/geofences/:id  <- update geofence (radius, name, enable/disable)
app.patch("/api/geofences/:id", (req, res) => {
  const idx = req.state.geofences.findIndex(g => g.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Geofence tidak ditemukan" });
  const { name, radius_m, valid } = req.body;
  if (name !== undefined) req.state.geofences[idx].name = name;
  if (radius_m !== undefined) req.state.geofences[idx].radius_m = radius_m;
  if (valid !== undefined) req.state.geofences[idx].valid = valid;
  res.json(req.state.geofences[idx]);
});

// DELETE /api/geofences/:id  <- hapus geofence
app.delete("/api/geofences/:id", (req, res) => {
  const idx = req.state.geofences.findIndex(g => g.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Geofence tidak ditemukan" });
  req.state.geofences.splice(idx, 1);
  res.json({ ok: true });
});

const server = app.listen(PORT, () => {
  console.log(`API web testing berjalan di http://localhost:${PORT}`);
  console.log(BACKEND_URL ? `Jembatan backend: ${BACKEND_URL} (device ${BACKEND_DEVICE})` : `Jembatan backend: nonaktif`);
  console.log(FORWARD_COMMANDS ? `Command     : DITERUSKAN ke backend (relay/mode di ESP32 asli bisa berubah!)` : `Command     : hanya lokal (jalankan npm run serve:control untuk meneruskan ke backend)`);
  console.log(hasDist ? `Frontend  : http://localhost:${PORT}/#/debug` : `Frontend  : belum ada dist/ (jalankan npm run build, atau npm run dev)`);
  console.log(`Endpoints:`);
  console.log(`  POST   /api/telemetry     (ESP32 → Web)`);
  console.log(`  GET    /api/telemetry     (Dashboard ← Web)`);
  console.log(`  GET    /api/command       (ESP32 polling)`);
  console.log(`  POST   /api/command       (Dashboard → Web → ESP)`);
  console.log(`  GET    /api/status        (Ringkasan)`);
  console.log(`  GET    /api/events        (SSE push ke dashboard)`);
  console.log(`  GET    /api/geofences     (List geofence)`);
  console.log(`  POST   /api/geofences     (Tambah geofence)`);
  console.log(`  PATCH  /api/geofences/:id (Update geofence)`);
  console.log(`  DELETE /api/geofences/:id (Hapus geofence)`);
});

server.on('error', (err) => {
  console.error('Server error:', err);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});