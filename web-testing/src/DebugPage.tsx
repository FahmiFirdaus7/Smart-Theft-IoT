import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { NavTabs } from './NavTabs'
import { DEFAULT_API_BASE } from './apiBase'

/* -------------------------------------------------------------
   Tipe & helper
   ------------------------------------------------------------- */
interface ApiResult {
  ok: boolean
  status: number | null // null = server tidak terjangkau
  data: any
  ms: number
  error?: string
}

interface LogEntry {
  id: number
  time: string
  method: string
  path: string
  status: number | null
  ok: boolean
  ms: number
  reqBody?: string
  resBody?: string
}

type Call = (method: string, path: string, body?: unknown, silent?: boolean) => Promise<ApiResult>

function prettyJson(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return v
  return JSON.stringify(v, null, 2)
}

function presets(): Record<string, object> {
  const now = new Date().toISOString()
  return {
    'Normal (armed)': {
      lat: -7.7915, lng: 110.3268, altitude: 120, speed: 0, satellites: 8, hdop: 1.2,
      battery_v: 3.9, mode: 'armed', relay1: 0, relay2: 0, alarm_active: false,
      mpu_vibration: false, gps_fix_at: now,
    },
    'Keluar geofence': {
      lat: -7.8, lng: 110.35, altitude: 118, speed: 24.5, satellites: 7, hdop: 1.6,
      battery_v: 3.85, mode: 'armed', relay1: 0, relay2: 0, alarm_active: false,
      mpu_vibration: false, gps_fix_at: now,
    },
    'Tanpa GPS fix': {
      lat: null, lng: null, satellites: 0, battery_v: 3.8, mode: 'powersafe',
      relay1: 0, relay2: 0, alarm_active: false, mpu_vibration: false,
    },
    'Getaran terdeteksi': {
      lat: -7.7915, lng: 110.3268, satellites: 8, hdop: 1.1, battery_v: 3.9,
      mode: 'overwatch', relay1: 0, relay2: 0, alarm_active: false,
      mpu_vibration: true, gps_fix_at: now,
    },
  }
}

/* -------------------------------------------------------------
   Kartu kecil
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
   Panel: Simulator telemetri (meniru ESP32 -> POST /api/telemetry)
   ------------------------------------------------------------- */
function SimulatorPanel({ call, onSent }: { call: Call; onSent: () => void }) {
  const [text, setText] = useState(() => prettyJson(presets()['Normal (armed)']))
  const [error, setError] = useState('')
  const [repeat, setRepeat] = useState(false)
  const [sentCount, setSentCount] = useState(0)
  const textRef = useRef(text)
  useEffect(() => { textRef.current = text }, [text])

  const send = useCallback(async (silent: boolean) => {
    let payload: unknown
    try {
      payload = JSON.parse(textRef.current)
    } catch (e) {
      setError(`JSON tidak valid: ${e instanceof Error ? e.message : String(e)}`)
      return false
    }
    setError('')
    const res = await call('POST', '/api/telemetry', payload, silent)
    if (res.ok) {
      setSentCount((n) => n + 1)
      onSent()
    }
    return res.ok
  }, [call, onSent])

  useEffect(() => {
    if (!repeat) return
    const id = setInterval(() => { void send(true) }, 2000)
    return () => clearInterval(id)
  }, [repeat, send])

  return (
    <Panel
      title="Simulator ESP32"
      subtitle="Kirim telemetri palsu (POST /api/telemetry) tanpa hardware"
      right={<span className="caption">terkirim: {sentCount}×</span>}
    >
      <div className="flex flex-wrap gap-1.5 mb-2">
        {Object.keys(presets()).map((name) => (
          <button key={name} className="btn btn--secondary" onClick={() => setText(prettyJson(presets()[name]))}>
            {name}
          </button>
        ))}
      </div>
      <textarea
        className="input input--mono h-44"
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        aria-label="Payload telemetri"
      />
      {error && <p className="caption text-red-600 mt-1">{error}</p>}
      <div className="flex items-center justify-between gap-3 mt-2 flex-wrap">
        <label className="flex items-center gap-2 caption cursor-pointer">
          <input type="checkbox" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} />
          Kirim otomatis tiap 2 detik
        </label>
        <button className="btn btn--primary" onClick={() => void send(false)}>Kirim sekali</button>
      </div>
    </Panel>
  )
}

