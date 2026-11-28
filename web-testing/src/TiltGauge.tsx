import type { AvatarTone } from './MpuAvatar'

/* -------------------------------------------------------------
   TiltGauge — indikator kemiringan gaya waterpass (bubble level).
   Geometri SVG: cincin, crosshair, dan titik "gelembung" yang
   bergeser mengikuti pitch/roll (makin ke tepi, makin miring).
   ------------------------------------------------------------- */

const TONE_COLOR: Record<AvatarTone, string> = {
  idle: '#64748b',
  ok: '#2563eb',
  warn: '#f59e0b',
  bad: '#ef4444',
}

export interface TiltGaugeProps {
  pitch?: number | null
  roll?: number | null
  tone?: AvatarTone
  size?: number
}

export default function TiltGauge({ pitch, roll, tone = 'idle', size = 128 }: TiltGaugeProps) {
  const valid = typeof pitch === 'number' && Number.isFinite(pitch) && typeof roll === 'number' && Number.isFinite(roll)
  const maxR = size * 0.29
  // Gelembung bergerak berlawanan arah kemiringan (seperti waterpass asli).
  const dx = valid ? Math.max(-1, Math.min(1, (roll as number) / 35)) * maxR : 0
  const dy = valid ? Math.max(-1, Math.min(1, (pitch as number) / 35)) * maxR : 0
  const c = size / 2
  const color = TONE_COLOR[tone]

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={valid ? `Kemiringan pitch ${pitch} derajat, roll ${roll} derajat` : 'Data kemiringan belum tersedia'}
      style={{ opacity: valid ? 1 : 0.45 }}
    >
      {/* Cincin luar + tengah */}
      <circle cx={c} cy={c} r={c - 1} fill="#ffffff" stroke="#e2e8f0" strokeWidth="1" />
      <circle cx={c} cy={c} r={c * 0.62} fill="none" stroke="#dbe3ee" strokeWidth="1" />
      <circle cx={c} cy={c} r={c * 0.3} fill="none" stroke="#dbe3ee" strokeWidth="1" />

      {/* Crosshair + tick kardinal */}
      <line x1={c} y1={c * 0.28} x2={c} y2={size - c * 0.28} stroke="#cbd5e1" strokeWidth="1" />
      <line x1={c * 0.28} y1={c} x2={size - c * 0.28} y2={c} stroke="#cbd5e1" strokeWidth="1" />
      {[0, 90, 180, 270].map((deg) => {
        const a = (deg * Math.PI) / 180
        const r1 = c - 1
        const r2 = c - 9
        return (
          <line
            key={deg}
            x1={c + Math.sin(a) * r1}
            y1={c - Math.cos(a) * r1}
            x2={c + Math.sin(a) * r2}
            y2={c - Math.cos(a) * r2}
            stroke="#94a3b8"
            strokeWidth="1.5"
          />
        )
      })}

      {/* Gelembung */}
      <circle cx={c + dx} cy={c + dy} r={size * 0.088} fill={color} opacity={valid ? 0.22 : 0.12} />
      <circle cx={c + dx} cy={c + dy} r={size * 0.055} fill={color} />
      <circle cx={c + dx - size * 0.014} cy={c + dy - size * 0.016} r={size * 0.018} fill="#ffffff" opacity={0.75} />
    </svg>
  )
}
