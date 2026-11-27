import React, { useState, useEffect, useRef, useCallback } from 'react'
import DebugPage from './DebugPage'
import { NavTabs, usePage } from './NavTabs'

/* -------------------------------------------------------------
   Web API server (lokal) — ESP32 POST telemetri ke sini,
   dashboard baca dari sini, dan kirim command balik ke ESP.
   ------------------------------------------------------------- */
// Dev (Vite :5173) memanggil API di :3001; saat disajikan dari server.js cukup same-origin.
const API_BASE = import.meta.env.DEV ? "http://localhost:3001" : ""

async function fetchTelemetry(): Promise<any> {
  try {
    const res = await fetch(`${API_BASE}/api/telemetry`, { cache: "no-store" })
    if (res.status === 204) return null
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

async function sendCommand(cmd: any): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/api/command`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cmd),
    })
    return res.ok
  } catch {
    return false
  }
}

/* -------------------------------------------------------------
   Utility: Format GPS coordinates
   ------------------------------------------------------------- */
function formatCoordinate(val: number | null | undefined): string {
  if (val == null || typeof val !== 'number' || isNaN(val)) return '—'
  return val.toFixed(6)
}

function hasValidGPS(tele: any): boolean {
  return tele != null &&
    typeof tele.lat === 'number' && !isNaN(tele.lat) &&
    typeof tele.lng === 'number' && !isNaN(tele.lng)
}

/* -------------------------------------------------------------
   JSON Viewer - Plain white text on black (no syntax colors)
   ------------------------------------------------------------- */
interface JsonNodeProps {
  value: any
  // Nama field JSON. JANGAN pakai nama `key` — itu prop khusus React yang tidak
  // pernah diteruskan ke komponen, sehingga nama field tidak pernah tampil.
  jsonKey?: string
  isLast?: boolean
  indent?: number
  specInfo?: Record<string, string>
}

function JsonNode({ value, jsonKey, isLast = true, indent = 0, specInfo = {} }: JsonNodeProps) {
  const renderKey = () => {
    if (!jsonKey) return null
    const info = specInfo[jsonKey]
    const keyElement = (
      <React.Fragment>
        <span>"{jsonKey}"</span>
        <span>: </span>
      </React.Fragment>
    )
    if (info) {
      return (
        <span className="cursor-help" style={{ borderBottom: '1px dotted #3b82f6' }} title={info}>
          {keyElement}
        </span>
      )
    }
    return keyElement
  }

  const punct = (char: string) => <span>{char}</span>

  if (value === null) {
    return (
      <div className="code-block__line" style={{ paddingLeft: `${indent * 14}px` }}>
        <React.Fragment>
          {renderKey()}
          <span>null</span>
          {isLast ? null : punct(',')}
        </React.Fragment>
      </div>
    )
  }

  const type = typeof value

  if (type !== 'object') {
    let content: React.ReactNode
    if (type === 'string') {
      content = <span>"{value}"</span>
    } else if (type === 'number') {
      content = <span>{value}</span>
    } else if (type === 'boolean') {
      content = <span>{value}</span>
    } else {
      content = <span>{String(value)}</span>
    }
    return (
      <div className="code-block__line" style={{ paddingLeft: `${indent * 14}px` }}>
        <React.Fragment>
          {renderKey()}
          {content}
          {isLast ? null : punct(',')}
        </React.Fragment>
      </div>
    )
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return (
        <div className="code-block__line" style={{ paddingLeft: `${indent * 14}px` }}>
          <React.Fragment>
            {renderKey()}
            <span>[]</span>
            {isLast ? null : punct(',')}
          </React.Fragment>
        </div>
      )
    }
    return (
      <div style={{ paddingLeft: `${indent * 14}px` }}>
        <div className="code-block__line">
          <React.Fragment>
            {renderKey()}
            <span>[</span>
          </React.Fragment>
        </div>
        {value.map((item, i) => (
          <JsonNode key={String(i)} value={item} isLast={i === value.length - 1} indent={indent + 1} specInfo={specInfo} />
        ))}
        <div className="code-block__line">
          <React.Fragment>
            <span>]</span>
            {isLast ? null : punct(',')}
          </React.Fragment>
        </div>
      </div>
    )
  }

  // Object
  const entries = Object.entries(value).filter(([k]) => k !== 'esp_ip')
  if (entries.length === 0) {
    return (
      <div className="code-block__line" style={{ paddingLeft: `${indent * 14}px` }}>
        <React.Fragment>
          {renderKey()}
          <span>{}</span>
          {isLast ? null : punct(',')}
        </React.Fragment>
      </div>
    )
  }

  return (
    <div style={{ paddingLeft: `${indent * 14}px` }}>
      <div className="code-block__line">
        <React.Fragment>
          {renderKey()}
          <span>{'{'}</span>
        </React.Fragment>
      </div>
      {entries.map(([k, v], i) => (
        <JsonNode key={k} jsonKey={k} value={v} isLast={i === entries.length - 1} indent={indent + 1} specInfo={specInfo} />
      ))}
      <div className="code-block__line">
        <React.Fragment>
          <span>{'}'}</span>
          {isLast ? null : punct(',')}
        </React.Fragment>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------
   UI Components
   ------------------------------------------------------------- */

function StatCard({ title, value, unit, tooltip }: { title: string; value: string; unit?: string; tooltip?: string }) {
  return (
    <div className="card animate-fade-in" title={tooltip}>
      <div className="card-body">
        <p className="section-title">{title}</p>
        <div className="flex items-baseline gap-1 mt-0.5">
          <span className="value-large">{value}</span>
          {unit && <span className="unit">{unit}</span>}
        </div>
      </div>
    </div>
  )
}

function LedCard({ title, on }: { title: string; on?: boolean }) {
  const isGreen = title.includes('Hijau')
  const tooltipContent = isGreen
    ? 'LED Hijau: Menyala saat mode Armed atau Overwatch (pemantauan aktif). Mati saat Powersafe/Sleep.'
    : 'LED Merah: Menyala saat Alarm aktif (geofence dilanggar atau gerakan mencurigakan). Blink via Relay 2.'

  return (
    <div className="card animate-fade-in text-center" title={tooltipContent}>
      <div className="card-body py-4">
        <p className="section-title cursor-help">{title}</p>
        <div className={`led ${on ? 'led--on' : ''} led--${on ? 'green' : 'red'}`} aria-label={`${title} ${on ? 'aktif' : 'mati'}`} />
        <p className="caption mt-2.5 font-medium">{on ? 'Aktif' : 'Mati'}</p>
      </div>
    </div>
  )
}

function GpsCard({ tele }: { tele: any }) {
  const hasGps = hasValidGPS(tele)
  const lat = tele?.lat
  const lng = tele?.lng
  const alt = tele?.altitude
  const speed = tele?.speed
  const satellites = tele?.satellites
  const hdop = tele?.hdop
  const lastFix = tele?.gps_fix_at

  return (
    <div className="card animate-fade-in">
      <div className="card-header">
        <h3 className="value-small">Koordinat GPS</h3>
        <span className={`status-badge ${hasGps ? 'status-badge--online' : 'status-badge--offline'}`}>
          {hasGps ? 'FIX' : 'NO FIX'}
        </span>
      </div>
      <div className="card-body space-y-2.5">
        <div className="grid grid-cols-2 gap-3">
          <div title={SPEC_INFO.lat}>
            <p className="gps-coordinate cursor-help">
              <span className="gps-coordinate__label">Lat</span>
              <span className={`gps-coordinate__value ${!hasGps ? 'gps-coordinate__value--invalid' : ''}`}>
                {formatCoordinate(lat)}
              </span>
            </p>
          </div>
          <div title={SPEC_INFO.lng}>
            <p className="gps-coordinate cursor-help">
              <span className="gps-coordinate__label">Lng</span>
              <span className={`gps-coordinate__value ${!hasGps ? 'gps-coordinate__value--invalid' : ''}`}>
                {formatCoordinate(lng)}
              </span>
            </p>
          </div>
        </div>

        <hr className="divider" />

        <div className="grid grid-cols-3 gap-2 text-center">
          {alt != null && (
            <div className="p-2.5 bg-brand-soft/50 rounded-lg border border-brand-light/50 cursor-help" title={SPEC_INFO.altitude}>
              <p className="section-title">Altitude</p>
              <p className="value-medium mono">{alt.toFixed(1)} m</p>
            </div>
          )}
          {speed != null && (
            <div className="p-2.5 bg-brand-soft/50 rounded-lg border border-brand-light/50 cursor-help" title={SPEC_INFO.speed}>
              <p className="section-title">Speed</p>
              <p className="value-medium mono">{speed.toFixed(1)} km/h</p>
            </div>
          )}
          {satellites != null && (
            <div className="p-2.5 bg-brand-soft/50 rounded-lg border border-brand-light/50 cursor-help" title={SPEC_INFO.satellites}>
              <p className="section-title">Satellites</p>
              <p className="value-medium mono">{satellites}</p>
            </div>
          )}
        </div>

        {(hdop != null || lastFix) && (
          <>
            <hr className="divider" />
            <div className="grid grid-cols-2 gap-2 text-center">
              {hdop != null && (
                <div className="p-2 rounded-md bg-muted/5 cursor-help" title={SPEC_INFO.hdop}>
                  <p className="section-title">HDOP</p>
                  <p className="value-small mono">{hdop.toFixed(1)}</p>
                </div>
              )}
              {lastFix && (
                <div className="p-2 rounded-md bg-muted/5 cursor-help" title={SPEC_INFO.gps_fix_at}>
                  <p className="section-title">Last Fix</p>
                  <p className="value-small mono">
                    {new Date(lastFix).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </p>
                </div>
              )}
            </div>
          </>
        )}

        {!hasGps && (
          <div className="mt-2 p-2.5 rounded-md bg-amber-50 border border-amber-200">
            <p className="caption text-amber-800 text-center">
              Menunggu sinyal GPS... Pastikan ESP32 memiliki view ke langit.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

function StatusCard({ title, online, subtitle }: { title: string; online?: boolean; subtitle?: string }) {
  return (
    <div className="card animate-fade-in">
      <div className="card-body">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="section-title">{title}</p>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className={`status-dot ${online ? 'status-dot--online' : 'status-dot--offline'}`} />
              <span className={`value-small ${online ? 'text-emerald-600' : 'text-muted'}`}>
                {online ? 'ONLINE' : 'OFFLINE'}
              </span>
            </div>
            {subtitle && <p className="caption mt-0.75">{subtitle}</p>}
          </div>
        </div>
      </div>
    </div>
  )
}

function ToggleCard({ title, on, onChange, subtitle, pending }: { title: string; on?: boolean; onChange?: (v: boolean) => void; subtitle?: string; pending?: boolean }) {
  return (
    <div className="card animate-fade-in">
      <div className="card-body">
        <div className="toggle-card-row">
          <div className="toggle-card-info">
            <p className="value-small truncate">{title}</p>
            {subtitle && <p className="caption mt-0.5">{subtitle}</p>}
          </div>
          <div className="toggle-card-controls">
            {pending && (
              <span className="caption text-brand animate-pulse" title="Menunggu konfirmasi dari ESP32">
                &#8226;
              </span>
            )}
            <span className="toggle__state">{on ? 'ON' : 'OFF'}</span>
            <label className="toggle" style={{ cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={on === true}
                onChange={() => onChange?.(!on)}
                aria-label={title}
                aria-busy={pending === true}
              />
            </label>
          </div>
        </div>
      </div>
    </div>
  )
}

function StateCard({ title, value }: { title: string; value: string }) {
  const stateColors: Record<string, string> = {
    armed: 'bg-red-50 text-red-700 border-red-200',
    overwatch: 'bg-blue-50 text-blue-700 border-blue-200',
    powersafe: 'bg-slate-50 text-slate-700 border-slate-200',
    alarm: 'bg-red-100 text-red-800 border-red-300',
    sleep: 'bg-gray-50 text-gray-700 border-gray-200',
  }
  const className = stateColors[value] || 'bg-brand-soft text-brand border-brand-light'

  return (
    <div className="card animate-fade-in">
      <div className="card-body">
        <p className="section-title">{title}</p>
        <div className="mt-1.5">
          <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${className}`}>
            {value}
          </span>
        </div>
      </div>
    </div>
  )
}

