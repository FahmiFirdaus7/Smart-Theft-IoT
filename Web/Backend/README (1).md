# SMARTGUARD Backend (awal)

FastAPI + SQLite. Folder ini berada di dalam `Web/`, dan `index.html` ada di folder induknya:

```
Smart-Theft-IoT/
└── Web/
    ├── index.html
    └── Backend/   (main.py, requirements.txt, test_api.py)
```

## Menjalankan (PowerShell)

```powershell
cd Backend
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn main:app --reload
```

- Dashboard: http://127.0.0.1:8000/ (otomatis melayani `Web/index.html`)
- Dokumentasi API otomatis: http://127.0.0.1:8000/docs
- Uji tanpa ESP32: buka terminal kedua, lalu `python test_api.py`

## Token perangkat

Default untuk lokal: `sg-device-001` / `dev-token-ganti-ini`. Ganti sebelum dipakai sungguhan:

```powershell
$env:SMARTGUARD_DEVICE_TOKENS="sg-device-001=tokenacakpanjang"
uvicorn main:app --reload
```

ESP32 mengirim header `Authorization: Bearer <token>`.

## Yang sudah / belum

Sudah: auth token per perangkat, validasi payload (400), dedup `event_id`,
status offline dari waktu laporan terakhir (interval + 5 menit toleransi),
`next_heartbeat_seconds` jadi 30 saat alarm aktif, status lama tidak menimpa yang baru.

Belum: login pengguna di endpoint dashboard, HTTPS, push notification
(sudah disiapkan fungsi `notify()` di `main.py`), retensi data lokasi,
dan penyambungan `Web/index.html` ke API (masih data dummy).

## Pembaruan v0.2: frontend baru dan firmware main_1.cpp

Struktur folder: `Web/` berisi frontend (`index.html`, `config.js`, `sw.js`, `css/`, `js/`) dan `Backend/` berada di dalamnya.
Server hanya menyajikan file pada daftar putih (`index.html`, `config.js`, `sw.js`, folder `css/` `js/` `assets/` `img/` `icons/` `fonts/`),
jadi `Backend/`, database, dan `.venv` tidak bisa diunduh. Pastikan `css/app.css` sudah dibuat (`npm install && npm run build` di folder `Web/`).

Endpoint tambahan:
- Firmware `main_1.cpp`: `POST /api/telemetry` (JSON datar) dan `GET /api/command` (JSON polos, tanpa pembungkus). Perangkat yang dipakai: `SMARTGUARD_LEGACY_DEVICE` (default `sg-device-001`).
- Pengaturan perangkat: `GET/PUT /api/v1/devices/{id}/command` (mode, relay, radius geofence, ambang guncangan, titik awal), `POST .../home/current`, `POST .../alarm/reset`.
- `GET .../events` mendukung `cursor` dan mengembalikan `next_cursor`.

Variabel lingkungan: `SMARTGUARD_LEGACY_KEY` (bila diisi, firmware wajib mengirim header `X-Api-Key`), `SMARTGUARD_CORS_ORIGINS` (hanya bila frontend di origin lain).
Uji: `python test_firmware.py` (pakai database kosong).
