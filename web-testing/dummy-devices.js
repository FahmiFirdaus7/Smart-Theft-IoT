#!/usr/bin/env node
/**
 * dummy-devices.js — armada device dummy untuk pengujian fitur Zona Aman
 * (dan dashboard lainnya) tanpa ESP32 sungguhan.
 *
 * Setiap skenario = satu device_id terpisah (header x-device-id), jadi Anda bisa
 * berpindah device di halaman Zona/Debug untuk melihat masing-masing kondisi.
 *
 * Pakai:
 *   node dummy-devices.js                      # semua skenario, jalan terus (Ctrl+C berhenti)
 *   node dummy-devices.js --once               # kirim satu putaran lalu keluar
 *   node dummy-devices.js --duration 30        # berhenti otomatis setelah 30 detik
 *   node dummy-devices.js --only moving,outside
 *   node dummy-devices.js --base http://localhost:8000/_testing
 *   node dummy-devices.js --list               # tampilkan daftar skenario
 *
 * Opsi:
 *   --base <url>      Basis API (default http://localhost:3001)
 *   --interval <ms>   Jeda kirim antar putaran (default 3000)
 *   --duration <detik> Berhenti otomatis setelah N detik (default: tanpa batas)
 *   --only <a,b>      Jalankan skenario tertentu saja
 *   --device <id>     Device id untuk skenario "moving" (default "default",
 *                     supaya tampil juga di halaman Dashboard)
 *   --no-seed         Jangan membuat geofence otomatis bila device belum punya zona
 *   --once            Kirim satu putaran lalu keluar
 *   --list            Tampilkan skenario lalu keluar
 *
 * Catatan:
 *   - Data disimpan di memori server (web-testing/server.js) — hilang saat restart.
 *   - Skenario "moving" mengirim posisi berbeda tiap putaran (lintas zona) sehingga
 *     cocok untuk menguji daftar zona dengan banyak posisi.
 *   - Skenario "offline" berhenti mengirim setelah beberapa laporan — dipakai untuk
 *     menguji tampilan umur data / perangkat berhenti mengirim.
 *   - Skenario "moving" ikut polling GET /api/command seperti ESP32 asli, sehingga
 *     alarm hasil pelanggaran geofence ikut tampil di dashboard.
 */
import { parseArgs } from 'node:util'

// ---------------------------------------------------------------------------
// Zona contoh (sama dengan test-server.ps1): rumah r30 m, kantor r50 m.
// Jarak pusatnya ±390 m — titik di antaranya berada DI LUAR kedua zona.
// ---------------------------------------------------------------------------
const ZONES = [
  { name: 'rumah', lat: -7.7915, lng: 110.3268, radius_m: 30 },
  { name: 'kantor', lat: -7.79, lng: 110.33, radius_m: 50 },
]

