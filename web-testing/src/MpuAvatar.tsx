import { useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { ContactShadows, OrbitControls, RoundedBox } from '@react-three/drei'
import * as THREE from 'three'

/* -------------------------------------------------------------
   Avatar 3D motor — proyeksi live orientasi MPU (pitch/roll).
   Model disusun dari primitif (RoundedBox/cylinder/torus) supaya
   ringan dan tanpa file model eksternal. Rotasi di-lerp halus tiap
   frame supaya gerakan tidak "patah" saat telemetri diperbarui.
   Tone warna (ok/warn/bad) mewakili status pose dari server.
   Lantai memakai pola "target kalibrasi" — cincin konsentris + tick.
   Model ini kembar dengan Web/Frontend/motor3d.js (dashboard pengguna).
   ------------------------------------------------------------- */

const DEG = Math.PI / 180

export type AvatarTone = 'idle' | 'ok' | 'warn' | 'bad'

const TONE_ACCENT: Record<AvatarTone, string> = {
  idle: '#64748b',
  ok: '#2563eb',
  warn: '#f59e0b',
  bad: '#ef4444',
}

/* ------------------------- Rangkaian roda ------------------------- */

function Wheel({ position }: { position: [number, number, number] }) {
  const spokes = useMemo(() => [0, 1, 2, 3, 4, 5].map((i) => (i * Math.PI) / 3), [])
  return (
    <group position={position}>
      {/* Ban */}
      <mesh>
        <torusGeometry args={[0.3, 0.088, 16, 40]} />
        <meshStandardMaterial color="#17171c" roughness={0.92} metalness={0.05} />
      </mesh>
      {/* Velg + bibir */}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.232, 0.232, 0.058, 24]} />
        <meshStandardMaterial color="#cdd5e1" metalness={0.55} roughness={0.32} />
      </mesh>
      {[0.031, -0.031].map((z) => (
        <mesh key={z} position={[0, 0, z]}>
          <torusGeometry args={[0.228, 0.011, 8, 32]} />
          <meshStandardMaterial color="#94a3b8" metalness={0.6} roughness={0.35} />
        </mesh>
      ))}
      {/* Jari-jari */}
      {spokes.map((a, i) => (
        <mesh key={i} rotation={[0, 0, a]}>
          <boxGeometry args={[0.022, 0.43, 0.016]} />
          <meshStandardMaterial color="#94a3b8" metalness={0.5} roughness={0.38} />
        </mesh>
      ))}
      {/* Cakram rem + kaliper */}
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, 0.045]}>
        <cylinderGeometry args={[0.155, 0.155, 0.01, 22]} />
        <meshStandardMaterial color="#e2e8f0" metalness={0.7} roughness={0.26} />
      </mesh>
      <RoundedBox args={[0.055, 0.1, 0.045]} radius={0.012} smoothness={2} position={[-0.12, 0.1, 0.055]}>
        <meshStandardMaterial color="#1d4ed8" metalness={0.45} roughness={0.4} />
      </RoundedBox>
      {/* Tromol */}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.062, 0.062, 0.085, 16]} />
        <meshStandardMaterial color="#475569" metalness={0.6} roughness={0.42} />
      </mesh>
    </group>
  )
}

/* ------------------------- Spakbor (torus sebagian) ------------------------- */

function Fender({ position, rotation, color }: {
  position: [number, number, number]
  rotation: [number, number, number]
  color: string
}) {
  return (
    <group position={position} rotation={rotation} scale={[1, 1, 2.1]}>
      <mesh>
        <torusGeometry args={[0.38, 0.032, 8, 26, Math.PI * 0.52]} />
        <meshStandardMaterial color={color} metalness={0.35} roughness={0.42} />
      </mesh>
    </group>
  )
}

/* ------------------------- Model motor ------------------------- */

