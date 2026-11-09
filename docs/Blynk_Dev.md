# Blynk Development Guide — SMARTGUARD v5.1.1

Panduan pengembangan aplikasi Blynk untuk firmware **dumb device** ESP32 SMARTGUARD. Web/Blynk adalah otak; ESP32 hanya sensor + aktuator.

**LED tidak ada switch manual di Blynk.** LED dikontrol otomatis oleh firmware berdasarkan mode & alarm. Hanya **2 Relay** yang dikontrol dari aplikasi.

---

## 1. Ringkasan Virtual Pin

| VPIN | Widget Blynk | Tipe Data | Arah | Fungsi | Contoh Nilai |
|------|-------------|-----------|------|--------|--------------|
| **V1** | Value Display / Terminal | `String` (JSON) | Keluar | Telemetri lengkap (mode, GPS, MPU, baterai, relay, jarak HOME) | `{"mode":"armed","gps_fix":true,...}` |
| **V2** | Text Input / Terminal | `String` (JSON) | Masuk | Perintah JSON utama dari web ke ESP32 | `{"mode":"armed",...}` |
| **V3** | Switch | `int` (0/1) | Dua arah | Relay 1 (Active-LOW) | `0` = mati, `1` = nyala |
| **V4** | Switch | `int` (0/1) | Dua arah | Relay 2 blink 500 ms | `0` = mati, `1` = blink |
| V5 | — | — | — | **Tidak digunakan** (LED otomatis) | — |
| V6 | — | — | — | **Tidak digunakan** (LED otomatis) | — |
| **V7** | Segmented Switch / Dropdown | `String` | Masuk | Mode operasional | `"armed"`, `"overwatch"`, `"powersafe"` |
| **V8** | Value Display | `float` | Keluar | Jarak dari HOME (meter) | `4.8` atau `-1` |
| **V9** | Value Display | `float` | Keluar | Tegangan baterai (Volt) | `3.91` |
| **V10** | Value Display | `int` (0/1) | Keluar | Status GPS fix | `0` = belum, `1` = valid |

---

## 2. Mode Operasional (dikirim via V2 atau V7)

| Mode | Perilaku ESP32 | Alarm Otomatis? | Aktuator Otomatis? | LED |
|------|---------------|-----------------|-------------------|-----|
| **armed** | Evaluasi geofence di ESP32. Jarak > radius dari HOME → alarm | ✅ Ya | ✅ Ya | Hijau konstan |
| **overwatch** | Cuma baca sensor + kirim telemetri. Tidak ada alarm/aktuator otomatis | ❌ Tidak | ❌ Tidak | Hijau konstan |
| **powersafe** | MPU6050 deteksi getaran → `mpu_vibration = true`, GPS siap | ❌ Tidak | ❌ Tidak | Hijau kedip lambat |

**Ketika `alarm_active = true` (semua mode):** LED merah kedip cepat, hijau mati.

---

## 3. Contoh JSON Payload untuk V2 (perintah dari aplikasi ke ESP32)

### Mode ARMED
```json
{
	"mode": "armed",
	"geofence_radius_m": 30,
	"shock_threshold": 15,
	"home_valid": true,
	"home_lat": -7.797,
	"home_lng": 110.37,
	"relay1": 0,
	"relay2": 0,
	"alarm_active": false
}
```

### Mode OVERWATCH
```json
{
	"mode": "overwatch",
	"geofence_radius_m": 30,
	"shock_threshold": 15,
	"home_valid": true,
	"home_lat": -7.797,
	"home_lng": 110.37,
	"relay1": 0,
	"relay2": 0,
	"alarm_active": false
}
```

### Mode POWERSAFE
```json
{
	"mode": "powersafe",
	"geofence_radius_m": 30,
	"shock_threshold": 12,
	"home_valid": false,
	"home_lat": 0,
	"home_lng": 0,
	"relay1": 0,
	"relay2": 0,
	"alarm_active": false
}
```

---

## 4. Contoh Telemetri JSON dari ESP32 (V1)

ESP32 mengirim tiap 3 detik ke V1:

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

---

## 5. Feedback Loop (ESP32 → Blynk)

ESP32 menulis balik ke widget setiap loop agar tampilan sinkron dengan kondisi fisik:

| VPIN | Nilai yang ditulis balik |
|------|------------------------|
| V3 | `g_cmd.relay1` (0/1) |
| V4 | `g_cmd.relay2` (0/1) |
| V8 | `dist_home_m` (float) |
| V9 | `g_battVoltage` (float) |
| V10 | `gpsFixValid() ? 1 : 0` |

> Catatan: `Blynk.virtualWrite()` di perangkat yang sama **tidak** memicu `BLYNK_WRITE()`, jadi tidak akan造成 looping.

---

## 6. Langkah Setup di Aplikasi Blynk

1. Buat project baru di Blynk, pilih hardware **ESP32**.
2. Catat `BLYNK_AUTH_TOKEN`, masukkan ke `hardprogramming/Smart-Guard-Hardprog/src/config.h`.
3. Buat widget sesuai tabel di bagian 1 (hanya V1–V4, V7–V10; **jangan buat V5/V6**).
4. Untuk V2, gunakan widget **Text Input** atau **Terminal** yang bisa mengirim string JSON bebas.
5. Untuk V7, gunakan **Segmented Switch** atau **Dropdown** dengan opsi: `armed`, `overwatch`, `powersafe`.
6. Untuk V3–V4, gunakan widget **Switch** (baca/tulis).
7. Upload firmware ke ESP32, buka Serial Monitor (baud 115200).

---

## 7. Catatan Penting

- **Tipe data:** V1 dan V2 adalah `String` (JSON). V3–V4, V10 adalah `int` (0/1). V7 adalah `String`. V8, V9 adalah `float`.
- **Relay Active-LOW:** Nilai `1` di Blynk = sinyal LOW = relay NYALA. Nilai `0` = sinyal HIGH = relay MATI.
- **LED otomatis:** tidak ada switch LED di Blynk. Merah kedip saat alarm, hijau konstan saat armed/overwatch, hijau kedip lambat saat powersafe.
- **Kredensial:** Jangan commit `config.h` ke git. File sudah di-gitignore. Gunakan `config.h.example` sebagai template.
- **WiFi dulu:** Kode menunggu WiFi terhubung sebelum memulai Blynk (hindari crash `xQueueSemaphoreTake`).
- **Dumb device:** ESP32 tidak membuat keputusan keamanan sendiri kecuali mode `armed` (geofence lokal) dan `powersafe` (getaran lokal). Semua keputusan alarm utama ada di sisi web.

---