/* -------------------------------------------------------------
   Panel: Command (dashboard -> ESP32) + simulasi polling ESP
   ------------------------------------------------------------- */
function CommandPanel({ call, forwarding }: { call: Call; forwarding: boolean | null }) {
  const [text, setText] = useState('{"relay1": 1}')
  const [error, setError] = useState('')
  const [status, setStatus] = useState<'idle' | 'ok' | 'fail'>('idle')

  const send = async () => {
    try {
      const payload = JSON.parse(text)
      setError('')
      setStatus('idle')
      const res = await call('POST', '/api/command', payload)
      setStatus(res.ok ? 'ok' : 'fail')
      if (!res.ok) {
        const detail = res.data && typeof res.data === 'object' && typeof res.data.error === 'string'
          ? res.data.error
          : `Server membalas HTTP ${res.status ?? '—'}`
        setError(detail)
      }
    } catch (e) {
      setStatus('fail')
      setError(`JSON tidak valid: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return (
    <Panel
      title="Command"
      subtitle="POST /api/command &middot; GET /api/command"
      right={
        <span className={`status-badge ${status === 'ok' ? 'status-badge--online' : status === 'fail' ? 'status-badge--offline' : 'status-badge--warning'}`}>
          {status === 'ok' ? 'TERKIRIM' : status === 'fail' ? 'GAGAL' : 'SIAP'}
        </span>
      }
    >
      <textarea
        className="input input--mono h-20"
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        aria-label="Payload command"
      />
      {error && <p className="caption text-red-600 mt-1">{error}</p>}
      <div className="flex flex-wrap gap-2 mt-2">
        <button className="btn btn--primary" onClick={() => void send()}>Kirim command</button>
        <button className="btn btn--secondary" onClick={() => void call('GET', '/api/command')}>
          Simulasi polling ESP
        </button>
      </div>
      <p className={`caption mt-2 ${forwarding ? 'text-amber-700' : ''}`}>
        {forwarding === null
          ? 'Status penerusan ke backend belum diketahui.'
          : forwarding
            ? 'Penerusan ke backend AKTIF: command diteruskan ke backend dan akan diterima ESP32 asli (Relay 1 = kontak mesin).'
            : 'Penerusan ke backend nonaktif: command hanya tersimpan di server ini. Jalankan npm run serve:control agar sampai ke ESP32.'}
      </p>
      <p className="caption mt-2">
        Polling ESP bersifat sekali ambil: command yang terbaca langsung ditandai terkirim, sehingga
        ESP32 asli tidak akan menerimanya lagi. Hindari menekannya saat ESP32 sedang tersambung.
      </p>
    </Panel>
  )
}

/* -------------------------------------------------------------
   Panel: Geofence CRUD
   ------------------------------------------------------------- */
interface Geofence { id: string; name: string; lat: number; lng: number; radius_m: number; valid: boolean }

function GeofencePanel({ call, geofences, tele, onChanged }: {
  call: Call
  geofences: Geofence[]
  tele: any
  onChanged: () => void
}) {
  const [name, setName] = useState('rumah')
  const [lat, setLat] = useState('-7.7915')
  const [lng, setLng] = useState('110.3268')
  const [radius, setRadius] = useState('30')
  const [error, setError] = useState('')

  const hasGps = typeof tele?.lat === 'number' && typeof tele?.lng === 'number'

  const add = async () => {
    const body = { name: name.trim(), lat: Number(lat), lng: Number(lng), radius_m: Number(radius) }
    if (!body.name || [body.lat, body.lng, body.radius_m].some((n) => Number.isNaN(n))) {
      setError('Nama wajib diisi; lat, lng, dan radius harus berupa angka.')
      return
    }
    setError('')
    const res = await call('POST', '/api/geofences', body)
    if (res.ok) onChanged()
  }

  const toggle = async (g: Geofence) => {
    const res = await call('PATCH', `/api/geofences/${g.id}`, { valid: !g.valid })
    if (res.ok) onChanged()
  }

  const remove = async (g: Geofence) => {
    const res = await call('DELETE', `/api/geofences/${g.id}`)
    if (res.ok) onChanged()
  }

  return (
    <Panel title="Geofence" subtitle="Aman jika di dalam minimal satu zona aktif" right={<span className="caption">{geofences.length} zona</span>}>
      {geofences.length === 0 ? (
        <p className="caption mb-2">Belum ada geofence. Tanpa geofence, server menganggap perangkat selalu di dalam zona.</p>
      ) : (
        <ul className="space-y-1.5 mb-3">
          {geofences.map((g) => (
            <li key={g.id} className="flex items-center justify-between gap-2 p-2 rounded-md bg-muted/5">
              <div className="min-w-0">
                <p className="value-small truncate">{g.name} <span className="caption">({g.radius_m} m)</span></p>
                <p className="mono text-muted truncate">{g.lat.toFixed(6)}, {g.lng.toFixed(6)}</p>
              </div>
              <div className="flex gap-1.5 shrink-0">
                <button className="btn btn--secondary" onClick={() => void toggle(g)}>{g.valid ? 'Aktif' : 'Nonaktif'}</button>
                <button className="btn btn--ghost" onClick={() => void remove(g)} aria-label={`Hapus ${g.name}`}>Hapus</button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="grid grid-cols-2 gap-2">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nama" aria-label="Nama geofence" />
        <input className="input" value={radius} onChange={(e) => setRadius(e.target.value)} placeholder="Radius (m)" inputMode="decimal" aria-label="Radius meter" />
        <input className="input" value={lat} onChange={(e) => setLat(e.target.value)} placeholder="Latitude" inputMode="decimal" aria-label="Latitude" />
        <input className="input" value={lng} onChange={(e) => setLng(e.target.value)} placeholder="Longitude" inputMode="decimal" aria-label="Longitude" />
      </div>
      {error && <p className="caption text-red-600 mt-1">{error}</p>}
      <div className="flex flex-wrap gap-2 mt-2">
        <button className="btn btn--primary" onClick={() => void add()}>Tambah geofence</button>
        <button
          className="btn btn--secondary"
          disabled={!hasGps}
          onClick={() => { setLat(String(tele.lat)); setLng(String(tele.lng)) }}
          title={hasGps ? 'Isi lat/lng dari telemetri terakhir' : 'Belum ada GPS fix di telemetri'}
        >
          Pakai posisi telemetri
        </button>
      </div>
    </Panel>
  )
}

/* -------------------------------------------------------------
   Panel: Log request
   ------------------------------------------------------------- */
function LogPanel({ logs, onClear }: { logs: LogEntry[]; onClear: () => void }) {
  return (
    <Panel
      title="Log Request"
      subtitle="Request yang dikirim dari halaman ini (polling otomatis tidak dicatat)"
      right={<button className="btn btn--ghost" onClick={onClear} disabled={logs.length === 0}>Bersihkan</button>}
    >
      {logs.length === 0 ? (
        <p className="caption">Belum ada request. Coba kirim telemetri atau command.</p>
      ) : (
        <ul className="space-y-1.5 max-h-96 overflow-auto">
          {logs.map((l) => (
            <li key={l.id} className="rounded-md border border-border">
              <details>
                <summary className="flex items-center gap-2 p-2 cursor-pointer text-xs">
                  <span className="mono text-muted">{l.time}</span>
                  <span className="font-semibold">{l.method}</span>
                  <span className="mono truncate flex-1">{l.path}</span>
                  <span className={`status-badge ${l.ok ? 'status-badge--online' : 'status-badge--warning'}`}>
                    {l.status ?? 'ERR'}
                  </span>
                  <span className="mono text-muted">{l.ms} ms</span>
                </summary>
                <div className="p-2 border-t border-border space-y-2">
                  {l.reqBody && (
                    <div>
                      <p className="section-title">Request</p>
                      <pre className="code-block code-block__content">{l.reqBody}</pre>
                    </div>
                  )}
                  <div>
                    <p className="section-title">Response</p>
                    <pre className="code-block code-block__content">{l.resBody || '(kosong)'}</pre>
                  </div>
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

/* -------------------------------------------------------------
   Halaman Debug
   ------------------------------------------------------------- */
export default function DebugPage() {
  const [apiBase, setApiBase] = useState(DEFAULT_API_BASE)
  const [deviceId, setDeviceId] = useState('default')
  const [auto, setAuto] = useState(true)

  const [serverUp, setServerUp] = useState<boolean | null>(null)
  const [latency, setLatency] = useState<number | null>(null)
  const [tele, setTele] = useState<any>(null)
  const [statusInfo, setStatusInfo] = useState<any>(null)
  const [geofences, setGeofences] = useState<Geofence[]>([])
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [nowMs, setNowMs] = useState(() => Date.now())
  const logId = useRef(0)

  const addLog = useCallback((e: Omit<LogEntry, 'id' | 'time'>) => {
    const entry: LogEntry = {
      ...e,
      id: ++logId.current,
      time: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    }
    setLogs((prev) => [entry, ...prev].slice(0, 50))
  }, [])

  const call = useCallback<Call>(async (method, path, body, silent = false) => {
    const url = `${apiBase.replace(/\/+$/, '')}${path}`
    const headers: Record<string, string> = {}
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    if (deviceId.trim()) headers['x-device-id'] = deviceId.trim()

    const started = performance.now()
    let result: ApiResult
    try {
      const res = await fetch(url, {
        method,
        headers,
        cache: 'no-store',
        body: body !== undefined ? JSON.stringify(body) : undefined,
      })
      const text = await res.text()
      let data: any = null
      if (text) {
        try { data = JSON.parse(text) } catch { data = text }
      }
      result = { ok: res.ok, status: res.status, data, ms: Math.round(performance.now() - started) }
    } catch (e) {
      result = {
        ok: false, status: null, data: null,
        ms: Math.round(performance.now() - started),
        error: e instanceof Error ? e.message : String(e),
      }
    }

    if (!silent) {
      addLog({
        method, path, status: result.status, ok: result.ok, ms: result.ms,
        reqBody: body !== undefined ? prettyJson(body) : undefined,
        resBody: result.error ? `Gagal terhubung: ${result.error}` : prettyJson(result.data),
      })
    }
    return result
  }, [apiBase, deviceId, addLog])

  const refresh = useCallback(async () => {
    const [t, s, g] = await Promise.all([
      call('GET', '/api/telemetry', undefined, true),
      call('GET', '/api/status', undefined, true),
      call('GET', '/api/geofences', undefined, true),
    ])
    setServerUp(t.status !== null)
    setLatency(t.status !== null ? t.ms : null)
    setTele(t.status === 200 ? t.data : null)
    setStatusInfo(s.ok ? s.data : null)
    if (g.ok && Array.isArray(g.data)) setGeofences(g.data)
    setNowMs(Date.now())
  }, [call])

  useEffect(() => {
    void refresh()
    if (!auto) return
    const id = setInterval(() => { void refresh() }, 2000)
    return () => clearInterval(id)
  }, [refresh, auto])

  // Push dari server: telemetri/command baru langsung tampil tanpa menunggu polling.
  useEffect(() => {
    const es = new EventSource(`${apiBase.replace(/\/+$/, '')}/api/events`)
    const onUpdate = () => { void refresh() }
    es.addEventListener('telemetry', onUpdate)
    es.addEventListener('command', onUpdate)
    return () => es.close()
  }, [apiBase, refresh])

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const receivedAt = tele?.received_at ? new Date(tele.received_at).getTime() : null
  const ageSec = receivedAt ? Math.max(0, Math.round((nowMs - receivedAt) / 1000)) : null
  const stale = ageSec !== null && ageSec > 10

  const serverLabel = serverUp === null ? 'Memeriksa…' : serverUp ? 'Terhubung' : 'Tidak terjangkau'
  const serverTone = serverUp === null ? undefined : serverUp ? 'ok' : 'bad'

  const copyTele = () => {
    if (tele) void navigator.clipboard?.writeText(prettyJson(tele))
  }

  return (
    <div className="page">
      <header className="mb-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5">
          <div>
            <h1 className="page-title">Debug</h1>
            <p className="page-subtitle">Smart Theft IoT &nbsp;·&nbsp; alat bantu pengujian API dan ESP32</p>
          </div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <NavTabs page="debug" />
            <span className={`status-badge ${serverUp ? 'status-badge--online' : 'status-badge--offline'}`}>
              <span className={`status-dot ${serverUp ? 'status-dot--online' : 'status-dot--offline'}`} />
              API {serverUp ? 'Online' : 'Offline'}
            </span>
          </div>
        </div>
      </header>

      <div className="space-y-3">
        {/* Koneksi */}
        <Panel
          title="Koneksi"
          subtitle="Alamat API dan device ID (header x-device-id)"
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
            <input className="input input--mono" value={apiBase} onChange={(e) => setApiBase(e.target.value)} aria-label="Alamat API" spellCheck={false} />
            <input className="input input--mono" value={deviceId} onChange={(e) => setDeviceId(e.target.value)} aria-label="Device ID" placeholder="default" spellCheck={false} />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Chip label="Server" value={serverLabel} tone={serverTone} />
            <Chip label="Latensi" value={latency !== null ? `${latency} ms` : '—'} />
            <Chip
              label="Umur data"
              value={ageSec !== null ? `${ageSec} dtk` : serverUp ? 'belum ada data' : '—'}
              tone={ageSec === null ? undefined : stale ? 'warn' : 'ok'}
            />
            <Chip label="Geofence aktif" value={statusInfo ? String(statusInfo.geofenceCount) : '—'} />
          </div>
          {stale && (
            <p className="caption text-amber-700 mt-2">
              Telemetri terakhir sudah {ageSec} detik lalu. ESP32 mungkin berhenti mengirim atau device ID tidak cocok.
            </p>
          )}
          {serverUp === false && (
            <p className="caption text-red-600 mt-2">
              API tidak terjangkau di {apiBase}. Pastikan server berjalan (npm run dev:api) dan alamat sudah benar.
            </p>
          )}
        </Panel>

        <div className="grid grid--main">
          {/* Kiri: telemetri mentah + log */}
          <div className="space-y-3 min-w-0">
            <Panel
              title="Telemetri Mentah"
              subtitle="GET /api/telemetry"
              right={<button className="btn btn--ghost" onClick={copyTele} disabled={!tele}>Salin JSON</button>}
            >
              <pre className="code-block code-block__content" style={{ maxHeight: 360 }}>
                {tele ? prettyJson(tele) : serverUp ? '(server aktif, belum ada telemetri)' : '(tidak ada data)'}
              </pre>
              {tele && (
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mt-2">
                  <Chip label="Sumber" value={tele.source === 'backend' ? 'backend :8000' : tele.source === 'local' ? 'lokal :3001' : '—'} />
                  <Chip label="Mode" value={String(tele.mode ?? '—')} />
                  <Chip label="Alarm" value={tele.alarm_active === true ? 'AKTIF' : 'mati'} tone={tele.alarm_active === true ? 'bad' : undefined} />
                  <Chip
                    label="Geofence"
                    value={tele.geofence_inside === true ? 'di dalam' : tele.geofence_inside === false ? 'di luar' : '—'}
                    tone={tele.geofence_inside === false ? 'bad' : undefined}
                  />
                  <Chip label="Baterai" value={tele.battery_v != null ? `${Number(tele.battery_v).toFixed(2)} V` : '—'} />
                </div>
              )}
            </Panel>

            <LogPanel logs={logs} onClear={() => setLogs([])} />
          </div>

          {/* Kanan: alat uji */}
          <div className="space-y-3 min-w-0">
            <SimulatorPanel call={call} onSent={() => void refresh()} />
            <CommandPanel call={call} forwarding={statusInfo ? statusInfo.forwardCommands === true : null} />
            <GeofencePanel call={call} geofences={geofences} tele={tele} onChanged={() => void refresh()} />
          </div>
        </div>
      </div>

      <footer className="footer">
        <span>Web Testing &bull; Halaman Debug</span>
        <span>Request manual dicatat di Log Request</span>
      </footer>
    </div>
  )
}
