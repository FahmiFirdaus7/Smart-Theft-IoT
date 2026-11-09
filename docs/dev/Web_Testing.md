# Web Testing — Dashboard Liquid Glass SMARTGUARD

Dashboard satu halaman (single page) untuk menguji komunikasi **ESP32 → Web API → Dashboard → ESP32** tanpa Blynk. Arsitektur:

1. **ESP32** terus-menerus `POST` telemetri JSON ke web API (`/api/telemetry`).
2. **Dashboard (React)** baca telemetri terbaru dari API (`GET /api/telemetry`) dan tampilkan di semua widget.
3. **Dashboard** kirim command ke ESP32 melalui API (`POST /api/command`).
4. **ESP32** polling `GET /api/command` untuk terima command terbaru dari dashboard.

Dibuat dengan **Vite + React + TypeScript + Tailwind CSS v4**, desain **Apple Liquid Glass** (biru-biruan, frosted/liquid glass dengan blur tinggi, saturasi tinggi, inner highlight, layered shadow). Ada juga mini API server (`server.js`, Express) sebagai perantara ESP ↔ dashboard.

Lokasi proyek: `web-testing/` (di dalam root repo `Smart-Theft-IoT`).

---

## 1. Desain & Color Palette

| Token | Nilai | Keterangan |
|-------|-------|------------|
| `--color-brand` | `#0ea5e9` | Sky 500 — brand utama (biru cerah) |
| `--color-brand-deep` | `#0284c7` | Sky 600 — hover/active |
| `--color-brand-soft` | `rgba(14,165,233,0.10)` | Background subtle |
| Background | `radial-gradient` biru-cyan | 3-layer gradient tipis `#eef8ff` base |
| Glass `.glass` | `backdrop-filter: blur(40px) saturate(190%)` | Apple Liquid Glass style |
| Glass `.glass-dark` | `backdrop-filter: blur(36px) saturate(180%)` | Untuk terminal/code |
| Glass `.glass-thin` | `backdrop-filter: blur(28px) saturate(170%)` | Card ringan |
| Specular highlight | `::before` radial + linear gradient | "Catch-light" efek cair |

**Ciri khas Liquid Glass:**
- Blur **40px** (bukan 20px biasa)
- Saturate **190%+** untuk warna tetap jernih di balik kaca
- Border putih semi-transparan (`rgba(255,255,255,0.65)`)
- Inner highlight (`inset` border + gradient) meniru pantulan cahaya atas kaca
- Layered shadow: ambient + depth + specular

---

## 2. Isi halaman (satu page)

Kolom kiri:
- **Dummy JSON** — menampilkan telemetri JSON mentah terbaru yang diterima dari ESP32 lewat API.
- **Input to Device** — kotak input JSON + tombol kirim perintah ke ESP32 (`POST /api/command`).

Kolom kanan:
- **Home Distance** — jarak dari HOME (meter), dari `dist_home_m`.
- **Battery Voltage** — tegangan baterai (Volt), dari `battery_v`.
- **LED Hijau** — menyala saat mode `armed` atau `overwatch`.
- **LED Merah** — menyala saat `alarm_active = true`.
- **GPS Status** — online/offline (data masih masuk dari ESP lewat API).
- **Tlakson** — status `relay2` (blink).
- **Kontak to Machine** — status `relay1`.
- **Device State** — mode operasional (`armed` / `overwatch` / `powersafe`).

---

## 3. Struktur folder `web-testing/`

```
web-testing/
├── index.html
├── package.json
├── package-lock.json
├── vite.config.ts            # Vite + Tailwind CSS v4 plugin
├── tsconfig*.json
├── server.js                 # Mini API Express (perantara ESP ↔ dashboard)
├── start-dev.ps1             # PowerShell launcher (API + Vite sekaligus)
├── public/
│   ├── favicon.svg
│   └── icons.svg
├── src/
│   ├── main.tsx              # React entry point
│   ├── index.css             # Tailwind import + Liquid Glass styles
│   └── App.tsx               # Semua widget + fetch ke API server
├── dist/                     # Hasil build produksi
└── node_modules/
```

