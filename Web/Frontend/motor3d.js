// ============================================================================
// SMARTGUARD — Avatar 3D kendaraan (proyeksi orientasi MPU) untuk dashboard.
//
// Modul ES mandiri (three.js dari CDN via importmap di dashboard.html).
// Auto-mount ke elemen #avatar3d lalu mengekspos window.SGAvatar3D:
//   SGAvatar3D.setPose(pitchDeg, rollDeg)   orientasi target (derajat)
//   SGAvatar3D.setTone('ok'|'warn'|'alarm'|'idle')  warna status
//   SGAvatar3D.setVibration(bool)           guncangan kecil + LED panik
//
// Model = Vespa klasik, disusun dari primitif three.js (tanpa file GLB) supaya
// ringan. Port 3D twin dari web-testing/src/MpuAvatar.tsx (React Three Fiber) —
// koordinat, ukuran, warna & material identik dengan desain master di sana.
// Siluet khas Vespa vintage: tameng depan melengkung + "dasi", dek kaki rata,
// body monocoque dengan panel samping melengkung, jok panjang, ban serep
// belakang, garpu tunggal (trailing link), silinder mesin kanan + knalpot.
// Konvensi sumbu (sama dengan firmware & web-testing):
//   mpu_pitch (+) = hidung naik  -> rotasi sumbu Z
//   mpu_roll  (+) = miring kanan -> rotasi sumbu X
// ============================================================================

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const DEG = Math.PI / 180;

const TONE_HEX = {
  idle: 0x5e6980,
  ok: 0x12b76a,
  warn: 0xf79009,
  alarm: 0xf04438,
};
const TONE_KEY = { alarm: 'alarm', bad: 'alarm', warn: 'warn', ok: 'ok', idle: 'idle' };

// ---------------------------------------------------------------------------
// Material helper
// ---------------------------------------------------------------------------
function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.25, ...opts });
}

function rounded(w, h, d, r, material) {
  return new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, r), material);
}

// ---------------------------------------------------------------------------
// Palet Vespa vintage (identik dengan MpuAvatar.tsx)
// ---------------------------------------------------------------------------
const MAT = {
  paint: mat(0x74b09a, { metalness: 0.32, roughness: 0.38, envMapIntensity: 0.65 }),      // verde pastel klasik
  paintDark: mat(0x5f9a86, { metalness: 0.32, roughness: 0.44, envMapIntensity: 0.6 }),   // panel samping (lebih pekat)
  chrome: mat(0xe2e8ef, { metalness: 1, roughness: 0.16, envMapIntensity: 1.15 }),
  steel: mat(0x98a4b2, { metalness: 0.85, roughness: 0.32, envMapIntensity: 1 }),
  cream: mat(0xf2ecde, { metalness: 0.1, roughness: 0.62, envMapIntensity: 0.6 }),        // krem: dinding ban, pelat nomor
  leather: mat(0x26221e, { metalness: 0.05, roughness: 0.82, envMapIntensity: 0.5 }),
  rubber: mat(0x1c1c21, { metalness: 0.05, roughness: 0.92, envMapIntensity: 0.35 }),
};

