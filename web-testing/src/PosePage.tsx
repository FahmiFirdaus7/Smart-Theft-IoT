import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { NavTabs } from './NavTabs'
import { API_BASE } from './apiBase'
import { computePose, computePoseStatus, fetchPoses } from './poses'
import type { PoseProfile, PoseStatus } from './poses'
import MpuAvatar from './MpuAvatar'
import type { AvatarTone } from './MpuAvatar'
import TiltGauge from './TiltGauge'

/* -------------------------------------------------------------
   Posisi Aman — daftar profil orientasi (pitch/roll) aman perangkat.
   Server menyimpan profil pose PER device (header x-device-id) dengan
   logika OR: aman bila orientasi masuk minimal satu profil aktif
   (envelope toleransi). Dipakai mendeteksi kendaraan yang tiba-tiba
   miring/diangkat — yang tidak terbaca oleh deteksi getaran.
   ------------------------------------------------------------- */

/** Nada & copy status pose — dipakai halaman Posisi, kartu Dashboard, dan VehicleHero. */
export function statusTone(st: PoseStatus): { cls: string; title: string; sub: string } {
  if (!st.poseValid) {
    return {
      cls: 'border-amber-300 bg-amber-50',
      title: 'Menunggu data MPU',
      sub: 'Perangkat belum mengirim mpu_ax/ay/az (atau mpu_pitch/roll) — status pose belum bisa dihitung.',
    }
  }
  if (st.overall === 'moving') {
    return {
      cls: 'border-border bg-muted/5',
      title: 'Kendaraan berjalan — cek pose dilewati',
      sub: 'Sudut wajar berubah saat menikung/mengerem, jadi server hanya mengecek pose saat kendaraan diam (≤ 5 km/j).',
    }
  }
  if (st.overall === 'nozone') {
    return {
      cls: 'border-border bg-muted/5',
      title: 'Belum ada profil posisi aktif',
      sub: 'Tanpa profil, server menganggap semua orientasi aman. Tambah profil (mis. "standar samping") agar deteksi miring bekerja.',
    }
  }
  if (st.overall === 'inside') {
    const names = st.inside.map((p) => `"${p.name}"`).join(' atau ')
    return {
      cls: 'border-emerald-300 bg-emerald-50',
      title: `Aman — orientasi sesuai ${names}`,
      sub:
        `${st.inside.length} profil mencakup posisi ini` +
        (st.nearest
          ? ` · terdekat ${st.nearest.profile.name} (Δpitch ${st.nearest.d_pitch}°, Δroll ${st.nearest.d_roll}°)`
          : ''),
    }
  }
  return {
    cls: 'border-red-300 bg-red-50',
    title: 'DI LUAR semua profil posisi aman',
    sub: st.nearest
      ? `Profil terdekat: ${st.nearest.profile.name} (Δpitch ${st.nearest.d_pitch}°, Δroll ${st.nearest.d_roll}° melewati toleransi) — server memicu alarm setelah debounce ±3 detik.`
      : 'Server memicu alarm karena orientasi tidak sesuai profil manapun.',
  }
}

function StatusBanner({ st, alarm }: { st: PoseStatus; alarm?: boolean }) {
  const tone = statusTone(st)
  const good = st.overall === 'inside'
  const bad = st.overall === 'outside'
  return (
    <div className={`flex items-start justify-between gap-3 p-3.5 rounded-xl border animate-fade-in ${tone.cls}`}>
      <div className="min-w-0">
        <p className={`text-sm font-semibold ${good ? 'text-emerald-700' : bad ? 'text-red-700' : 'text-text'}`}>
          {tone.title}
        </p>
        <p className="text-xs text-muted mt-0.5 leading-relaxed">{tone.sub}</p>
      </div>
      {alarm && (
        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border bg-red-100 text-red-700 border-red-200 shrink-0">
          Alarm aktif
        </span>
      )}
    </div>
  )
}

/* -------------------------------------------------------------
   Kartu ringkas + avatar untuk halaman Dashboard
   ------------------------------------------------------------- */
