import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { NavTabs } from './NavTabs'
import { API_BASE } from './apiBase'
import { computeZoneStatus, fetchZones, haversineM } from './zones'
import type { Geofence, ZoneStatus } from './zones'

/* -------------------------------------------------------------
   Zona Aman — daftar home location / save zone perangkat.
   Server menyimpan geofence PER device (header x-device-id) dengan
   logika OR: aman bila berada di DALAM minimal satu zona aktif.
   Zona baru selalu dibuat aktif (otomatis).
   ------------------------------------------------------------- */

/* -------------------------------------------------------------
   Banner status — dipakai halaman Zona & kartu di Dashboard
   ------------------------------------------------------------- */
function statusTone(st: ZoneStatus): { cls: string; title: string; sub: string } {
  if (!st.posValid) {
    return {
      cls: 'border-amber-300 bg-amber-50',
      title: 'Menunggu posisi GPS',
      sub: 'Perangkat belum mengirim koordinat valid — status zona belum bisa dihitung.',
    }
  }
  if (st.overall === 'nozone') {
    return {
      cls: 'border-border bg-muted/5',
      title: 'Belum ada zona aktif',
      sub: 'Tanpa zona, server menganggap semua posisi aman. Tambah zona agar perlindungan geofence benar-benar bekerja.',
    }
  }
  if (st.overall === 'inside') {
    const names = st.inside.map((z) => `"${z.name}"`).join(' atau ')
    return {
      cls: 'border-emerald-300 bg-emerald-50',
      title: `Aman — di dalam zona ${names}`,
      sub:
        `${st.inside.length} zona mencakup posisi ini` +
        (st.nearest ? ` · zona terdekat ${st.nearest.zone.name} ${st.nearest.dist_m} m` : ''),
    }
  }
  return {
    cls: 'border-red-300 bg-red-50',
    title: 'DI LUAR semua zona aktif',
    sub: st.nearest
      ? `Zona terdekat: ${st.nearest.zone.name} (${st.nearest.dist_m} m dari pusat, radius ${st.nearest.zone.radius_m} m) — server memicu alarm.`
      : 'Server memicu alarm karena perangkat tidak berada di zona manapun.',
  }
}

