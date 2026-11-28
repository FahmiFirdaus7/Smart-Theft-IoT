import { useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { ContactShadows, OrbitControls, RoundedBox } from '@react-three/drei'
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/* -------------------------------------------------------------
   Avatar 3D Vespa klasik — proyeksi live orientasi MPU (pitch/roll).

   Model disusun dari primitif three.js (tanpa file GLB) supaya
   ringan dan tanpa aset eksternal. Siluet khas Vespa vintage:
   tameng depan melengkung + "dasi", dek kaki rata, body monocoque
   dengan panel samping melengkung, jok panjang, ban serep belakang,
   garpu tunggal (trailing link), silinder mesin kanan + knalpot.

   Rotasi di-lerp halus tiap frame supaya gerakan tidak "patah" saat
   telemetri diperbarui. Tone warna (ok/warn/bad) mewakili status pose
   dari server. Lantai memakai pola "target kalibrasi".
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

/* ------------------------- Palet Vespa vintage ------------------------- */

const PAINT = '#74b09a' // verde pastel klasik
const PAINT_D = '#5f9a86' // panel samping (sedikit lebih pekat)
const CREAM = '#f2ecde' // krem: dinding ban, pelat nomor
const CHROME = '#e2e8ef'
const STEEL = '#98a4b2'
const LEATHER = '#26221e'

const M = {
  paint: { color: PAINT, metalness: 0.32, roughness: 0.38, envMapIntensity: 0.65 },
  paintDark: { color: PAINT_D, metalness: 0.32, roughness: 0.44, envMapIntensity: 0.6 },
  chrome: { color: CHROME, metalness: 1, roughness: 0.16, envMapIntensity: 1.15 },
  steel: { color: STEEL, metalness: 0.85, roughness: 0.32, envMapIntensity: 1 },
  cream: { color: CREAM, metalness: 0.1, roughness: 0.62, envMapIntensity: 0.6 },
  leather: { color: LEATHER, metalness: 0.05, roughness: 0.82, envMapIntensity: 0.5 },
  rubber: { color: '#1c1c21', metalness: 0.05, roughness: 0.92, envMapIntensity: 0.35 },
}

/* ------------------------- Body monocoque -------------------------
   Profil samping (tameng depan + dek kaki + buritan) diekstrusi
   lalu dibengkokkan pada sumbu Z supaya pelatnya melengkung khas
   bodi Vespa (bukan pelat datar).                              */

function buildBodyGeometry() {
  const s = new THREE.Shape()
  s.moveTo(0.755, -0.325)
  s.bezierCurveTo(0.822, -0.312, 0.862, -0.125, 0.868, 0.035) // sisi depan tameng
  s.bezierCurveTo(0.874, 0.22, 0.83, 0.335, 0.752, 0.372) // puncak tameng (menyambung ke setang)
  s.lineTo(0.632, 0.352) // bibir atas tameng
  s.bezierCurveTo(0.665, 0.2, 0.652, -0.05, 0.648, -0.202) // sisi belakang tameng (tipis)
  s.lineTo(0.556, -0.243) // bertemu dek kaki
  s.lineTo(-0.185, -0.256) // dek kaki
  s.bezierCurveTo(-0.262, -0.263, -0.303, -0.218, -0.318, -0.118) // dinding depan body
  s.bezierCurveTo(-0.336, 0.012, -0.318, 0.172, -0.345, 0.252) // naik ke level jok
  s.lineTo(-0.392, 0.305) // pangkal dek jok
  s.lineTo(-1.02, 0.318) // dek jok
  s.bezierCurveTo(-1.165, 0.322, -1.285, 0.272, -1.33, 0.142) // buritan
  s.bezierCurveTo(-1.362, 0.015, -1.352, -0.108, -1.272, -0.178)
  s.bezierCurveTo(-1.148, -0.272, -0.95, -0.33, -0.72, -0.342) // kolong body
  s.bezierCurveTo(-0.48, -0.352, -0.05, -0.352, 0.32, -0.338)
  s.lineTo(0.755, -0.325)

  let geo: THREE.BufferGeometry = new THREE.ExtrudeGeometry(s, {
    depth: 0.42,
    bevelEnabled: true,
    bevelThickness: 0.038,
    bevelSize: 0.032,
    bevelSegments: 3,
    curveSegments: 24,
  })
  geo.translate(0, 0, -0.21)

  // Bengkokkan pelat: sisi yang jauh dari sumbu tengah mundur (khas tameng Vespa),
  // lalu perapian siluet: buritan menyempit + sedikit meruncing ke atas.
  geo = mergeVertices(geo, 1e-4)
  const pos = geo.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const y = pos.getY(i)
    const z = pos.getZ(i)
    let taper = 1
    if (x < -0.2) taper = 1 - 0.3 * Math.min(1, (-0.2 - x) / 1.15)
    const vy = 1 - 0.1 * Math.max(0, (y - 0.1) / 0.3)
    const zz = z * taper * vy
    pos.setZ(i, zz)
    pos.setX(i, x - 0.7 * zz * zz)
  }
  pos.needsUpdate = true
  geo.computeVertexNormals()
  return geo
}

