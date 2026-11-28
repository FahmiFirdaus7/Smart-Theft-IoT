// ============================================================================
// Test integrasi TANPA hardware.
//
// Menjalankan web-testing/server.js sungguhan, lalu mensimulasikan ESP32:
//   - payload telemetri dibuat oleh smartguard_core.h (build C++ asli)
//   - command dari server diparse oleh smartguard_core.h (build C++ asli)
//
// Memakai header X-Device-Id unik, jadi state "default" milik dashboard tidak
// tersentuh. Geofence sementara dihapus lagi di akhir test.
//
// Dijalankan otomatis oleh test/run_tests.ps1, atau manual:
//   $env:SG_TEST_BIN="...\test_core.exe"; node test/integration/run_integration.mjs
// ============================================================================
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");
const serverDir = path.join(repoRoot, "web-testing");
const serverPath = path.join(serverDir, "server.js");
const testBin = process.env.SG_TEST_BIN;
const PORT = 3001;
const BASE = `http://127.0.0.1:${PORT}`;
const DEVICE = `sg-test-${Date.now()}`;

let checks = 0;
let failures = 0;

function check(cond, message, extra) {
  checks++;
  if (cond) {
    console.log(`ok   ${message}`);
  } else {
    failures++;
    console.log(`FAIL ${message}${extra === undefined ? "" : `  -> ${JSON.stringify(extra)}`}`);
  }
}

function checkEqual(actual, expected, message) {
  check(actual === expected, message, { actual, expected });
}

function portFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.once("listening", () => srv.close(() => resolve(true)));
    srv.listen(port, "127.0.0.1");
  });
}

