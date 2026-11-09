# Knowledge Transfer — SMARTGUARD (Anti-Theft GPS Vehicle Tracker)

File ini adalah panduan lengkap untuk AI (agent) yang akan bekerja pada proyek ini. Baca sebelum mengubah kode atau dokumen.

---

## 1. Ringkasan Proyek

| Item | Nilai |
|------|-------|
| Nama | **SMARTGUARD** — Smart Anti-Theft GPS Vehicle Tracker |
| Mikrokontroler | ESP32 DevKit V1 (ESP32 klasik) |
| Status dokumen | Spesifikasi rancangan v5.1 (belum bukti implementasi lolos uji) |
| Bahasa firmware | C++ (Arduino-ESP32) |
| Uji saat ini | **Web API (HTTP)** — Blynk sudah dimatikan (`SEND_TO_BLYNK 0`) |
| Lokasi utama | `hardprogramming/Smart-Guard-Hardprog/src/main.cpp` |
| Spesifikasi lengkap | `docs/SMARTGUARD_Core_v5.1_Clean.md` |
| Dashboard web testing | `web-testing/` (Vite + React + TypeScript + Tailwind CSS v4, Apple Liquid Glass) |
| Server perantara | `web-testing/server.js` (Express, multi-geofence, OR logic) |

**Tujuan:** Pelacak kendaraan anti-curi yang memantau GPS + gerakan (MPU6050), mengirim data sensor mentah ke **Web API (HTTPS/HTTP)**, dan menjawab perintah aktuator dari web. **Web menentukan status keamanan/alarm (termasuk geofence multi-zona)**; ESP32 hanya sebagai sensor + aktuator (dumb device).

---

## 2. Hardware & Pin Mapping (ESP32 DevKit V1)

| Komponen | GPIO | Keterangan |
|----------|------|------------|
| GPS NEO-6M TX → ESP32 RX | 16 | UART2 RX |
| GPS NEO-6M RX ← ESP32 TX | 17 | UART2 TX |
| MPU6050 SDA | 21 | I2C |
| MPU6050 SCL | 22 | I2C |
| Relay 1 (Active-LOW) | 32 | HIGH=mati, LOW=nyala |
| Relay 2 Blink 500ms (Active-LOW) | 33 | HIGH=mati, LOW=nyala |
| LED Hijau (normal) | 25 | Pola menurut state |
| LED Merah (alarm) | 26 | Kedip saat ALARM |
| Baterai ADC (pembagi tegangan) | 34 | Input-only; pembagi eksternal wajib |

**Baterai:** Shield double 18500, tapi untuk prototyping dipakai **1 sel saja (1S)**. Perhatikan polaritas dan slot kosong jangan bersentuhan logam.

**Peringatan kerusakan:** Jangan sambungkan sel Li-ion 1S langsung ke `VIN/5V` tanpa regulator. Jangan pernah sambungkan baterai langsung ke pin `3V3`. GPS tidak boleh diberi daya langsung dari GPIO.

---

## 3. Mode Operasional Firmware

ESP32 adalah **dumb device** — tidak membuat keputusan alarm/geofence sendiri. Web/API yang menentukan state. Firmware hanya:
- Baca sensor (GPS, MPU6050, baterai)
- Kirim telemetri JSON ke Web API (`POST /api/telemetry`)
- Terima perintah JSON dari Web API via polling (`GET /api/command`)
- Actuate LED/relay sesuai perintah

| Mode | Perilaku ESP32 | Alarm Otomatis? | Aktuator Otomatis? | Penggunaan |
|------|---------------|-----------------|-------------------|------------|
| `armed` | Kirim telemetri, terima `alarm_active` dari web. **Tidak** evaluasi geofence lokal. | ❌ Tidak (di web) | ✅ Ya (LED/relay per command) | Parkir lonjakan, butuh respons otomatis dari web |
| `overwatch` | Kirim telemetri, terima command. Tidak ada alarm/aktuator otomatis. | ❌ Tidak | ❌ Tidak | Parkir dengan tukang parkir, monitoring pasif |
| `powersafe` | MPU6050 deteksi getaran → `mpu_vibration = true` (vibration monitor only). GPS tetap nyala (belum ada load switch). | ❌ Tidak | ❌ Tidak | Parkir jangka panjang, monitoring getaran |

**Contoh JSON perintah dari web ke ESP (via `GET /api/command` polling):**