/* ------------------------- Rangkaian roda -------------------------
   Velg baja klasik: ban + dinding putih, lubang ventilasi, tromol. */

function Wheel({ position, rotation, scale = 1 }: {
  position: [number, number, number]
  rotation?: [number, number, number]
  scale?: number
}) {
  const slots = useMemo(() => [0, 1, 2, 3, 4, 5].map((i) => (i * Math.PI) / 3), [])
  return (
    <group position={position} rotation={rotation} scale={scale}>
      {/* Ban */}
      <mesh>
        <torusGeometry args={[0.305, 0.085, 18, 44]} />
        <meshStandardMaterial {...M.rubber} />
      </mesh>
      {/* Dinding putih klasik (pita tipis di tepi ban) */}
      {[0.076, -0.076].map((z) => (
        <mesh key={z} position={[0, 0, z]} scale={[1, 1, 0.3]}>
          <torusGeometry args={[0.316, 0.032, 8, 40]} />
          <meshStandardMaterial {...M.cream} />
        </mesh>
      ))}
      {/* Velg baja + bibir krom */}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.246, 0.246, 0.1, 28]} />
        <meshStandardMaterial color="#c9cfd8" metalness={0.55} roughness={0.36} envMapIntensity={0.9} />
      </mesh>
      {[0.051, -0.051].map((z) => (
        <mesh key={z} position={[0, 0, z]}>
          <torusGeometry args={[0.243, 0.013, 8, 36]} />
          <meshStandardMaterial {...M.chrome} />
        </mesh>
      ))}
      {/* Lubang ventilasi velg */}
      {slots.map((a, i) =>
        [1, -1].map((s) => (
          <mesh
            key={`${i}-${s}`}
            position={[Math.cos(a) * 0.192, Math.sin(a) * 0.192, s * 0.0505]}
            rotation={[0, 0, a - Math.PI / 2]}
          >
            <boxGeometry args={[0.036, 0.08, 0.005]} />
            <meshStandardMaterial color="#46525e" metalness={0.5} roughness={0.55} envMapIntensity={0.7} />
          </mesh>
        ))
      )}
      {/* Tromol rem + tutup as */}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.105, 0.108, 0.108, 20]} />
        <meshStandardMaterial {...M.steel} />
      </mesh>
      {[0.068, -0.068].map((z) => (
        <mesh key={z} position={[0, 0, z]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.052, 0.058, 0.032, 18]} />
          <meshStandardMaterial {...M.chrome} />
        </mesh>
      ))}
      {/* Pentil ban */}
      <mesh position={[0.208, 0.108, 0.075]} rotation={[0, 0, -0.48]}>
        <cylinderGeometry args={[0.007, 0.007, 0.032, 8]} />
        <meshStandardMaterial {...M.steel} />
      </mesh>
    </group>
  )
}

/* ------------------------- Model Vespa ------------------------- */