async function waitForServer(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/status`, {
        headers: { "x-device-id": DEVICE },
        signal: AbortSignal.timeout(1000),
      });
      if (res.ok) return true;
    } catch {
      /* belum siap */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function api(method, pathName, body) {
  const res = await fetch(`${BASE}${pathName}`, {
    method,
    headers: {
      "x-device-id": DEVICE,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json, text };
}

function runTestBin(args, stdin) {
  return new Promise((resolve, reject) => {
    const child = spawn(testBin, args, { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`test_core ${args.join(" ")} exit ${code}: ${err || out}`));
        return;
      }
      try {
        resolve(JSON.parse(out.trim()));
      } catch (e) {
        reject(new Error(`output bukan JSON: ${out}\n${e.message}`));
      }
    });
    child.stdin.end(stdin ?? "");
  });
}

async function main() {
  if (!testBin) {
    console.error("SG_TEST_BIN belum diset — jalankan lewat test/run_tests.ps1");
    process.exit(1);
  }

  if (!(await portFree(PORT))) {
    console.log(`SKIP: port ${PORT} sudah dipakai (server/dashboard sedang berjalan).`);
    console.log("      Hentikan server lalu ulangi test integrasi.");
    process.exit(0);
  }

  const server = spawn(process.execPath, [serverPath], {
    cwd: serverDir,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, BACKEND_URL: "" },
  });
  let serverLog = "";
  server.stdout.on("data", (d) => (serverLog += d));
  server.stderr.on("data", (d) => (serverLog += d));

  let geofenceId = null;
  try {
    const ready = await waitForServer();
    if (!ready) throw new Error(`server.js tidak siap.\n${serverLog}`);
    check(true, "server.js berjalan di port 3001");

    // --- Geofence sementara untuk device uji ---
    const gf = await api("POST", "/api/geofences", {
      name: "test-home",
      lat: -7.797,
      lng: 110.37,
      radius_m: 50,
    });
    checkEqual(gf.status, 201, "POST /api/geofences membuat geofence");
    geofenceId = gf.json?.id ?? null;

    // --- Telemetri di dalam geofence: tidak boleh ada alarm ---
    const inside = await runTestBin(["--emit-telemetry", "valid"]);
    check(inside.lat != null && inside.lng != null, "payload GPS valid berisi lat/lng angka");
    const postInside = await api("POST", "/api/telemetry", inside);
    checkEqual(postInside.status, 200, "POST /api/telemetry (di dalam) diterima");
    const cmdInside = await api("GET", "/api/command");
    checkEqual(cmdInside.status, 204, "GET /api/command -> 204 saat aman");

    // --- Telemetri di luar geofence: server harus membuat alarm ---
    const outside = await runTestBin(["--emit-telemetry", "outside"]);
    const postOutside = await api("POST", "/api/telemetry", outside);
    checkEqual(postOutside.status, 200, "POST /api/telemetry (di luar) diterima");
    const cmdAlarm = await api("GET", "/api/command");
    checkEqual(cmdAlarm.status, 200, "GET /api/command -> 200 saat geofence dilanggar");
    checkEqual(cmdAlarm.json?.alarm_active, true, "command berisi alarm_active=true");
    checkEqual(cmdAlarm.json?.reason, "geofence_violated", "reason=geofence_violated");
    check(
      typeof cmdAlarm.json?.distance_m === "number" && cmdAlarm.json.distance_m > 50,
      "distance_m melaporkan jarak > radius",
      cmdAlarm.json,
    );

    // --- Firmware (kode C++ asli) harus bisa memparse command server ---
    const parsedAlarm = await runTestBin(["--parse-command"], JSON.stringify(cmdAlarm.json));
    checkEqual(parsedAlarm.ok, true, "firmware memparse command alarm");
    checkEqual(parsedAlarm.alarm_active, true, "parser firmware: alarm_active=true");
    checkEqual(parsedAlarm.home_updated, false, "parser firmware: HOME tidak ikut berubah");

    // --- Command manual dari dashboard tidak boleh mereset alarm/relay lain ---
    const postCmd = await api("POST", "/api/command", {
      relay1: 1,
      relay2: 1,
      mode: "armed",
      shock_threshold: 12,
    });
    checkEqual(postCmd.status, 200, "POST /api/command diterima");
    const cmdManual = await api("GET", "/api/command");
    checkEqual(cmdManual.status, 200, "GET /api/command -> 200 untuk command manual");
    checkEqual(cmdManual.json?.alarm_active, true, "alarm tetap aktif setelah command parsial");
    checkEqual(cmdManual.json?.relay1, 1, "relay1=1 diteruskan");
    checkEqual(cmdManual.json?.relay2, 1, "relay2=1 diteruskan");

    const parsedManual = await runTestBin(["--parse-command"], JSON.stringify(cmdManual.json));
    checkEqual(parsedManual.ok, true, "firmware memparse command manual");
    checkEqual(parsedManual.mode, "armed", "parser firmware: mode=armed");
    checkEqual(parsedManual.relay1, 1, "parser firmware: relay1=1");
    checkEqual(parsedManual.relay2, 1, "parser firmware: relay2=1");
    checkEqual(parsedManual.alarm_active, true, "parser firmware: alarm tetap aktif");
    checkEqual(parsedManual.shock_threshold, 12, "parser firmware: shock_threshold=12");

    // --- GPS belum fix (lat/lng null) tidak boleh memicu alarm palsu ---
    const nofix = await runTestBin(["--emit-telemetry", "nofix"]);
    checkEqual(nofix.lat, null, "payload tanpa fix: lat=null");
    checkEqual(nofix.lng, null, "payload tanpa fix: lng=null");
    const postNofix = await api("POST", "/api/telemetry", nofix);
    checkEqual(postNofix.status, 200, "POST /api/telemetry tanpa fix diterima");
    const cmdAfterNofix = await api("GET", "/api/command");
    checkEqual(cmdAfterNofix.status, 204, "tanpa fix tidak membuat alarm geofence baru");

    // --- Firmware menolak command rusak ---
    const parsedBroken = await runTestBin(["--parse-command"], "{bukan json}");
    checkEqual(parsedBroken.ok, false, "parser firmware menolak JSON rusak");
  } finally {
    if (geofenceId) {
      await api("DELETE", `/api/geofences/${geofenceId}`).catch(() => {});
    }
    server.kill();
  }

  console.log(`\n${checks} cek, ${failures} gagal`);
  if (failures > 0) {
    console.log("TEST INTEGRASI GAGAL");
    process.exit(1);
  }
  console.log("SEMUA TEST INTEGRASI LULUS");
}

main().catch((err) => {
  console.error("ERROR:", err.message);
  process.exit(1);
});