// ---------------------------------------------------------------------------
// Body monocoque
// Profil samping (tameng depan + dek kaki + buritan) diekstrusi
// lalu dibengkokkan pada sumbu Z supaya pelatnya melengkung khas
// bodi Vespa (bukan pelat datar).
// ---------------------------------------------------------------------------
function buildBodyGeometry() {
  const s = new THREE.Shape();
  s.moveTo(0.755, -0.325);
  s.bezierCurveTo(0.822, -0.312, 0.862, -0.125, 0.868, 0.035); // sisi depan tameng
  s.bezierCurveTo(0.874, 0.22, 0.83, 0.335, 0.752, 0.372); // puncak tameng (menyambung ke setang)
  s.lineTo(0.632, 0.352); // bibir atas tameng
  s.bezierCurveTo(0.665, 0.2, 0.652, -0.05, 0.648, -0.202); // sisi belakang tameng (tipis)
  s.lineTo(0.556, -0.243); // bertemu dek kaki
  s.lineTo(-0.185, -0.256); // dek kaki
  s.bezierCurveTo(-0.262, -0.263, -0.303, -0.218, -0.318, -0.118); // dinding depan body
  s.bezierCurveTo(-0.336, 0.012, -0.318, 0.172, -0.345, 0.252); // naik ke level jok
  s.lineTo(-0.392, 0.305); // pangkal dek jok
  s.lineTo(-1.02, 0.318); // dek jok
  s.bezierCurveTo(-1.165, 0.322, -1.285, 0.272, -1.33, 0.142); // buritan
  s.bezierCurveTo(-1.362, 0.015, -1.352, -0.108, -1.272, -0.178);
  s.bezierCurveTo(-1.148, -0.272, -0.95, -0.33, -0.72, -0.342); // kolong body
  s.bezierCurveTo(-0.48, -0.352, -0.05, -0.352, 0.32, -0.338);
  s.lineTo(0.755, -0.325);

  let geo = new THREE.ExtrudeGeometry(s, {
    depth: 0.42,
    bevelEnabled: true,
    bevelThickness: 0.038,
    bevelSize: 0.032,
    bevelSegments: 3,
    curveSegments: 24,
  });
  geo.translate(0, 0, -0.21);

  // Bengkokkan pelat: sisi yang jauh dari sumbu tengah mundur (khas tameng Vespa),
  // lalu perapian siluet: buritan menyempit + sedikit meruncing ke atas.
  geo = mergeVertices(geo, 1e-4);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    let taper = 1;
    if (x < -0.2) taper = 1 - 0.3 * Math.min(1, (-0.2 - x) / 1.15);
    const vy = 1 - 0.1 * Math.max(0, (y - 0.1) / 0.3);
    const zz = z * taper * vy;
    pos.setZ(i, zz);
    pos.setX(i, x - 0.7 * zz * zz);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

// ---------------------------------------------------------------------------
// Rangkaian roda — velg baja klasik: ban + dinding putih,
// lubang ventilasi, tromol, tutup as, pentil.
// ---------------------------------------------------------------------------
function buildWheel(position = [0, 0, 0], rotation = [0, 0, 0], scale = 1) {
  const g = new THREE.Group();
  g.position.set(position[0], position[1], position[2]);
  g.rotation.set(rotation[0], rotation[1], rotation[2]);
  g.scale.setScalar(scale);

  // Ban
  g.add(new THREE.Mesh(new THREE.TorusGeometry(0.305, 0.085, 18, 44), MAT.rubber));

  // Dinding putih klasik (pita tipis di tepi ban)
  for (const z of [0.076, -0.076]) {
    const whitewall = new THREE.Mesh(new THREE.TorusGeometry(0.316, 0.032, 8, 40), MAT.cream);
    whitewall.position.z = z;
    whitewall.scale.set(1, 1, 0.3);
    g.add(whitewall);
  }

  // Velg baja + bibir krom
  const rim = new THREE.Mesh(
    new THREE.CylinderGeometry(0.246, 0.246, 0.1, 28),
    mat(0xc9cfd8, { metalness: 0.55, roughness: 0.36, envMapIntensity: 0.9 })
  );
  rim.rotation.x = Math.PI / 2;
  g.add(rim);
  for (const z of [0.051, -0.051]) {
    const lip = new THREE.Mesh(new THREE.TorusGeometry(0.243, 0.013, 8, 36), MAT.chrome);
    lip.position.z = z;
    g.add(lip);
  }

  // Lubang ventilasi velg
  for (const i of [0, 1, 2, 3, 4, 5]) {
    const a = (i * Math.PI) / 3;
    for (const s of [1, -1]) {
      const slot = new THREE.Mesh(
        new THREE.BoxGeometry(0.036, 0.08, 0.005),
        mat(0x46525e, { metalness: 0.5, roughness: 0.55, envMapIntensity: 0.7 })
      );
      slot.position.set(Math.cos(a) * 0.192, Math.sin(a) * 0.192, s * 0.0505);
      slot.rotation.set(0, 0, a - Math.PI / 2);
      g.add(slot);
    }
  }

  // Tromol rem + tutup as
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.108, 0.108, 20), MAT.steel);
  drum.rotation.x = Math.PI / 2;
  g.add(drum);
  for (const z of [0.068, -0.068]) {
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.058, 0.032, 18), MAT.chrome);
    cap.position.z = z;
    cap.rotation.x = Math.PI / 2;
    g.add(cap);
  }

  // Pentil ban
  const valve = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.032, 8), MAT.steel);
  valve.position.set(0.208, 0.108, 0.075);
  valve.rotation.set(0, 0, -0.48);
  g.add(valve);

  return g;
}

