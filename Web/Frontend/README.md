# SMARTGUARD Web (frontend)

Frontend statis (HTML + Tailwind CSS + JavaScript ES module) untuk dashboard SMARTGUARD v5.1.
Tidak butuh framework. Peta memakai Leaflet, ikon memakai Lucide (keduanya dimuat dari CDN dengan versi dikunci).

## Struktur
| File | Fungsi |
|---|---|
| `index.html` | Kerangka halaman: peta, panel status, dialog login |
| `config.js` | **Satu-satunya file yang perlu Anda ubah**: URL API, auth, VAPID, mode demo |
| `js/api.js` | Pemanggilan Web API, penanganan auth, dan data contoh (mode demo) |
| `js/map.js` | Peta interaktif: kendaraan, titik awal, geofence, titik alarm, satelit |
| `js/app.js` | Logika status (online/offline/gangguan), render, polling, push |
| `sw.js` | Service worker untuk Web Push |
| `css/input.css`, `tailwind.config.js` | Sumber Tailwind; hasil build ada di `css/app.css` |

## Konfigurasi dan menjalankan
1. Edit `config.js`: isi `API_BASE` (kosong bila API satu origin), `AUTH` (`cookie` atau `token`), dan `VAPID_PUBLIC_KEY`.
2. Coba tanpa backend: buka `index.html?demo=armed` (atau `alarm`, `offline`, `nofix`, `fault`) lewat server statis, misalnya `npx serve .`.
3. Deploy: unggah seluruh folder ke hosting statis (Netlify, Vercel, Cloudflare Pages, Nginx). **Wajib HTTPS** agar service worker dan push berfungsi.
4. Ubah gaya Tailwind: `npm install && npm run build`.

## Tanpa login (default sementara)
`AUTH: 'none'` di `config.js` menonaktifkan login. Frontend memakai endpoint Bagian 8.1 (`/devices/{id}/status`, `/devices/{id}/events`, `/devices/{id}/events/{event_id}/acknowledge`) dengan `DEVICE_ID` dari config. Karena API terbuka, batasi akses di server (jaringan/IP) dan aktifkan login (`cookie`/`token`) sebelum dipakai sungguhan.

## Endpoint mode login (Bagian 8.6 dokumen)
- `GET  {API_PREFIX}/me/devices`
- `GET  {API_PREFIX}/me/devices/{id}/status` (payload Bagian 7.2; waktu terakhir dilihat dari `last_seen_at`/`received_at` bila ada)
- `GET  {API_PREFIX}/me/devices/{id}/events?limit=20&cursor=...` (array atau `{items, next_cursor}`)
- `POST {API_PREFIX}/me/events/{event_id}/acknowledge`
- `PUT  {API_PREFIX}/me/notification-preferences` (menerima `{ "push_subscription": {...} }`)

Respons boleh polos atau dibungkus `{ok, data, error}`. Jika `DEVICE_ID` diisi, `/me/devices` tidak dipanggil.
Backend yang beda origin harus mengizinkan CORS (dengan `Access-Control-Allow-Credentials: true` untuk mode cookie).

## Aturan yang sudah diterapkan
- Offline dihitung dari `next_heartbeat_due_at` + `GRACE_S`, tidak pernah ditampilkan sebagai "aman".
- Tanpa GPS fix, peta menampilkan lokasi valid terakhir dengan tanda pudar.
- Tidak ada tombol mematikan perangkat; "Akui" hanya menandai alarm sudah dilihat.
- Tidak ada device token di browser; token pengguna disimpan di `sessionStorage`.
