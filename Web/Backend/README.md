# SMARTGUARD Backend (JavaScript)

Backend SMARTGUARD versi **Node.js + Express + SQLite** — pengganti versi Python/FastAPI.
API-nya kompatibel penuh dengan versi lama, jadi firmware `main_1.cpp` dan frontend
`Web/Frontend/dashboard.html` **tidak perlu diubah sama sekali**.

- Bahasa sama dengan frontend → satu ekosistem, satu cara debug.
- SQLite dibaca lewat modul bawaan `node:sqlite` (tanpa kompilasi native).
- Satu koneksi database dibuka seumur hidup proses.
- File statis disajikan dengan `ETag` + `304 Not Modified` supaya muat ulang dashboard cepat.

Versi Python yang lama ada di [`archive/`](archive/README.md), dan snapshot permanennya
dirilis sebagai [release **backend python**](https://github.com/FahmiFirdaus7/Smart-Theft-IoT/releases/tag/backend-python).

## Prasyarat

| Alat | Versi minimal |
|------|---------------|
| Node.js | 22.5 (modul `node:sqlite`) — di mesin ini: v24.18.0 |
| npm | 11+ |

## Menjalankan

```powershell
cd Web/Backend
npm install        # sekali saja
npm start          # http://127.0.0.1:8000/
```

Development dengan reload otomatis saat file diubah:

```powershell
npm run dev
```

Saat server hidup, banner akan menampilkan URL, lokasi database, dan daftar device.

## Uji

Server harus sudah jalan, lalu buka terminal kedua:

```powershell
npm test               # node test_api.js     — endpoint /api/v1/...
npm run test:firmware  # node test_firmware.js — kompatibilitas firmware + file statis
```

`test_firmware.js` **menulis data uji** (event alarm & titik lokasi) ke database. Untuk
mengujinya tanpa menyentuh data asli, jalankan server dengan database salinan:

```powershell
$env:SMARTGUARD_DB = "$env:TEMP\sg-uji.db"
Copy-Item smartguard.db $env:SMARTGUARD_DB -Force
npm start
```

## Konfigurasi lewat `.env`

Semua variabel di bawah **opsional** — server tetap jalan tanpa `.env` karena semuanya
punya default. Buat file `.env` hanya bila ingin mengganti default-nya (mis. token asli)
tanpa perlu mengetik env di PowerShell tiap kali:

```powershell
cd Web/Backend
Copy-Item .env.example .env
notepad .env        # isi token asli, lalu simpan
npm start
```

`server.js` memuat `.env` lewat `process.loadEnvFile()` **bawaan Node** — tidak ada
dependensi tambahan. File `.env` sudah masuk `.gitignore` (hanya `.env.example` yang
di-commit), jadi token tidak akan ikut ter-push.

Urutan prioritas: **environment/shell > `.env` > default**.
Jadi `$env:PORT=9000; npm start` tetap menang atas isi `.env`.

## Variabel lingkungan

Semua nama variabel sama dengan versi Python.

| Variabel | Default | Fungsi |
|----------|---------|--------|
| `PORT` | `8000` | Port HTTP |
| `HOST` | `0.0.0.0` | Alamat ikat. `127.0.0.1` bila hanya ingin bisa diakses dari komputer ini |
| `SMARTGUARD_DB` | `smartguard.db` | Lokasi basis data SQLite |
| `SMARTGUARD_WEB_DIR` | `../Frontend` | Folder frontend yang disajikan |
| `SMARTGUARD_DEVICE_TOKENS` | `sg-device-001=dev-token-ganti-ini` | Daftar `device=token` dipisah koma |
| `SMARTGUARD_LEGACY_DEVICE` | `sg-device-001` | Device untuk endpoint legacy `/api/telemetry` |
| `SMARTGUARD_LEGACY_KEY` | *(kosong)* | Bila diisi, firmware wajib kirim header `X-Api-Key` |
| `SMARTGUARD_CORS_ORIGINS` | *(kosong)* | Daftar origin, dipisah koma. Hanya bila frontend di origin lain |
| `LOCATION_RETENTION_DAYS` | `30` | Lama riwayat lokasi disimpan |
| `SMARTGUARD_ACCESS_LOG` | `0` | `1` untuk mencetak satu baris log tiap request |

Contoh memakai token acak:

```powershell
$env:SMARTGUARD_DEVICE_TOKENS = "sg-device-001=tokenacakpanjang"
npm start
```

ESP32 mengirim header `Authorization: Bearer <token>`.

## Endpoint

Pembungkus respons selalu `{"ok": bool, "data": ..., "error": string|null}` — dua endpoint
legacy di bawah adalah pengecualian (JSON polos, karena firmware membacanya langsung).

### Perangkat (Bearer token)

| Method & path | Fungsi |
|---------------|--------|
| `POST /api/v1/devices/{id}/heartbeat` | Denyut jantung → `next_heartbeat_seconds` |
| `POST /api/v1/devices/{id}/telemetry` | Laporan status + titik lokasi |
| `POST /api/v1/devices/{id}/events` | Terima event, `event_id` didedup |

### Dashboard

| Method & path | Fungsi |
|---------------|--------|
| `GET /api/v1/devices/{id}/status` | Status + `connection` online/offline/never |
| `GET /api/v1/devices/{id}/location` | Posisi GPS terakhir |
| `GET /api/v1/devices/{id}/locations` | Riwayat lokasi (`limit` 1–500, `since`) |
| `GET /api/v1/devices/{id}/battery` | Ringkasan baterai |
| `GET /api/v1/devices/{id}/events` | Daftar event (`limit` 1–100, `cursor`) |
| `POST /api/v1/devices/{id}/events/{event_id}/acknowledge` | Tandai sudah dibaca |
| `GET`/`PUT /api/v1/devices/{id}/command` | Baca/ubah mode, relay, geofence, dsb. |
| `POST /api/v1/devices/{id}/alarm/reset` | Lepas kunci alarm |
| `POST /api/v1/devices/{id}/home/current` | Jadikan posisi terkini sebagai titik awal |

### Legacy firmware `main_1.cpp`

| Method & path | Fungsi |
|---------------|--------|
| `POST /api/telemetry` | Telemetri JSON datar; server menentukan geofence & alarm |
| `GET /api/command` | Polling command (JSON polos) |

Rincian kontrak payload ada di [`archive/README.md`](archive/README.md) dan
`docs/SMARTGUARD_Core_v5.1_Clean.md` Bagian 7–8.

## Keamanan file statis

Server hanya menyajikan file yang ada di daftar putih:

- Berkas satu tingkat: `index.html`, `dashboard.html`, `config.js`, `sw.js`,
  `manifest.webmanifest`, `favicon.ico`
- Folder: `css/`, `js/`, `assets/`, `img/`, `icons/`, `fonts/`

`Backend/`, `archive/`, `smartguard.db`, `package.json`, dan `node_modules/` **tidak bisa
diunduh**. Path traversal (`../`, `%2e%2e`, backslash, path absolut) ditolak sebelum
menyentuh sistem berkas. Bila `css/app.css` belum ada (hasil build Tailwind), `/`
menampilkan `dashboard.html`.

## Catatan migrasi

Dibanding versi Python, satu-satunya perbedaan yang mungkin terlihat: dokumentasi API
otomatis (`/docs` Swagger) tidak dibawa ke versi ini, dan host bawaan berubah dari
`127.0.0.1` menjadi `0.0.0.0` supaya ESP32 di WiFi yang sama bisa terhubung
(set `HOST=127.0.0.1` untuk mengembalikannya). Daftar perbedaan lengkap ada di
[`archive/README.md`](archive/README.md).

Untuk mengembalikan versi Python, lihat bagian *Cara mengembalikan versi Python*
di folder arsip.