/** Jarak Haversine (meter) — rumus sama dengan server. */
function haversineM(lat1, lng1, lat2, lng2) {
  const R = 6371000
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/** Status posisi terhadap daftar zona (logika OR, sama dengan server). */
function zoneStatus(lat, lng, zones) {
  const active = zones.filter((z) => z.valid !== false)
  if (lat == null || lng == null) return { inside: null, label: 'tanpa posisi' }
  if (active.length === 0) return { inside: true, label: 'tanpa zona (dianggap aman)' }
  const inside = active.find((z) => haversineM(lat, lng, z.lat, z.lng) <= z.radius_m)
  if (inside) return { inside: true, label: `di dalam "${inside.name}"` }
  let nearest = null
  let min = Infinity
  for (const z of active) {
    const d = haversineM(lat, lng, z.lat, z.lng)
    if (d < min) { min = d; nearest = z }
  }
  return { inside: false, label: `di luar semua zona (terdekat ${nearest.name} ${Math.round(min)} m)` }
}

/** Jarak ke zona pertama ("home") + radiusnya — untuk field dist_home_m. */
function homeDist(lat, lng, zones) {
  if (lat == null || lng == null || zones.length === 0) return { dist: -1, radius: 30 }
  const h = zones[0]
  return { dist: Math.round(haversineM(lat, lng, h.lat, h.lng)), radius: h.radius_m }
}

function jitter(v, amp = 0.00001) {
  // ±±1 m agar posisi terlihat seperti GPS asli (bukan titik beku sempurna)
  return v + (Math.random() * 2 - 1) * amp
}

// ---------------------------------------------------------------------------
// Skenario — tiap skenario punya device_id sendiri
// ---------------------------------------------------------------------------
function buildScenarios(mainDevice) {
  // Jalur "moving": rumah → di antara (luar) → kantor (dalam) → luar → kembali.
  // Titik antar-waypoint diinterpolasi sehingga menghasilkan banyak posisi.
  const path = [
    [-7.7915, 110.3268],   // pusat rumah — DI DALAM
    [-7.79075, 110.3284],  // di antara kedua zona — DI LUAR
    [-7.79, 110.33],       // pusat kantor — DI DALAM
    [-7.788, 110.335],     // timur laut — DI LUAR
    [-7.7915, 110.3268],   // kembali ke rumah
  ]
  const STEPS_PER_SEG = 5 // 4 segmen × 5 = 20 posisi per putaran

  return [
    {
      id: mainDevice,
      name: 'moving (banyak posisi, lintas zona)',
      intervalScale: 1,
      state: { leg: 0, step: 0, mode: 'armed', alarm: false, relay1: 0, relay2: 0, pollCommand: true },
      next() {
        const from = path[this.state.leg]
        const to = path[(this.state.leg + 1) % path.length]
        const t = this.state.step / STEPS_PER_SEG
        const lat = jitter(from[0] + (to[0] - from[0]) * t)
        const lng = jitter(from[1] + (to[1] - from[1]) * t)
        this.state.step += 1
        if (this.state.step > STEPS_PER_SEG) {
          this.state.step = 0
          this.state.leg = (this.state.leg + 1) % path.length
        }
        return { lat, lng, gps_fix: true, speed: 15, mode: this.state.mode, alarm_active: this.state.alarm, relay1: this.state.relay1, relay2: this.state.relay2, battery_v: 3.9 }
      },
    },
    {
      id: 'dummy-inside',
      name: 'inside (diam di dalam zona rumah, standar samping)',
      state: { mode: 'armed', alarm: false },
      next() {
        // Miring standar samping: roll ≈ -30° (uji profil posisi aman)
        return { lat: jitter(ZONES[0].lat), lng: jitter(ZONES[0].lng), gps_fix: true, speed: 0, mode: this.state.mode, alarm_active: false, relay1: 0, relay2: 0, battery_v: 3.95, mpu_ax: 0, mpu_ay: -4.9, mpu_az: 8.49 }
      },
    },
    {
      id: 'dummy-outside',
      name: 'outside (diam di luar semua zona — memicu alarm)',
      state: { mode: 'armed', alarm: false, pollCommand: true },
      next() {
        // ±1.6 km dari rumah, jauh dari kedua zona
        return { lat: jitter(-7.785, 0.00002), lng: jitter(110.34, 0.00002), gps_fix: true, speed: 0, mode: this.state.mode, alarm_active: this.state.alarm, relay1: this.state.relay1, relay2: this.state.relay2, battery_v: 3.88 }
      },
    },
    {
      id: 'dummy-offline',
      name: 'offline (kirim 3 laporan lalu berhenti)',
      state: { sent: 0, mode: 'armed' },
      maxPosts: 3,
      next() {
        this.state.sent += 1
        return { lat: jitter(ZONES[0].lat), lng: jitter(ZONES[0].lng), gps_fix: true, speed: 0, mode: this.state.mode, alarm_active: false, relay1: 0, relay2: 0, battery_v: 3.92 }
      },
    },
    {
      id: 'dummy-nofix',
      name: 'nofix (GPS tanpa lock — lat/lng null)',
      state: { mode: 'powersafe' },
      next() {
        return { lat: null, lng: null, gps_fix: false, speed: 0, satellites: 0, mode: this.state.mode, alarm_active: false, relay1: 0, relay2: 0, battery_v: 3.7 }
      },
    },
    {
      id: 'dummy-lowbat',
      name: 'lowbat (baterai rendah 3.4 V, di dalam zona)',
      state: { mode: 'armed' },
      next() {
        return { lat: jitter(ZONES[0].lat), lng: jitter(ZONES[0].lng), gps_fix: true, speed: 0, mode: this.state.mode, alarm_active: false, relay1: 0, relay2: 0, battery_v: 3.4 }
      },
    },
  ]
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------
function makeClient(base) {
  const root = base.replace(/\/+$/, '')
  return async function req(method, path, { device, body } = {}) {
    const headers = {}
    if (device) headers['x-device-id'] = device
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    const res = await fetch(root + path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(4000),
    })
    const text = await res.text()
    let json = null
    try { json = text ? JSON.parse(text) : null } catch { /* balasan bukan JSON */ }
    return { status: res.status, json }
  }
}

/** Buat geofence bila device belum punya zona sama sekali (idempoten). */
async function seedZones(req, device) {
  const list = await req('GET', '/api/geofences', { device })
  if (list.status !== 200 || !Array.isArray(list.json) || list.json.length > 0) return 0
  let created = 0
  for (const z of ZONES) {
    const r = await req('POST', '/api/geofences', { device, body: z })
    if (r.status === 201) created += 1
  }
  return created
}

/** Bangun payload telemetri flat (format firmware, lihat docs/Web_Testing.md §7). */
function buildPayload(pos, zones, sentAt) {
  const { dist, radius } = homeDist(pos.lat, pos.lng, zones)
  return {
    mode: pos.mode ?? 'armed',
    gps_fix: pos.gps_fix !== false,
    lat: pos.lat,
    lng: pos.lng,
    altitude: pos.gps_fix === false ? undefined : 120,
    speed: pos.speed ?? 0,
    speed_kmh: pos.speed ?? 0,
    satellites: pos.gps_fix === false ? 0 : (pos.satellites ?? 8),
    hdop: pos.gps_fix === false ? undefined : 1.2,
    mpu_ax: pos.mpu_ax ?? 0.08,
    mpu_ay: pos.mpu_ay ?? -0.05,
    mpu_az: pos.mpu_az ?? 9.81,
    mpu_vibration: pos.mpu_vibration ?? false,
    battery_v: pos.battery_v ?? 3.9,
    relay1: pos.relay1 ?? 0,
    relay2: pos.relay2 ?? 0,
    alarm_active: pos.alarm_active === true,
    geofence_radius_m: radius,
    dist_home_m: dist,
    gps_fix_at: pos.gps_fix === false ? undefined : sentAt,
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const { values: opt } = parseArgs({
  options: {
    base: { type: 'string', default: 'http://localhost:3001' },
    interval: { type: 'string', default: '3000' },
    duration: { type: 'string' },
    only: { type: 'string' },
    device: { type: 'string', default: 'default' },
    'no-seed': { type: 'boolean', default: false },
    once: { type: 'boolean', default: false },
    list: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
})

const intervalMs = Math.max(500, Number(opt.interval) || 3000)
const all = buildScenarios(opt.device)

if (opt.help || opt.list) {
  console.log('Skenario device dummy:')
  for (const s of all) console.log(`  ${s.id.padEnd(16)} ${s.name}`)
  console.log('\nJalankan: node dummy-devices.js [--base URL] [--only id,...] [--once] [--duration detik]')
  process.exit(0)
}

const wanted = opt.only
  ? new Set(opt.only.split(',').map((s) => s.trim()).filter(Boolean))
  : null
const fleet = all.filter((s) => !wanted || wanted.has(s.id) || wanted.has(s.name.split(' ')[0]))

if (fleet.length === 0) {
  console.error(`Tidak ada skenario cocok dengan --only ${opt.only}. Pakai --list untuk melihat daftar.`)
  process.exit(1)
}

const req = makeClient(opt.base)
const stopped = new Set()
let rounds = 0

console.log(`Device dummy → ${opt.base.replace(/\/+$/, '')} (interval ${intervalMs} ms)`)
if (!opt['no-seed']) console.log('Zona contoh:', ZONES.map((z) => `${z.name} r${z.radius_m}m`).join(', '))

/** Poll command seperti ESP32 asli; terapkan alarm/mode/relay ke laporan berikutnya. */
async function pollCommand(sc) {
  if (!sc.state.pollCommand) return
  const r = await req('GET', '/api/command', { device: sc.id })
  if (r.status === 200 && r.json) {
    const c = r.json
    let changed = ''
    if (typeof c.alarm_active === 'boolean' && c.alarm_active !== sc.state.alarm) {
      sc.state.alarm = c.alarm_active
      changed += ` alarm_active=${c.alarm_active}`
    }
    if (typeof c.mode === 'string' && c.mode !== sc.state.mode) {
      sc.state.mode = c.mode
      changed += ` mode=${c.mode}`
    }
    if (typeof c.relay1 === 'number') sc.state.relay1 = c.relay1
    if (typeof c.relay2 === 'number') sc.state.relay2 = c.relay2
    if (changed) console.log(`  [${sc.id}] command diterima:${changed}`)
  }
}

async function round() {
  rounds += 1
  for (const sc of fleet) {
    if (stopped.has(sc.id)) continue

    // Skenario offline: berhenti setelah maxPosts laporan
    if (sc.maxPosts && sc.state.sent >= sc.maxPosts) {
      stopped.add(sc.id)
      console.log(`  [${sc.id}] BERHENTI mengirim (simulasi offline) setelah ${sc.state.sent} laporan`)
      continue
    }

    const pos = sc.next()
    const sentAt = new Date().toISOString()
    const payload = buildPayload(pos, ZONES, sentAt)

    try {
      const r = await req('POST', '/api/telemetry', { device: sc.id, body: payload })
      if (r.status !== 200) {
        console.log(`  [${sc.id}] POST /api/telemetry -> HTTP ${r.status}`)
        continue
      }
      const st = zoneStatus(pos.lat, pos.lng, ZONES)
      const alarm = pos.alarm_active ? ' ALARM' : ''
      const where = pos.gps_fix === false ? 'tanpa GPS fix' : `${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)} (${st.label})`
      console.log(`  [${sc.id}] #${rounds} ${where}${alarm} · baterai ${pos.battery_v} V`)

      // Ambil balasan server: status geofence perangkat ini
      const t = await req('GET', '/api/telemetry', { device: sc.id })
      if (t.status === 200 && t.json && typeof t.json.geofence_inside === 'boolean') {
        const mark = t.json.geofence_inside ? '✓' : '✗'
        console.log(`      server: geofence_inside=${t.json.geofence_inside} ${mark}` +
          (t.json.geofence_violated ? ` (melanggar "${t.json.geofence_violated.name}")` : ''))
      }

      if (sc.state.pollCommand) await pollCommand(sc)
    } catch (e) {
      stopped.add(sc.id)
      console.log(`  [${sc.id}] GAGAL: ${e.message} — skenario dihentikan.`)
    }

    if (stopped.size === fleet.length) break
  }

  // Semua skenario selesai (mis. --once atau semua offline) -> keluar
  if (opt.once || stopped.size === fleet.length) {
    console.log(opt.once ? 'Selesai (satu putaran).' : 'Semua skenario selesai.')
    process.exit(0)
  }
}

// ---------------------------------------------------------------------------
// Jalankan
// ---------------------------------------------------------------------------
async function main() {
  // Cek server hidup dulu
  try {
    const ping = await req('GET', '/api/status')
    if (ping.status !== 200) throw new Error(`HTTP ${ping.status}`)
  } catch (e) {
    console.error(`Server tidak terjangkau di ${opt.base}: ${e.message}`)
    console.error('Jalankan dulu: node server.js (port 3001) atau npm start di Web/Backend (port 8000).')
    process.exit(1)
  }

  if (!opt['no-seed']) {
    for (const sc of fleet) {
      try {
        const n = await seedZones(req, sc.id)
        if (n > 0) console.log(`  [${sc.id}] ${n} zona contoh dibuat (otomatis aktif)`)
      } catch { /* biarkan */ }
    }
  }

  await round()
  if (opt.once) return

  const timer = setInterval(round, intervalMs)
  let deadline = null
  if (opt.duration) {
    deadline = setTimeout(() => {
      console.log(`Durasi ${opt.duration} detik habis — berhenti.`)
      process.exit(0)
    }, (Number(opt.duration) || 0) * 1000)
  }

  const bye = () => {
    clearInterval(timer)
    if (deadline) clearTimeout(deadline)
    console.log('\nBerhenti.')
    process.exit(0)
  }
  process.on('SIGINT', bye)
  process.on('SIGTERM', bye)
}

main()
