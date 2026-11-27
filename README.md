# 🛡️ SMART — Smart Theft IoT (Anti-Curi Kendaraan)

Proyek anti-curi berbasis **ESP32 + Web API + Dashboard**. ESP32 hanya sebagai
**dumb device** (sensor + aktuator); semua keputusan keamanan — geofence, alarm,
mode — dihitung di **server**, bukan di perangkat.

Dokumen spesifikasi lengkap: [`docs/SMARTGUARD_Core_v5.1_Clean.md`](docs/SMARTGUARD_Core_v5.1_Clean.md)

---

## 1. Struktur repo

```
Smart-Theft-IoT/
├── README.md                        # ← file ini
├── docs/README.md                   # Index dokumentasi
├── hardprogramming/                 # Firmware ESP32 (PlatformIO)
│   └── Smart-Guard-Hardprog/        #   main_1.cpp, config.h, pin mapping
├── Web/
│   ├── Frontend/                    # Dashboard statis HTML + Tailwind (produksi)
│   └── Backend/                     # Node.js + Express + SQLite (API + file statis)
├── web-testing/                     # Dashboard React (Vite) + server.js Express untuk uji cepat
└── TODO.md                          # Catatan tugas tim
```

README tiap folder: [`docs/`](docs/README.md) · [`Web/`](Web/README.md) ·
[`Web/Frontend/`](Web/Frontend/README.md) · [`Web/Backend/`](Web/Backend/README.md) ·
[`web-testing/`](web-testing/README.md) ·
[`hardprogramming/`](hardprogramming/README.md) ·
[`hardprogramming/Smart-Guard-Hardprog/`](hardprogramming/Smart-Guard-Hardprog/README.md)

---

## 2. Cara kerja alat ↔ web: arsitektur

```
┌─────────────────────────────┐        ┌──────────────────────────────┐
│  ESP32 (perangkat)          │        │  Komputer / Server           │
│  - GPS NEO-6M               │  HTTP  │  - server.js (port 3001)  atau│
│  - MPU6050 (getaran)        │ ─────► │    Web/Backend (port 8000)   │
│  - Baterai (ADC 34)         │        │  - SQLite / memori           │
│  - Relay + LED hijau/merah  │ ◄───── │  - Dashboard (React / HTML)  │
└─────────────────────────────┘  poll  └──────────────────────────────┘
         Wi-Fi satu jaringan (LAN)  ATAU  lewat cloudflared tunnel (internet)
```

### Prinsip utama

1. **ESP32 mengirim data mentah, bukan keputusan.** Tiap **3 detik** ia `POST`
   JSON telemetri (GPS, getaran, tegangan baterai, mode) ke server.
2. **Server yang menentukan alarm.** Server memeriksa geofence (logika OR,
   multi-zone) terhadap titik `HOME`. Kalau ESP32 berada di luar **semua** safe
   zone → server menyetel `alarm_active: true`.
3. **ESP32 polling perintah.** Tiap **3 detik** ESP32 `GET /api/command`; balasan
   berisi `mode`, `relay1`, `relay2`, `alarm_active`, radius geofence, dll.
   ESP32 tinggal mengeksekusi (LED merah kedip, relay blink, dst).
4. **Dashboard membaca dan menulis lewat API yang sama** — tidak ada koneksi
   langsung browser ↔ ESP32.

### Alur satu putaran (normal)

```
ESP32 ──POST /api/telemetry──► Server ──simpan──► Database
  │                               │
  │                               ├── cek geofence → bila melanggar:
  │                               │     simpan event + push notifikasi ke ponsel
  │                               │
  └──GET  /api/command───────────◄┘  (balasan: alarm_active, mode, relay...)
        │
        └──► ESP32 menyalakan LED merah / menggerakkan relay
```

Detail payload: [`docs/Web_Testing.md`](docs/Web_Testing.md) §6–§7 dan
[`Web/Backend/README.md`](Web/Backend/README.md) (bagian Endpoint).

### Dua "backend" yang tersedia

| | `web-testing/server.js` | `Web/Backend/server.js` |
|---|---|---|
| Port | **3001** | **8000** |
| Penyimpanan | Memori (hilang saat restart) | SQLite (`smartguard.db`) |
| Auth | Tidak ada (uji lokal) | Bearer token perangkat |
| Frontend | React/Vite (port 5173) | `Web/Frontend` disajikan langsung |
| Untuk | Uji cepat ESP32 ↔ dashboard | Versi lengkap / demo |

Firmware memakai `WEB_API_URL` dari `config.h` — jadi tinggal ganti URL untuk
pindah antara kedua server.

---

## 3. Dua mode koneksi ESP32 → server

### Mode A — LAN (default, paling sederhana)

ESP32 dan komputer berada di **Wi-Fi yang sama**. Isi `config.h` dengan IP lokal:

```c
#define WEB_API_URL "http://192.168.29.29:3001"   // IP komputer, tanpa / di akhir
```

