# web-testing — Dashboard Uji (React + Vite)

Dashboard **web testing** satu halaman untuk menguji komunikasi
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

## Menjalankan

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
├── start-dev.ps1        # Launcher PowerShell (API + Vite sekaligus)
├── vite.config.ts       # Vite + Tailwind CSS v4
├── src/
│   ├── App.tsx          # Semua widget + fetch ke API
│   └── index.css        # Import Tailwind + gaya Liquid Glass
├── public/  dist/
```

## Endpoint `server.js` (port 3001)

| Endpoint | Method | Pemanggil |
|---|---|---|
| `/api/telemetry` | POST / GET | ESP32 kirim / dashboard baca |
| `/api/command` | GET / GET | ESP32 polling / dashboard kirim |
| `/api/status` | GET | Dashboard |
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
