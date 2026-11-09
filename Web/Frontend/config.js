// Konfigurasi frontend. Jangan taruh device token/secret di sini (file ini publik).
window.SG = {
  API_BASE: '',                 // '' = origin yang sama. Contoh: 'https://api.domainanda.com'
  API_PREFIX: '/api/v1',
  AUTH: 'none',                 // 'none' (tanpa login, sementara) | 'cookie' (sesi) | 'token' (Bearer)
  LOGIN_URL: '',                // mode cookie: halaman login backend (opsional)
  DEVICE_ID: 'sg-device-001',   // wajib diisi bila AUTH 'none'; kosong = ambil dari GET /me/devices
  POLL_MS: 15000,
  GRACE_S: 300,                 // toleransi setelah heartbeat berikutnya terlewat
  ACTIVE_TIMEOUT_S: 180,        // batas offline bila perangkat tidak dalam mode tidur
  VAPID_PUBLIC_KEY: '',         // kunci publik Web Push
  DEMO: false,                  // true / atau buka ?demo=alarm|offline|nofix|fault untuk data contoh
  ATTR: '© OpenStreetMap, CARTO, Esri',
  TILES: {
    street: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    satellite: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
  }
};
