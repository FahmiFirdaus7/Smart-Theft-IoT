# Web Testing — Dashboard Liquid Glass SMARTGUARD

Dashboard **React** untuk menguji komunikasi **ESP32 → Web API → Dashboard → ESP32** tanpa Blynk. Arsitektur:

1. **ESP32** terus-menerus `POST` telemetri JSON ke web API (`/api/telemetry`).
2. **Dashboard (React)** baca telemetri terbaru dari API (`GET /api/telemetry`) dan tampilkan di semua widget.
3. **Dashboard** kirim command ke ESP32 melalui API (`POST /api/command`).
4. **ESP32** polling `GET /api/command` untuk terima command terbaru dari dashboard.

Dibuat dengan **Vite + React + TypeScript + Tailwind CSS v4**, desain **Apple Liquid Glass** (biru-biruan, frosted/liquid glass dengan blur tinggi, saturasi tinggi, inner highlight, layered shadow). Ada juga mini API server (`server.js`, Express) sebagai perantara ESP ↔ dashboard.

Dashboard punya **4 halaman** (navigasi tab di atas, routing lewat URL hash):

| Halaman | Hash | Isi |
|---|---|---|
| Dashboard | `#/` | Panel **Posisi Kendaraan** (avatar 3D + waterpass pitch/roll), widget telemetri, LED, relay, kartu **Zona Aman** |
| **Zona** | `#/zones` | **Daftar home location / save zone**: status di dalam/luar per zona, tambah/nonaktif/hapus |
| **Posisi** | `#/pose` | **Profil orientasi aman (pitch/roll)**: avatar 3D live, kalibrasi dari posisi sekarang, tambah/nonaktif/hapus |
| Debug | `#/debug` | Simulator ESP32, command manual, CRUD geofence, log request |

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

## 2. Isi halaman

Dashboard punya **4 halaman** (tab navigasi di atas, routing lewat URL hash):

| Halaman | Hash | Isi |
|---|---|---|
| Dashboard | `#/` | Panel **Posisi Kendaraan** (avatar 3D + waterpass pitch/roll), widget telemetri, LED, relay, kartu **Zona Aman** |
| **Zona** | `#/zones` | **Daftar home location / save zone**: status di dalam/luar per zona, tambah/nonaktif/hapus |
| **Posisi** | `#/pose` | **Profil orientasi aman (pitch/roll)**: avatar 3D live, kalibrasi dari posisi sekarang, tambah/nonaktif/hapus |
| Debug | `#/debug` | Simulator ESP32, command manual, CRUD geofence, log request |

### Halaman Dashboard (`#/`)

Kolom kiri:
- **Dummy JSON** — menampilkan telemetri JSON mentah terbaru yang diterima dari ESP32 lewat API.
- **Input to Device** — kotak input JSON + tombol kirim perintah ke ESP32 (`POST /api/command`).

Kolom kanan:
- **Home Distance** — jarak dari HOME (meter), dari `dist_home_m`.
- **Battery Voltage** — tegangan baterai (Volt), dari `battery_v`.
- **Posisi Kendaraan (MPU)** — avatar 3D motor yang memproyeksikan orientasi live (`mpu_pitch` / `mpu_roll`) dari MPU6050; bergoyang kecil saat `mpu_vibration` aktif.
- **Zona Aman** — ringkas status geofence: `Aman — di dalam zona "…"` / `DI LUAR semua zona aktif` + tautan ke halaman Zona.
- **Posisi Aman** — ringkas status orientasi: `Sesuai` / `Mencurigakan` + tautan ke halaman Posisi.
- **LED Hijau** — menyala saat mode `armed` atau `overwatch`.
- **LED Merah** — menyala saat `alarm_active = true`.
- **GPS Status** — online/offline (data masih masuk dari ESP lewat API).
- **Tlakson** — status `relay2` (blink).
- **Kontak to Machine** — status `relay1`.
- **Device State** — mode operasional (`armed` / `overwatch` / `powersafe`).

### Halaman Zona (`#/zones`) — daftar save zone

