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
| Uji saat ini | **Blynk** (belum HTTP/Web API) |
| Lokasi utama | `hardprogramming/Smart-Guard-Hardprog/src/main.cpp` |
| Spesifikasi lengkap | `docs/SMARTGUARD_Core_v5.1_Clean.md` |

**Tujuan:** Pelacak kendaraan anti-curi yang memantau GPS + gerakan (MPU6050), mengirim data sensor mentah ke web, dan menjawab perintah aktuator dari web. Web menentukan status keamanan/alarm; ESP32 hanya sebagai sensor + aktuator (dumb device). Uji saat ini pakai Blynk, nanti HTTPS ke server eksternal.

---

## 2. Hardware & Pin Mapping (ESP32 DevKit V1)

| Komponen | GPIO | Keterangan |
|----------|------|------------|
| GPS NEO-6M TX → ESP32 RX | 16 | UART2 RX |
| GPS NEO-6M RX ← ESP32 TX | 17 | UART2 TX |
| MPU6050 SDA | 21 | I2C |
| MPU6050 SCL | 22 | I2C |
| Relay 1 (Active-LOW) | 32 | Blynk V3; HIGH=mati, LOW=nyala |
| Relay 2 Blink 500ms (Active-LOW) | 33 | Blynk V4; HIGH=mati, LOW=nyala |
| LED Hijau (normal) | 25 | Pola menurut state |
| LED Merah (alarm) | 26 | Kedip saat ALARM |
| Baterai ADC (pembagi tegangan) | 34 | Input-only; pembagi eksternal wajib |

**Baterai:** Shield double 18500, tapi untuk prototyping dipakai **1 sel saja (1S)**. Perhatikan polaritas dan slot kosong jangan bersentuhan logam.

**Peringatan kerusakan:** Jangan sambungkan sel Li-ion 1S langsung ke `VIN/5V` tanpa regulator. Jangan pernah sambungkan baterai langsung ke pin `3V3`. GPS tidak boleh diberi daya langsung dari GPIO.

---

## 3. Mode Operasional Firmware

ESP32 adalah dumb device, tapi punya 3 mode yang ditentukan lewat perintah JSON dari web (V2/V7):

| Mode | Perilaku ESP32 | Alarm Otomatis? | Aktuator Otomatis? | Penggunaan |
|------|---------------|-----------------|-------------------|------------|
| `armed` | Evaluasi geofence di ESP32. Kalau jarak > radius dari HOME → nyalakan alarm (LED merah, Relay 2 blink) | ✅ Ya (geofence) | ✅ Ya | Parkir lonjakan, butuh respons otomatis |
| `overwatch` | Cuma baca sensor + kirim telemetri. Tidak ada alarm otomatis, tidak ada aktuator otomatis | ❌ Tidak | ❌ Tidak | Parkir dengan tukang parkir, monitoring pasif |
| `powersafe` | MPU6050 deteksi getaran → `mpu_vibration = true`, GPS siap dihidupkan (load switch nanti) | ❌ Tidak | ❌ Tidak | Parkir jangka panjang, hemat baterai ekstrem |

**Contoh JSON perintah dari web ke V2:**

```json
// Armed
{"mode":"armed","geofence_radius_m":30,"shock_threshold":15,"home_valid":true,"home_lat":-7.797,"home_lng":110.37,"led_red":false,"led_green":true,"relay1":0,"relay2":0}

// Overwatch
{"mode":"overwatch","led_red":false,"led_green":true,"relay1":0,"relay2":0}

// PowerSafe
{"mode":"powersafe","shock_threshold":12,"led_red":false,"led_green":false,"relay1":0,"relay2":0}
```

**Field tambahan telemetri V1:** `mode`, `mpu_vibration`, `geofence_radius_m`, `dist_home_m`.

---

## 4. Fitur yang Sudah Diimplementasi (main.cpp)

- Inisialisasi WiFi (non-blocking, timeout 15 detik) sebelum Blynk
- Koneksi Blynk non-blocking (`Blynk.config` + `Blynk.connect(5000)`, tidak macet saat WiFi gagal)
- Baca GPS NEO-6M via UART2 (TinyGPSPlus)
- Validasi GPS fix (`isValid()` + umur data < 5 detik)
- Baca MPU6050 (akselerasi X/Y/Z) + deteksi getaran untuk PowerSafe
- Pembacaan baterai via ADC GPIO34 + estimasi SoC kasar (3.0V–4.2V)
- Telemetri JSON ke Blynk V1 (termasuk mode, state aktuator, jarak dari HOME, getaran)
- Parsing perintah JSON dari web via Blynk V2 (`ArduinoJson` v6)
- Relay 1 (V3), Relay 2 blink (V4), LED Merah (V5), LED Hijau (V6), Mode (V7)
- Feedback otomatis ke Blynk V3–V6, V8–V10 agar widget switch ikut terupdate
- Semua timing non-blocking (`millis()`, tidak ada `delay()` panjang)
- Kredensial dipisah ke `config.h` (tidak di-commit ke git)

---

## 4. Fitur yang Sudah Diimplementasi (main.cpp)