---

## 4. Prasyarat

| Alat | Versi yang terpasang di mesin ini |
|------|-----------------------------------|
| Node.js | v24.18.0 |
| npm | 11.17.0 |
| PowerShell | 5.1+ / 7+ (untuk `start-dev.ps1`) |

Install dependency (termasuk Express + CORS + concurrently):

```bash
cd web-testing
npm install
```

---

## 5. Menjalankan (Pilih salah satu)

### Opsi A — PowerShell Script (Recommended, satu terminal)

```powershell
cd web-testing
.\start-dev.ps1
```

Script ini akan:
- Cek & bersihkan port 3001 & 5173
- Install dependencies jika perlu
- Jalankan **API Server** (port 3001) + **Vite Dev Server** (port 5173) via background jobs
- Tampilkan URL endpoint & dashboard
- Tekan `Ctrl+C` untuk hentikan keduanya bersamaan

### Opsi B — npm script (cross-platform)

```bash
cd web-testing
npm run dev:full
```

Menggunakan `concurrently` untuk jalanin `node server.js` dan `vite` paralel.

### Opsi C — Manual (dua terminal)

**Terminal A — API Server:**
```bash
cd web-testing
node server.js
```

**Terminal B — Dashboard React:**
```bash
cd web-testing
npm run dev
```

---

## 6. API Endpoint (`server.js`)

Server berjalan di `http://localhost:3001`.

### Core Endpoint (ESP ↔ Dashboard)

| Endpoint | Method | Siapa pemanggil | Fungsi |
|----------|--------|-----------------|--------|
| `/api/telemetry` | `POST` | ESP32 | Kirim telemetri JSON (auto cek geofence) |
| `/api/telemetry` | `GET` | Dashboard | Baca telemetri terbaru + `geofence_inside` |
| `/api/command` | `GET` | ESP32 | Polling terima command/alarm (204 kalau tidak ada baru) |
| `/api/command` | `POST` | Dashboard | Kirim command manual ke ESP |
| `/api/status` | `GET` | Dashboard | Ringkasan koneksi + status geofence |

### Geofence Management (Dashboard CRUD)

| Endpoint | Method | Fungsi |
|----------|--------|--------|
| `/api/geofences` | `GET` | List semua geofence device |
| `/api/geofences` | `POST` | Tambah geofence baru `{name, lat, lng, radius_m}` |
| `/api/geofences/:id` | `PATCH` | Update geofence (radius, name, enable/disable) |
| `/api/geofences/:id` | `DELETE` | Hapus geofence |

### Logika Geofence (Server-side)

- **OR logic**: Device aman kalau berada di **DALAM SATU** geofence manapun (safe zone)
- **Alarm trigger**: Kalau device **LUAR SEMUA** geofence valid → server otomatis set `alarm_active: true` di command berikutnya
- **Response telemetry**: Field `geofence_inside` (bool) + `geofence_violated` (detail geofence terdekat kalau violated)
- **Alarm command**: `{alarm_active: true, reason: "geofence_violated", geofence: "nama", distance_m, radius_m}`

### Device Isolation

Semua endpoint pakai header `x-device-id` (atau query `device_id`) untuk multi-device support. Default: `"default"`.

---

## 7. Konfigurasi ESP32 (`config.h`)

Di `hardprogramming/Smart-Guard-Hardprog/src/config.h`, atur `WEB_API_URL` ke IP komputer yang menjalankan `server.js`:

```c
#define WEB_API_URL "http://192.168.29.29:3001"
```

Ganti `192.168.29.29` dengan IP LAN komputer tempat `server.js` berjalan (lihat `ipconfig` / `Get-NetIPAddress`). Pastikan ESP32 dan komputer **satu jaringan WiFi** (subnet sama).