```json
// Armed
{"mode":"armed","relay1":0,"relay2":0,"alarm_active":false}

// Overwatch
{"mode":"overwatch","relay1":0,"relay2":0,"alarm_active":false}

// PowerSafe
{"mode":"powersafe","relay1":0,"relay2":0,"alarm_active":false}
```

**Field telemetri yang dikirim ESP ke web (`POST /api/telemetry`):**
`mode`, `gps_fix`, `lat`, `lng`, `speed_kmh`, `satellites`, `mpu_ax`, `mpu_ay`, `mpu_az`, `mpu_vibration`, `battery_v`, `relay1`, `relay2`, `alarm_active`, `geofence_radius_m`, `dist_home_m`

---

## 4. Fitur yang Sudah Diimplementasi (main.cpp)

- Inisialisasi WiFi (non-blocking, timeout 15 detik) sebelum HTTP client
- **HTTP Client** (`HTTPClient.h`) untuk `POST /api/telemetry` dan `GET /api/command` polling
- **Blynk dimatikan** via `#define SEND_TO_BLYNK 0` (semua `Blynk.virtualWrite` dan `Blynk.run()` dikondisional)
- Baca GPS NEO-6M via UART2 (TinyGPSPlus)
- Validasi GPS fix (`isValid()` + umur data < 5 detik)
- Baca MPU6050 (akselerasi X/Y/Z) + deteksi getaran untuk mode PowerSafe (vibration monitor only)
- Pembacaan baterai via ADC GPIO34 + estimasi SoC kasar (3.0V–4.2V)
- Telemetri JSON ke Web API tiap 3 detik (`POST /api/telemetry`)
- Polling command dari web tiap 3 detik (`GET /api/command`) → `parseWebCommand()`
- Relay 1, Relay 2 blink, LED Merah, LED Hijau dikontrol via command dari web
- Semua timing non-blocking (`millis()`, tidak ada `delay()` panjang)
- Kredensial dipisah ke `config.h` (tidak di-commit ke git), termasuk `WEB_API_URL`

---

## 5. Fitur Belum Diimplementasi / Roadmap

- **HTTPS/TLS** untuk Web API production (saat ini HTTP lokal)
- State machine lokal (`INITIALIZING`, `ARMED`, `ALARM`, `FAULT`) — dihapus, web yang menentukan state
- Geofence otomatis di ESP32 — **dipindah ke server** (web/API handle multi-geofence)
- Antrean event lokal dengan `event_id` — web yang menangani event
- Fuel gauge I2C (MAX17048) — saat ini masih ADC pembagi tegangan
- GPS power gating / load switch
- BLE GATT (NimBLE-Arduino)
- Penyimpanan event persisten (Preferences/NVS/LittleFS) — saat ini RAM saja
- Deep sleep + wake-up interrupt MPU6050 / timer
- OTA firmware

---

## 6. Web API & Server Perantara (`web-testing/server.js`)

**Arsitektur:** ESP32 → HTTP → `server.js` (Express) → Dashboard React

| Endpoint | Method | Pemanggil | Fungsi |
|----------|--------|-----------|--------|
| `/api/telemetry` | `POST` | ESP32 | Kirim telemetri + auto cek geofence |
| `/api/telemetry` | `GET` | Dashboard | Baca telemetri + `geofence_inside` |
| `/api/command` | `GET` | ESP32 | Polling command/alarm (204 kalau tidak ada) |
| `/api/command` | `POST` | Dashboard | Kirim command manual ke ESP |
| `/api/status` | `GET` | Dashboard | Ringkasan + status geofence |
| `/api/geofences` | `GET` | Dashboard | List geofence device |
| `/api/geofences` | `POST` | Dashboard | Tambah geofence `{name, lat, lng, radius_m}` |
| `/api/geofences/:id` | `PATCH` | Dashboard | Update geofence (radius, name, enable/disable) |
| `/api/geofences/:id` | `DELETE` | Dashboard | Hapus geofence |

**Logika Geofence (Server-side):**
- **OR logic**: Device aman kalau berada di **DALAM SATU** geofence manapun (safe zone)
- **Alarm trigger**: Kalau device **LUAR SEMUA** geofence valid → server otomatis set `alarm_active: true` di command berikutnya
- **Response telemetry**: Field `geofence_inside` (bool) + `geofence_violated` (detail geofence terdekat kalau violated)
- **Alarm command**: `{alarm_active: true, reason: "geofence_violated", geofence: "nama", distance_m, radius_m}`