// Spec info for tooltips (used as native title attributes)
const SPEC_INFO: Record<string, string> = {
  mode: 'Mode keamanan: armed (siaga), overwatch (pengawasan), powersafe (hemat daya), alarm (terpicu), sleep (tidur)',
  lat: 'Latitude GPS (derajat), 6 desimal. Dari GPS NEO-6M via UART2. Null jika belum fix.',
  lng: 'Longitude GPS (derajat), 6 desimal. Dari GPS NEO-6M via UART2. Null jika belum fix.',
  altitude: 'Ketinggian dari permukaan laut (meter). Dari GPS NEO-6M.',
  speed: 'Kecepatan (km/h). Dari GPS NEO-6M.',
  satellites: 'Jumlah satelit GPS terkunci. Minimal 4 untuk fix 3D.',
  hdop: 'Horizontal Dilution of Precision. < 1.5 = excellent, 1.5-2 = baik, > 2 = kurang akurat.',
  battery_v: 'Tegangan baterai (Volt). Dari ADC GPIO34 atau fuel gauge MAX17048 via I2C.',
  dist_home_m: 'Jarak dari HOME (meter). Dihitung server via Haversine dari GPS ke HOME. HOME diset otomatis saat GPS fix valid pertama.',
  relay1: 'Relay 1 (GPIO32, Active-LOW): Kontak ke mesin. 1=nyala (LOW), 0=mati (HIGH).',
  relay2: 'Relay 2 (GPIO33, Active-LOW): Tlakson/alarm audio. Blink 500ms saat alarm.',
  alarm_active: 'Alarm aktif (true/false). Ditetapkan server saat geofence dilanggar atau gerakan mencurigakan.',
  geofence_inside: 'Di dalam geofence (true/false). Server cek multi-zona OR logic: aman jika di DALAM minimal 1 zona.',
  gps_fix_at: 'Timestamp last GPS fix valid (ISO 8601 UTC). Null jika belum pernah fix.',
  received_at: 'Timestamp server terima telemetri (ISO 8601 UTC). Bedakan dari gps_fix_at.',
  esp_ip: 'IP address ESP32 saat mengirim telemetri. Berguna untuk debugging koneksi jaringan.',
  mpu_vibration: 'Vibration terdeteksi MPU6050 (true/false). Sensor gerak via I2C GPIO21/22.',
  pending_command: 'true = nilai ini masih menunggu konfirmasi dari ESP32. Perubahan ditampilkan lebih dulu agar tombol terasa responsif.',
  gps_fix: 'GPS sudah fix valid (true/false). Butuh minimal 4 satelit.',
  speed_kmh: 'Kecepatan (km/h) dari GPS NEO-6M.',
  mpu_ax: 'Percepatan MPU6050 sumbu X (m/s²). Gravitas diam ≈ 9.8.',
  mpu_ay: 'Percepatan MPU6050 sumbu Y (m/s²). Gravitas diam ≈ 9.8.',
  mpu_az: 'Percepatan MPU6050 sumbu Z (m/s²). Gravitas diam ≈ 9.8.',
  geofence_radius_m: 'Radius geofence default (meter). Bisa diubah dari halaman Debug.',
  geofence_violated: 'Zona geofence yang dilanggar (null kalau aman).',
  source: 'Sumber data: lokal (:3001) atau backend (:8000).',
}