function StatusBanner({ st, alarm }: { st: ZoneStatus; alarm?: boolean }) {
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
   Kartu ringkas untuk halaman Dashboard
   ------------------------------------------------------------- */
export function ZoneStatusCard({ tele }: { tele: any }) {
  const [zones, setZones] = useState<Geofence[]>([])

  useEffect(() => {
    let alive = true
    const load = () => {
      fetchZones(API_BASE)
        .then((z) => { if (alive) setZones(z) })
        .catch(() => { /* server tidak terjangkau — biarkan data lama */ })
    }
    load()
    const id = window.setInterval(load, 5000)
    return () => { alive = false; window.clearInterval(id) }
  }, [])

  const st = computeZoneStatus(tele?.lat, tele?.lng, zones)
  const tone = statusTone(st)
  const good = st.overall === 'inside'
  const bad = st.overall === 'outside'

  return (
    <div className="card animate-fade-in">
      <div className="card-header">
        <h3 className="value-small">Zona Aman</h3>
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[0.625rem] font-semibold uppercase tracking-wide border ${
            good
              ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
              : bad
                ? 'bg-red-100 text-red-700 border-red-200'
                : 'bg-slate-100 text-slate-600 border-slate-200'
          }`}
        >
          {st.overall === 'inside' ? 'Di dalam' : st.overall === 'outside' ? 'Di luar' : st.overall === 'nozone' ? 'Tanpa zona' : 'Menunggu GPS'}
        </span>
      </div>
      <div className="card-body space-y-1.5">
        <p className={`text-sm font-semibold ${good ? 'text-emerald-700' : bad ? 'text-red-700' : 'text-text'}`}>
          {tone.title}
        </p>
        <p className="text-xs text-muted leading-relaxed">{tone.sub}</p>
        <a href="#/zones" className="text-xs font-semibold text-brand hover:underline">
          Kelola daftar zona &rarr;
        </a>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------
   Panel kartu — markup sama dengan halaman Debug
   ------------------------------------------------------------- */
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
   Halaman Zona
   ------------------------------------------------------------- */
export default function ZonesPage() {
  const [deviceId, setDeviceId] = useState('default')
  const [auto, setAuto] = useState(true)
  const [zones, setZones] = useState<Geofence[]>([])
  const [tele, setTele] = useState<any>(null)
  const [serverUp, setServerUp] = useState<boolean | null>(null)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [error, setError] = useState('')
  const [form, setForm] = useState({ name: '', lat: '', lng: '', radius: '30' })

  const refresh = useCallback(async () => {
    try {
      const headers: Record<string, string> = {}
      if (deviceId.trim()) headers['x-device-id'] = deviceId.trim()
      const [zRes, tRes] = await Promise.all([
        fetch(`${API_BASE}/api/geofences`, { cache: 'no-store', headers }),
        fetch(`${API_BASE}/api/telemetry`, { cache: 'no-store', headers }),
      ])
      setServerUp(true)
      if (zRes.ok) {
        const j = await zRes.json()
        if (Array.isArray(j)) setZones(j)
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

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  const st = computeZoneStatus(tele?.lat, tele?.lng, zones)
  const hasGps = st.posValid
  const receivedAt = tele?.received_at ? new Date(tele.received_at).getTime() : null
  const ageSec = receivedAt ? Math.max(0, Math.round((nowMs - receivedAt) / 1000)) : null
  const stale = ageSec !== null && ageSec > 10

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

  const addZone = async () => {
    const body = {
      name: form.name.trim(),
      lat: Number(form.lat),
      lng: Number(form.lng),
      radius_m: Number(form.radius),
    }
    if (!body.name || Number.isNaN(body.lat) || Number.isNaN(body.lng) || Number.isNaN(body.radius_m)) {
      setError('Nama wajib diisi; lat, lng, dan radius harus berupa angka.')
      return
    }
    if (body.lat < -90 || body.lat > 90 || body.lng < -180 || body.lng > 180) {
      setError('Lat/lng di luar rentang yang valid.')
      return
    }
    if (body.radius_m <= 0 || body.radius_m > 5000) {
      setError('Radius harus lebih dari 0 dan maksimal 5000 m.')
      return
    }
    const r = await call('POST', '/api/geofences', body)
    if (r.ok) {
      setError('')
      setForm((f) => ({ ...f, name: '' }))
      await refresh()
    } else setError(r.msg || 'Gagal menambah zona.')
  }

  const toggleZone = async (z: Geofence) => {
    const r = await call('PATCH', `/api/geofences/${z.id}`, { valid: !z.valid })
    if (r.ok) await refresh()
    else setError(r.msg || 'Gagal mengubah zona.')
  }

  const removeZone = async (z: Geofence) => {
    const r = await call('DELETE', `/api/geofences/${z.id}`)
    if (r.ok) await refresh()
    else setError(r.msg || 'Gagal menghapus zona.')
  }

  const useTelemetryPos = () => {
    if (!hasGps) return
    setForm((f) => ({ ...f, lat: String(tele.lat), lng: String(tele.lng) }))
  }

  const serverLabel = serverUp === null ? 'Memeriksa…' : serverUp ? 'Terhubung' : 'Tidak terjangkau'
  const serverTone = serverUp === null ? undefined : serverUp ? 'ok' : 'bad'

  return (
    <div className="page">
      <header className="mb-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5">
          <div>
            <h1 className="page-title">Zona Aman</h1>
            <p className="page-subtitle">Smart Theft IoT &nbsp;·&nbsp; daftar home location / save zone</p>
          </div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <NavTabs page="zones" />
            <span className={`status-badge ${serverUp ? 'status-badge--online' : 'status-badge--offline'}`}>
              <span className={`status-dot ${serverUp ? 'status-dot--online' : 'status-dot--offline'}`} />
              API {serverUp ? 'Online' : 'Offline'}
            </span>
          </div>
        </div>
      </header>

      <div className="space-y-3">
        {/* Koneksi & perangkat */}
        <Panel
          title="Perangkat"
          subtitle="Zona disimpan per device (header x-device-id) — sama dengan halaman Debug"
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
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
              <Chip
                label="Umur data"
                value={ageSec !== null ? `${ageSec} dtk` : serverUp ? 'belum ada data' : '—'}
                tone={ageSec === null ? undefined : stale ? 'warn' : 'ok'}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <Chip label="Zona tersimpan" value={String(zones.length)} />
            <Chip label="Zona aktif" value={String(st.active.length)} />
            <Chip
              label="Posisi"
              value={hasGps ? `${Number(tele.lat).toFixed(5)}, ${Number(tele.lng).toFixed(5)}` : 'belum ada'}
              tone={hasGps ? 'ok' : undefined}
            />
          </div>
          {stale && (
            <p className="text-xs text-amber-700 mt-2">
              Telemetri terakhir sudah {ageSec} detik lalu — perangkat mungkin berhenti mengirim.
            </p>
          )}
          {serverUp === false && (
            <p className="text-xs text-red-600 mt-2">
              API tidak terjangkau. Pastikan server berjalan (npm run dev:api atau npm start di Web/Backend).
            </p>
          )}
        </Panel>

        {/* Status zona */}
        <StatusBanner st={st} alarm={tele?.alarm_active === true} />

        {/* Daftar zona */}
        <Panel
          title="Zona Tersimpan"
          subtitle="Aman bila berada di dalam minimal satu zona aktif (logika OR, dihitung server)"
          right={<span className="caption">{zones.length} zona · {st.active.length} aktif</span>}
        >
          {zones.length === 0 ? (
            <p className="caption mb-3">
              Belum ada zona. Tambahkan zona pertama — zona baru langsung aktif otomatis.
            </p>
          ) : (
            <ul className="space-y-1.5 mb-3">
              {zones.map((z) => {
                const inside = st.posValid && z.valid && haversineM(tele.lat, tele.lng, z.lat, z.lng) <= z.radius_m
                const dist = st.posValid ? Math.round(haversineM(tele.lat, tele.lng, z.lat, z.lng)) : null
                const badge = !z.valid
                  ? { cls: 'bg-slate-100 text-slate-600 border-slate-200', label: 'Nonaktif' }
                  : inside
                    ? { cls: 'bg-emerald-100 text-emerald-700 border-emerald-200', label: 'Di dalam' }
                    : st.posValid
                      ? { cls: 'bg-red-100 text-red-700 border-red-200', label: 'Di luar' }
                      : { cls: 'bg-slate-100 text-slate-600 border-slate-200', label: 'Aktif' }
                return (
                  <li key={z.id} className="flex items-center justify-between gap-2 p-2.5 rounded-md bg-muted/5">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="value-small truncate">{z.name}</p>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[0.625rem] font-semibold uppercase tracking-wide border ${badge.cls}`}>
                          {badge.label}
                        </span>
                      </div>
                      <p className="mono text-muted truncate">
                        {z.lat.toFixed(6)}, {z.lng.toFixed(6)} &middot; r{z.radius_m} m
                        {dist !== null && ` · ${dist} m dari posisi`}
                      </p>
                    </div>
                    <div className="flex gap-1.5 shrink-0">
                      <button
                        className="btn btn--secondary"
                        onClick={() => void toggleZone(z)}
                      >
                        {z.valid ? 'Nonaktifkan' : 'Aktifkan'}
                      </button>
                      <button className="btn btn--ghost" onClick={() => void removeZone(z)} aria-label={`Hapus ${z.name}`}>
                        Hapus
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}

          <p className="section-title mb-2">Tambah zona</p>
          <div className="grid grid-cols-2 gap-2">
            <input
              className="input"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Nama (mis. rumah)"
              aria-label="Nama zona"
            />
            <input
              className="input"
              value={form.radius}
              onChange={(e) => setForm((f) => ({ ...f, radius: e.target.value }))}
              placeholder="Radius (m)"
              inputMode="decimal"
              aria-label="Radius meter"
            />
            <input
              className="input input--mono"
              value={form.lat}
              onChange={(e) => setForm((f) => ({ ...f, lat: e.target.value }))}
              placeholder="Latitude"
              inputMode="decimal"
              aria-label="Latitude"
              spellCheck={false}
            />
            <input
              className="input input--mono"
              value={form.lng}
              onChange={(e) => setForm((f) => ({ ...f, lng: e.target.value }))}
              placeholder="Longitude"
              inputMode="decimal"
              aria-label="Longitude"
              spellCheck={false}
            />
          </div>
          {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
          <div className="flex flex-wrap gap-2 mt-2">
            <button className="btn btn--primary" onClick={() => void addZone()}>Tambah zona</button>
            <button
              className="btn btn--secondary"
              disabled={!hasGps}
              onClick={useTelemetryPos}
              title={hasGps ? 'Isi lat/lng dari telemetri terakhir' : 'Belum ada GPS fix di telemetri'}
            >
              Pakai posisi telemetri
            </button>
          </div>
          <p className="caption mt-2">
            Zona baru otomatis aktif. Alarm dipicu otomatis oleh server saat perangkat berada di luar semua zona aktif.
          </p>
        </Panel>
      </div>

      <footer className="footer">
        <span>Web Testing &bull; Zona Aman</span>
        <span>Logika OR server-side: aman jika di dalam ≥1 zona aktif</span>
      </footer>
    </div>
  )
}