export function PoseStatusCard({ tele }: { tele: any }) {
  const [poses, setPoses] = useState<PoseProfile[]>([])

  useEffect(() => {
    let alive = true
    const load = () => {
      fetchPoses(API_BASE)
        .then((p) => { if (alive) setPoses(p) })
        .catch(() => { /* server tidak terjangkau — biarkan data lama */ })
    }
    load()
    const id = window.setInterval(load, 5000)
    return () => { alive = false; window.clearInterval(id) }
  }, [])

  const st = computePoseStatus(tele, poses)
  const tone = statusTone(st)
  const good = st.overall === 'inside'
  const bad = st.overall === 'outside'

  return (
    <div className="card animate-fade-in">
      <div className="card-header">
        <h3 className="value-small">Posisi Aman</h3>
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[0.625rem] font-semibold uppercase tracking-wide border ${
            good
              ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
              : bad
                ? 'bg-red-100 text-red-700 border-red-200'
                : 'bg-slate-100 text-slate-600 border-slate-200'
          }`}
        >
          {good ? 'Sesuai' : bad ? 'Mencurigakan' : st.overall === 'moving' ? 'Berjalan' : st.overall === 'nozone' ? 'Tanpa profil' : 'Menunggu MPU'}
        </span>
      </div>
      <div className="card-body space-y-1.5">
        <p className={`text-sm font-semibold ${good ? 'text-emerald-700' : bad ? 'text-red-700' : 'text-text'}`}>
          {tone.title}
        </p>
        <p className="text-xs text-muted leading-relaxed">{tone.sub}</p>
        <a href="#/pose" className="text-xs font-semibold text-brand hover:underline">
          Kelola profil posisi &rarr;
        </a>
      </div>
    </div>
  )
}

function Panel({ title, subtitle, right, children }: {
  title: string
  subtitle?: string
  right?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="card animate-fade-in">
      <div className="card-header">
        <div>
          <h3 className="value-small">{title}</h3>
          {subtitle && <p className="caption">{subtitle}</p>}
        </div>
        {right}
      </div>
      <div className="card-body">{children}</div>
    </section>
  )
}

function Chip({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'warn' | 'bad' }) {
  const color = tone === 'ok' ? 'text-emerald-600' : tone === 'warn' ? 'text-amber-600' : tone === 'bad' ? 'text-red-600' : ''
  return (
    <div className="p-2 rounded-md bg-muted/5 text-center">
      <p className="section-title">{label}</p>
      <p className={`value-small mono mt-0.5 ${color}`}>{value}</p>
    </div>
  )
}

/* -------------------------------------------------------------
   Halaman Posisi
   ------------------------------------------------------------- */
export default function PosePage() {
  const [deviceId, setDeviceId] = useState('default')
  const [auto, setAuto] = useState(true)
  const [poses, setPoses] = useState<PoseProfile[]>([])
  const [tele, setTele] = useState<any>(null)
  const [serverUp, setServerUp] = useState<boolean | null>(null)
  const [error, setError] = useState('')
  const [form, setForm] = useState({ name: '', pitch: '', roll: '', tol_pitch: '5', tol_roll: '7' })

  const refresh = useCallback(async () => {
    try {
      const headers: Record<string, string> = {}
      if (deviceId.trim()) headers['x-device-id'] = deviceId.trim()
      const [pRes, tRes] = await Promise.all([
        fetch(`${API_BASE}/api/poses`, { cache: 'no-store', headers }),
        fetch(`${API_BASE}/api/telemetry`, { cache: 'no-store', headers }),
      ])
      setServerUp(true)
      if (pRes.ok) {
        const j = await pRes.json()
        if (Array.isArray(j)) setPoses(j)
      }
      if (tRes.status === 200) setTele(await tRes.json())
      else if (tRes.status === 204) setTele(null)
      setError('')
    } catch {
      setServerUp(false)
    }
  }, [deviceId])

  useEffect(() => {
    void refresh()
    if (!auto) return
    const id = window.setInterval(() => { void refresh() }, 2000)
    return () => window.clearInterval(id)
  }, [refresh, auto])

  // Push dari server: telemetri/command baru langsung tampil.
  useEffect(() => {
    const es = new EventSource(`${API_BASE}/api/events`)
    const onUpdate = () => { void refresh() }
    es.addEventListener('telemetry', onUpdate)
    es.addEventListener('command', onUpdate)
    return () => es.close()
  }, [refresh])

  const st = computePoseStatus(tele, poses)
  const livePose = st.pose
  const liveVibration = tele?.mpu_vibration === true
  const avatarTone: AvatarTone =
    st.overall === 'outside' ? 'bad'
      : st.overall === 'moving' || liveVibration ? 'warn'
        : st.overall === 'inside' ? 'ok'
          : 'idle'

  const call = useCallback(async (method: string, path: string, body?: unknown): Promise<{ ok: boolean; msg?: string }> => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (deviceId.trim()) headers['x-device-id'] = deviceId.trim()
    try {
      const res = await fetch(`${API_BASE}${path}`, {
        method,
        headers,
        cache: 'no-store',
        body: body !== undefined ? JSON.stringify(body) : undefined,
      })
      const j = await res.json().catch(() => null)
      if (!res.ok) {
        return { ok: false, msg: (j && typeof j.error === 'string' ? j.error : `HTTP ${res.status}`) }
      }
      return { ok: true }
    } catch (e) {
      return { ok: false, msg: e instanceof Error ? e.message : String(e) }
    }
  }, [deviceId])

  const addPose = async (fromTelemetry: boolean) => {
    const body: Record<string, unknown> = {
      name: form.name.trim(),
      tol_pitch: Number(form.tol_pitch),
      tol_roll: Number(form.tol_roll),
    }
    if (fromTelemetry) {
      body.from_telemetry = true
    } else {
      body.pitch = Number(form.pitch)
      body.roll = Number(form.roll)
      if (!body.name || Number.isNaN(body.pitch as number) || Number.isNaN(body.roll as number)) {
        setError('Nama wajib diisi; pitch dan roll harus berupa angka (atau pakai tombol kalibrasi).')
        return
      }
    }
    if (!body.name) {
      setError('Nama profil wajib diisi.')
      return
    }
    const r = await call('POST', '/api/poses', body)
    if (r.ok) {
      setError('')
      setForm((f) => ({ ...f, name: '', pitch: '', roll: '' }))
      await refresh()
    } else setError(r.msg || 'Gagal menambah profil posisi.')
  }

  const togglePose = async (p: PoseProfile) => {
    const r = await call('PATCH', `/api/poses/${p.id}`, { valid: !p.valid })
    if (r.ok) await refresh()
    else setError(r.msg || 'Gagal mengubah profil.')
  }

  const removePose = async (p: PoseProfile) => {
    const r = await call('DELETE', `/api/poses/${p.id}`)
    if (r.ok) await refresh()
    else setError(r.msg || 'Gagal menghapus profil.')
  }

  // "Ambil dari posisi sekarang": isi form dengan orientasi live dari telemetri.
  const snapFromTelemetry = () => {
    const pose = computePose(tele)
    if (!pose) {
      setError('Data MPU belum tersedia — tidak bisa mengambil orientasi saat ini.')
      return
    }
    setError('')
    setForm((f) => ({
      ...f,
      pitch: String(Math.round(pose.pitch * 10) / 10),
      roll: String(Math.round(pose.roll * 10) / 10),
    }))
  }

  const serverLabel = serverUp === null ? 'Memeriksa…' : serverUp ? 'Terhubung' : 'Tidak terjangkau'
  const serverTone = serverUp === null ? undefined : serverUp ? 'ok' : 'bad'

  return (
    <div className="page">
      <header className="mb-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5">
          <div>
            <h1 className="page-title">Posisi Aman</h1>
            <p className="page-subtitle">Smart Theft IoT &nbsp;·&nbsp; profil orientasi aman (pitch/roll MPU6050)</p>
          </div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <NavTabs page="pose" />
            <span className={`status-badge ${serverUp ? 'status-badge--online' : 'status-badge--offline'}`}>
              <span className={`status-dot ${serverUp ? 'status-dot--online' : 'status-dot--offline'}`} />
              API {serverUp ? 'Online' : 'Offline'}
            </span>
          </div>
        </div>
      </header>

      <div className="space-y-3">
        {/* Perangkat */}
        <Panel
          title="Perangkat"
          subtitle="Profil pose disimpan per device (header x-device-id) — sama dengan halaman Zona"
          right={<button className="btn btn--secondary" onClick={() => void refresh()}>Refresh</button>}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input
              className="input input--mono"
              value={deviceId}
              onChange={(e) => setDeviceId(e.target.value)}
              aria-label="Device ID"
              placeholder="default"
              spellCheck={false}
            />
            <div className="grid grid-cols-2 gap-2">
              <Chip label="Server" value={serverLabel} tone={serverTone} />
              <Chip label="Profil aktif" value={String(st.active.length)} />
            </div>
          </div>
          {serverUp === false && (
            <p className="text-xs text-red-600 mt-2">
              API tidak terjangkau. Pastikan server berjalan (npm run dev:api atau npm start di Web/Backend).
            </p>
          )}
        </Panel>

        {/* Avatar 3D + orientasi live */}
        <Panel
          title="Proyeksi Orientasi (MPU6050)"
          subtitle="Avatar 3D mengikuti pitch/roll live dari telemetri — geser untuk memutar kamera"
          right={
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 caption cursor-pointer">
                <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
                Auto-refresh 2 dtk
              </label>
              <button className="btn btn--secondary" onClick={() => void refresh()}>Refresh</button>
            </div>
          }
        >
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <MpuAvatar
              pitch={livePose?.pitch}
              roll={livePose?.roll}
              vibration={liveVibration}
              tone={avatarTone}
              stale={tele == null}
              staleLabel="ESP32 offline"
              height={280}
            />
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <TiltGauge pitch={livePose?.pitch} roll={livePose?.roll} tone={avatarTone} size={92} />
                <div className="flex-1 min-w-0">
                  <p className="caption">
                    Waterpass kendaraan — gelembung makin ke tepi berarti makin miring.
                    Titik warna mengikuti status pose.
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <Chip
                  label="Pitch"
                  value={livePose ? `${livePose.pitch.toFixed(1)}°` : '—'}
                  tone={livePose && st.overall === 'outside' ? 'bad' : livePose ? 'ok' : undefined}
                />
                <Chip
                  label="Roll"
                  value={livePose ? `${livePose.roll.toFixed(1)}°` : '—'}
                  tone={livePose && st.overall === 'outside' ? 'bad' : livePose ? 'ok' : undefined}
                />
                <Chip
                  label="Getaran"
                  value={liveVibration ? 'YA' : 'tidak'}
                  tone={liveVibration ? 'warn' : 'ok'}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Chip label="Profil tersimpan" value={String(poses.length)} />
                <Chip label="Profil aktif" value={String(st.active.length)} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Chip label="Device ID" value={deviceId || 'default'} />
                <Chip
                  label="Speed"
                  value={typeof tele?.speed_kmh === 'number' ? `${tele.speed_kmh.toFixed(1)} km/j` : '—'}
                  tone={st.overall === 'moving' ? 'warn' : undefined}
                />
              </div>
              <p className="caption">
                Pitch = hidung kendaraan naik/turun · Roll = miring kiri/kanan. Dihitung dari
                mpu_ax/ay/az (fallback otomatis bila firmware belum mengirim mpu_pitch/mpu_roll).
              </p>
            </div>
          </div>
        </Panel>

        {/* Status pose */}
        <StatusBanner st={st} alarm={tele?.alarm_active === true} />

        {/* Daftar profil */}
        <Panel
          title="Profil Posisi Tersimpan"
          subtitle="Aman bila orientasi masuk minimal satu profil aktif (logika OR + debounce 3 detik di server)"
          right={<span className="caption">{poses.length} profil · {st.active.length} aktif</span>}
        >
          {poses.length === 0 ? (
            <p className="caption mb-3">
              Belum ada profil. Parkirkan kendaraan pada posisi aman (mis. standar samping), lalu
              tekan "Kalibrasi dari posisi sekarang" untuk membuat profil pertama.
            </p>
          ) : (
            <ul className="space-y-1.5 mb-3">
              {poses.map((p) => {
                const matched = st.poseValid && p.valid && st.inside.some((i) => i.id === p.id)
                const dPitch = livePose ? Math.round(Math.abs(livePose.pitch - p.pitch) * 10) / 10 : null
                const dRoll = livePose ? Math.round(Math.abs(livePose.roll - p.roll) * 10) / 10 : null
                const badge = !p.valid
                  ? { cls: 'bg-slate-100 text-slate-600 border-slate-200', label: 'Nonaktif' }
                  : matched
                    ? { cls: 'bg-emerald-100 text-emerald-700 border-emerald-200', label: 'Sesuai' }
                    : st.poseValid
                      ? { cls: 'bg-red-100 text-red-700 border-red-200', label: 'Tidak sesuai' }
                      : { cls: 'bg-slate-100 text-slate-600 border-slate-200', label: 'Aktif' }
                return (
                  <li key={p.id} className="flex items-center justify-between gap-2 p-2.5 rounded-md bg-muted/5">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="value-small truncate">{p.name}</p>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[0.625rem] font-semibold uppercase tracking-wide border ${badge.cls}`}>
                          {badge.label}
                        </span>
                      </div>
                      <p className="mono text-muted truncate">
                        pitch {p.pitch}° ±{p.tol_pitch}° · roll {p.roll}° ±{p.tol_roll}°
                        {dPitch !== null && ` · Δpitch ${dPitch}° Δroll ${dRoll}°`}
                      </p>
                    </div>
                    <div className="flex gap-1.5 shrink-0">
                      <button className="btn btn--secondary" onClick={() => void togglePose(p)}>
                        {p.valid ? 'Nonaktifkan' : 'Aktifkan'}
                      </button>
                      <button className="btn btn--ghost" onClick={() => void removePose(p)} aria-label={`Hapus ${p.name}`}>
                        Hapus
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}

          <p className="section-title mb-2">Tambah profil posisi</p>
          <div className="grid grid-cols-2 gap-2">
            <input
              className="input"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Nama (mis. standar samping)"
              aria-label="Nama profil posisi"
            />
            <input
              className="input input--mono"
              value={form.pitch}
              onChange={(e) => setForm((f) => ({ ...f, pitch: e.target.value }))}
              placeholder="Pitch (derajat)"
              inputMode="decimal"
              aria-label="Pitch derajat"
              spellCheck={false}
            />
            <input
              className="input input--mono"
              value={form.roll}
              onChange={(e) => setForm((f) => ({ ...f, roll: e.target.value }))}
              placeholder="Roll (derajat)"
              inputMode="decimal"
              aria-label="Roll derajat"
              spellCheck={false}
            />
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="caption block mb-1" htmlFor="tol-pitch">Toleransi pitch (°)</label>
                <input
                  id="tol-pitch"
                  className="input"
                  value={form.tol_pitch}
                  onChange={(e) => setForm((f) => ({ ...f, tol_pitch: e.target.value }))}
                  inputMode="decimal"
                  aria-label="Toleransi pitch"
                />
              </div>
              <div>
                <label className="caption block mb-1" htmlFor="tol-roll">Toleransi roll (°)</label>
                <input
                  id="tol-roll"
                  className="input"
                  value={form.tol_roll}
                  onChange={(e) => setForm((f) => ({ ...f, tol_roll: e.target.value }))}
                  inputMode="decimal"
                  aria-label="Toleransi roll"
                />
              </div>
            </div>
          </div>
          {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
          <div className="flex flex-wrap gap-2 mt-2">
            <button className="btn btn--primary" onClick={() => void addPose(false)}>Tambah profil</button>
            <button
              className="btn btn--secondary"
              disabled={!livePose}
              onClick={snapFromTelemetry}
              title={livePose ? 'Isi pitch/roll dari orientasi MPU saat ini' : 'Data MPU belum tersedia'}
            >
              Ambil dari posisi sekarang
            </button>
            <button
              className="btn btn--secondary"
              disabled={!livePose}
              onClick={() => void addPose(true)}
              title={livePose ? 'Simpan profil dengan sudut persis seperti posisi kendaraan saat ini' : 'Data MPU belum tersedia'}
            >
              Kalibrasi &amp; simpan
            </button>
          </div>
          <p className="caption mt-2">
            Prosedur kalibrasi: parkirkan kendaraan pada posisi aman → diamkan ±30 detik → tekan
            "Kalibrasi &amp; simpan". Uji dengan memiringkan kendaraan pelan-pelan — pelanggaran harus
            bertahan ±3 detik sebelum alarm (mencegah false positive dari guncangan sesaat).
          </p>
        </Panel>
      </div>

      <footer className="footer">
        <span>Web Testing &bull; Posisi Aman</span>
        <span>Logika OR server-side: aman jika orientasi masuk ≥1 profil aktif</span>
      </footer>
    </div>
  )
}