- **Perangkat** — pilih Device ID (header `x-device-id`), auto-refresh, chip: server, umur data, jumlah zona, koordinat posisi.
- **Banner status** — `Aman — di dalam zona "…"` (hijau) / `DI LUAR semua zona aktif` (merah, server memicu alarm) / `Menunggu posisi GPS` / `Belum ada zona aktif`.
- **Zona Tersimpan** — tiap baris: nama, badge status (**Di dalam** / **Di luar** / **Nonaktif**), koordinat, radius, jarak dari posisi sekarang, tombol **Nonaktifkan/Aktifkan** dan **Hapus**.
- **Tambah zona** — nama, radius, lat, lng + tombol **Pakai posisi telemetri** (isi koordinat dari posisi terakhir).

Aturan yang berlaku (sama dengan sisi server):
- Zona disimpan **per device** (`x-device-id`); ganti Device ID untuk melihat zona device lain.
- **Logika OR**: aman bila berada di dalam **minimal satu zona aktif**; di luar semua zona aktif → server mengirim `alarm_active: true`.
- Zona baru **selalu aktif otomatis** (`valid: true`).
- Tanpa zona aktif server menganggap semua posisi aman — banner menampilkan peringatan agar menambah zona.

### Halaman Posisi (`#/pose`) — profil orientasi aman (pitch/roll)

- **Proyeksi Orientasi (MPU6050)** — avatar 3D motor yang mengikuti orientasi live dari telemetri (`mpu_pitch`/`mpu_roll`, fallback hitung dari `mpu_ax/ay/az`); chip pitch, roll, getaran, jumlah profil, kecepatan. Kamera bisa digeser (orbit).
- **Banner status** — `Aman — orientasi sesuai "…"` (hijau) / `DI LUAR semua profil posisi aman` (merah) / `Kendaraan berjalan — cek pose dilewati` / `Menunggu data MPU` / `Belum ada profil posisi aktif`.
- **Profil Posisi Tersimpan** — tiap baris: nama, badge (**Sesuai** / **Tidak sesuai** / **Nonaktif**), sudut pitch/roll + toleransi, selisih Δ terhadap orientasi sekarang, tombol **Nonaktifkan/Aktifkan** dan **Hapus**.
- **Tambah profil** — nama, pitch, roll, toleransi pitch/roll + tombol **Ambil dari posisi sekarang** (isi form dari orientasi live) dan **Kalibrasi & simpan** (simpan profil dengan sudut persis posisi kendaraan saat ini).

Aturan yang berlaku (sama dengan sisi server):
- Profil disimpan **per device** (`x-device-id`) dan berlaku **OR**: aman bila orientasi masuk **minimal satu profil aktif** (envelope `|Δpitch| ≤ tol_pitch` dan `|Δroll| ≤ tol_roll`).
- **Debounce 3 detik**: pelanggaran harus bertahan ±3 detik sebelum server mengisi `pose_violated` dan memicu alarm (anti false positive guncangan sesaat).
- **Cek pose dilewati saat kendaraan berjalan** (`speed_kmh > 5`) — sudut wajar berubah saat menikung/mengerem.
- Auto-alarm (`alarm_active: true`) **hanya di mode `armed`** — berlaku juga untuk pelanggaran geofence. Mode `overwatch`/`powersafe` tetap menampilkan status tapi tanpa alarm/aktuator otomatis.
- Deteksi pose dipakai untuk **kendaraan yang tiba-tiba miring/diangkat** — yang tidak terbaca oleh deteksi getaran, karena magnitude gravitasi selalu ≈ 9,8 m/s² di semua orientasi.

### Halaman Debug (`#/debug`)