function MotorModel({ pitch, roll, tone, vibration }: {
  pitch: number
  roll: number
  tone: AvatarTone
  vibration: boolean
}) {
  const rig = useRef<THREE.Group>(null)
  const glow = useRef<THREE.MeshStandardMaterial>(null)
  const beacon = useRef<THREE.PointLight>(null)

  const accent = TONE_ACCENT[tone]

  useFrame((state, delta) => {
    const g = rig.current
    if (!g) return
    const t = state.clock.elapsedTime

    // Lerp eksponensial halus ke orientasi target (frame-rate independent).
    // Konvensi: mpu_pitch (+) = hidung naik  -> rotasi sumbu Z (lateral),
    //           mpu_roll  (+) = miring kanan -> rotasi sumbu X (memanjang).
    // Bila tanda sensor terbalik saat kalibrasi hardware, cukup balik tanda di sini.
    const k = 1 - Math.exp(-7 * Math.min(delta, 0.1))
    g.rotation.z += (pitch * DEG - g.rotation.z) * k
    g.rotation.x += (-roll * DEG - g.rotation.x) * k

    // Napas halus saat diam + guncangan kecil saat mpu_vibration.
    const shake = vibration ? 0.012 : 0
    g.position.y = 0.02 + Math.sin(t * 1.1) * 0.012 + (Math.random() - 0.5) * shake
    g.position.x = (Math.random() - 0.5) * shake

    // Denyut LED modul: panik saat getaran/alarm, tenang saat normal.
    const panic = vibration || tone === 'bad'
    const pulse = panic ? 0.55 + Math.sin(t * 7) * 0.45 : 0.5 + Math.sin(t * 1.8) * 0.15
    if (glow.current) glow.current.emissiveIntensity = pulse
    if (beacon.current) beacon.current.intensity = panic ? 0.7 + Math.sin(t * 7) * 0.5 : 0.32
  })

  return (
    <group ref={rig}>
      {/* Roda depan & belakang + spakbor */}
      <Wheel position={[-1.0, -0.42, 0]} />
      <Wheel position={[1.05, -0.42, 0]} />
      <Fender position={[1.05, -0.42, 0]} rotation={[0, 0, Math.PI * 0.22]} color="#1e3a8a" />
      <Fender position={[-1.0, -0.42, 0]} rotation={[0, 0, Math.PI * 0.3]} color="#1e3a8a" />

      {/* Mesin: blok + silinder + sirip pendingin */}
      <RoundedBox args={[0.42, 0.3, 0.28]} radius={0.045} smoothness={3} position={[0.12, -0.17, 0]}>
        <meshStandardMaterial color="#334155" metalness={0.55} roughness={0.5} />
      </RoundedBox>
      <mesh position={[0.3, -0.02, 0]} rotation={[0, 0, -0.55]}>
        <cylinderGeometry args={[0.085, 0.1, 0.24, 14]} />
        <meshStandardMaterial color="#475569" metalness={0.6} roughness={0.45} />
      </mesh>
      {[0, 1, 2].map((i) => (
        <mesh key={i} position={[0.335 - i * 0.045, 0.03 + i * 0.052, 0]} rotation={[0, 0, -0.55]}>
          <boxGeometry args={[0.21, 0.016, 0.21]} />
          <meshStandardMaterial color="#94a3b8" metalness={0.6} roughness={0.4} />
        </mesh>
      ))}

      {/* Radiator + sirip vertikal */}
      <RoundedBox args={[0.1, 0.2, 0.17]} radius={0.02} smoothness={2} position={[0.52, -0.02, 0]}>
        <meshStandardMaterial color="#334155" metalness={0.5} roughness={0.5} />
      </RoundedBox>
      {[0, 1, 2].map((i) => (
        <mesh key={i} position={[0.573, -0.02, -0.05 + i * 0.05]}>
          <boxGeometry args={[0.012, 0.17, 0.018]} />
          <meshStandardMaterial color="#94a3b8" metalness={0.5} />
        </mesh>
      ))}

      {/* Swingarm + rantai + gear belakang/depan */}
      {[1, -1].map((s) => (
        <RoundedBox key={s} args={[0.9, 0.07, 0.06]} radius={0.02} smoothness={2} position={[-0.55, -0.34, s * 0.12]} rotation={[0, 0, 0.06]}>
          <meshStandardMaterial color="#64748b" metalness={0.6} roughness={0.42} />
        </RoundedBox>
      ))}
      <mesh position={[-1.0, -0.42, 0.115]}>
        <torusGeometry args={[0.115, 0.018, 8, 26]} />
        <meshStandardMaterial color="#94a3b8" metalness={0.65} roughness={0.38} />
      </mesh>
      <mesh position={[0.12, -0.26, 0.115]}>
        <torusGeometry args={[0.055, 0.016, 8, 22]} />
        <meshStandardMaterial color="#94a3b8" metalness={0.65} roughness={0.38} />
      </mesh>
      <mesh position={[-0.44, -0.295, 0.115]} rotation={[0, 0, -0.085]}>
        <boxGeometry args={[1.12, 0.022, 0.03]} />
        <meshStandardMaterial color="#334155" metalness={0.55} roughness={0.5} />
      </mesh>
      <mesh position={[-0.44, -0.55, 0.115]} rotation={[0, 0, 0.11]}>
        <boxGeometry args={[1.12, 0.022, 0.03]} />
        <meshStandardMaterial color="#334155" metalness={0.55} roughness={0.5} />
      </mesh>

      {/* Rangka utama + tutup samping */}
      <RoundedBox args={[1.5, 0.15, 0.17]} radius={0.055} smoothness={3} position={[0, 0.06, 0]} rotation={[0, 0, -0.05]}>
        <meshStandardMaterial color="#2563eb" metalness={0.35} roughness={0.42} />
      </RoundedBox>
      {[1, -1].map((s) => (
        <RoundedBox key={s} args={[0.3, 0.19, 0.045]} radius={0.02} smoothness={2} position={[-0.32, 0.06, s * 0.155]} rotation={[0, 0, -0.08]}>
          <meshStandardMaterial color="#1e3a8a" metalness={0.35} roughness={0.45} />
        </RoundedBox>
      ))}

      {/* Tangki + tutup + bantalan lutut */}
      <RoundedBox args={[0.68, 0.25, 0.3]} radius={0.085} smoothness={4} position={[0.28, 0.3, 0]} rotation={[0, 0, -0.08]}>
        <meshStandardMaterial color="#2563eb" metalness={0.4} roughness={0.3} />
      </RoundedBox>
      <mesh position={[0.42, 0.445, 0]}>
        <cylinderGeometry args={[0.045, 0.045, 0.028, 14]} />
        <meshStandardMaterial color="#94a3b8" metalness={0.7} roughness={0.3} />
      </mesh>
      {[1, -1].map((s) => (
        <RoundedBox key={s} args={[0.2, 0.13, 0.02]} radius={0.01} smoothness={2} position={[0.18, 0.28, s * 0.155]} rotation={[0, 0, -0.08]}>
          <meshStandardMaterial color="#0f172a" roughness={0.8} />
        </RoundedBox>
      ))}

      {/* Jok + pegangan belakang + buritan + pelat nomor */}
      <RoundedBox args={[0.72, 0.13, 0.27]} radius={0.05} smoothness={3} position={[-0.5, 0.31, 0]}>
        <meshStandardMaterial color="#111827" roughness={0.92} metalness={0.02} />
      </RoundedBox>
      <mesh position={[-0.88, 0.37, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.016, 0.016, 0.3, 10]} />
        <meshStandardMaterial color="#cbd5e1" metalness={0.65} roughness={0.35} />
      </mesh>
      <RoundedBox args={[0.36, 0.1, 0.22]} radius={0.035} smoothness={3} position={[-0.97, 0.29, 0]} rotation={[0, 0, 0.16]}>
        <meshStandardMaterial color="#1e3a8a" metalness={0.35} roughness={0.45} />
      </RoundedBox>
      <RoundedBox args={[0.02, 0.11, 0.16]} radius={0.006} smoothness={2} position={[-1.16, 0.16, 0]} rotation={[0, 0, 0.35]}>
        <meshStandardMaterial color="#f1f5f9" roughness={0.6} />
      </RoundedBox>

      {/* Garpu depan + segitiga + reflektor */}
      {[1, -1].map((s) => (
        <mesh key={s} position={[0.945, -0.02, s * 0.088]} rotation={[0, 0, 0.265]}>
          <cylinderGeometry args={[0.032, 0.032, 0.9, 12]} />
          <meshStandardMaterial color="#dbeafe" metalness={0.72} roughness={0.25} />
        </mesh>
      ))}
      {[[0.845, 0.38], [0.9, 0.16]].map(([x, y]) => (
        <RoundedBox key={y} args={[0.13, 0.07, 0.26]} radius={0.025} smoothness={3} position={[x, y, 0]} rotation={[0, 0, 0.265]}>
          <meshStandardMaterial color="#475569" metalness={0.6} roughness={0.4} />
        </RoundedBox>
      ))}
      <RoundedBox args={[0.03, 0.07, 0.045]} radius={0.008} smoothness={2} position={[0.925, 0.05, 0]} rotation={[0, 0, 0.265]}>
        <meshStandardMaterial color="#f79009" emissive="#f79009" emissiveIntensity={0.25} roughness={0.4} />
      </RoundedBox>

      {/* Setang: batang, grip, tuas rem, spion */}
      <mesh position={[0.82, 0.56, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.024, 0.024, 0.62, 12]} />
        <meshStandardMaterial color="#334155" metalness={0.55} roughness={0.45} />
      </mesh>
      {[1, -1].map((s) => (
        <group key={s}>
          <mesh position={[0.82, 0.56, s * 0.265]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.034, 0.034, 0.13, 12]} />
            <meshStandardMaterial color="#0f172a" roughness={0.85} />
          </mesh>
          <RoundedBox args={[0.14, 0.018, 0.03]} radius={0.008} smoothness={2} position={[0.9, 0.53, s * 0.22]} rotation={[0, s * 0.5, -0.4]}>
            <meshStandardMaterial color="#94a3b8" metalness={0.65} roughness={0.35} />
          </RoundedBox>
          <mesh position={[0.78, 0.68, s * 0.24]} rotation={[-s * 0.35, 0, s * 0.32]}>
            <cylinderGeometry args={[0.011, 0.011, 0.22, 8]} />
            <meshStandardMaterial color="#475569" metalness={0.6} roughness={0.4} />
          </mesh>
          <mesh position={[0.74, 0.79, s * 0.3]} rotation={[Math.PI / 2 - s * 0.35, 0, s * 0.3]}>
            <cylinderGeometry args={[0.052, 0.052, 0.016, 16]} />
            <meshStandardMaterial color="#e2e8f0" metalness={0.65} roughness={0.22} />
          </mesh>
        </group>
      ))}

      {/* Lampu depan (bezel + lensa) + sein depan */}
      <mesh position={[0.99, 0.42, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.1, 0.105, 0.07, 20]} />
        <meshStandardMaterial color="#334155" metalness={0.55} roughness={0.4} />
      </mesh>
      <mesh position={[1.03, 0.42, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.082, 0.082, 0.022, 20]} />
        <meshStandardMaterial color="#fde68a" emissive="#f59e0b" emissiveIntensity={0.5} roughness={0.22} />
      </mesh>
      <pointLight position={[1.5, 0.42, 0]} intensity={0.42} distance={2.4} color="#fbbf24" />
      {[1, -1].map((s) => (
        <mesh key={s} position={[0.93, 0.35, s * 0.17]}>
          <sphereGeometry args={[0.032, 12, 10]} />
          <meshStandardMaterial color="#f79009" emissive="#f79009" emissiveIntensity={0.35} roughness={0.35} />
        </mesh>
      ))}

      {/* Lampu belakang + sein belakang */}
      <mesh position={[-1.155, 0.31, 0]}>
        <boxGeometry args={[0.055, 0.075, 0.17]} />
        <meshStandardMaterial color="#ef4444" emissive="#ef4444" emissiveIntensity={0.5} />
      </mesh>
      {[1, -1].map((s) => (
        <mesh key={s} position={[-1.12, 0.24, s * 0.15]}>
          <sphereGeometry args={[0.03, 12, 10]} />
          <meshStandardMaterial color="#f79009" emissive="#f79009" emissiveIntensity={0.35} roughness={0.35} />
        </mesh>
      ))}

      {/* Knalpot: header + muffler + heat shield */}
      <mesh position={[-0.42, -0.19, 0.17]} rotation={[0, 0, 0.1]}>
        <cylinderGeometry args={[0.042, 0.052, 0.95, 14]} />
        <meshStandardMaterial color="#94a3b8" metalness={0.78} roughness={0.3} />
      </mesh>
      <mesh position={[-0.92, -0.14, 0.17]} rotation={[0, 0, 1.42]}>
        <cylinderGeometry args={[0.056, 0.056, 0.22, 14]} />
        <meshStandardMaterial color="#64748b" metalness={0.7} roughness={0.35} />
      </mesh>
      <RoundedBox args={[0.16, 0.055, 0.012]} radius={0.006} smoothness={2} position={[-0.72, -0.105, 0.225]} rotation={[0, 0, 0.12]}>
        <meshStandardMaterial color="#e2e8f0" metalness={0.7} roughness={0.3} />
      </RoundedBox>

      {/* Footstep kiri-kanan */}
      {[1, -1].map((s) => (
        <mesh key={s} position={[-0.08, -0.32, s * 0.2]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.016, 0.016, 0.12, 10]} />
          <meshStandardMaterial color="#475569" metalness={0.6} roughness={0.45} />
        </mesh>
      ))}

      {/* Modul SMARTGUARD — LED berdenyut sesuai status */}
      <RoundedBox args={[0.26, 0.15, 0.2]} radius={0.03} smoothness={3} position={[-0.28, 0.1, -0.19]}>
        <meshStandardMaterial color="#0ea5e9" metalness={0.25} roughness={0.42} />
      </RoundedBox>
      <mesh position={[-0.28, 0.185, -0.19]}>
        <sphereGeometry args={[0.028, 12, 10]} />
        <meshStandardMaterial ref={glow} color={accent} emissive={accent} emissiveIntensity={0.6} />
      </mesh>
      <pointLight ref={beacon} position={[-0.28, 0.3, -0.19]} intensity={0.32} distance={1.3} color={accent} />

      {/* Standar samping */}
      <mesh position={[-0.32, -0.58, 0.2]} rotation={[0.55, 0, 0.22]}>
        <cylinderGeometry args={[0.016, 0.016, 0.48, 8]} />
        <meshStandardMaterial color="#475569" metalness={0.6} roughness={0.45} />
      </mesh>
    </group>
  )
}