function VespaModel({ pitch, roll, tone, vibration }: {
  pitch: number
  roll: number
  tone: AvatarTone
  vibration: boolean
}) {
  const rig = useRef<THREE.Group>(null)
  const glow = useRef<THREE.MeshStandardMaterial>(null)
  const beacon = useRef<THREE.PointLight>(null)
  const bodyGeo = useMemo(() => buildBodyGeometry(), [])

  const accent = TONE_ACCENT[tone]

  useFrame((state, delta) => {
    const g = rig.current
    if (!g) return
    const t = state.clock.elapsedTime

    // Lerp eksponensial halus ke orientasi target (frame-rate independent).
    // Konvensi: mpu_pitch (+) = hidung naik  -> rotasi sumbu Z (lateral),
    //           mpu_roll  (+) = miring kanan -> rotasi sumbu X (memanjang).
    // Model: hidung ke +X, up +Y, kanan tangan => +Z = sisi KANAN motor, dan
    // rotasi X positif membuat punggung motor condong ke kanan -> pakai +roll.
    const k = 1 - Math.exp(-7 * Math.min(delta, 0.1))
    g.rotation.z += (pitch * DEG - g.rotation.z) * k
    g.rotation.x += (roll * DEG - g.rotation.x) * k

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
      {/* ===== Roda depan & belakang ===== */}
      <Wheel position={[-1.0, -0.42, 0]} />
      <Wheel position={[1.05, -0.42, 0]} />

      {/* ===== Spakbor depan klasik + ornamen krom ===== */}
      <mesh position={[1.05, -0.42, 0]} rotation={[0, 0, -0.56]} scale={[1, 1, 2.8]}>
        <torusGeometry args={[0.438, 0.04, 10, 30, Math.PI * 0.72]} />
        <meshStandardMaterial {...M.paint} />
      </mesh>
      <RoundedBox args={[0.095, 0.03, 0.034]} radius={0.013} smoothness={2} position={[1.262, 0.045, 0]} rotation={[0, 0, -0.22]}>
        <meshStandardMaterial {...M.chrome} />
      </RoundedBox>

      {/* ===== Suspensi depan trailing-link (garpu tunggal) khas Vespa ===== */}
      <mesh position={[0.93, 0.1, 0]} rotation={[0, 0, -0.232]}>
        <cylinderGeometry args={[0.052, 0.052, 0.88, 16]} />
        <meshStandardMaterial {...M.steel} />
      </mesh>
      <RoundedBox args={[0.26, 0.07, 0.05]} radius={0.02} smoothness={3} position={[0.985, -0.345, -0.14]} rotation={[0, 0, -0.83]}>
        <meshStandardMaterial {...M.steel} />
      </RoundedBox>
      <group position={[0.9125, -0.175, -0.115]} rotation={[0, 0, -0.41]}>
        <mesh>
          <cylinderGeometry args={[0.032, 0.032, 0.34, 12]} />
          <meshStandardMaterial {...M.steel} />
        </mesh>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <mesh key={i} position={[0, -0.11 + i * 0.044, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.055, 0.011, 8, 18]} />
            <meshStandardMaterial {...M.chrome} />
          </mesh>
        ))}
      </group>
      <mesh position={[1.05, -0.42, -0.105]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.028, 0.028, 0.15, 12]} />
        <meshStandardMaterial {...M.chrome} />
      </mesh>

      {/* ===== Body monocoque: tameng depan + dek kaki + buritan ===== */}
      <mesh geometry={bodyGeo}>
        <meshStandardMaterial {...M.paint} />
      </mesh>

      {/* ===== Panel samping melengkung ("kuping" khas Vespa) + aksen krom ===== */}
      {[1, -1].map((s) => (
        <group key={s}>
          <mesh position={[-0.72, -0.01, s * 0.215]} scale={[0.52, 0.225, 0.105]} rotation={[0, 0, -0.06]}>
            <sphereGeometry args={[1, 28, 20]} />
            <meshStandardMaterial {...M.paintDark} />
          </mesh>
          <RoundedBox args={[0.14, 0.045, 0.014]} radius={0.007} smoothness={2} position={[-0.72, -0.01, s * 0.322]}>
            <meshStandardMaterial {...M.chrome} />
          </RoundedBox>
        </group>
      ))}

      {/* ===== Dek kaki: rel krom samping + alur anti slip ===== */}
      {[1, -1].map((s) => (
        <RoundedBox key={s} args={[0.8, 0.022, 0.028]} radius={0.01} smoothness={2} position={[0.165, -0.238, s * 0.272]}>
          <meshStandardMaterial {...M.chrome} />
        </RoundedBox>
      ))}
      {[-0.135, 0, 0.135].map((z) => (
        <RoundedBox key={z} args={[0.72, 0.014, 0.05]} radius={0.006} smoothness={2} position={[0.185, -0.238, z]}>
          <meshStandardMaterial {...M.paintDark} />
        </RoundedBox>
      ))}

      {/* ===== Tameng depan: "dasi" krom + lencana ===== */}
      <RoundedBox args={[0.032, 0.44, 0.082]} radius={0.013} smoothness={2} position={[0.884, 0.03, 0]} rotation={[0, 0, -0.02]}>
        <meshStandardMaterial {...M.chrome} />
      </RoundedBox>
      <RoundedBox args={[0.018, 0.36, 0.045]} radius={0.008} smoothness={2} position={[0.902, 0.03, 0]} rotation={[0, 0, -0.02]}>
        <meshStandardMaterial {...M.paintDark} />
      </RoundedBox>
      <RoundedBox args={[0.022, 0.075, 0.17]} radius={0.009} smoothness={2} position={[0.803, 0.263, 0]} rotation={[0, 0, -0.52]}>
        <meshStandardMaterial {...M.chrome} />
      </RoundedBox>

      {/* ===== Jok panjang vintage + tali jok ===== */}
      <mesh position={[-0.64, 0.372, 0]} scale={[0.44, 0.075, 0.19]} rotation={[0, 0, -0.04]}>
        <sphereGeometry args={[1, 32, 20]} />
        <meshStandardMaterial {...M.leather} />
      </mesh>
      <RoundedBox args={[0.05, 0.018, 0.36]} radius={0.008} smoothness={2} position={[-0.5, 0.432, 0]} rotation={[0, 0, -0.04]}>
        <meshStandardMaterial color="#6b4f3a" metalness={0.05} roughness={0.8} />
      </RoundedBox>

      {/* ===== Ban serep klasik (kecil, diikat di buritan) ===== */}
      <Wheel position={[-1.12, 0.26, -0.22]} rotation={[0.15, -0.25, 0]} scale={0.62} />

      {/* ===== Mesin kanan: silinder + tutup kipas + knalpot ===== */}
      <mesh position={[-0.62, -0.27, 0.22]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.072, 0.072, 0.32, 16]} />
        <meshStandardMaterial {...M.steel} />
      </mesh>
      {[-0.5, -0.585, -0.67, -0.755].map((x) => (
        <mesh key={x} position={[x, -0.27, 0.22]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.1, 0.1, 0.016, 18]} />
          <meshStandardMaterial {...M.steel} />
        </mesh>
      ))}
      <mesh position={[-0.845, -0.27, 0.22]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.092, 0.092, 0.085, 18]} />
        <meshStandardMaterial {...M.steel} />
      </mesh>
      <mesh position={[-0.415, -0.27, 0.235]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.118, 0.118, 0.08, 22]} />
        <meshStandardMaterial {...M.cream} />
      </mesh>
      <mesh position={[-0.362, -0.27, 0.235]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.055, 0.055, 0.022, 16]} />
        <meshStandardMaterial {...M.chrome} />
      </mesh>
      {/* Knalpot: leher + peredam + perisai panas */}
      <mesh position={[-0.98, -0.345, 0.26]} rotation={[0, 0, Math.PI / 2 + 0.16]}>
        <cylinderGeometry args={[0.038, 0.032, 0.3, 12]} />
        <meshStandardMaterial {...M.steel} />
      </mesh>
      <mesh position={[-1.06, -0.4, 0.27]} rotation={[0, 0, Math.PI / 2 + 0.08]}>
        <cylinderGeometry args={[0.058, 0.058, 0.42, 18]} />
        <meshStandardMaterial {...M.steel} />
      </mesh>
      <mesh position={[-1.265, -0.415, 0.27]} rotation={[0, 0, Math.PI / 2 + 0.08]}>
        <cylinderGeometry args={[0.032, 0.038, 0.07, 12]} />
        <meshStandardMaterial {...M.chrome} />
      </mesh>
      <RoundedBox args={[0.21, 0.045, 0.016]} radius={0.007} smoothness={2} position={[-1.06, -0.338, 0.332]} rotation={[0, 0, 0.08]}>
        <meshStandardMaterial {...M.chrome} />
      </RoundedBox>

      {/* ===== Setang: rumah lampu, grip, tuas, spion bulat ===== */}
      <RoundedBox args={[0.26, 0.19, 0.34]} radius={0.055} smoothness={3} position={[0.845, 0.455, 0]} rotation={[0, 0, -0.04]}>
        <meshStandardMaterial {...M.paint} />
      </RoundedBox>
      <mesh position={[0.845, 0.475, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.023, 0.023, 0.8, 12]} />
        <meshStandardMaterial {...M.steel} />
      </mesh>
      {[1, -1].map((s) => (
        <group key={s}>
          {/* Grip */}
          <mesh position={[0.845, 0.475, s * 0.355]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.037, 0.037, 0.135, 14]} />
            <meshStandardMaterial color="#1b1b1f" metalness={0.05} roughness={0.88} />
          </mesh>
          <mesh position={[0.845, 0.475, s * 0.293]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.041, 0.041, 0.014, 14]} />
            <meshStandardMaterial {...M.chrome} />
          </mesh>
          {/* Tuas rem */}
          <RoundedBox args={[0.155, 0.02, 0.032]} radius={0.008} smoothness={2} position={[0.935, 0.438, s * 0.285]} rotation={[0, s * 0.5, -0.35]}>
            <meshStandardMaterial {...M.steel} />
          </RoundedBox>
          {/* Batang spion + kepala bulat */}
          <mesh position={[0.815, 0.625, s * 0.245]} rotation={[s * 0.42, 0, s * 0.1]}>
            <cylinderGeometry args={[0.012, 0.012, 0.24, 8]} />
            <meshStandardMaterial {...M.chrome} />
          </mesh>
          <mesh position={[0.795, 0.745, s * 0.315]} rotation={[0, 0, Math.PI / 2 - 0.18]}>
            <cylinderGeometry args={[0.068, 0.068, 0.02, 22]} />
            <meshStandardMaterial {...M.chrome} />
          </mesh>
          <mesh position={[0.782, 0.748, s * 0.315]} rotation={[0, 0, Math.PI / 2 - 0.18]}>
            <cylinderGeometry args={[0.056, 0.056, 0.006, 22]} />
            <meshStandardMaterial color="#cfd8e3" metalness={0.9} roughness={0.08} envMapIntensity={1.5} />
          </mesh>
          {/* Sein depan model peluru */}
          <group position={[0.925, 0.435, s * 0.28]}>
            <mesh rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.013, 0.013, 0.09, 8]} />
              <meshStandardMaterial {...M.chrome} />
            </mesh>
            <mesh position={[0, 0, s * 0.045]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.04, 0.04, 0.012, 16]} />
              <meshStandardMaterial {...M.chrome} />
            </mesh>
            <mesh position={[0, 0, s * 0.078]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.038, 0.032, 0.055, 16]} />
              <meshStandardMaterial color="#f79009" emissive="#f79009" emissiveIntensity={0.35} metalness={0.15} roughness={0.3} />
            </mesh>
          </group>
        </group>
      ))}

      {/* ===== Speedometer bulat di atas rumah lampu ===== */}
      <mesh position={[0.825, 0.556, 0]} rotation={[0, 0, -0.04]}>
        <cylinderGeometry args={[0.078, 0.078, 0.028, 22]} />
        <meshStandardMaterial {...M.chrome} />
      </mesh>
      <mesh position={[0.825, 0.572, 0]} rotation={[0, 0, -0.04]}>
        <cylinderGeometry args={[0.062, 0.062, 0.008, 22]} />
        <meshStandardMaterial color="#f4f1e6" metalness={0.05} roughness={0.35} />
      </mesh>
      <RoundedBox args={[0.007, 0.004, 0.045]} radius={0.002} smoothness={2} position={[0.838, 0.578, 0.012]} rotation={[0, 0.6, -0.04]}>
        <meshStandardMaterial color="#c0392b" metalness={0.1} roughness={0.5} />
      </RoundedBox>

      {/* ===== Lampu depan bulat klasik (bezel krom + lensa) ===== */}
      <mesh position={[1.0, 0.475, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.118, 0.118, 0.05, 26]} />
        <meshStandardMaterial {...M.chrome} />
      </mesh>
      <mesh position={[1.033, 0.475, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.098, 0.098, 0.022, 26]} />
        <meshStandardMaterial color="#fde68a" emissive="#f59e0b" emissiveIntensity={0.5} metalness={0.15} roughness={0.22} />
      </mesh>
      <pointLight position={[1.45, 0.475, 0]} intensity={0.42} distance={2.4} color="#fbbf24" />

      {/* ===== Lampu belakang + pelat nomor + sein belakang ===== */}
      <RoundedBox args={[0.05, 0.12, 0.18]} radius={0.014} smoothness={2} position={[-1.315, 0.055, 0]} rotation={[0, 0, 0.2]}>
        <meshStandardMaterial {...M.chrome} />
      </RoundedBox>
      <RoundedBox args={[0.04, 0.1, 0.152]} radius={0.012} smoothness={2} position={[-1.342, 0.055, 0]} rotation={[0, 0, 0.2]}>
        <meshStandardMaterial color="#ef4444" emissive="#ef4444" emissiveIntensity={0.5} metalness={0.15} roughness={0.3} />
      </RoundedBox>
      <RoundedBox args={[0.018, 0.125, 0.215]} radius={0.008} smoothness={2} position={[-1.322, -0.135, 0]} rotation={[0, 0, 0.42]}>
        <meshStandardMaterial {...M.cream} />
      </RoundedBox>
      <RoundedBox args={[0.01, 0.1, 0.185]} radius={0.005} smoothness={2} position={[-1.332, -0.135, 0]} rotation={[0, 0, 0.42]}>
        <meshStandardMaterial color="#2c3e50" metalness={0.1} roughness={0.55} />
      </RoundedBox>
      {[1, -1].map((s) => (
        <group key={s} position={[-1.245, 0.105, s * 0.19]}>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.04, 0.04, 0.012, 16]} />
            <meshStandardMaterial {...M.chrome} />
          </mesh>
          <mesh position={[0, 0, s * 0.033]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.038, 0.032, 0.055, 16]} />
            <meshStandardMaterial color="#f79009" emissive="#f79009" emissiveIntensity={0.35} metalness={0.15} roughness={0.3} />
          </mesh>
        </group>
      ))}

      {/* ===== Modul SMARTGUARD + LED status di buritan ===== */}
      <RoundedBox args={[0.22, 0.13, 0.25]} radius={0.03} smoothness={3} position={[-1.18, 0.335, 0]}>
        <meshStandardMaterial color="#1f2a37" metalness={0.35} roughness={0.42} />
      </RoundedBox>
      <RoundedBox args={[0.185, 0.012, 0.215]} radius={0.005} smoothness={2} position={[-1.18, 0.404, 0]}>
        <meshStandardMaterial color="#0ea5e9" metalness={0.3} roughness={0.35} emissive="#0ea5e9" emissiveIntensity={0.18} />
      </RoundedBox>
      <mesh position={[-1.18, 0.433, 0]}>
        <sphereGeometry args={[0.03, 14, 12]} />
        <meshStandardMaterial ref={glow} color={accent} emissive={accent} emissiveIntensity={0.6} />
      </mesh>
      <pointLight ref={beacon} position={[-1.18, 0.54, 0]} intensity={0.32} distance={1.3} color={accent} />
      {/* Antena modul */}
      <mesh position={[-1.27, 0.445, 0]}>
        <cylinderGeometry args={[0.006, 0.006, 0.15, 8]} />
        <meshStandardMaterial {...M.steel} />
      </mesh>
      <mesh position={[-1.27, 0.525, 0]}>
        <sphereGeometry args={[0.013, 10, 8]} />
        <meshStandardMaterial {...M.chrome} />
      </mesh>

      {/* ===== Standar samping ===== */}
      <mesh position={[-0.32, -0.56, 0.235]} rotation={[-0.55, 0, 0.22]}>
        <cylinderGeometry args={[0.017, 0.017, 0.42, 10]} />
        <meshStandardMaterial {...M.steel} />
      </mesh>
      <RoundedBox args={[0.055, 0.018, 0.075]} radius={0.007} smoothness={2} position={[-0.274, -0.762, 0.345]} rotation={[0, -0.35, 0.22]}>
        <meshStandardMaterial {...M.steel} />
      </RoundedBox>
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

