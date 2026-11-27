# Web — Dashboard & API SMARTGUARD

Folder web proyek: **frontend** (dashboard) dan **backend** (Web API + penyaji file
statis). Alur komunikasinya dijelaskan di [`../README.md`](../README.md) §2–§4.

```
Web/
├── Frontend/   # Dashboard statis: HTML + Tailwind + JS ES module (Leaflet, Lucide)
├── Backend/    # Node.js + Express + SQLite — API + menyajikan Frontend
└── README.md   # ← file ini
```

## Mana yang dipakai?

| | [`Frontend/`](Frontend/README.md) | [`Backend/`](Backend/README.md) |
|---|---|---|
| Peran | Tampilan: peta, status, event, login | API untuk ESP32 & dashboard, database |
| Teknologi | HTML statis + Tailwind (tanpa framework) | Node.js ≥ 22.5 + Express + `node:sqlite` |
| Port | — (disajikan oleh Backend) | **8000** |

Menjalankan:

```powershell
cd Web/Backend
npm install    # sekali saja
npm start      # buka http://127.0.0.1:8000/
```

Backend menyajikan `Frontend/` langsung dari `/`, jadi **cukup jalankan Backend
satu-satunya proses** untuk melihat dashboard.

## Akses dari luar komputer (LAN / internet)

- **Dari ESP32 satu Wi-Fi:** `HOST` default `0.0.0.0`, jadi cukup pakai IP LAN
  komputer, mis. `http://192.168.x.x:8000`.
- **Dari luar jaringan:** pakai **cloudflared tunnel** — lihat
  [`../README.md`](../README.md) §4 (cloudflared itu apa?).

```powershell
& "C:\Program Files (x86)\cloudflared\cloudflared.exe" tunnel --url http://localhost:8000
```

## Catatan

- Versi backend Python (FastAPI) lama dipindah ke [`Backend/archive/`](Backend/archive/README.md).
- Untuk pengujian cepat tanpa database (data di memori), ada alternatif
  [`../web-testing/`](../web-testing/README.md) dengan port 3001 + dashboard React.
