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

## 3. Arsitektur Firmware (Dumb Device)

ESP32 **tidak lagi membuat keputusan keamanan secara lokal**. Web/Blynk adalah otak; ESP32 hanya:
- Baca sensor (GPS, MPU6050, baterai)
- Kirim telemetri JSON mentah ke web (V1)
- Terima perintah JSON dari web (V2) lalu actuate LED/relay

| Perintah dari web (V2) | Aksi ESP32 |
|------------------------|------------|
| `led_red: true` | LED merah nyala |
| `led_green: true` | LED hijau nyala |
| `relay1: 1` | Relay 1 nyala (Active-LOW) |
| `relay2: 1` | Relay 2 berkedip 500 ms (Active-LOW) |
| `alarm_active: true` | Catatan saja, aksi fisik diatur lewat field di atas |

Tidak ada tombol, tidak ada buzzer, tidak ada perintah `power_off`.

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
| V1 | Keluar | Telemetri JSON sensor mentah + state aktuator (GPS, MPU, baterai, LED, relay) |
| V2 | Masuk | Perintah JSON dari web (`led_red`, `led_green`, `relay1`, `relay2`, `alarm_active`) |
| V3 | Masuk | Relay 1 Active-LOW (fallback manual) |
| V4 | Masuk | Relay 2 blink 500 ms (fallback manual) |

---

## 7. File Struktur Penting

```
docs/SMARTGUARD_Core_v5.1_Clean.md     # Spesifikasi lengkap (baca dulu)
docs/knowledge_transfer.md             # File ini
hardprogramming/Smart-Guard-Hardprog/src/main.cpp   # Firmware utama (dumb device)
hardprogramming/Smart-Guard-Hardprog/src/config.h           # Kredensial lokal (TIDAK di-commit)
hardprogramming/Smart-Guard-Hardprog/src/config.h.example   # Template kredensial (boleh di-commit)
```

---

## 8. Aturan Penting Saat Mengubah Kode

1. **Jangan pasang HTTP/Web API** kecuali diminta secara eksplisit.
2. **Jangan commit kredensial produksi** (`BLYNK_AUTH_TOKEN`, WiFi password, API token) ke repo Publik. Gunakan `config.h` (gitignored) + `config.h.example` (template).
3. WiFi harus dihubungkan **sebelum** `Blynk.config()`/`Blynk.connect()` agar tidak crash (assert `xQueueSemaphoreTake`).
4. `loop()` hanya memanggil `Blynk.run()` — jangan panggil `Blynk.connect()` manual di setiap loop.
5. ESP32 adalah dumb device: tidak membuat keputusan alarm/state sendiri. Web yang menentukan.
6. GPS belum fix → koordinat `null`, `gps.fix = false`, jangan buat `HOME` palsu.
7. Semua loop harus non-blocking. Hindari `delay()` panjang.
8. Kalibrasi pembagi tegangan baterai di hardware nyata sebelum dipakai pada kendaraan.

---

## 9. Perhatian Khusus Baterai 18500

- Dipakai shield double 18500, tapi hanya **1 sel dipasang** untuk prototyping.
- Slot kosong jangan biarkan mencoret kontak logam.
- Pastikan polaritas sel terpasang benar.
- Estimasi SoC saat ini sangat kasar (hanya tegangan). Untuk akurasi lebih baik, ganti ke fuel gauge (MAX17048).

---

## 10. Roadmap Singkat (dari dokumen v5.1)

1. P1: Core sensor (GPS, MPU6050, LED, validasi fix) ✅
2. P2: Dumb device actuator (LED, relay via Blynk JSON) ✅
3. P3: Baterai (charger, regulator, ADC/fuel gauge) ⚠️ ADC saja
4. P4: BLE (GATT status/diagnostik) ❌
5. P5: Wi-Fi/API (HTTPS heartbeat, telemetri, event) ❌ sengaja ditunda
6. P6: Event queue persistensi + kirim ulang ❌ RAM saja
7. P7: Power management (deep sleep, motion interrupt, timer wake) ❌
8. P8: Hardening & regresi ❌

---

Jika ada pertanyaan tentang bagian tertentu, tanya spesifik (mis. "bagaimana logika geofence?" atau "pin mana untuk Relay 2?").