// ---------------------------------------------------------------------------
// Model Vespa klasik — detail lengkap (twin dari VespaModel di MpuAvatar.tsx)
// ---------------------------------------------------------------------------
function buildVespa(toneColor) {
  const rig = new THREE.Group();

  // ===== Roda depan & belakang =====
  rig.add(buildWheel([-1.0, -0.42, 0]));
  rig.add(buildWheel([1.05, -0.42, 0]));

  // ===== Spakbor depan klasik + ornamen krom =====
  const fender = new THREE.Mesh(new THREE.TorusGeometry(0.438, 0.04, 10, 30, Math.PI * 0.72), MAT.paint);
  fender.position.set(1.05, -0.42, 0);
  fender.rotation.set(0, 0, -0.56);
  fender.scale.set(1, 1, 2.8);
  rig.add(fender);
  const fenderTrim = rounded(0.095, 0.03, 0.034, 0.013, MAT.chrome);
  fenderTrim.position.set(1.262, 0.045, 0);
  fenderTrim.rotation.set(0, 0, -0.22);
  rig.add(fenderTrim);

  // ===== Suspensi depan trailing-link (garpu tunggal) khas Vespa =====
  const steeringCol = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.88, 16), MAT.steel);
  steeringCol.position.set(0.93, 0.1, 0);
  steeringCol.rotation.set(0, 0, -0.232);
  rig.add(steeringCol);
  const trailingArm = rounded(0.26, 0.07, 0.05, 0.02, MAT.steel);
  trailingArm.position.set(0.985, -0.345, -0.14);
  trailingArm.rotation.set(0, 0, -0.83);
  rig.add(trailingArm);
  // Shock + 6 per (torus) dalam group yang dirotasi z=-0.41
  const shock = new THREE.Group();
  shock.position.set(0.9125, -0.175, -0.115);
  shock.rotation.set(0, 0, -0.41);
  shock.add(new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.34, 12), MAT.steel));
  for (let i = 0; i < 6; i++) {
    const spring = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.011, 8, 18), MAT.chrome);
    spring.position.set(0, -0.11 + i * 0.044, 0);
    spring.rotation.set(Math.PI / 2, 0, 0);
    shock.add(spring);
  }
  rig.add(shock);
  // Poros roda depan
  const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.15, 12), MAT.chrome);
  axle.position.set(1.05, -0.42, -0.105);
  axle.rotation.set(Math.PI / 2, 0, 0);
  rig.add(axle);

  // ===== Body monocoque: tameng depan + dek kaki + buritan =====
  rig.add(new THREE.Mesh(buildBodyGeometry(), MAT.paint));

  // ===== Panel samping melengkung ("kuping" khas Vespa) + aksen krom =====
  for (const s of [1, -1]) {
    const panel = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 20), MAT.paintDark);
    panel.position.set(-0.72, -0.01, s * 0.215);
    panel.scale.set(0.52, 0.225, 0.105);
    panel.rotation.set(0, 0, -0.06);
    rig.add(panel);
    const panelTrim = rounded(0.14, 0.045, 0.014, 0.007, MAT.chrome);
    panelTrim.position.set(-0.72, -0.01, s * 0.322);
    rig.add(panelTrim);
  }

  // ===== Dek kaki: rel krom samping + alur anti slip =====
  for (const s of [1, -1]) {
    const rail = rounded(0.8, 0.022, 0.028, 0.01, MAT.chrome);
    rail.position.set(0.165, -0.238, s * 0.272);
    rig.add(rail);
  }
  for (const z of [-0.135, 0, 0.135]) {
    const groove = rounded(0.72, 0.014, 0.05, 0.006, MAT.paintDark);
    groove.position.set(0.185, -0.238, z);
    rig.add(groove);
  }

  // ===== Tameng depan: "dasi" krom + lencana =====
  const tie = rounded(0.032, 0.44, 0.082, 0.013, MAT.chrome);
  tie.position.set(0.884, 0.03, 0);
  tie.rotation.set(0, 0, -0.02);
  rig.add(tie);
  const tieInset = rounded(0.018, 0.36, 0.045, 0.008, MAT.paintDark);
  tieInset.position.set(0.902, 0.03, 0);
  tieInset.rotation.set(0, 0, -0.02);
  rig.add(tieInset);
  const badge = rounded(0.022, 0.075, 0.17, 0.009, MAT.chrome);
  badge.position.set(0.803, 0.263, 0);
  badge.rotation.set(0, 0, -0.52);
  rig.add(badge);

  // ===== Jok panjang vintage + tali jok =====
  const seat = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), MAT.leather);
  seat.position.set(-0.64, 0.372, 0);
  seat.scale.set(0.44, 0.075, 0.19);
  seat.rotation.set(0, 0, -0.04);
  rig.add(seat);
  const strap = rounded(0.05, 0.018, 0.36, 0.008, mat(0x6b4f3a, { metalness: 0.05, roughness: 0.8 }));
  strap.position.set(-0.5, 0.432, 0);
  strap.rotation.set(0, 0, -0.04);
  rig.add(strap);

  // ===== Ban serep klasik (kecil, diikat di buritan) =====
  rig.add(buildWheel([-1.12, 0.26, -0.22], [0.15, -0.25, 0], 0.62));

  // ===== Mesin kanan: silinder + tutup kipas + knalpot =====
  const cylinder = new THREE.Mesh(new THREE.CylinderGeometry(0.072, 0.072, 0.32, 16), MAT.steel);
  cylinder.position.set(-0.62, -0.27, 0.22);
  cylinder.rotation.set(0, 0, Math.PI / 2);
  rig.add(cylinder);
  // 4 sirip pendingin
  for (const x of [-0.5, -0.585, -0.67, -0.755]) {
    const fin = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.016, 18), MAT.steel);
    fin.position.set(x, -0.27, 0.22);
    fin.rotation.set(0, 0, Math.PI / 2);
    rig.add(fin);
  }
  // Kepala silinder
  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.092, 0.092, 0.085, 18), MAT.steel);
  head.position.set(-0.845, -0.27, 0.22);
  head.rotation.set(0, 0, Math.PI / 2);
  rig.add(head);
  // Tutup kipas krem + tutup krom
  const fanCover = new THREE.Mesh(new THREE.CylinderGeometry(0.118, 0.118, 0.08, 22), MAT.cream);
  fanCover.position.set(-0.415, -0.27, 0.235);
  fanCover.rotation.set(0, 0, Math.PI / 2);
  rig.add(fanCover);
  const fanCap = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.022, 16), MAT.chrome);
  fanCap.position.set(-0.362, -0.27, 0.235);
  fanCap.rotation.set(0, 0, Math.PI / 2);
  rig.add(fanCap);
  // Knalpot: leher + peredam + perisai panas
  const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.032, 0.3, 12), MAT.steel);
  exhaust.position.set(-0.98, -0.345, 0.26);
  exhaust.rotation.set(0, 0, Math.PI / 2 + 0.16);
  rig.add(exhaust);
  const muffler = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.058, 0.42, 18), MAT.steel);
  muffler.position.set(-1.06, -0.4, 0.27);
  muffler.rotation.set(0, 0, Math.PI / 2 + 0.08);
  rig.add(muffler);
  const mufflerTip = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.038, 0.07, 12), MAT.chrome);
  mufflerTip.position.set(-1.265, -0.415, 0.27);
  mufflerTip.rotation.set(0, 0, Math.PI / 2 + 0.08);
  rig.add(mufflerTip);
  const heatShield = rounded(0.21, 0.045, 0.016, 0.007, MAT.chrome);
  heatShield.position.set(-1.06, -0.338, 0.332);
  heatShield.rotation.set(0, 0, 0.08);
  rig.add(heatShield);

  // ===== Setang: rumah lampu, grip, tuas, spion bulat =====
  const housing = rounded(0.26, 0.19, 0.34, 0.055, MAT.paint);
  housing.position.set(0.845, 0.455, 0);
  housing.rotation.set(0, 0, -0.04);
  rig.add(housing);
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.023, 0.023, 0.8, 12), MAT.steel);
  bar.position.set(0.845, 0.475, 0);
  bar.rotation.set(Math.PI / 2, 0, 0);
  rig.add(bar);
  for (const s of [1, -1]) {
    // Grip + ring krom
    const grip = new THREE.Mesh(
      new THREE.CylinderGeometry(0.037, 0.037, 0.135, 14),
      mat(0x1b1b1f, { metalness: 0.05, roughness: 0.88 })
    );
    grip.position.set(0.845, 0.475, s * 0.355);
    grip.rotation.set(Math.PI / 2, 0, 0);
    rig.add(grip);
    const gripRing = new THREE.Mesh(new THREE.CylinderGeometry(0.041, 0.041, 0.014, 14), MAT.chrome);
    gripRing.position.set(0.845, 0.475, s * 0.293);
    gripRing.rotation.set(Math.PI / 2, 0, 0);
    rig.add(gripRing);

    // Tuas rem
    const lever = rounded(0.155, 0.02, 0.032, 0.008, MAT.steel);
    lever.position.set(0.935, 0.438, s * 0.285);
    lever.rotation.set(0, s * 0.5, -0.35);
    rig.add(lever);

    // Batang spion + kepala bulat + cermin
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.24, 8), MAT.chrome);
    stalk.position.set(0.815, 0.625, s * 0.245);
    stalk.rotation.set(s * 0.42, 0, s * 0.1);
    rig.add(stalk);
    const mirrorHead = new THREE.Mesh(new THREE.CylinderGeometry(0.068, 0.068, 0.02, 22), MAT.chrome);
    mirrorHead.position.set(0.795, 0.745, s * 0.315);
    mirrorHead.rotation.set(0, 0, Math.PI / 2 - 0.18);
    rig.add(mirrorHead);
    const mirrorGlass = new THREE.Mesh(
      new THREE.CylinderGeometry(0.056, 0.056, 0.006, 22),
      mat(0xcfd8e3, { metalness: 0.9, roughness: 0.08, envMapIntensity: 1.5 })
    );
    mirrorGlass.position.set(0.782, 0.748, s * 0.315);
    mirrorGlass.rotation.set(0, 0, Math.PI / 2 - 0.18);
    rig.add(mirrorGlass);

    // Sein depan model peluru
    const signal = new THREE.Group();
    signal.position.set(0.925, 0.435, s * 0.28);
    const signalStem = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.09, 8), MAT.chrome);
    signalStem.rotation.set(Math.PI / 2, 0, 0);
    signal.add(signalStem);
    const signalBase = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.012, 16), MAT.chrome);
    signalBase.position.set(0, 0, s * 0.045);
    signalBase.rotation.set(Math.PI / 2, 0, 0);
    signal.add(signalBase);
    const signalLens = new THREE.Mesh(
      new THREE.CylinderGeometry(0.038, 0.032, 0.055, 16),
      mat(0xf79009, { emissive: 0xf79009, emissiveIntensity: 0.35, metalness: 0.15, roughness: 0.3 })
    );
    signalLens.position.set(0, 0, s * 0.078);
    signalLens.rotation.set(Math.PI / 2, 0, 0);
    signal.add(signalLens);
    rig.add(signal);
  }

  // ===== Speedometer bulat di atas rumah lampu =====
  const speedoBezel = new THREE.Mesh(new THREE.CylinderGeometry(0.078, 0.078, 0.028, 22), MAT.chrome);
  speedoBezel.position.set(0.825, 0.556, 0);
  speedoBezel.rotation.set(0, 0, -0.04);
  rig.add(speedoBezel);
  const speedoFace = new THREE.Mesh(
    new THREE.CylinderGeometry(0.062, 0.062, 0.008, 22),
    mat(0xf4f1e6, { metalness: 0.05, roughness: 0.35 })
  );
  speedoFace.position.set(0.825, 0.572, 0);
  speedoFace.rotation.set(0, 0, -0.04);
  rig.add(speedoFace);
  const needle = rounded(0.007, 0.004, 0.045, 0.002, mat(0xc0392b, { metalness: 0.1, roughness: 0.5 }));
  needle.position.set(0.838, 0.578, 0.012);
  needle.rotation.set(0, 0.6, -0.04);
  rig.add(needle);

  // ===== Lampu depan bulat klasik (bezel krom + lensa) =====
  const bezel = new THREE.Mesh(new THREE.CylinderGeometry(0.118, 0.118, 0.05, 26), MAT.chrome);
  bezel.position.set(1.0, 0.475, 0);
  bezel.rotation.set(0, 0, Math.PI / 2);
  rig.add(bezel);
  const lens = new THREE.Mesh(
    new THREE.CylinderGeometry(0.098, 0.098, 0.022, 26),
    mat(0xfde68a, { emissive: 0xf59e0b, emissiveIntensity: 0.5, metalness: 0.15, roughness: 0.22 })
  );
  lens.position.set(1.033, 0.475, 0);
  lens.rotation.set(0, 0, Math.PI / 2);
  rig.add(lens);
  const headLight = new THREE.PointLight(0xfbbf24, 0.42, 2.4);
  headLight.position.set(1.45, 0.475, 0);
  rig.add(headLight);

  // ===== Lampu belakang + pelat nomor + sein belakang =====
  const tailHousing = rounded(0.05, 0.12, 0.18, 0.014, MAT.chrome);
  tailHousing.position.set(-1.315, 0.055, 0);
  tailHousing.rotation.set(0, 0, 0.2);
  rig.add(tailHousing);
  const tailLens = rounded(
    0.04, 0.1, 0.152, 0.012,
    mat(0xef4444, { emissive: 0xef4444, emissiveIntensity: 0.5, metalness: 0.15, roughness: 0.3 })
  );
  tailLens.position.set(-1.342, 0.055, 0);
  tailLens.rotation.set(0, 0, 0.2);
  rig.add(tailLens);
  const plateBack = rounded(0.018, 0.125, 0.215, 0.008, MAT.cream);
  plateBack.position.set(-1.322, -0.135, 0);
  plateBack.rotation.set(0, 0, 0.42);
  rig.add(plateBack);
  const plateFace = rounded(0.01, 0.1, 0.185, 0.005, mat(0x2c3e50, { metalness: 0.1, roughness: 0.55 }));
  plateFace.position.set(-1.332, -0.135, 0);
  plateFace.rotation.set(0, 0, 0.42);
  rig.add(plateFace);
  for (const s of [1, -1]) {
    const signal = new THREE.Group();
    signal.position.set(-1.245, 0.105, s * 0.19);
    const signalBase = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.012, 16), MAT.chrome);
    signalBase.rotation.set(Math.PI / 2, 0, 0);
    signal.add(signalBase);
    const signalLens = new THREE.Mesh(
      new THREE.CylinderGeometry(0.038, 0.032, 0.055, 16),
      mat(0xf79009, { emissive: 0xf79009, emissiveIntensity: 0.35, metalness: 0.15, roughness: 0.3 })
    );
    signalLens.position.set(0, 0, s * 0.033);
    signalLens.rotation.set(Math.PI / 2, 0, 0);
    signal.add(signalLens);
    rig.add(signal);
  }

  // ===== Modul SMARTGUARD + LED status di buritan =====
  const mod = rounded(0.22, 0.13, 0.25, 0.03, mat(0x1f2a37, { metalness: 0.35, roughness: 0.42 }));
  mod.position.set(-1.18, 0.335, 0);
  rig.add(mod);
  const modTop = rounded(
    0.185, 0.012, 0.215, 0.005,
    mat(0x0ea5e9, { metalness: 0.3, roughness: 0.35, emissive: 0x0ea5e9, emissiveIntensity: 0.18 })
  );
  modTop.position.set(-1.18, 0.404, 0);
  rig.add(modTop);
  // LED status (warna mengikuti TONE_HEX, diubah via setTone)
  const ledMat = mat(toneColor, { emissive: toneColor, emissiveIntensity: 0.6, roughness: 0.3 });
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.03, 14, 12), ledMat);
  led.position.set(-1.18, 0.433, 0);
  rig.add(led);
  const beacon = new THREE.PointLight(toneColor, 0.32, 1.3);
  beacon.position.set(-1.18, 0.54, 0);
  rig.add(beacon);
  // Antena modul
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.15, 8), MAT.steel);
  antenna.position.set(-1.27, 0.445, 0);
  rig.add(antenna);
  const antennaTip = new THREE.Mesh(new THREE.SphereGeometry(0.013, 10, 8), MAT.chrome);
  antennaTip.position.set(-1.27, 0.525, 0);
  rig.add(antennaTip);

  // ===== Standar samping + kaki =====
  const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.42, 10), MAT.steel);
  stand.position.set(-0.32, -0.56, 0.235);
  stand.rotation.set(-0.55, 0, 0.22);
  rig.add(stand);
  const standFoot = rounded(0.055, 0.018, 0.075, 0.007, MAT.steel);
  standFoot.position.set(-0.274, -0.762, 0.345);
  standFoot.rotation.set(0, -0.35, 0.22);
  rig.add(standFoot);

  rig.userData = { ledMat, beacon };
  return rig;
}

