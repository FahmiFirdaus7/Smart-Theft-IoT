import { useEffect, useState } from 'react'
import MpuAvatar from './MpuAvatar'
import type { AvatarTone } from './MpuAvatar'
import TiltGauge from './TiltGauge'
import { computePose, computePoseStatus, fetchPoses } from './poses'
import type { PoseProfile } from './poses'
import { statusTone } from './PosePage'
import { API_BASE } from './apiBase'

/* -------------------------------------------------------------
   VehicleHero — panel utama "Posisi Kendaraan" di Dashboard.
   Menggabungkan avatar 3D (proyeksi orientasi MPU), waterpass
   pitch/roll, dan ringkasan status pose dalam satu bidang yang
   terbaca sekejap mata.
   ------------------------------------------------------------- */

function toneFor(overall: ReturnType<typeof computePoseStatus>['overall'], vibration: boolean): AvatarTone {
  if (overall === 'outside') return 'bad'
  if (overall === 'moving' || vibration) return 'warn'
  if (overall === 'inside') return 'ok'
  return 'idle'
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'warn' | 'bad' }) {
  const color = tone === 'ok' ? 'text-emerald-600' : tone === 'warn' ? 'text-amber-600' : tone === 'bad' ? 'text-red-600' : 'text-text'
  return (
    <div className="px-2.5 py-2 rounded-lg bg-muted/5 border border-border/60 min-w-0">
      <p className="section-title truncate">{label}</p>
      <p className={`value-small mono mt-0.5 tabular-nums truncate ${color}`}>{value}</p>
    </div>
  )
}

export default function VehicleHero({ tele, online = true }: { tele: any; online?: boolean }) {
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
  const pose = st.pose ?? computePose(tele)
  const tone = toneFor(st.overall, tele?.mpu_vibration === true)
  const copy = statusTone(st)
  const good = st.overall === 'inside'
  const bad = st.overall === 'outside'
  const alarm = tele?.alarm_active === true

  return (
    <section className="card animate-fade-in">
      <div className="card-header">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="value-small">Posisi Kendaraan</h3>
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
            {alarm && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[0.625rem] font-semibold uppercase tracking-wide border bg-red-100 text-red-700 border-red-200">
                Alarm aktif
              </span>
            )}
          </div>
          <p className="caption mt-0.5">Orientasi live MPU6050 &nbsp;·&nbsp; proyeksi pitch &amp; roll kendaraan</p>
        </div>
        <a href="#/pose" className="text-xs font-semibold text-brand hover:underline shrink-0">
          Kelola profil posisi &rarr;
        </a>
      </div>

      <div className="card-body">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] gap-4">
          {/* Avatar 3D */}
          <div>
            <MpuAvatar
              pitch={pose?.pitch}
              roll={pose?.roll}
              vibration={tele?.mpu_vibration === true}
              tone={tone}
              stale={!online}
              staleLabel="ESP32 offline"
              height={318}
            />
            <p className="caption mt-1.5">
              Geser untuk memutar kamera. Warna LED modul &amp; cincin lantai mengikuti status pose.
            </p>
          </div>

          {/* Panel bacaan */}
          <div className="flex flex-col gap-3">
            <div>
              <p className={`text-sm font-semibold ${good ? 'text-emerald-700' : bad ? 'text-red-700' : 'text-text'}`}>
                {copy.title}
              </p>
              <p className="text-xs text-muted mt-1 leading-relaxed">{copy.sub}</p>
            </div>

            <div className="flex items-center gap-4">
              <TiltGauge pitch={pose?.pitch} roll={pose?.roll} tone={tone} size={124} />
              <div className="flex-1 min-w-0 space-y-2">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="section-title">Pitch</span>
                  <span className="value-large mono tabular-nums">
                    {pose ? pose.pitch.toFixed(1) : '—'}<span className="unit">°</span>
                  </span>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="section-title">Roll</span>
                  <span className="value-large mono tabular-nums">
                    {pose ? pose.roll.toFixed(1) : '—'}<span className="unit">°</span>
                  </span>
                </div>
                {st.nearest && (
                  <p className="caption mono tabular-nums truncate">
                    Δ "{st.nearest.profile.name}" · {st.nearest.d_pitch}° / {st.nearest.d_roll}°
                  </p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <MiniStat
                label="Getaran"
                value={tele?.mpu_vibration === true ? 'TERDETEKSI' : 'tenang'}
                tone={tele?.mpu_vibration === true ? 'warn' : 'ok'}
              />
              <MiniStat
                label="Kecepatan"
                value={typeof tele?.speed_kmh === 'number' ? `${tele.speed_kmh.toFixed(1)} km/j` : '—'}
                tone={st.overall === 'moving' ? 'warn' : undefined}
              />
              <MiniStat label="Profil aktif" value={`${st.active.length} dari ${poses.length}`} />
              <MiniStat
                label="Mode"
                value={tele?.mode ?? '—'}
                tone={tele?.mode === 'armed' ? 'warn' : undefined}
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
