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

**Tujuan:** Pelacak kendaraan anti-curi yang memantau GPS + gerakan (MPU6050), menentukan status keamanan secara lokal, menyala kan LED merah saat alarm, dan mengirim event ke Web API (via Blynk untuk prototyping, nanti HTTPS ke server eksternal).

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

## 3. State Machine Firmware (v5.1)

| State | Arti | LED |
|-------|------|-----|
| `INITIALIZING` | Baru nyala, menyiapkan sensor/jaringan | Kedip hijau lambat |
| `ARMED` | Pemantauan aktif | Hijau nyala |
| `ALARM` | Gerakan/geofence terpicu | Merah kedip cepat |
| `FAULT` | Sensor penting gagal | Merah + hijau kedip bersamaan |

**Alur utama:**
1. Power ON → `INITIALIZING`
2. GPS fix valid → set `HOME` → masuk `ARMED`
3. MPU6050 shock melewati ambang ATAU jarak > geofence (30 m) → `ALARM`, buat event, LED merah
4. Blynk V2 bisa paksa tracking manual (untuk uji)
5. Tidak ada tombol, tidak ada buzzer, tidak ada perintah `power_off`

---

## 4. Fitur yang Sudah Diimplementasi (main.cpp)

- Inisialisasi WiFi + Blynk (non-blocking reconnect)
- Baca GPS NEO-6M via UART2 (TinyGPSPlus)
- Validasi GPS fix (`isValid()` + umur data < 5 detik)
- Set `HOME` otomatis dari GPS fix pertama yang valid
- Deteksi guncangan MPU6050 (magnitudo akselerasi > threshold)
- Geofence Haversine radius 30 m dari `HOME`
- Antrean event lokal dengan `event_id` unik
- Telemetri JSON ke Blynk V1
- Relay 1 (V3) dan Relay 2 blink (V4) via Blynk
- Pembacaan baterai via ADC GPIO34 + estimasi SoC kasar (3.0V–4.2V)
- Pola LED sesuai state machine
- Semua timing non-blocking (`millis()`, tidak ada `delay()` panjang)

---

## 5. Fitur Belum Diimplementasi / Belum Diubah ke HTTP

- **Web API / HTTPS** belum dipasang (sengaja, sesuai permintaan user)
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
| V1 | Keluar | Telemetri JSON (state, GPS, MPU, baterai) |
| V2 | Masuk | Paksa tracking manual (1=aktif, 0=mati) |
| V3 | Masuk | Relay 1 Active-LOW |
| V4 | Masuk | Relay 2 blink 500 ms |

---

## 7. File Struktur Penting

```
docs/SMARTGUARD_Core_v5.1_Clean.md     # Spesifikasi lengkap (baca dulu)
.agents/knowledge_transfer.md           # File ini
hardprogramming/Smart-Guard-Hardprog/src/main.cpp  # Firmware utama (diubah terakhir)
```

---

## 8. Aturan Penting Saat Mengubah Kode

1. **Jangan pasang HTTP/Web API** kecuali diminta secara eksplisit.
2. **Jangan commit kredensial produksi** (`BLYNK_AUTH_TOKEN`, WiFi password, API token) ke repo publik.
3. MPU6050 gagal → masuk state `FAULT`, **jangan** `while(1)` ngegantung.
4. GPS belum fix → koordinat `null`, `gps.fix = false`, jangan buat `HOME` palsu.
5. Semua loop harus non-blocking. Hindari `delay()` panjang.
6. Event alarm punya `event_id` unik untuk deduplikasi nanti saat dikirim ke server.
7. Kalibrasi `shockThreshold`, `GEOFENCE_RADIUS_M`, dan pembagi tegangan baterai di hardware nyata sebelum dipakai pada kendaraan.

---

## 9. Perhatian Khusus Baterai 18500

- Dipakai shield double 18500, tapi hanya **1 sel dipasang** untuk prototyping.
- Slot kosong jangan biarkan mencoret kontak logam.
- Pastikan polaritas sel terpasang benar.
- Estimasi SoC saat ini sangat kasar (hanya tegangan). Untuk akurasi lebih baik, ganti ke fuel gauge (MAX17048).

---

## 10. Roadmap Singkat (dari dokumen v5.1)

1. P1: Core sensor (GPS, MPU6050, LED, validasi fix) ✅ sebagian
2. P2: Security logic (HOME, geofence, state machine) ✅
3. P3: Baterai (charger, regulator, ADC/fuel gauge) ⚠️ ADC saja
4. P4: BLE (GATT status/diagnostik) ❌
5. P5: Wi-Fi/API (HTTPS heartbeat, telemetri, event) ❌ sengaja ditunda
6. P6: Event queue persistensi + kirim ulang ❌ RAM saja
7. P7: Power management (deep sleep, motion interrupt, timer wake) ❌
8. P8: Hardening & regresi ❌

---

Jika ada pertanyaan tentang bagian tertentu, tanya spesifik (mis. "bagaimana logika geofence?" atau "pin mana untuk Relay 2?").