import { useState, useEffect, useRef } from 'react'

/* -------------------------------------------------------------
   Web API server (lokal) — ESP32 POST telemetri ke sini,
   dashboard baca dari sini, dan kirim command balik ke ESP.
   ------------------------------------------------------------- */
const API_BASE = "http://localhost:3001" // server.js berjalan di port 3001

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
   Widgets
   ------------------------------------------------------------- */

function StatCard({ title, value, unit }: { title: string; value: string; unit?: string }) {
  return (
    <div className="glass p-5">
      <p className="section-label">{title}</p>
      <div className="flex items-baseline gap-1">
        <span className="card-value">{value}</span>
        {unit && <span className="card-unit">{unit}</span>}
      </div>
    </div>
  )
}

function LedCard({ title, on }: { title: string; on?: boolean }) {
  return (
    <div className="glass p-5 flex flex-col items-center justify-center gap-3">
      <p className="section-label">{title}</p>
      <div className={`led-circle ${on ? 'led-green' : 'led-red'}`}>
        <div className={`absolute rounded-full w-3 h-3 ${on ? 'bg-white' : 'bg-black/10'}`} />
      </div>
      <p className="card-caption">{on ? 'Aktif' : 'Mati'}</p>
    </div>
  )
}

function StatusCard({ title, online }: { title: string; online?: boolean }) {
  const color = online ? 'bg-purple-500 shadow-[0_0_12px_rgba(168,85,247,0.6)] animate-pulse' : 'bg-slate-400'
  return (
    <div className="glass p-5 flex flex-col items-center justify-center gap-3">
      <p className="section-label">{title}</p>
      <div className="relative flex items-center gap-2">
        <div className={`dot ${color}`} />
        <span className={`text-sm font-semibold ${online ? 'text-purple-600' : 'text-slate-400'}`}>
          {online ? 'LIVE' : 'OFFLINE'}
        </span>
      </div>
      <p className="card-caption">{online ? 'GPS terhubung' : 'Tidak terhubung ke ESP32'}</p>
    </div>
  )
}

function ToggleCard({ title, on, onChange }: { title: string; on?: boolean; onChange?: (v: boolean) => void }) {
  return (
    <div className="glass p-5 flex items-center justify-between">
      <p className="card-title">{title}</p>
      <div className="flex items-end gap-2">
        <span className={`toggle-state font-bold ${on ? 'text-purple-600' : 'text-slate-400'}`}>
          {on ? 'ON' : 'OFF'}
        </span>
        <label className="toggle">
          <input
            type="checkbox"
            checked={on === true}
            onChange={() => onChange?.(!on)}
            aria-label={title}
          />
        </label>
      </div>
    </div>
  )
}

function StateCard({ title, value }: { title: string; value: string }) {
  return (
    <div className="glass p-5">
      <p className="section-label">{title}</p>
      <input
        className="state-field"
        type="text"
        value={value}
        readOnly
        aria-label={title}
      />
    </div>
  )
}

function DummyJson({ tele }: { tele: any }) {
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [tele])

  const lines = tele ? [JSON.stringify(tele, null, 2)] : ['(menunggu data dari ESP32...)']

  return (
    <div className="glass-dark p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className={`dot ${tele ? 'bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.5)] animate-pulse' : 'bg-slate-400'}`} />
        <span className={`text-xs font-bold ${tele ? 'text-emerald-400' : 'text-slate-400'} uppercase tracking-wider`}>
          Dummy JSON
        </span>
        <span className="ml-auto text-xs text-slate-500">live feed</span>
      </div>
      <div className="terminal" ref={scrollRef}>
        {lines.map((line, i) => (
          <div key={i} className="terminal-line">{line}</div>
        ))}
      </div>
    </div>
  )
}

function InputToDevice() {
  const [text, setText] = useState('{"relay1": 1, "relay2": 0, "mode": "overwatch"}')
  const [sent, setSent] = useState(false)

  const handleSend = async () => {
    try {
      const cmd = JSON.parse(text)
      const ok = await sendCommand(cmd)
      setSent(ok)
    } catch {
      setSent(false)
    }
    setTimeout(() => setSent(false), 1200)
  }

  return (
    <div className="glass p-0">
      <div className="p-4 border-b border-white/60 flex items-center justify-between bg-white/40 rounded-t-[1.5rem]">
        <div>
          <p className="card-title">Input to Device</p>
          <p className="card-caption">Kirim perintah ke ESP32 (POST /command)</p>
        </div>
        <span className={`text-xs font-bold ${sent ? 'text-emerald-400' : 'text-purple-600'} bg-purple-50 px-2 py-0.5 rounded`}>
          TX
        </span>
      </div>
      <div className="p-4">
        <div className="code-wrap p-3">
          <textarea
            className="w-full h-full bg-transparent border-none p-0 resize-none font-mono text-sm text-slate-700 outline-none"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder='{"relay1": 1, "relay2": 0, "mode": "overwatch"}'
            aria-label="Input to Device"
          />
        </div>
        <button
          className="btn-primary"
          onClick={handleSend}
          disabled={sent}
          aria-label="Kirim input ke device"
        >
          {sent ? 'Terkirim' : 'Kirim ke Device'}
        </button>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------
   App
   ------------------------------------------------------------- */
export default function App() {
  const now = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
  const [tele, setTele] = useState<any>(null)
  const [online, setOnline] = useState(false)

  useEffect(() => {
    const id = setInterval(async () => {
      const data = await fetchTelemetry()
      setTele(data)
      setOnline(data !== null)
    }, 2000)
    return () => clearInterval(id)
  }, [])

  const distHome = tele?.dist_home_m != null && tele.dist_home_m >= 0 ? tele.dist_home_m.toFixed(0) : "0"
  const batt = tele?.battery_v != null ? tele.battery_v.toFixed(2) : "0"
  const greenOn = tele?.mode === "armed" || tele?.mode === "overwatch"
  const redOn = tele?.alarm_active === true

  return (
    <div className="page">
      <header className="header">
        <div>
          <h1 className="title">Dashboard</h1>
          <p className="subtitle">Smart Theft IoT &nbsp;·&nbsp; {now}</p>
        </div>
        <span className="status-pill">
          <span className={`dot ${online ? 'bg-emerald-400 animate-pulse' : 'bg-slate-400'}`} />
          {online ? 'ESP32 Online' : 'ESP32 Offline'}
        </span>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left column: JSON + Input */}
        <div className="lg:col-span-8 space-y-6">
          <DummyJson tele={tele} />
          <InputToDevice />
        </div>

        {/* Right column: stats + controls */}
        <div className="lg:col-span-4 space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <StatCard title="Home Distance" value={distHome} unit="m" />
            <StatCard title="Battery Voltage" value={batt} unit="v" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <LedCard title="LED Hijau" on={greenOn} />
            <LedCard title="LED Merah" on={redOn} />
          </div>
          <StatusCard title="GPS Status" online={online} />
          <ToggleCard title="Tlakson" on={tele?.relay2 === 1} />
          <ToggleCard title="Kontak to Machine" on={tele?.relay1 === 1} />
          <StateCard title="Device State" value={tele?.mode ?? "powersafe"} />
        </div>
      </div>

      <footer className="mt-6 flex items-center justify-between text-xs text-slate-400">
        <span>Web Testing &bull; Glassmorphism Dashboard</span>
        <span>{online ? 'Data dari ESP32' : 'Simulasi data &mdash; ESP32 tidak terjangkau'}</span>
      </footer>
    </div>
  )
}