- Inisialisasi WiFi (non-blocking, timeout 15 detik) sebelum Blynk
- Koneksi Blynk non-blocking (`Blynk.config` + `Blynk.connect(5000)`, tidak macet saat WiFi gagal)
- Baca GPS NEO-6M via UART2 (TinyGPSPlus)
- Validasi GPS fix (`isValid()` + umur data < 5 detik)
- Baca MPU6050 (akselerasi X/Y/Z)
- Pembacaan baterai via ADC GPIO34 + estimasi SoC kasar (3.0V–4.2V)
- Telemetri JSON ke Blynk V1 (termasuk **state aktuator**: led_red, led_green, relay1, relay2, alarm_active)
- Parsing perintah JSON dari web via Blynk V2 (`ArduinoJson` v6)
- Relay 1 (V3) dan Relay 2 blink (V4) via Blynk
- Semua timing non-blocking (`millis()`, tidak ada `delay()` panjang)
- Kredensial dipisah ke `config.h` (tidak di-commit ke git)

---

## 5. Fitur Belum Diimplementasi / Belum Diubah ke HTTP

- **Web API / HTTPS** belum dipasang (sengaja, sesuai permintaan user)
- State machine lokal (`INITIALIZING`, `ARMED`, `ALARM`, `FAULT`) — dihapus, web yang menentukan state
- Geofence otomatis di ESP32 — dihapus, web yang menentukan alarm
- Antrean event lokal dengan `event_id` — dihapus, web yang menangani event
- Fuel gauge I2C (MAX17048) — saat ini masih ADC pembagi tegangan
- GPS power gating / load switch
- BLE GATT (NimBLE-Arduino)
- Penyimpanan event persisten (Preferences/NVS/LittleFS) — saat ini RAM saja
- Deep sleep + wake-up interrupt MPU6050 / timer
- OTA firmware

---

## 6. Virtual Pin Blynk (untu uji prototyping)

| Pin | Arah | Fungsi |
|-----|------|--------|
| V1 | Keluar | Telemetri JSON lengkap (mode, GPS, MPU, baterai, state aktuator, jarak HOME) |
| V2 | Masuk | Perintah JSON dari web (`mode`, `geofence_radius_m`, `shock_threshold`, `home_valid`, `home_lat`, `home_lng`, `led_red`, `led_green`, `relay1`, `relay2`, `alarm_active`) |
| V3 | Dua arah | Relay 1 Active-LOW |
| V4 | Dua arah | Relay 2 blink 500 ms |
| V5 | Dua arah | LED Merah |
| V6 | Dua arah | LED Hijau |
| V7 | Masuk | Pilih mode: `armed` / `overwatch` / `powersafe` |
| V8 | Keluar | Jarak dari HOME (meter) |
| V9 | Keluar | Tegangan baterai (Volt) |
| V10 | Keluar | Status GPS fix (1=valid, 0=belum) |

---

## 7. File Struktur Penting

```
docs/SMARTGUARD_Core_v5.1_Clean.md     # Spesifikasi lengkap (baca dulu)
docs/knowledge_transfer.md             # File ini
hardprogramming/Smart-Guard-Hardprog/src/main.cpp   # Firmware utama (dumb device + 3 mode)
hardprogramming/Smart-Guard-Hardprog/src/config.h           # Kredensial lokal (TIDAK di-commit)
hardprogramming/Smart-Guard-Hardprog/src/config.h.example   # Template kredensial (boleh di-commit)
```

---

## 8. Aturan Penting Saat Mengubah Kode

1. **Jangan pasang HTTP/Web API** kecuali diminta secara eksplisit.
2. **Jangan commit kredensial produksi** (`BLYNK_AUTH_TOKEN`, WiFi password, API token) ke repo Publik. Gunakan `config.h` (gitignored) + `config.h.example` (template).
3. WiFi harus dihubungkan **sebelum** `Blynk.config()`/`Blynk.connect()` agar tidak crash (assert `xQueueSemaphoreTake`).
4. `loop()` hanya memanggil `Blynk.run()` — jangan panggil `Blynk.connect()` manual di setiap loop.
5. ESP32 adalah dumb device: tidak membuat keputusan alarm/state sendiri kecuali mode `armed` (geofence lokal) dan `powersafe` (getaran lokal).
6. GPS belum fix → koordinat `null`, `gps.fix = false`, jangan buat `HOME` palsu.
7. Semua loop harus non-blocking. Hindari `delay()` panjang.
8. Kalibrasi `shockThreshold`, `geofenceRadiusM`, dan pembagi tegangan baterai di hardware nyata sebelum dipakai pada kendaraan.

---

## 9. Perhatian Khusus Baterai 18500

- Dipakai shield double 18500, tapi hanya **1 sel dipasang** untuk prototyping.
- Slot kosong jangan biarkan mencoret kontak logam.
- Pastikan polaritas sel terpasang benar.
- Estimasi SoC saat ini sangat kasar (hanya tegangan). Untuk akurasi lebih baik, ganti ke fuel gauge (MAX17048).

---

## 10. Roadmap Singkat (dari dokumen v5.1)

1. P1: Core sensor (GPS, MPU6050, LED, validasi fix) ✅
2. P2: Dumb device actuator + 3 mode (armed/overwatch/powersafe) ✅
3. P3: Baterai (charger, regulator, ADC/fuel gauge) ⚠️ ADC saja
4. P4: BLE (GATT status/diagnostik) ❌
5. P5: Wi-Fi/API (HTTPS heartbeat, telemetri, event) ❌ sengaja ditunda
6. P6: Event queue persistensi + kirim ulang ❌ RAM saja
7. P7: Power management (deep sleep, motion interrupt, timer wake) ❌
8. P8: Hardening & regresi ❌

---

Jika ada pertanyaan tentang bagian tertentu, tanya spesifik (mis. "bagaimana logika geofence?" atau "pin mana untuk Relay 2?").