/* ------------------------- Lantai: target kalibrasi ------------------------- */

function Floor({ tone }: { tone: AvatarTone }) {
  const ticks = useMemo(() => Array.from({ length: 24 }, (_, i) => (i * Math.PI) / 12), [])
  return (
    <group>
      {/* Alas */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.825, 0]}>
        <circleGeometry args={[2.62, 64]} />
        <meshStandardMaterial color="#f0f6ff" transparent opacity={0.92} />
      </mesh>
      {/* Cincin konsentris */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.818, 0]}>
        <ringGeometry args={[0.92, 0.945, 64]} />
        <meshStandardMaterial color="#c7dcf5" transparent opacity={0.8} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.816, 0]}>
        <ringGeometry args={[1.72, 1.755, 64]} />
        <meshStandardMaterial
          color={TONE_ACCENT[tone]}
          emissive={TONE_ACCENT[tone]}
          emissiveIntensity={tone === 'bad' ? 0.45 : 0.18}
          transparent
          opacity={0.6}
        />
      </mesh>
      {/* Tick keliling — nuansa alat ukur */}
      {ticks.map((a, i) => (
        <mesh
          key={i}
          rotation={[-Math.PI / 2, 0, -a]}
          position={[Math.cos(a) * 2.36, -0.812, Math.sin(a) * 2.36]}
        >
          <boxGeometry args={[0.16, 0.012, 0.022]} />
          <meshStandardMaterial color="#b9cfe9" transparent opacity={0.85} />
        </mesh>
      ))}
    </group>
  )
}

