# SMARTGUARD Web (frontend)

Dashboard statis (HTML + CSS + JavaScript) untuk SMARTGUARD v5.1. Tidak butuh framework
atau build step. Peta memakai Leaflet dari CDN.

## Struktur
| File | Fungsi |
|---|---|
| `dashboard.html` | Seluruh dashboard: peta, tab Status / Zona Aman / Riwayat, form zona |
| `motor3d.js` | Avatar 3D kendaraan (three.js via CDN) — proyeksi orientasi pitch/roll MPU di tab Status |
| `motor-default.png` | Avatar default (render motor) — tampil saat 3D belum siap/gagal dimuat |
| `config.js` | **Satu-satunya file yang perlu Anda ubah**: URL API, device ID, polling, mode demo |
| `sw.js` | Service worker untuk Web Push |
| `tailwind.config.js` | Konfigurasi Tailwind (opsional, dashboard memakai CSS inline) |

## Tab dashboard
- **Status** — kondisi kendaraan, mode, baterai, GPS, jarak ke zona, tombol admin, dan
  kartu **Posisi Kendaraan**: motor 3D yang memproyeksikan orientasi live (`motion.pitch_deg`/`roll_deg`
  dari backend, fallback `mpu_ax/ay/az`) + pembacaan pitch/roll/getaran. Warna LED modul & cincin
  lantai mengikuti tone status. **Avatar default** berupa gambar motor (`motor-default.png`) tampil
  langsung saat 3D belum siap atau three.js gagal dimuat (chip "3D tidak tersedia"); **saat perangkat
  offline avatar di-blur** + label "Offline — tampilan terakhir".
- **Zona Aman** — daftar multi-home / safe zone: tambah, ubah, aktif-nonaktif, hapus.
  Semua zona digambar di peta sebagai lingkaran. Aman bila kendaraan berada di dalam
  minimal satu zona aktif (logika OR, dihitung server).
- **Riwayat** — riwayat kejadian alarm/baterai/perangkat, dengan filter dan "Muat lebih banyak".

Tab bisa dibuka langsung lewat hash: `#status`, `#zona`, `#riwayat`.

## Konfigurasi dan menjalankan
1. Edit `config.js`: isi `API_BASE` (kosong bila API satu origin), `DEVICE_ID`, dan
   `VAPID_PUBLIC_KEY` bila memakai push.
2. Jalankan backend: `cd Web/Backend && npm start` lalu buka `http://127.0.0.1:8000/`.
3. Coba tanpa backend: buka `dashboard.html?demo=armed` (atau `alarm`, `offline`,
   `nofix`, `fault`) lewat server statis.

## Web Testing (debug)
Web-testing dipasang sebagai sub-app di **port yang sama** dengan backend produksi:

- Dashboard uji: `http://<host>:<port>/_testing/`
- Halaman Debug: `http://<host>:<port>/_testing/#/debug`
- Zona: `http://<host>:<port>/_testing/#/zones`

Tombol Web Testing di dashboard otomatis menunjuk ke `/_testing/`. Bisa dioverride
dengan `?testing=http://host:port/` (disimpan di browser) atau `TESTING_URL` di
`config.js`. Route bisa diganti lewat `SMARTGUARD_TESTING_ROUTE` dan dimatikan dengan
`SMARTGUARD_TESTING=0`.

## Aturan yang sudah diterapkan
- Offline dihitung dari `next_heartbeat_due_at` + `GRACE_S`, tidak pernah ditampilkan
  sebagai "aman".
- Tanpa GPS fix, peta menampilkan lokasi valid terakhir dengan tanda pudar.
- Tidak ada tombol mematikan perangkat; "Akui" hanya menandai alarm sudah dilihat.
- Tidak ada device token di browser; token pengguna disimpan di `sessionStorage`.
- Zona baru langsung aktif. Bila belum ada zona, HOME tunggal + radius lama tetap dipakai.