- **Koneksi** — alamat API, Device ID, latensi, umur data, jumlah geofence aktif.
- **Simulator ESP32** — kirim payload contoh (preset: normal, keluar geofence, tanpa GPS fix, getaran) via `POST /api/telemetry`.
- **Command** — kirim command manual + simulasi polling ESP (`GET /api/command`).
- **Geofence** — CRUD geofence ringkas (versi cepat; kelola zona lengkap di halaman Zona).
- **Log Request** — riwayat request yang dikirim dari halaman itu.

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
├── dummy-devices.js          # Armada device dummy untuk uji zona tanpa ESP32
├── start-dev.ps1             # PowerShell launcher (API + Vite sekaligus)
├── public/
│   ├── favicon.svg
│   └── icons.svg
├── src/
│   ├── main.tsx              # React entry point
│   ├── index.css             # Tailwind import + Liquid Glass styles
│   ├── apiBase.ts            # Deteksi prefix API (root atau /_testing)
│   ├── NavTabs.tsx           # Navigasi Dashboard / Zona / Posisi / Debug
│   ├── zones.ts              # Helper zona: Haversine + status OR logic
│   ├── ZonesPage.tsx         # Halaman Zona Aman (daftar save zone)
│   ├── poses.ts              # Helper pose: hitung pitch/roll + status OR logic
│   ├── PosePage.tsx          # Halaman Posisi Aman (profil orientasi + kalibrasi)
│   ├── MpuAvatar.tsx         # Avatar 3D motor (React Three Fiber) proyeksi MPU
│   ├── DebugPage.tsx         # Halaman Debug
│   └── App.tsx               # Router hash + widget Dashboard
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

### Opsi — Terpasang di web asli (disarankan, satu server)

`server.js` juga di-import sebagai sub-app oleh `Web/Backend/server.js`,
jadi **tidak perlu port 3001 terpisah**:

```powershell
cd Web/Backend
npm start        # http://127.0.0.1:8000
```

| Halaman | Alamat |
|---|---|
| Dashboard uji | `http://127.0.0.1:8000/_testing/` |
| **Zona (daftar save zone)** | `http://127.0.0.1:8000/_testing/#/zones` |
| Debug | `http://127.0.0.1:8000/_testing/#/debug` |

Route bisa diganti via env `SMARTGUARD_TESTING_ROUTE`, dimatikan `SMARTGUARD_TESTING=0`.

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
| `/api/telemetry` | `POST` | ESP32 | Kirim telemetri JSON (auto cek geofence + pose) |
| `/api/telemetry` | `GET` | Dashboard | Baca telemetri terbaru + `geofence_inside` + `pose_inside` |
| `/api/command` | `GET` | ESP32 | Polling terima command/alarm (204 kalau tidak ada baru) |
| `/api/command` | `POST` | Dashboard | Kirim command manual ke ESP |
| `/api/status` | `GET` | Dashboard | Ringkasan koneksi + status geofence & pose |

### Geofence Management (Dashboard CRUD)

| Endpoint | Method | Fungsi |
|----------|--------|--------|
| `/api/geofences` | `GET` | List semua geofence device |
| `/api/geofences` | `POST` | Tambah geofence baru `{name, lat, lng, radius_m}` |
| `/api/geofences/:id` | `PATCH` | Update geofence (radius, name, enable/disable) |
| `/api/geofences/:id` | `DELETE` | Hapus geofence |

### Pose Management (Dashboard CRUD)

| Endpoint | Method | Fungsi |
|----------|--------|--------|
| `/api/poses` | `GET` | List semua profil pose device |
| `/api/poses` | `POST` | Tambah profil `{name, pitch, roll, tol_pitch?, tol_roll?}` atau `{name, from_telemetry: true}` (kalibrasi dari posisi sekarang) |
| `/api/poses/:id` | `PATCH` | Update profil (sudut, toleransi, name, enable/disable) |
| `/api/poses/:id` | `DELETE` | Hapus profil |

### Logika Geofence (Server-side)

- **OR logic**: Device aman kalau berada di **DALAM SATU** geofence manapun (safe zone)
- **Alarm trigger**: Kalau device **LUAR SEMUA** geofence valid → server otomatis set `alarm_active: true` di command berikutnya (**hanya saat mode `armed`**)
- **Response telemetry**: Field `geofence_inside` (bool) + `geofence_violated` (detail geofence terdekat kalau violated)
- **Alarm command**: `{alarm_active: true, reason: "geofence_violated", geofence: "nama", distance_m, radius_m}`

### Logika Pose / Posisi Aman (Server-side)