function JsonViewer({ tele }: { tele: any }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const legendRef = useRef<HTMLDivElement>(null)
  const splitterRef = useRef<HTMLDivElement>(null)
  const [legendWidth, setLegendWidth] = useState(300)

  // Baris legenda dibuat dari field yang benar-benar ada di JSON, urut sama persis,
  // sehingga baris legenda sejajar 1:1 dengan baris JSON dan tingginya identik.
  const entries = React.useMemo(() => {
    if (tele == null || typeof tele !== 'object' || Array.isArray(tele)) return []
    return Object.entries(tele).filter(([k]) => k !== 'esp_ip')
  }, [tele])

  // Scroll menempel ke bawah HANYA bila pengguna memang sudah di posisi bawah,
  // jadi telemetry baru tidak menarik baris saat sedang dibaca.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 48) {
      el.scrollTop = el.scrollHeight
      if (legendRef.current) legendRef.current.scrollTop = legendRef.current.scrollHeight
    }
  }, [tele])

  // Sinkronkan scroll legenda <-> JSON supaya tetap sejajar saat digulir.
  const mirrorScroll = (s: HTMLDivElement | null, d: HTMLDivElement | null) => {
    if (!s || !d) return
    if (Math.abs(d.scrollTop - s.scrollTop) > 1) d.scrollTop = s.scrollTop
  }
  const handleLegendScroll = () => mirrorScroll(legendRef.current, scrollRef.current)
  const handleJsonScroll = () => mirrorScroll(scrollRef.current, legendRef.current)

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = legendWidth

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX
      const newWidth = Math.min(Math.max(startWidth + deltaX, 160), 480)
      setLegendWidth(newWidth)
    }

    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      if (splitterRef.current) {
        splitterRef.current.style.background = ''
      }
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    if (splitterRef.current) {
      splitterRef.current.style.background = '#1e40af'
    }
  }

  return (
    <div className="code-block animate-fade-in flex flex-col h-full min-h-[420px]">
      <div className="code-block__header flex-shrink-0 flex items-center justify-between gap-2">
        <span>Telemetri Live</span>
        {tele?.esp_ip && (
          <span className="text-[0.625rem] text-[#93c5fd] font-mono bg-[#1a1a1a] px-2 py-0.5 rounded cursor-help" title={SPEC_INFO.esp_ip}>
            {tele.esp_ip}
          </span>
        )}
        <span className={`status-dot ${tele ? 'status-dot--online' : 'status-dot--offline'}`} />
      </div>
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* Left: Legend — satu baris per field, tidak pernah wrap */}
        <div
          className="flex flex-col flex-shrink-0 border-r border-[#1a1a1a] bg-[#050505]"
          style={{ width: legendWidth, minWidth: 160, maxWidth: 480 }}
        >
          <div className="json-subhead">Legenda</div>
          <div className="json-scroll" ref={legendRef} onScroll={handleLegendScroll}>
            {entries.length === 0 ? (
              <div className="code-block__line text-muted">{"(menunggu data...)"}</div>
            ) : (
              <>
                {/* Baris kosong supaya sejajar dengan baris "{" di panel JSON */}
                <div className="code-block__line" aria-hidden="true">{"\u00a0"}</div>
                {entries.map(([k]) => {
                  const desc = SPEC_INFO[k] ?? '—'
                  return (
                    <div className="legend-row" key={k} title={desc}>
                      <span className="legend-key">"{k}"</span>
                      <span className="legend-desc">{desc}</span>
                    </div>
                  )
                })}
                {/* Baris kosong supaya sejajar dengan baris "}" di panel JSON */}
                <div className="code-block__line" aria-hidden="true">{"\u00a0"}</div>
              </>
            )}
          </div>
        </div>
        {/* Splitter */}
        <div
          ref={splitterRef}
          className="w-1 cursor-col-resize flex-shrink-0 select-none transition-colors hover:bg-[#1e40af]"
          style={{ background: '#1a1a1a' }}
          onMouseDown={handleMouseDown}
          aria-label="Resize legend panel"
          role="separator"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') {
              e.preventDefault()
              setLegendWidth(w => Math.max(w - 20, 160))
            } else if (e.key === 'ArrowRight') {
              e.preventDefault()
              setLegendWidth(w => Math.min(w + 20, 480))
            }
          }}
        >
          <div className="w-full h-full flex items-center justify-center">
            <div className="w-px h-6 bg-[#333] rounded" />
          </div>
        </div>
        {/* Right: JSON Content — 1 baris = 1 baris (tidak wrap), scroll horizontal */}
        <div className="flex flex-col flex-1 min-w-0">
          <div className="json-subhead">Field &rarr; Nilai</div>
          <div className="json-scroll" ref={scrollRef} onScroll={handleJsonScroll}>
            {tele ? (
              <JsonNode value={tele} specInfo={SPEC_INFO} />
            ) : (
              <div className="code-block__line text-muted">(menunggu data dari ESP32...)</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function InputToDevice() {
  const [text, setText] = useState('{"relay1": 1, "relay2": 0, "mode": "overwatch"}')
  const [status, setStatus] = useState<'idle' | 'sending' | 'success' | 'error'>('idle')

  const handleSend = async () => {
    setStatus('sending')
    try {
      const cmd = JSON.parse(text)
      const ok = await sendCommand(cmd)
      setStatus(ok ? 'success' : 'error')
    } catch {
      setStatus('error')
    }
    setTimeout(() => setStatus('idle'), 1500)
  }

  return (
    <div className="card animate-fade-in">
      <div className="card-header">
        <div>
          <h3 className="value-small">Input to Device</h3>
          <p className="caption">Kirim perintah ke ESP32 (POST /command)</p>
        </div>
        <span className={`status-badge ${status === 'success' ? 'status-badge--online' : status === 'error' ? 'status-badge--offline' : 'status-badge--warning'}`}>
          {status === 'sending' ? 'MENGIRIM' : status === 'success' ? 'TERKIRIM' : status === 'error' ? 'GAGAL' : 'SIAP'}
        </span>
      </div>
      <div className="card-body p-0">
        <div className="code-block__content p-3">
          <textarea
            className="w-full h-28 bg-transparent border-none p-0 resize-none font-mono text-sm text-text outline-none"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder='{"relay1": 1, "relay2": 0, "mode": "overwatch"}'
            aria-label="Input to Device"
            spellCheck={false}
          />
        </div>
        <div className="card-footer">
          <button
            className="btn btn--primary w-full"
            onClick={handleSend}
            disabled={status === 'sending'}
            aria-label="Kirim input ke device"
          >
            {status === 'sending' ? 'Mengirim...' : 'Kirim ke Device'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Header({ online, now }: { online: boolean; now: string }) {
  return (
    <header className="mb-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">Smart Theft IoT &nbsp;·&nbsp; {now}</p>
        </div>
        <div className="flex items-center gap-2.5 flex-wrap">
          <NavTabs page="dashboard" />
          <span className={`status-badge ${online ? 'status-badge--online' : 'status-badge--offline'}`}>
            <span className={`status-dot ${online ? 'status-dot--online' : 'status-dot--offline'}`} />
            {online ? 'ESP32 Online' : 'ESP32 Offline'}
          </span>
        </div>
      </div>
    </header>
  )
}

function Footer({ online }: { online: boolean }) {
  return (
    <footer className="footer">
      <span>Web Testing &bull; Minimal Dashboard</span>
      <span>{online ? 'Data dari ESP32' : 'Simulasi data — ESP32 tidak terjangkau'}</span>
    </footer>
  )
}

/* -------------------------------------------------------------
   App
   ------------------------------------------------------------- */
function DashboardPage() {
  const now = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
  const [tele, setTele] = useState<any>(null)
  const [online, setOnline] = useState(false)
  // State optimis: nilai yang sudah ditekan user tapi belum dikonfirmasi ESP32.
  const [pending, setPending] = useState<Record<string, number>>({})
  const [cmdError, setCmdError] = useState('')
  const errTimer = useRef<number | null>(null)

  const refresh = useCallback(async () => {
    const data = await fetchTelemetry()
    setTele(data)
    setOnline(data !== null)
  }, [])

  // Cadangan: polling bila SSE tidak tersedia.
  useEffect(() => {
    void refresh()
    const id = setInterval(() => { void refresh() }, 2000)
    return () => clearInterval(id)
  }, [refresh])

  // Utama: push dari server — telemetri/command baru langsung tampil tanpa nunggu polling.
  useEffect(() => {
    const es = new EventSource(`${API_BASE}/api/events`)
    const onUpdate = () => { void refresh() }
    es.addEventListener('telemetry', onUpdate)
    es.addEventListener('command', onUpdate)
    return () => es.close()
  }, [refresh])

  // Buang state optimis begitu telemetri dari ESP32 sudah mencerminkan nilainya.
  useEffect(() => {
    setPending((prev) => {
      const keys = Object.keys(prev)
      if (keys.length === 0 || !tele) return prev
      let changed = false
      const next = { ...prev }
      for (const k of keys) {
        if (tele[k] === prev[k]) {
          delete next[k]
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [tele])

  useEffect(() => () => { if (errTimer.current) window.clearTimeout(errTimer.current) }, [])

  const showCmdError = useCallback((msg: string) => {
    setCmdError(msg)
    if (errTimer.current) window.clearTimeout(errTimer.current)
    errTimer.current = window.setTimeout(() => setCmdError(''), 4000)
  }, [])

  // Toggle: UI berubah dulu (optimistic), request menyusul. Gagal -> balik ke nilai asli.
  const setRelay = useCallback(async (n: 1 | 2, value: boolean) => {
    const key = `relay${n}`
    setPending((p) => ({ ...p, [key]: value ? 1 : 0 }))
    setCmdError('')
    const ok = await sendCommand({ [key]: value ? 1 : 0 })
    if (!ok) {
      setPending((p) => {
        const next = { ...p }
        delete next[key]
        return next
      })
      showCmdError(`Relay ${n} gagal dikirim — server tidak merespons`)
    }
  }, [showCmdError])

  const relay1 = pending.relay1 ?? tele?.relay1 ?? 0
  const relay2 = pending.relay2 ?? tele?.relay2 ?? 0

  const distHome = tele?.dist_home_m != null && tele.dist_home_m >= 0 ? tele.dist_home_m.toFixed(0) : "0"
  const batt = tele?.battery_v != null ? tele.battery_v.toFixed(2) : "0"
  const greenOn = tele?.mode === "armed" || tele?.mode === "overwatch"
  const redOn = tele?.alarm_active === true

  return (
    <div className="page">
      <Header online={online} now={now} />

      <div className="grid grid--main">
        {/* Left column: JSON + Input */}
        <div className="flex flex-col space-y-3 min-h-0">
          <div className="flex-1 min-h-0">
            <JsonViewer tele={tele} />
          </div>
          <InputToDevice />
        </div>

        {/* Right column: stats + controls */}
        <div className="space-y-3">
          <div className="grid grid--stats gap-2.5">
            <StatCard title="Home Distance" value={distHome} unit="m" tooltip={SPEC_INFO.dist_home_m} />
            <StatCard title="Battery Voltage" value={batt} unit="V" tooltip={SPEC_INFO.battery_v} />
          </div>

          <div className="grid grid--leds gap-2.5">
            <LedCard title="LED Hijau (Armed)" on={greenOn} />
            <LedCard title="LED Merah (Alarm)" on={redOn} />
          </div>

          <GpsCard tele={tele} />

          <StatusCard
            title="Koneksi ESP32"
            online={online}
            subtitle={online ? `Terakhir update: ${tele?.received_at ? new Date(tele.received_at).toLocaleTimeString('id-ID') : '—'}` : 'Menunggu data...'}
          />

          <ToggleCard
            title="Relay 1 (Kontak ke Mesin)"
            on={relay1 === 1}
            pending={pending.relay1 !== undefined}
            onChange={(v) => void setRelay(1, v)}
            subtitle="Mengontrol kontak utama ke mesin"
          />

          <ToggleCard
            title="Relay 2 (Tlakson)"
            on={relay2 === 1}
            pending={pending.relay2 !== undefined}
            onChange={(v) => void setRelay(2, v)}
            subtitle="Mengontrol tlakson/alarm audio"
          />

          {cmdError && <p className="caption text-red-600">{cmdError}</p>}

          <StateCard title="Device State" value={tele?.mode ?? "powersafe"} />
        </div>
      </div>

      <Footer online={online} />
    </div>
  )
}

/* -------------------------------------------------------------
   Router sederhana berbasis hash: #/ = Dashboard, #/debug = Debug
   ------------------------------------------------------------- */
export default function App() {
  const page = usePage()
  return page === 'debug' ? <DebugPage /> : <DashboardPage />
}
