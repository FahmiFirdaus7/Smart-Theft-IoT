# Smart-Guard-Hardprog — Firmware ESP32 SMARTGUARD

Firmware **dumb device** untuk prototipe anti-curi kendaraan: ESP32 membaca GPS + MPU6050 + baterai, mengirim telemetri mentah ke Web API, dan mengeksekusi perintah (relay/LED/mode) dari web. **Keamanan dan geofence ditentukan di server**, bukan di ESP32.

Dokumen spesifikasi lengkap: [`docs/SMARTGUARD_Core_v5.1_Clean.md`](../../docs/SMARTGUARD_Core_v5.1_Clean.md) · Panduan web testing: [`docs/Web_Testing.md`](../../docs/Web_Testing.md)

## Struktur

```
Smart-Guard-Hardprog/
├── platformio.ini           # Env: esp32doit-devkit-v1, monitor 115200
├── src/
│   ├── main_1.cpp           # Hardware glue: WiFi, sensor, HTTP, aktuator
│   ├── smartguard_core.h    # Logika inti (parsing, telemetri, LED, getaran)
│   ├── config.h             # Kredensial — GITIGNORED, jangan di-commit
│   └── config.h.example     # Template config.h (isi placeholder)
├── test/
│   ├── run_tests.ps1        # Test tanpa hardware (build + unit + integrasi)
│   ├── host/test_core.cpp   # Unit test smartguard_core.h (g++)
│   └── integration/         # Simulasi ESP32 ke web-testing/server.js
└── .pio/                    # Hasil build (gitignored)
```

## Hardware & Pin Mapping (ESP32 DevKit V1)

| Komponen | GPIO | Keterangan |
|----------|------|------------|
| GPS NEO-6M TX → RX ESP32 | 16 | UART2 RX, 9600 baud |
| GPS NEO-6M RX ← TX ESP32 | 17 | UART2 TX |
| MPU6050 SDA | 21 | I2C |
| MPU6050 SCL | 22 | I2C |
| Relay 1 (Active-LOW) | 32 | `relay1=1` → LOW → nyala |
| Relay 2 (Active-LOW) | 33 | `relay2=1` → blink 500 ms |
| LED Hijau | 25 | Indikator mode (otomatis) |
| LED Merah | 26 | Alarm: kedip 300 ms (otomatis) |
| Battery ADC | 34 | Input-only, pembagi tegangan 2:1 |

> Sensor gerak: **MPU6050/GY-521** via library `Adafruit MPU6050`.

## Mode Operasional

| Mode | Perilaku |
|------|----------|
| `armed` | Kirim telemetri; alarm **hanya** dari command web (geofence di server) |
| `overwatch` | Default — monitoring pasif, tanpa alarm otomatis |
| `powersafe` | Vibration monitor; GPS tetap nyala (belum ada load switch) |

`mpu_vibration` diisi di semua mode: `true` saat getaran melewati `shock_threshold`, dan bertahan 5 detik setelah guncangan terakhir.

LED dikontrol otomatis oleh firmware (hijau konstan armed/overwatch, hijau kedip 1 s powersafe, merah kedip 300 ms saat `alarm_active`). Tidak ada switch LED manual.

## Konektivitas (HTTP murni, tanpa Blynk)

- `POST {WEB_API_URL}/api/telemetry` tiap 3 detik — payload JSON (lihat `docs/Web_Testing.md` §7)
- `GET {WEB_API_URL}/api/command` polling tiap 3 detik — balasan berisi `mode`, `relay1`, `relay2`, `alarm_active`, `geofence_radius_m`, `shock_threshold`, `home_*`
- **Tidak ada dependensi Blynk** — `platformio.ini`, `config.h`, dan firmware sudah bersih dari Blynk.
- WiFi reconnect otomatis dengan exponential backoff (2 s → 60 s), jadi gagal connect saat boot tidak membuat perangkat offline permanen.
- Header opsional: `X-Api-Key` (`WEB_API_KEY`) dan `X-Device-Id` (`DEVICE_ID`) bila server memerlukannya.

## Optimasi v5.2.0

- Blynk dihapus total (library, virtual pin, auth token) → firmware lebih kecil & tidak ada jalur kontrol kedua.
- Logika inti dipindah ke `smartguard_core.h` supaya bisa diuji tanpa hardware.
- **Fix LED:** alarm/powersafe sebelumnya hanya menyala ~1 ms per siklus; sekarang kedip benar (300 ms / 1 s).
- **Fix telemetri tanpa GPS fix:** `lat`/`lng` dikirim `null`, bukan `0,0`. Sebelumnya server bisa menganggap `(0,0)` koordinat valid dan memicu alarm geofence palsu.
- **Fix command parsial:** `{alarm_active:true}` tidak lagi mereset `relay1`/`relay2`/`mode`.
- **Fix WiFi:** reconnect otomatis + backoff.
- ADC baterai dirata-rata 8 sampel, plus opsi `BATTERY_CALIBRATION`.
- Buffer UART GPS 1024 byte agar NMEA tidak hilang saat request HTTP lambat.
- Interval, timeout, dan retry memakai konstanta yang bisa dioverride dari `config.h`.
- Nilai `shock_threshold` & `geofence_radius_m` di-clamp ke rentang aman.

## Build, Upload & Test

```powershell
# 1. Siapkan config.h (sekali saja)
copy src\config.h.example src\config.h   # lalu isi WiFi + WEB_API_URL

# 2. Build / upload
pio run
pio run -t upload
pio device monitor                       # baud 115200

# 3. Test tanpa hardware (tidak perlu ESP32)
.\test\run_tests.ps1
.\test\run_tests.ps1 -SkipIntegration    # unit test saja
```

`run_tests.ps1` akan:
1. meng-compile `smartguard_core.h` dengan g++ (butuh MSYS2/MinGW),
2. menjalankan 91 unit test (parsing command, telemetri, LED, getaran, baterai, Haversine),
3. menjalankan `web-testing/server.js` dan mensimulasikan ESP32: telemetri dibuat oleh kode C++ asli, command server diparse oleh kode C++ asli.

Test integrasi memakai `X-Device-Id` unik dan geofence sementara yang dihapus lagi, jadi data dashboard tidak tersentuh. Jika port 3001 sedang dipakai, test integrasi otomatis dilewati.

Pastikan `WEB_API_URL` menunjuk IP komputer yang menjalankan `web-testing/server.js` (port 3001) dan ESP32 satu jaringan WiFi. Untuk akses dari luar LAN, pakai URL tunnel **cloudflared** (`https://....trycloudflare.com`) — penjelasannya di [`../../README.md`](../../README.md) §4.

## Aturan

1. Jangan commit `config.h` (berisi kredensial asli).
2. **Jangan menambahkan kembali Blynk** — kontrol perangkat hanya lewat Web API.
3. ESP32 tidak mengevaluasi geofence — jangan tambahkan logika alarm lokal; server (`server.js`) yang menentukan `alarm_active`.
4. Semua loop non-blocking (`millis()`), tanpa `delay()` panjang.
5. Perubahan logika inti harus disertai test di `test/host/test_core.cpp`.
