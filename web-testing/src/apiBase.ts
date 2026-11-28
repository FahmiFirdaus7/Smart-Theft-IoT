/**
 * Basis URL API untuk dashboard web-testing.
 *
 * - Dev (Vite :5173): API berjalan terpisah di :3001.
 * - Produksi: disajikan dari server yang sama. Prefix diambil dari lokasi
 *   halaman sehingga berfungsi baik di root (server standalone :3001, prefix "")
 *   maupun di route tersembunyi web utama (mis. /_testing/ di :8000, prefix
 *   "/_testing"). Hash routing (#/debug) tidak mempengaruhi window.location.pathname.
 */
const DEV_API = 'http://localhost:3001'

function detectPrefix(): string {
  if (import.meta.env.DEV) return DEV_API
  // "/_testing/" -> "/_testing"; "/_testing/index.html" -> "/_testing"; "/" -> ""
  return window.location.pathname.replace(/\/index\.html$/, '').replace(/\/$/, '')
}

/** Dipakai fetch()/EventSource: prefix relatif-ke-origin, mis. "/_testing/api/...". */
export const API_BASE = detectPrefix()

/** Alamat API lengkap (origin + prefix) sebagai default input di halaman Debug. */
export const DEFAULT_API_BASE = import.meta.env.DEV
  ? DEV_API
  : window.location.origin + detectPrefix()

/**
 * Alamat dashboard pengguna (Web/Frontend/dashboard.html, disajikan Web/Backend).
 * Saat terpasang di web utama (/_testing/), dashboard pengguna ada di root origin.
 * Saat standalone (:3001), asumsikan backend di :8000 — ubah di sini bila berbeda.
 */
export const USER_DASHBOARD_URL = (() => {
  const override = (window as any).SG_USER_DASHBOARD_URL
  if (typeof override === 'string' && override) return override
  return detectPrefix().includes('/_testing') ? '/' : 'http://localhost:8000/'
})()