- **OR logic**: Kendaraan aman kalau orientasinya (pitch/roll) masuk **SALAH SATU** profil pose aktif (`|Δpitch| ≤ tol_pitch` DAN `|Δroll| ≤ tol_roll`)
- **Sumber orientasi**: `mpu_pitch`/`mpu_roll` dari firmware; fallback dihitung server dari `mpu_ax/ay/az`
- **Debounce**: pelanggaran harus bertahan **±3 detik** sebelum `pose_violated` terisi (anti false positive)
- **Skip saat berjalan**: `speed_kmh > 5` → `pose_inside: null` (cek dilewati)
- **Alarm trigger**: pose melanggar (setelah debounce) → `alarm_active: true` **hanya saat mode `armed`**
- **Response telemetry**: Field `pose_inside` (bool/null) + `pose_violated` (detail profil terdekat kalau violated)
- **Alarm command**: `{alarm_active: true, reason: "pose_violated", pose: "nama", pitch, roll}`

### Mode & auto-alarm

Auto-alarm (geofence maupun pose) **hanya dipicu saat mode `armed`**. Mode `overwatch` dan `powersafe` tetap menghitung & menampilkan status (`geofence_inside`, `pose_inside`) tapi tanpa `alarm_active`/aktuator otomatis — sesuai definisi mode di `docs/SMARTGUARD_Core_v5.1_Clean.md`.

### Device Isolation

Semua endpoint pakai header `x-device-id` (atau query `device_id`) untuk multi-device support. Default: `"default"`.

---

## 7. Konfigurasi ESP32 (`config.h`)

Di `hardprogramming/Smart-Guard-Hardprog/src/config.h`, atur `WEB_API_URL` ke IP komputer yang menjalankan `server.js`:

```c
#define WEB_API_URL "http://192.168.29.29:3001"
```

Ganti `192.168.29.29` dengan IP LAN komputer tempat `server.js` berjalan (lihat `ipconfig` / `Get-NetIPAddress`). Pastikan ESP32 dan komputer **satu jaringan WiFi** (subnet sama).

`config.h` sudah di-gitignore — jangan commit ke repo. Salin dari `config.h.example` (template dengan placeholder) sebagai awal.

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
  "mpu_pitch": -21.9,
  "mpu_roll": 0.7,
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

1. Upload `src/main_1.cpp` (versi HTTP client, tanpa Blynk) ke ESP32 via PlatformIO.
2. Buka Serial Monitor (baud 115200), pastikan WiFi terhubung & dapat IP subnet sama dengan komputer.
3. Jalankan **Opsi A** (`.\start-dev.ps1`) atau **Opsi B** (`npm run dev:full`) di `web-testing/`.
4. Buka `http://localhost:5173`. Dalam beberapa detik, data telemetri dari ESP32 akan muncul.
5. Coba ubah mode / nyalakan relay via kolom kanan dashboard, atau kirim JSON manual di "Input to Device". Perintah akan terkirim ke `/api/command` dan diterima ESP32 pada polling berikutnya (lihat Serial Monitor: "Command dari web diterima").

### 8.1 Uji zona tanpa ESP32 — `dummy-devices.js`

Kalau ESP32 tidak tersedia (offline), pakai armada device dummy:

```powershell
cd web-testing
npm run dummy                                    # semua skenario → :3001
npm run dummy -- --base http://localhost:8000/_testing   # mode terpasang (satu server)
npm run dummy -- --only moving,outside --duration 30
npm run dummy -- --list                          # daftar skenario
```

| Device ID | Skenario | Untuk menguji |
|---|---|---|
| `default` | **moving** — berpindah tiap putaran, lintas zona (banyak posisi) | Trail/daftar zona berubah-ubah, masuk-keluar zona |
| `dummy-inside` | diam di dalam zona `rumah` | Status "Di dalam" / aman |
| `dummy-outside` | diam di luar semua zona | Pelanggaran geofence + `alarm_active` (polling command) |
| `dummy-offline` | kirim 3 laporan lalu **berhenti** | Umur data tumbuh / perangkat berhenti mengirim |
| `dummy-nofix` | GPS tanpa fix (`lat/lng` null) | Banner "Menunggu posisi GPS" |
| `dummy-lowbat` | baterai 3.4 V di dalam zona | Tampilan baterai rendah |

- Tiap device otomatis mendapat 2 zona contoh (`rumah` r30 m, `kantor` r50 m) bila belum punya zona — lihat di halaman **Zona** dengan Device ID yang sama.
- Ganti **Device ID** di halaman Zona/Debug untuk berpindah antar skenario.
- Data tetap di memori server — hilang saat server restart (jalankan ulang dummy untuk menanam zona lagi, atau pakai `--no-seed`).

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