`config.h` sudah di-gitignore — jangan commit ke repo. Salin dari `config.h.example` sebagai template.

Contoh payload yang dikirim ESP32 ke `/api/telemetry`:

```json
{
  "mode": "armed",
  "gps_fix": true,
  "lat": -7.7971,
  "lng": 110.3702,
  "speed_kmh": 0.2,
  "satellites": 8,
  "mpu_ax": -3.945644,
  "mpu_ay": 0.1234,
  "mpu_az": 9.81,
  "mpu_vibration": false,
  "battery_v": 3.91,
  "relay1": 0,
  "relay2": 0,
  "alarm_active": false,
  "geofence_radius_m": 30,
  "dist_home_m": 4.8
}
```

Contoh command yang dashboard kirim ke `/api/command` (diterima ESP via polling):

```json
{
  "relay1": 1,
  "relay2": 0,
  "mode": "overwatch"
}
```

---

## 8. Urutan kerja pengujian

1. Upload `main.cpp` (versi HTTP client, `SEND_TO_BLYNK 0`) ke ESP32.
2. Buka Serial Monitor (baud 115200), pastikan WiFi terhubung & dapat IP subnet sama dengan komputer.
3. Jalankan **Opsi A** (`.\start-dev.ps1`) atau **Opsi B** (`npm run dev:full`) di `web-testing/`.
4. Buka `http://localhost:5173`. Dalam beberapa detik, data telemetri dari ESP32 akan muncul.
5. Coba ubah mode / nyalakan relay via kolom kanan dashboard, atau kirim JSON manual di "Input to Device". Perintah akan terkirim ke `/api/command` dan diterima ESP32 pada polling berikutnya (lihat Serial Monitor: "Command dari web diterima").

---

## 9. Build produksi

```bash
cd web-testing
npm run build
```

Hasil ada di `dist/`. Untuk produksi, `server.js` perlu di-hosting bersama atau diganti dengan backend asli (lihat `docs/SMARTGUARD_Web_Development_Contract.md`).

---

## 10. Troubleshooting

| Gejala | Kemungkinan penyebab | Solusi |
|--------|----------------------|--------|
| Dashboard tidak menampilkan data | `server.js` belum berjalan / ESP belum POST | Jalankan `.\start-dev.ps1` atau `npm run dev:full`, pastikan ESP32 nyala dan terhubung WiFi |
| `ERR_CONNECTION_REFUSED` localhost:5173 | Dev server belum nyala | Pastikan `npm run dev` / `dev:full` jalan |
| ESP `connection refused` | Port 3001 tidak listening / IP salah | Cek `Get-NetTCPConnection -LocalPort 3001`, pastikan `WEB_API_URL` benar |
| ESP tidak terima command | IP `WEB_API_URL` salah / port 3001 diblokir firewall | Periksa IP komputer, buka port 3001 di firewall (`New-NetFirewallRule ...`) |
| Build error TypeScript | `node_modules` tidak lengkap | `npm install` ulang, lalu `npm run build` |
| PowerShell script error | ExecutionPolicy terbatas | Jalankan `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass` dulu |

---

## 11. Catatan

- Data disimpan **di memori** `server.js`; hilang saat server restart. Cocok untuk pengujian lokal saja.
- Tanpa autentikasi (lokal testing). Untuk jaringan luas, tambahkan token/auth di `server.js` dan header `Authorization` pada fetch di `App.tsx`.
- Desain mengikuti **Apple Liquid Glass** — blur tinggi, saturasi tinggi, inner highlight, layered shadow. Bisa dikustomisasi via `@theme` di `src/index.css`.
- Ini adalah dashboard **web testing**, bukan aplikasi produksi final. Untuk arsitektur web resmi, lihat `docs/SMARTGUARD_Web_Development_Contract.md`.