/* ------------------------- Pencahayaan studio ------------------------- */

/** Environment map prosedural (tanpa unduhan HDRI) supaya krom & cat terlihat hidup. */
function StudioEnv() {
  const { gl, scene } = useThree()
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl)
    // RoomEnvironment: studio prosedural bawaan three.js (tanpa unduhan HDRI).
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04)
    // oxlint-disable-next-line react(immutability) -- scene three.js memang dimutasi
    scene.environment = env.texture
    return () => {
      // oxlint-disable-next-line react(immutability) -- scene three.js memang dimutasi
      scene.environment = null
      env.dispose()
      pmrem.dispose()
    }
  }, [gl, scene])
  return null
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
 * Avatar 3D Vespa klasik yang memproyeksikan orientasi kendaraan dari MPU6050.
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
          camera={{ position: [3.35, 2.25, 3.95], fov: 35 }}
          dpr={[1, 1.75]}
          gl={{ antialias: true, alpha: true }}
        >
          <StudioEnv />
          <ambientLight intensity={0.42} />
          <hemisphereLight args={['#dbeafe', '#e2e8f0', 0.45]} />
          <directionalLight position={[5, 7, 4]} intensity={1.05} />
          <directionalLight position={[-5, 4, -3]} intensity={0.34} />
          <directionalLight position={[-2, 2.5, 6]} intensity={0.28} color="#bfdbfe" />

          <Floor tone={tone} />

          <VespaModel pitch={p} roll={r} tone={tone} vibration={vibration === true} />

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