// ---------------------------------------------------------------------------
// Lantai: target kalibrasi (alas + 2 cincin + 24 tick keliling)
// ---------------------------------------------------------------------------
function buildFloor(toneColor = TONE_HEX.ok) {
  const g = new THREE.Group();

  // Alas
  const base = new THREE.Mesh(new THREE.CircleGeometry(2.62, 64), mat(0xf0f6ff, { transparent: true, opacity: 0.92, roughness: 0.9, metalness: 0 }));
  base.rotation.x = -Math.PI / 2; base.position.y = -0.825; g.add(base);

  // Cincin konsentris
  const ringA = new THREE.Mesh(new THREE.RingGeometry(0.92, 0.945, 64), mat(0xc7dcf5, { transparent: true, opacity: 0.8, roughness: 0.9 }));
  ringA.rotation.x = -Math.PI / 2; ringA.position.y = -0.818; g.add(ringA);

  const statusMat = mat(toneColor, { emissive: toneColor, emissiveIntensity: 0.18, transparent: true, opacity: 0.6, roughness: 0.6 });
  const ringB = new THREE.Mesh(new THREE.RingGeometry(1.72, 1.755, 64), statusMat);
  ringB.rotation.x = -Math.PI / 2; ringB.position.y = -0.816; g.add(ringB);

  // Tick keliling — nuansa alat ukur
  for (let i = 0; i < 24; i++) {
    const a = (i * Math.PI) / 12;
    const tick = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.012, 0.022), mat(0xb9cfe9, { transparent: true, opacity: 0.85, roughness: 0.9 }));
    tick.position.set(Math.cos(a) * 2.36, -0.812, Math.sin(a) * 2.36);
    tick.rotation.set(-Math.PI / 2, 0, -a);
    g.add(tick);
  }

  g.userData = { statusMat };
  return g;
}

