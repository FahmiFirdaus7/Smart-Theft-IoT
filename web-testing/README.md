# web-testing — Dashboard Uji (React + Vite)

Dashboard **web testing** (3 halaman: Dashboard, Zona, Debug) untuk menguji komunikasi
**ESP32 → Web API → Dashboard → ESP32** tanpa Blynk, dengan desain
**Apple Liquid Glass**. Ada juga mini API server (`server.js`, Express) sebagai
perantara ESP ↔ dashboard.

> Dokumentasi lengkap (desain, endpoint, payload, troubleshooting):
> [`../docs/Web_Testing.md`](../docs/Web_Testing.md)

## Cara kerja komunikasi

1. ESP32 `POST /api/telemetry` (JSON) tiap 3 detik — server cek geofence.
2. Dashboard `GET /api/telemetry` untuk menampilkan data terbaru.
3. Dashboard `POST /api/command` untuk kirim perintah (mode, relay, JSON manual).
4. ESP32 polling `GET /api/command` tiap 3 detik untuk menerima perintah.

## Dua cara menjalankan

### A. Terpasang di web asli (disarankan — satu server)

`server.js` kini juga di-import sebagai sub-app oleh
[`../Web/Backend/server.js`](../Web/Backend/server.js) sehingga **tidak perlu
port 3001 terpisah**. Cukup jalankan backend web asli:

```powershell
cd Web/Backend
npm start        # http://127.0.0.1:8000
```

Lalu buka (route ini **tidak ditautkan** dari dashboard publik):

| Halaman | Alamat |
|---|---|
| Dashboard uji | `http://<ip>:8000/_testing/` |
| Halaman Zona (daftar save zone) | `http://<ip>:8000/_testing/#/zones` |
| Halaman Debug | `http://<ip>:8000/_testing/#/debug` |

- Nama route bisa diganti via env `SMARTGUARD_TESTING_ROUTE`, dimatikan dengan `SMARTGUARD_TESTING=0`.
- Telemetri ESP32 masuk lewat endpoint legacy di root (`POST /api/telemetry`);
  dashboard uji membacanya lewat jembatan, dan command dari dashboard uji
  **diteruskan** ke SQLite supaya ESP32 asli menerimanya
  (nonaktifkan dengan `SMARTGUARD_TESTING_FORWARD=0`).

### B. Standalone (port 3001, untuk pengembangan)

```powershell
cd web-testing
npm install          # sekali saja
.\start-dev.ps1      # API (3001) + Vite (5173) dalam satu terminal
# buka http://localhost:5173
```

Alternatif: `npm run dev:full` (pake `concurrently`), atau dua terminal:
`node server.js` dan `npm run dev`.

## Struktur

```
web-testing/
├── server.js            # Mini API Express (port 3001) — perantara ESP ↔ dashboard
├── dummy-devices.js     # Armada device dummy untuk uji zona tanpa ESP32
├── start-dev.ps1        # Launcher PowerShell (API + Vite sekaligus)
├── vite.config.ts       # Vite + Tailwind CSS v4
├── src/
│   ├── App.tsx          # Router hash + widget Dashboard
│   ├── ZonesPage.tsx    # Halaman Zona Aman (daftar save zone)
│   ├── zones.ts         # Helper zona: Haversine + status OR logic
│   ├── NavTabs.tsx      # Navigasi Dashboard / Zona / Debug
│   └── index.css        # Import Tailwind + gaya Liquid Glass
├── public/  dist/
```

## Halaman Zona Aman

Daftar **home location / save zone** perangkat (`#/zones`): lihat status
"di dalam / di luar" tiap zona secara langsung, tambah/nonaktifkan/hapus zona,
dan isi koordinat dari posisi telemetri terakhir.

- Zona disimpan **per device** (header `x-device-id`) — ganti Device ID di
  halaman Zona untuk melihat zona device lain.
- **Logika OR server-side**: aman bila berada di dalam minimal satu zona
  **aktif**; di luar semua zona aktif → server mengirim `alarm_active: true`.
- Zona baru selalu **aktif otomatis**; kartu "Zona Aman" di Dashboard menampilkan
  ringkas status yang sama.

### Device dummy (uji tanpa ESP32)

`dummy-devices.js` menjalankan armada perangkat palsu — banyak posisi
(lintas zona), GPS tanpa fix, baterai rendah, dan perangkat yang berhenti
mengirim (offline):

```powershell
cd web-testing
npm run dummy                                  # semua skenario, ke :3001
npm run dummy -- --base http://localhost:8000/_testing   # mode terpasang
npm run dummy -- --only moving,outside --duration 30
npm run dummy -- --list                        # daftar skenario
```

Skenario: `default` (moving/banyak posisi), `dummy-inside`, `dummy-outside`
(memicu alarm), `dummy-offline` (berhenti setelah 3 laporan), `dummy-nofix`,
`dummy-lowbat`. Ganti device ID di halaman Zona/Debug untuk melihat tiap skenario.

## Endpoint `server.js`

Mode terpasang: semua endpoint berada di bawah prefix route (`/_testing/api/...`).
Mode standalone (port 3001): tanpa prefix (`/api/...`).

| Endpoint | Method | Pemanggil |
|---|---|---|
| `/api/telemetry` | POST / GET | ESP32 kirim / dashboard baca |
| `/api/command` | GET / GET | ESP32 polling / dashboard kirim |
| `/api/status` | GET | Dashboard |
| `/api/events` | GET | SSE push ke dashboard |
| `/api/geofences` | GET/POST/PATCH/DELETE | CRUD geofence (OR logic, server-side) |

Geofence: device aman bila berada di **dalam salah satu** safe zone; kalau
**luar semua** → `alarm_active: true`. Multi-device via header `x-device-id`.

## Konfigurasi ESP32

Di `hardprogramming/Smart-Guard-Hardprog/src/config.h`:

```c
#define WEB_API_URL "http://192.168.29.29:3001"   // IP komputer, satu WiFi dengan ESP32
```

Bila ingin diakses dari luar LAN, jalankan cloudflared tunnel dan pakai URL
`https://...` tersebut — lihat [`../README.md`](../README.md) §4.

## Catatan

- Data disimpan **di memori** `server.js` — hilang saat restart (uji lokal saja).
- Tanpa autentikasi; untuk penggunaan luas pakai backend resmi
  [`../Web/Backend/`](../Web/Backend/README.md) (SQLite + token).
- Build produksi: `npm run build` → `dist/`.
- Stack: Vite + React + TypeScript + Tailwind CSS v4.
