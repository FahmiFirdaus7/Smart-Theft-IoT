# Arsip — Backend Python (FastAPI + SQLite)

Folder ini berisi **versi lama backend SMARTGUARD yang ditulis dalam Python/FastAPI**.
Versi ini sudah diganti backend JavaScript (Express + `node:sqlite`) yang ada di induk folder
`Web/Backend/`, dan seluruh berkasnya dipindah ke sini agar tetap terlacak riwayatnya.

> **Snapshot permanen:** versi Python ini juga dirilis di GitHub sebagai release
> **[backend python](https://github.com/FahmiFirdaus7/Smart-Theft-IoT/releases/tag/backend-python)**
> (tag `backend-python`, menunjuk commit `d717b19`). Bila folder ini suatu saat dihapus,
> kode aslinya masih bisa diunduh dari halaman release tersebut.

## Isi folder

| Berkas | Fungsi |
|--------|--------|
| `main.py` | Seluruh backend (633 baris): route, validasi payload, basis data, autentikasi, file statis |
| `requirements.txt` | Dependensi: `fastapi`, `uvicorn[standard]` |
| `test_api.py` | Uji hitung-ke-server untuk endpoint `/api/v1/...` (butuh server jalan) |
| `test_firmware.py` | Uji kompatibilitas firmware `main_1.cpp` + pemblokiran file statis |
| `README.fastapi.md` | README asli backend Python (sebelum dipindah ke sini) |
| `README (1).md` | Salinan README lama yang ikut ter-commit di repo |

Yang **tidak** ikut dipindah:

- `smartguard.db` — tetap di `Web/Backend/` karena dipakai backend baru (skemanya sama persis).
- `__pycache__/` — artefak build Python, dihapus dari repo (bisa dibuat ulang kapan saja).

## Menjalankan versi Python ini

Butuh Python 3.10+ dan port 8000 kosong.

```powershell
cd Web/Backend/archive
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn main:app --reload
```

- Dashboard: http://127.0.0.1:8000/
- Dokumentasi API otomatis (Swagger): http://127.0.0.1:8000/docs
- Uji: `python test_api.py` (terminal kedua) — pakai `python test_firmware.py` untuk uji firmware

> **Catatan:** `main.py` mencari frontend di `../Frontend` relatif terhadap lokasinya.
> Karena berkasnya kini ada di `archive/`, jalankan dengan `SMARTGUARD_WEB_DIR` menunjuk
> ke folder frontend, misalnya:
>
> ```powershell
> $env:SMARTGUARD_WEB_DIR = (Resolve-Path ../../Frontend).Path
> uvicorn main:app --reload
> ```
>
> Tanpa variabel itu halaman `/` akan kosong karena folder frontend tidak ditemukan.

## Ringkasan API (berlaku sama untuk versi Python & JavaScript)

Pembungkus respons selalu `{"ok": bool, "data": ..., "error": string|null}` kecuali dua
endpoint legacy yang membalas JSON polos untuk firmware.

### Dari perangkat (perlu `Authorization: Bearer <token>`)

| Method & path | Fungsi |
|---------------|--------|
| `POST /api/v1/devices/{id}/heartbeat` | Denyut jantung; membalas `next_heartbeat_seconds` |
| `POST /api/v1/devices/{id}/telemetry` | Laporan status + titik lokasi (Bagian 7.2) |
| `POST /api/v1/devices/{id}/events` | Terima event; `event_id` didedup (retry aman) |

### Dari dashboard (perlu device dikenal, tanpa token)

| Method & path | Fungsi |
|---------------|--------|
| `GET /api/v1/devices/{id}/status` | Status terbaru + `connection` online/offline/never |
| `GET /api/v1/devices/{id}/location` | Posisi GPS terakhir |
| `GET /api/v1/devices/{id}/locations` | Riwayat lokasi (`limit`, `since`) |
| `GET /api/v1/devices/{id}/battery` | Ringkasan baterai |
| `GET /api/v1/devices/{id}/events` | Daftar event (`limit`, `offset`/`cursor`) |
| `POST /api/v1/devices/{id}/events/{event_id}/acknowledge` | Tandai event sudah dibaca |
| `GET`/`PUT /api/v1/devices/{id}/command` | Baca/ubah perintah (mode, relay, geofence, dsb.) |
| `POST /api/v1/devices/{id}/alarm/reset` | Lepas kunci alarm |
| `POST /api/v1/devices/{id}/home/current` | Jadikan posisi GPS terkini sebagai titik awal |

### Legacy firmware `main_1.cpp` (JSON polos, tanpa pembungkus)

| Method & path | Fungsi |
|---------------|--------|
| `POST /api/telemetry` | Telemetri JSON datar; server menentukan geofence & alarm |
| `GET /api/command` | Polling command dari server |

## Perbedaan kecil versi Python vs versi JavaScript

Perilaku yang **sama persis** (sudah diuji dengan `test_api.py` dan `test_firmware.py`
yang dijalankan terhadap kedua versi): bentuk respons, kode status, pesan error validasi,
dedup event, status offline dari interval + grace 5 menit, alarm terkunci, pemblokiran
file statis (daftar putih + anti path traversal), dan retensi lokasi 30 hari.

Perbedaan yang diketahui, semuanya tidak memengaruhi firmware maupun frontend:

| Hal | Python (FastAPI) | JavaScript (Express) |
|-----|------------------|----------------------|
| Skrip uji | `test_api.py`, `test_firmware.py` | `test_api.js`, `test_firmware.js` |
| Dokumentasi API otomatis | Ada (`/docs`, Swagger) | Tidak ada |
| Port bawaan | 8000 (`uvicorn`) | 8000 (`PORT` bisa diubah) |
| Host bawaan | 127.0.0.1 | 0.0.0.0 (agar ESP32 di WiFi sama bisa terhubung) |
| Koneksi database | Dibuka/tutup tiap request | Satu koneksi seumur proses |
| Pembulatan `round()` Python | Banker's rounding | `Math.round` (beda hanya pada angka `.5` tepat; ambang baterai 10/20 tetap sama) |
| Format waktu di payload | `+00:00` (pydantic) | `Z` (diterima identik oleh `new Date()`) |

## Cara mengembalikan versi Python

```powershell
cd Web/Backend
git mv archive/main.py archive/requirements.txt archive/test_api.py archive/test_firmware.py .
git mv archive/README.fastapi.md README.md
```

Lalu hapus `server.js`, `package.json`, `test_api.js`, `test_firmware.js`, dan jalankan
`uvicorn main:app --reload` seperti di atas. Atau cukup unduh snapshot dari release
[backend python](https://github.com/FahmiFirdaus7/Smart-Theft-IoT/releases/tag/backend-python).
