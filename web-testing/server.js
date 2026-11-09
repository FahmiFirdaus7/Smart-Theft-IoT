import express from "express";
import cors from "cors";

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json({ limit: "16kb" }));

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

// POST /api/telemetry  <- ESP32 nembak telemetri terus-menerus ke sini
app.post("/api/telemetry", (req, res) => {
  const { lat, lng, ...rest } = req.body;
  const state = req.state;

  // Get client IP (ESP32 IP)
  const clientIp = req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress || 'unknown';

  // Update telemetry
  state.telemetry = {
    ...req.body,
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
    state.command = {
      alarm_active: true,
      reason: "geofence_violated",
      geofence: violated.name || "unknown",
      distance_m: violated.distance_m,
      radius_m: violated.radius_m,
    };
    state.commandAcked = false; // kirim ke ESP pada polling berikutnya
    console.log(`🚨 GEOFENCE VIOLATED [${req.deviceId}]: ${violated.name} (${violated.distance_m}m > ${violated.radius_m}m)`);
  }

  res.json({ ok: true, received_at: state.telemetry.received_at });
});

// GET /api/telemetry  <- dashboard baca telemetri terbaru
app.get("/api/telemetry", (req, res) => {
  if (!req.state.telemetry) {
    return res.status(204).end();
  }
  res.json(req.state.telemetry);
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
app.post("/api/command", (req, res) => {
  req.state.command = req.body;
  req.state.commandAcked = false;
  res.json({ ok: true });
});

// GET /api/status  <- ringkasan untuk dashboard
app.get("/api/status", (req, res) => {
  const t = req.state.telemetry;
  res.json({
    hasTelemetry: !!t,
    lastReceived: t ? t.received_at : null,
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
  console.log(`Endpoints:`);
  console.log(`  POST   /api/telemetry     (ESP32 → Web)`);
  console.log(`  GET    /api/telemetry     (Dashboard ← Web)`);
  console.log(`  GET    /api/command       (ESP32 polling)`);
  console.log(`  POST   /api/command       (Dashboard → Web → ESP)`);
  console.log(`  GET    /api/status        (Ringkasan)`);
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