**Device Isolation:** Semua endpoint pakai header `x-device-id` (atau query `device_id`) untuk multi-device support. Default: `"default"`.

---

## 7. Dashboard Web Testing (`web-testing/`)

- **Stack**: Vite + React 19 + TypeScript + Tailwind CSS v4
- **Desain**: **Apple Liquid Glass** (biru-biruan, blur 40px, saturate 190%, inner highlight, layered shadow)
- **Single page** dengan semua widget:
  - Dummy JSON (telemetri mentah)
  - Input to Device (kirim command manual)
  - Home Distance, Battery Voltage
  - LED Hijau/Merah, GPS Status
  - Tlakson (relay2), Kontak to Machine (relay1)
  - Device State (mode)

**Jalankan:**
```bash
cd web-testing
npm install
npm run dev:full    # jalanin server.js + Vite sekaligus (concurrently)
# atau
.\start-dev.ps1     # PowerShell launcher (auto cek port, install, jalanin keduanya)
```

---

## 8. File Struktur Penting

```
docs/SMARTGUARD_Core_v5.1_Clean.md     # Spesifikasi lengkap (baca dulu)
docs/dev/knowledge_transfer.md         # File ini
docs/Web_Testing.md                    # Panduan web testing (sinkron dengan docs/dev/)
web-testing/
  ├── server.js                        # Express API + multi-geofence
  ├── start-dev.ps1                    # PowerShell launcher (API + Vite)
  ├── src/
  │   ├── App.tsx                      # Dashboard React (fetch ke API)
  │   ├── index.css                    # Liquid Glass styles
  │   └── main.tsx
  └── package.json
hardprogramming/Smart-Guard-Hardprog/
  ├── src/main.cpp                     # Firmware utama (HTTP client, no Blynk)
  ├── src/config.h                     # Kredensial + WEB_API_URL (gitignored)
  └── src/config.h.example             # Template kredensial
```

---

## 9. Aturan Penting Saat Mengubah Kode

1. **Jangan hidupkan Blynk** — sudah dimatikan via `SEND_TO_BLYNK 0`.
2. **Jangan commit kredensial produksi** (`WEB_API_URL`, WiFi password) ke repo Publik. Gunakan `config.h` (gitignored) + `config.h.example` (template).
3. WiFi harus dihubungkan **sebelum** inisialisasi HTTP client agar tidak crash.
4. `loop()` memanggil `Blynk.run()` (dummy, kondisional) + `http` polling + sensor update — jangan panggil blocking calls.
5. ESP32 adalah **dumb device**: tidak membuat keputusan alarm/geofence. Web/server yang handle multi-geofence.
6. GPS belum fix → koordinat `null`, `gps.fix = false`, jangan buat `HOME` palsu.
7. Semua loop harus non-blocking. Hindari `delay()` panjang.
8. Kalibrasi `shockThreshold`, `geofenceRadiusM`, dan pembagi tegangan baterai di hardware nyata sebelum dipakai pada kendaraan.

---

## 10. Perhatian Khusus Baterai 18500

- Dipakai shield double 18500, tapi hanya **1 sel dipasang** untuk prototyping.
- Slot kosong jangan biarkan mencoret kontak logam.
- Pastikan polaritas sel terpasang benar.
- Estimasi SoC saat ini sangat kasar (hanya tegangan). Untuk akurasi lebih baik, ganti ke fuel gauge (MAX17048).

---

## 11. Roadmap Singkat

1. P1: Core sensor (GPS, MPU6050, LED, validasi fix) ✅
2. P2: Dumb device actuator + 3 mode (armed/overwatch/powersafe) ✅
3. P3: Baterai (charger, regulator, ADC/fuel gauge) ⚠️ ADC saja
4. P4: BLE (GATT status/diagnostik) ❌
5. P5: **Wi-Fi/HTTP API** (heartbeat, telemetri, event) ✅ (lokal HTTP, butuh HTTPS production)
6. P6: Event queue persistensi + kirim ulang ❌ RAM saja
7. P7: Power management (deep sleep, motion interrupt, timer wake) ❌ (GPS power gating / load switch belum dipasang)
8. P8: Hardening & regresi ❌

---

Jika ada pertanyaan tentang bagian tertentu, tanya spesifik (mis. "bagaimana logika geofence di server?" atau "pin mana untuk Relay 2?").