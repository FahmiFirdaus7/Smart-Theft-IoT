# Smart-Guard-Hardprog — Firmware ESP32 SMARTGUARD

Firmware **dumb device** untuk prototipe anti-curi kendaraan: ESP32 membaca GPS + MPU6050 + baterai, mengirim telemetri mentah ke Web API, dan mengeksekusi perintah (relay/LED/mode) dari web. **Keamanan dan geofence ditentukan di server**, bukan di ESP32.

Dokumen spesifikasi lengkap: [`docs/SMARTGUARD_Core_v5.1_Clean.md`](../../docs/SMARTGUARD_Core_v5.1_Clean.md) · Panduan web testing: [`docs/Web_Testing.md`](../../docs/Web_Testing.md)

## Struktur

```
Smart-Guard-Hardprog/
├── platformio.ini           # Env: esp32doit-devkit-v1, monitor 115200
├── src/
│   ├── main_1.cpp           # Firmware utama (HTTP client, Blynk dimatikan)
│   ├── config.h             # Kredensial — GITIGNORED, jangan di-commit
│   └── config.h.example     # Template config.h (isi placeholder)
├── include/  lib/  test/    # Default PlatformIO
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
| `powersafe` | Vibration monitor: getaran > `shock_threshold` → `mpu_vibration=true`. GPS tetap nyala (belum ada load switch) |

LED dikontrol otomatis oleh firmware (hijau konstan armed/overwatch, hijau kedip 1 s powersafe, merah kedip saat `alarm_active`). Tidak ada switch LED manual.

## Konektivitas (HTTP, tanpa Blynk)

- `POST {WEB_API_URL}/api/telemetry` tiap 3 detik — payload JSON (lihat `docs/Web_Testing.md` §7)
- `GET {WEB_API_URL}/api/command` polling tiap 3 detik — balasan berisi `mode`, `relay1`, `relay2`, `alarm_active`, `geofence_radius_m`, `shock_threshold`, `home_*`
- Blynk dikondisional `#define SEND_TO_BLYNK 0` — semua `Blynk.run()`/`virtualWrite()` nonaktif. Panduan virtual pin (bila diaktifkan lagi): `docs/dev/Blynk_Dev.md`

## Build & Upload

```powershell
# 1. Siapkan config.h (sekali saja)
copy src\config.h.example src\config.h   # lalu isi nilai asli

# 2. Build & upload (PlatformIO CLI atau VS Code extension)
pio run -t upload
pio device monitor   # baud 115200
```

Pastikan `WEB_API_URL` menunjuk IP komputer yang menjalankan `web-testing/server.js` (port 3001) dan ESP32 satu jaringan WiFi. Untuk akses dari luar LAN, pakai URL tunnel **cloudflared** (`https://....trycloudflare.com`) — penjelasannya di [`../../README.md`](../../README.md) §4.

## Aturan

1. Jangan commit `config.h` (berisi kredensial asli).
2. Jangan hidupkan Blynk tanpa keputusan tim (`SEND_TO_BLYNK`).
3. ESP32 tidak mengevaluasi geofence — jangan tambahkan logika alarm lokal; server (`server.js`) yang menentukan `alarm_active`.
4. Semua loop non-blocking (`millis()`), tanpa `delay()` panjang.
