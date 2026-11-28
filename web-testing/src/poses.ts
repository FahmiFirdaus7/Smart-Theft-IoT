/**
 * Tipe & helper bersama untuk fitur Posisi Aman (safe pose / orientasi MPU).
 *
 * Server (web-testing/server.js) menyimpan profil pose PER device (header
 * x-device-id) dengan logika OR: kendaraan aman bila orientasinya (pitch/roll)
 * masuk SALAH SATU profil aktif (envelope toleransi), dan pelanggaran hanya
 * dianggap nyata setelah bertahan beberapa detik (debounce server-side).
 * Saat kendaraan berjalan (speed_kmh > 5), cek pose dilewati.
 *
 * Pose dipakai untuk mendeteksi kendaraan yang tiba-tiba miring/diangkat —
 * yang tidak terlihat oleh deteksi getaran (magnitude gravitasi selalu ~9.8
 * m/s² di semua orientasi).
 */

export interface PoseProfile {
  id: string
  name: string
  /** Sudut pitch terkalibrasi (derajat, hidung naik/turun). */
  pitch: number
  /** Sudut roll terkalibrasi (derajat, miring kiri/kanan). */
  roll: number
  /** Toleransi pitch (derajat). */
  tol_pitch: number
  /** Toleransi roll (derajat). */
  tol_roll: number
  valid: boolean
}

/** Orientasi saat ini (derajat) hasil hitung dari telemetri. */
export interface VehiclePose {
  pitch: number
  roll: number
}

/** Ringkasan orientasi perangkat terhadap semua profil pose. */
export interface PoseStatus {
  /** true bila data MPU (pitch/roll) tersedia. */
  poseValid: boolean
  /** Orientasi saat ini (null bila data MPU tidak ada). */
  pose: VehiclePose | null
  /** Hanya profil berstatus aktif (valid). */
  active: PoseProfile[]
  /** Profil aktif yang mencakup orientasi saat ini. */
  inside: PoseProfile[]
  /** Profil aktif terdekat dari orientasi saat ini (null bila tak ada profil). */
  nearest: { profile: PoseProfile; d_pitch: number; d_roll: number } | null
  /**
   * inside  : orientasi masuk ≥1 profil aktif (aman)
   * outside : di luar semua envelope profil (server memicu alarm setelah debounce)
   * moving  : kendaraan berjalan — cek pose dilewati
   * nodata  : data MPU tidak tersedia
   * nozone  : tidak ada profil aktif (server menganggap selalu aman)
   */
  overall: 'inside' | 'outside' | 'moving' | 'nodata' | 'nozone'
}

/** Batas kecepatan: di atas ini cek pose dilewati (sama dengan server). */
export const POSE_SPEED_SKIP_KMH = 5

/**
 * Sudut orientasi dari telemetri: pakai mpu_pitch/mpu_roll bila ada,
 * fallback hitung dari mpu_ax/ay/az (rumus sama dengan firmware & server).
 */
export function computePose(tele: any): VehiclePose | null {
  if (tele == null) return null
  const p = tele.mpu_pitch
  const r = tele.mpu_roll
  if (typeof p === 'number' && Number.isFinite(p) && typeof r === 'number' && Number.isFinite(r)) {
    return { pitch: p, roll: r }
  }
  const ax = tele.mpu_ax
  const ay = tele.mpu_ay
  const az = tele.mpu_az
  if (![ax, ay, az].every((v: unknown) => typeof v === 'number' && Number.isFinite(v))) return null
  const radToDeg = 180 / Math.PI
  return {
    pitch: Math.atan2(ax, Math.sqrt(ay * ay + az * az)) * radToDeg,
    roll: Math.atan2(ay, az) * radToDeg,
  }
}

/** Hitung status perangkat terhadap daftar profil pose (sisi klien, selalu segar). */
export function computePoseStatus(tele: any, poses: PoseProfile[]): PoseStatus {
  const active = poses.filter((p) => p.valid)
  const pose = computePose(tele)
  const speed = typeof tele?.speed_kmh === 'number' ? tele.speed_kmh : 0

  if (!pose) return { poseValid: false, pose: null, active, inside: [], nearest: null, overall: 'nodata' }
  if (speed > POSE_SPEED_SKIP_KMH) return { poseValid: true, pose, active, inside: [], nearest: null, overall: 'moving' }
  if (active.length === 0) return { poseValid: true, pose, active, inside: [], nearest: null, overall: 'nozone' }

  const withDelta = active.map((profile) => ({
    profile,
    d_pitch: Math.abs(pose.pitch - profile.pitch),
    d_roll: Math.abs(pose.roll - profile.roll),
  }))
  const inside = withDelta
    .filter((d) => d.d_pitch <= d.profile.tol_pitch && d.d_roll <= d.profile.tol_roll)
    .map((d) => d.profile)
  const nearest = withDelta.reduce((m, d) =>
    Math.max(d.d_pitch / d.profile.tol_pitch, d.d_roll / d.profile.tol_roll) <
    Math.max(m.d_pitch / m.profile.tol_pitch, m.d_roll / m.profile.tol_roll) ? d : m, withDelta[0])

  return {
    poseValid: true,
    pose,
    active,
    inside,
    nearest: { profile: nearest.profile, d_pitch: Math.round(nearest.d_pitch * 10) / 10, d_roll: Math.round(nearest.d_roll * 10) / 10 },
    overall: inside.length > 0 ? 'inside' : 'outside',
  }
}

/**
 * Ambil daftar profil pose milik device dari server.
 * Catatan: endpoint /api/poses membalas ARRAY langsung (bukan envelope {ok,data}).
 */
export async function fetchPoses(base: string): Promise<PoseProfile[]> {
  const r = await fetch(`${base}/api/poses`, { cache: 'no-store' })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const j = await r.json()
  return Array.isArray(j) ? (j as PoseProfile[]) : []
}