IP komputer dilihat dengan `ipconfig` (Windows) atau `Get-NetIPAddress`.
Kelemahannya: ESP32 hanya bisa mengirim data selama berada di jaringan tersebut.

### Mode B — Lewat internet dengan **cloudflared**

Kalau ESP32 (atau dashboard) harus diakses **di luar jaringan LAN**, server yang
jalan di `localhost` tidak punya alamat publik. Di situlah `cloudflared` dipakai.

---

## 4. cloudflared itu apa?

**`cloudflared` adalah tool baris perintah (CLI) resmi dari Cloudflare** yang
membuat **tunnel keluar (outbound tunnel)** dari komputer kamu ke jaringan
Cloudflare — sehingga service yang hanya jalan di `localhost` bisa diakses lewat
alamat HTTPS publik, **tanpa** membuka port di router, tanpa IP publik, dan tanpa
port-forwarding.

### Cara kerjanya

```
ESP32 / browser (internet)
        │  HTTPS
        ▼
Cloudflare Edge (mis. https://abc-random.trycloudflare.com)
        │  tunnel terenkripsi dibuat OLEH komputer kamu (keluar)
        ▼
Komputer kamu ──► localhost:8000 (server SMARTGUARD)
```

1. Kamu menjalankan server di `localhost:8000`.
2. Menjalankan perintah:

   ```powershell
   & "C:\Program Files (x86)\cloudflared\cloudflared.exe" tunnel --url http://localhost:8000
   ```

3. `cloudflared` **membuka koneksi keluar** ke Cloudflare (tidak perlu izin
   firewall masuk), lalu mencetak alamat publik, misalnya:

   ```
   https://a1b2c3d4-e5f6-7890-abcd-ef1234567890.trycloudflare.com
   ```

4. Alamat itulah yang kamu berikan ke ESP32:

   ```c
   #define WEB_API_URL "https://a1b2c3d4-....trycloudflare.com"
   ```

   Firmware memakai `WiFiClientSecure` dengan `setInsecure()` (line 262
   `main_1.cpp`), jadi HTTPS tunnel Cloudflare bisa langsung dipakai tanpa
   memasang sertifikat.

### Poin penting

- **Tunnel bersifat keluar (outbound).** Tidak ada port yang dibuka di router
  kamu; aman dari pembobolan port.
- **Alamatnya gratis tapi acak.** `tunnel --url` (quick tunnel) menghasilkan URL
  baru setiap kali dijalankan ulang. Untuk URL tetap, pakai *named tunnel*
  (`cloudflared tunnel create` + domain sendiri).
- **HTTPS sudah disediakan Cloudflare** di sisi depan — ini juga syarat agar
  service worker & push notification frontend berfungsi.
- **Cloudflare tidak menyimpan data** di tunnel-nya; ia hanya meneruskan traffic
  dua arah secara terenkripsi.

> Referensi penggunaan tunnel di repo ini ada di
> [`Web/Backend/archive/README (1).md`](Web/Backend/archive/README%20(1).md)
> (versi backend Python lama) — pola yang sama berlaku untuk backend Node.js.

---

## 5. Menjalankan (ringkas)

### Backend + dashboard resmi

```powershell
cd Web/Backend
npm install       # sekali saja
npm start         # http://127.0.0.1:8000/
```

### Web testing (cepat, untuk uji ESP32)

```powershell
cd web-testing
.\start-dev.ps1   # API (3001) + Vite (5173) sekaligus
# buka http://localhost:5173
```

### Firmware ESP32

```powershell
cd hardprogramming/Smart-Guard-Hardprog
copy src\config.h.example src\config.h   # isi WiFi + WEB_API_URL
pio run -t upload
pio device monitor                       # baud 115200
```

### Bila butuh akses dari luar LAN

```powershell
# terminal terpisah, setelah server berjalan
& "C:\Program Files (x86)\cloudflared\cloudflared.exe" tunnel --url http://localhost:8000
# salin URL https://... yang muncul → tempel ke WEB_API_URL di config.h → upload ulang
```

---

## 6. Dokumentasi lain

| File | Isi |
|---|---|
| [`docs/SMARTGUARD_Core_v5.1_Clean.md`](docs/SMARTGUARD_Core_v5.1_Clean.md) | Spesifikasi lengkap: arsitektur, kontrak data, API, BLE, baterai |
| [`docs/Web_Testing.md`](docs/Web_Testing.md) | Panduan dashboard Liquid Glass + endpoint `server.js` |
| [`docs/SMARTGUARD_Web_Development_Contract.md`](docs/SMARTGUARD_Web_Development_Contract.md) | Kontrak pengembangan web |
| [`docs/smartguard_alur_kerja.png`](docs/smartguard_alur_kerja.png) | Diagram alur kerja |
| [`TODO.md`](TODO.md) | Catatan tugas tim |
