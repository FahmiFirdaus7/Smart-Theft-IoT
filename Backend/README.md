# SMARTGUARD Backend (awal)

FastAPI + SQLite. Letakkan folder ini sebagai `Backend/` sejajar dengan `Web/`:

```
Smart-Theft-IoT/
├── Backend/   (main.py, requirements.txt, test_api.py)
└── Web/       (index.html)
```

## Menjalankan server (Terminal)

First run
```powershell
cd Backend
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn main:app --reload
```

Continuous
```
  cd Backend
  Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
  .venv\Scripts\Activate.ps1
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