// ---------------------------------------------------------------------------
// Mount + animasi
// ---------------------------------------------------------------------------
function mount(container) {
  const width = () => container.clientWidth || 320;
  const height = () => container.clientHeight || 220;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.setSize(width(), height());
  // Gambar avatar default (motor-default.png) tetap di bawah kanvas;
  // disembunyikan via class "has3d" begitu kanvas siap.
  container.classList.add('has3d');
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();

  // Environment map prosedural (tanpa unduhan HDRI) supaya krom & cat hidup.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envRT = pmrem.fromScene(new RoomEnvironment(renderer), 0.04);
  scene.environment = envRT.texture;

  const camera = new THREE.PerspectiveCamera(35, width() / height(), 0.1, 50);
  camera.position.set(3.35, 2.25, 3.95);

  scene.add(new THREE.AmbientLight(0xffffff, 0.42));
  scene.add(new THREE.HemisphereLight(0xdbeafe, 0xe2e8f0, 0.45));
  const key = new THREE.DirectionalLight(0xffffff, 1.05); key.position.set(5, 7, 4); scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.34); fill.position.set(-5, 4, -3); scene.add(fill);
  const rim = new THREE.DirectionalLight(0xbfdbfe, 0.28); rim.position.set(-2, 2.5, 6); scene.add(rim);

  const floor = buildFloor();
  scene.add(floor);
  const vespa = buildVespa(TONE_HEX.ok);
  scene.add(vespa);

  // Bayangan lembut (cakram gradien radial di bawah motor)
  const shadowTexCanvas = document.createElement('canvas');
  shadowTexCanvas.width = shadowTexCanvas.height = 128;
  const shadowCtx = shadowTexCanvas.getContext('2d');
  const shadowGrad = shadowCtx.createRadialGradient(64, 64, 6, 64, 64, 64);
  shadowGrad.addColorStop(0, 'rgba(30,58,95,0.34)');
  shadowGrad.addColorStop(0.55, 'rgba(30,58,95,0.16)');
  shadowGrad.addColorStop(1, 'rgba(30,58,95,0)');
  shadowCtx.fillStyle = shadowGrad;
  shadowCtx.fillRect(0, 0, 128, 128);
  const shadowTex = new THREE.CanvasTexture(shadowTexCanvas);
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(1.75, 48),
    new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false })
  );
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = -0.8; scene.add(shadow);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableZoom = false;
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.35;
  controls.minPolarAngle = Math.PI * 0.16;
  controls.maxPolarAngle = Math.PI * 0.5;
  controls.target.set(0, -0.1, 0);

  const target = { pitch: 0, roll: 0, vibration: false };
  const clock = new THREE.Clock();

  function frame() {
    const delta = Math.min(clock.getDelta(), 0.1);
    const t = clock.elapsedTime;

    const k = 1 - Math.exp(-7 * delta);
    vespa.rotation.z += (target.pitch * DEG - vespa.rotation.z) * k;
    vespa.rotation.x += (target.roll * DEG - vespa.rotation.x) * k;

    const shake = target.vibration ? 0.012 : 0;
    vespa.position.y = 0.02 + Math.sin(t * 1.1) * 0.012 + (Math.random() - 0.5) * shake;
    vespa.position.x = (Math.random() - 0.5) * shake;

    const { ledMat, beacon } = vespa.userData;
    const panic = target.vibration || target.tone === 'alarm';
    const pulse = panic ? 0.55 + Math.sin(t * 7) * 0.45 : 0.5 + Math.sin(t * 1.8) * 0.15;
    ledMat.emissiveIntensity = pulse;
    beacon.intensity = panic ? 0.7 + Math.sin(t * 7) * 0.5 : 0.32;

    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  const ro = new ResizeObserver(() => {
    camera.aspect = width() / height();
    camera.updateProjectionMatrix();
    renderer.setSize(width(), height());
  });
  ro.observe(container);

  return {
    setPose(pitch, roll) {
      if (Number.isFinite(pitch)) target.pitch = pitch;
      if (Number.isFinite(roll)) target.roll = roll;
    },
    setTone(tone) {
      const key = TONE_KEY[tone] || 'idle';
      const hex = TONE_HEX[key];
      target.tone = key;
      vespa.userData.ledMat.color.setHex(hex);
      vespa.userData.ledMat.emissive.setHex(hex);
      vespa.userData.beacon.color.setHex(hex);
      floor.userData.statusMat.color.setHex(hex);
      floor.userData.statusMat.emissive.setHex(hex);
      floor.userData.statusMat.emissiveIntensity = key === 'alarm' ? 0.45 : 0.18;
    },
    setVibration(on) { target.vibration = on === true; },
    destroy() {
      ro.disconnect();
      scene.environment = null;
      envRT.dispose();
      pmrem.dispose();
      shadowTex.dispose();
      renderer.dispose();
      container.innerHTML = '';
    },
  };
}

// Auto-mount ke #avatar3d (elemen sudah ada di dashboard.html)
const el = document.getElementById('avatar3d');
if (el && !window.SGAvatar3D) {
  try {
    window.SGAvatar3D = mount(el);
    // Beri tahu dashboard bahwa avatar siap (label "3D tidak tersedia" di-refresh).
    window.dispatchEvent(new Event('sg-avatar-ready'));
  } catch (err) {
    console.warn('Avatar 3D tidak tersedia:', err);
  }
}