/* ------------------------- Komponen utama ------------------------- */

export interface MpuAvatarProps {
  /** Sudut pitch dari telemetri (derajat). */
  pitch?: number | null
  /** Sudut roll dari telemetri (derajat). */
  roll?: number | null
  /** mpu_vibration — memicu guncangan kecil + denyut lampu. */
  vibration?: boolean
  /** Status pose: memengaruhi warna aksen (LED modul & cincin lantai). */
  tone?: AvatarTone
  /** Tampilan "tidak live": avatar di-blur + label overlay (mis. menunggu data/offline). */
  stale?: boolean
  /** Label overlay saat stale. */
  staleLabel?: string
  /** Tinggi canvas (px). */
  height?: number
  /** Kamera berputar pelan (nonaktifkan bila ingin diam). */
  autoRotate?: boolean
}

/**
 * Avatar 3D motor yang memproyeksikan orientasi kendaraan dari MPU6050.
 * Pitch = hidung naik/turun, roll = miring kiri/kanan. Kamera bisa
 * digeser (orbit), zoom dimatikan supaya tata letak tetap rapi.
 */
export default function MpuAvatar({
  pitch,
  roll,
  vibration,
  tone = 'idle',
  stale = false,
  staleLabel = 'Menunggu data MPU',
  height = 260,
  autoRotate = true,
}: MpuAvatarProps) {
  const p = typeof pitch === 'number' && Number.isFinite(pitch) ? pitch : 0
  const r = typeof roll === 'number' && Number.isFinite(roll) ? roll : 0

  return (
    <div
      className="relative rounded-xl overflow-hidden"
      style={{
        height,
        background: 'linear-gradient(180deg, #f8fbff 0%, #e9f0fb 60%, #dde9f8 100%)',
      }}
    >
      <div
        className="h-full w-full"
        style={{
          filter: stale ? 'blur(7px) saturate(0.9)' : 'none',
          transition: 'filter 0.5s ease',
        }}
      >
        <Canvas
          camera={{ position: [3.15, 2.05, 3.65], fov: 35 }}
          dpr={[1, 1.75]}
          gl={{ antialias: true, alpha: true }}
        >
          <ambientLight intensity={0.56} />
          <hemisphereLight args={['#dbeafe', '#e2e8f0', 0.55]} />
          <directionalLight position={[5, 7, 4]} intensity={1.1} />
          <directionalLight position={[-5, 4, -3]} intensity={0.38} />
          <directionalLight position={[-2, 2.5, 6]} intensity={0.3} color="#bfdbfe" />

          <Floor tone={tone} />

          <MotorModel pitch={p} roll={r} tone={tone} vibration={vibration === true} />

          <ContactShadows position={[0, -0.8, 0]} opacity={0.42} scale={9} blur={2.5} far={3.2} color="#1e3a5f" />

          <OrbitControls
            enableZoom={false}
            enablePan={false}
            autoRotate={autoRotate}
            autoRotateSpeed={0.3}
            minPolarAngle={Math.PI * 0.16}
            maxPolarAngle={Math.PI * 0.5}
            enableDamping
            dampingFactor={0.08}
          />
        </Canvas>
      </div>
      {stale && (
        <div className="absolute inset-0 grid place-items-center pointer-events-none">
          <span className="px-3 py-1.5 rounded-full bg-white/85 border border-brand-light text-xs font-semibold text-muted shadow-sm">
            {staleLabel}
          </span>
        </div>
      )}
    </div>
  )
}
