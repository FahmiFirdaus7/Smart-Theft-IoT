/**
 * Tipe & helper bersama untuk fitur Zona Aman (home location / save zone).
 *
 * Server (web-testing/server.js) menyimpan geofence PER device (header
 * x-device-id) dengan logika OR: perangkat aman bila berada di DALAM minimal
 * satu zona aktif (valid), dan alarm dipicu saat di luar SEMUA zona aktif.
 * Zona baru selalu dibuat valid/aktif otomatis.
 */

export interface Geofence {
  id: string
  name: string
  lat: number
  lng: number
  radius_m: number
  valid: boolean
}

/** Ringkasan posisi perangkat terhadap semua zona. */
export interface ZoneStatus {
  /** true bila koordinat perangkat tersedia & valid. */
  posValid: boolean
  /** Hanya zona berstatus aktif (valid). */
  active: Geofence[]
  /** Zona aktif yang mencakup posisi saat ini. */
  inside: Geofence[]
  /** Zona aktif terdekat dari posisi saat ini (null bila tak ada zona aktif). */
  nearest: { zone: Geofence; dist_m: number } | null
  /**
   * inside  : di dalam ≥1 zona aktif (aman)
   * outside : di luar semua zona aktif (server memicu alarm)
   * nopos   : perangkat belum punya koordinat valid
   * nozone  : tidak ada zona aktif (server menganggap selalu aman)
   */
  overall: 'inside' | 'outside' | 'nopos' | 'nozone'
}

/** Jarak Haversine dalam meter (rumus sama dengan server). */
export function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/** Hitung status perangkat terhadap daftar zona (dihitung di sisi klien, selalu segar). */
export function computeZoneStatus(
  lat: unknown,
  lng: unknown,
  zones: Geofence[],
): ZoneStatus {
  const active = zones.filter((g) => g.valid)
  const posValid =
    typeof lat === 'number' && typeof lng === 'number' &&
    !Number.isNaN(lat) && !Number.isNaN(lng)

  if (!posValid) return { posValid: false, active, inside: [], nearest: null, overall: 'nopos' }
  // Tanpa zona aktif server memperlakukan semua posisi sebagai di-dalam (aman).
  if (active.length === 0) return { posValid: true, active, inside: [], nearest: null, overall: 'nozone' }

  const withDist = active.map((zone) => ({ zone, dist: haversineM(lat as number, lng as number, zone.lat, zone.lng) }))
  const inside = withDist.filter((d) => d.dist <= d.zone.radius_m).map((d) => d.zone)
  const nearest = withDist.reduce((m, d) => (d.dist < m.dist ? d : m), withDist[0])
  return {
    posValid: true,
    active,
    inside,
    nearest: { zone: nearest.zone, dist_m: Math.round(nearest.dist) },
    overall: inside.length > 0 ? 'inside' : 'outside',
  }
}

/**
 * Ambil daftar zona milik device dari server.
 * Catatan: endpoint /api/geofences membalas ARRAY langsung (bukan envelope {ok,data}).
 */
export async function fetchZones(base: string): Promise<Geofence[]> {
  const r = await fetch(`${base}/api/geofences`, { cache: 'no-store' })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const j = await r.json()
  return Array.isArray(j) ? (j as Geofence[]) : []
}
