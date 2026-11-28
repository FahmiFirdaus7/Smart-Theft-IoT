// ============================================================================
// SMARTGUARD — Avatar 3D kendaraan (proyeksi orientasi MPU) untuk dashboard.
//
// Modul ES mandiri (three.js dari CDN via importmap di dashboard.html).
// Auto-mount ke elemen #avatar3d lalu mengekspos window.SGAvatar3D:
//   SGAvatar3D.setPose(pitchDeg, rollDeg)   orientasi target (derajat)
//   SGAvatar3D.setTone('ok'|'warn'|'alarm'|'idle')  warna status
//   SGAvatar3D.setVibration(bool)           guncangan kecil + LED panik
//
// Model motor disusun dari primitif three.js (tanpa file GLB) supaya ringan.
// Konvensi sumbu (sama dengan firmware & web-testing):
//   mpu_pitch (+) = hidung naik  -> rotasi sumbu Z
//   mpu_roll  (+) = miring kanan -> rotasi sumbu X
// ============================================================================

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

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
// Rangkaian roda — ban, velg, jari-jari, cakram, kaliper, tromol
// ---------------------------------------------------------------------------
function buildWheel() {
  const g = new THREE.Group();

  const tire = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.088, 16, 40), mat(0x17171c, { roughness: 0.92, metalness: 0.05 }));
  g.add(tire);

  const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.232, 0.232, 0.058, 24), mat(0xcdd5e1, { metalness: 0.55, roughness: 0.32 }));
  rim.rotation.x = Math.PI / 2;
  g.add(rim);

  // Bibir velg
  for (const z of [0.031, -0.031]) {
    const lip = new THREE.Mesh(new THREE.TorusGeometry(0.228, 0.011, 8, 32), mat(0x94a3b8, { metalness: 0.6, roughness: 0.35 }));
    lip.position.z = z;
    g.add(lip);
  }

  // Jari-jari
  for (let i = 0; i < 6; i++) {
    const sp = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.43, 0.016), mat(0x94a3b8, { metalness: 0.5, roughness: 0.38 }));
    sp.rotation.z = (i * Math.PI) / 3;
    g.add(sp);
  }

  // Cakram rem + kaliper
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.155, 0.155, 0.01, 22), mat(0xe2e8f0, { metalness: 0.7, roughness: 0.26 }));
  disc.rotation.x = Math.PI / 2;
  disc.position.z = 0.045;
  g.add(disc);
  const caliper = rounded(0.055, 0.1, 0.045, 0.012, mat(0x1d4ed8, { metalness: 0.45, roughness: 0.4 }));
  caliper.position.set(-0.12, 0.1, 0.055);
  g.add(caliper);

  // Tromol
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.062, 0.085, 16), mat(0x475569, { metalness: 0.6, roughness: 0.42 }));
  hub.rotation.x = Math.PI / 2;
  g.add(hub);

  return g;
}

// ---------------------------------------------------------------------------
// Spakbor (torus sebagian)
// ---------------------------------------------------------------------------
function buildFender(color) {
  const g = new THREE.Group();
  const f = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.032, 8, 26, Math.PI * 0.52), mat(color, { metalness: 0.35, roughness: 0.42 }));
  g.scale.set(1, 1, 2.1);
  g.add(f);
  return g;
}

// ---------------------------------------------------------------------------
// Model motor — detail lengkap
// ---------------------------------------------------------------------------
function buildMotor(toneColor) {
  const rig = new THREE.Group();
  const blue = 0x2f6bff;      // brand dashboard pengguna
  const blueDark = 0x1e3a8a;
  const metal = 0xcdd5e1;
  const steel = 0x64748b;

  // --- Roda + spakbor ---
  const rear = buildWheel(); rear.position.set(-1.0, -0.42, 0); rig.add(rear);
  const front = buildWheel(); front.position.set(1.05, -0.42, 0); rig.add(front);
  const fFender = buildFender(blueDark); fFender.position.set(1.05, -0.42, 0); fFender.rotation.z = Math.PI * 0.22; rig.add(fFender);
  const rFender = buildFender(blueDark); rFender.position.set(-1.0, -0.42, 0); rFender.rotation.z = Math.PI * 0.3; rig.add(rFender);

  // --- Mesin: blok + silinder + sirip pendingin ---
  const block = rounded(0.42, 0.3, 0.28, 0.045, mat(0x334155, { metalness: 0.55, roughness: 0.5 }));
  block.position.set(0.12, -0.17, 0);
  rig.add(block);
  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.1, 0.24, 14), mat(0x475569, { metalness: 0.6, roughness: 0.45 }));
  head.position.set(0.3, -0.02, 0); head.rotation.z = -0.55; rig.add(head);
  for (let i = 0; i < 3; i++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.016, 0.21), mat(0x94a3b8, { metalness: 0.6, roughness: 0.4 }));
    fin.position.set(0.335 - i * 0.045, 0.03 + i * 0.052, 0);
    fin.rotation.z = -0.55;
    rig.add(fin);
  }
  // Radiator + garis sirip vertikal di muka radiator
  const rad = rounded(0.1, 0.2, 0.17, 0.02, mat(0x334155, { metalness: 0.5, roughness: 0.5 }));
  rad.position.set(0.52, -0.02, 0); rig.add(rad);
  for (let i = 0; i < 3; i++) {
    const slat = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.17, 0.018), mat(0x94a3b8, { metalness: 0.5 }));
    slat.position.set(0.573, -0.02, -0.05 + i * 0.05);
    rig.add(slat);
  }

  // --- Swingarm (2 lengan) + rantai + gear ---
  for (const s of [1, -1]) {
    const arm = rounded(0.9, 0.07, 0.06, 0.02, mat(steel, { metalness: 0.6, roughness: 0.42 }));
    arm.position.set(-0.55, -0.34, s * 0.12); arm.rotation.z = 0.06;
    rig.add(arm);
  }
  const sprocketRear = new THREE.Mesh(new THREE.TorusGeometry(0.115, 0.018, 8, 26), mat(0x94a3b8, { metalness: 0.65, roughness: 0.38 }));
  sprocketRear.position.set(-1.0, -0.42, 0.115); rig.add(sprocketRear);
  const sprocketFront = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.016, 8, 22), mat(0x94a3b8, { metalness: 0.65, roughness: 0.38 }));
  sprocketFront.position.set(0.12, -0.26, 0.115); rig.add(sprocketFront);
  const chainTop = new THREE.Mesh(new THREE.BoxGeometry(1.12, 0.022, 0.03), mat(0x334155, { metalness: 0.55, roughness: 0.5 }));
  chainTop.position.set(-0.44, -0.295, 0.115); chainTop.rotation.z = -0.085; rig.add(chainTop);
  const chainBot = chainTop.clone(); chainBot.position.set(-0.44, -0.55, 0.115); chainBot.rotation.z = 0.11; rig.add(chainBot);

  // --- Rangka utama + tutup samping ---
  const frame = rounded(1.5, 0.15, 0.17, 0.055, mat(blue, { metalness: 0.35, roughness: 0.42 }));
  frame.position.set(0, 0.06, 0); frame.rotation.z = -0.05; rig.add(frame);
  for (const s of [1, -1]) {
    const cover = rounded(0.3, 0.19, 0.045, 0.02, mat(blueDark, { metalness: 0.35, roughness: 0.45 }));
    cover.position.set(-0.32, 0.06, s * 0.155); cover.rotation.z = -0.08;
    rig.add(cover);
  }

  // --- Tangki + tutup + bantalan lutut ---
  const tank = rounded(0.68, 0.25, 0.3, 0.085, mat(blue, { metalness: 0.4, roughness: 0.3 }));
  tank.position.set(0.28, 0.3, 0); tank.rotation.z = -0.08; rig.add(tank);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.028, 14), mat(metal, { metalness: 0.7, roughness: 0.3 }));
  cap.position.set(0.42, 0.445, 0); rig.add(cap);
  for (const s of [1, -1]) {
    const pad = rounded(0.2, 0.13, 0.02, 0.01, mat(0x0f172a, { roughness: 0.8 }));
    pad.position.set(0.18, 0.28, s * 0.155); pad.rotation.z = -0.08;
    rig.add(pad);
  }

  // --- Jok + pegangan belakang + buritan + pelat nomor ---
  const seat = rounded(0.72, 0.13, 0.27, 0.05, mat(0x111827, { roughness: 0.92, metalness: 0.02 }));
  seat.position.set(-0.5, 0.31, 0); rig.add(seat);
  const grab = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.3, 10), mat(metal, { metalness: 0.65, roughness: 0.35 }));
  grab.position.set(-0.88, 0.37, 0); grab.rotation.x = Math.PI / 2; rig.add(grab);
  const tail = rounded(0.36, 0.1, 0.22, 0.035, mat(blueDark, { metalness: 0.35, roughness: 0.45 }));
  tail.position.set(-0.97, 0.29, 0); tail.rotation.z = 0.16; rig.add(tail);
  const plate = rounded(0.02, 0.11, 0.16, 0.006, mat(0xf1f5f9, { roughness: 0.6 }));
  plate.position.set(-1.16, 0.16, 0); plate.rotation.z = 0.35; rig.add(plate);

  // --- Garpu depan + segitiga + reflektor ---
  for (const s of [1, -1]) {
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.9, 12), mat(0xdbeafe, { metalness: 0.72, roughness: 0.25 }));
    tube.position.set(0.945, -0.02, s * 0.088); tube.rotation.z = 0.265;
    rig.add(tube);
  }
  for (const y of [0.38, 0.16]) {
    const clamp = rounded(0.13, 0.07, 0.26, 0.025, mat(0x475569, { metalness: 0.6, roughness: 0.4 }));
    clamp.position.set(y === 0.38 ? 0.845 : 0.9, y, 0); clamp.rotation.z = 0.265;
    rig.add(clamp);
  }
  const flector = rounded(0.03, 0.07, 0.045, 0.008, mat(0xf79009, { emissive: 0xf79009, emissiveIntensity: 0.25, roughness: 0.4 }));
  flector.position.set(0.925, 0.05, 0); flector.rotation.z = 0.265; rig.add(flector);

  // --- Setang: batang, grip, tuas rem, spion ---
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.62, 12), mat(0x334155, { metalness: 0.55, roughness: 0.45 }));
  bar.position.set(0.82, 0.56, 0); bar.rotation.x = Math.PI / 2; rig.add(bar);
  for (const s of [1, -1]) {
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.13, 12), mat(0x0f172a, { roughness: 0.85 }));
    grip.position.set(0.82, 0.56, s * 0.265); grip.rotation.x = Math.PI / 2; rig.add(grip);
    const lever = rounded(0.14, 0.018, 0.03, 0.008, mat(0x94a3b8, { metalness: 0.65, roughness: 0.35 }));
    lever.position.set(0.9, 0.53, s * 0.22); lever.rotation.set(0, s * 0.5, -0.4);
    rig.add(lever);
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.22, 8), mat(0x475569, { metalness: 0.6, roughness: 0.4 }));
    stalk.position.set(0.78, 0.68, s * 0.24); stalk.rotation.set(-s * 0.35, 0, s * 0.32);
    rig.add(stalk);
    const mirror = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.016, 16), mat(0xe2e8f0, { metalness: 0.65, roughness: 0.22 }));
    mirror.position.set(0.74, 0.79, s * 0.3); mirror.rotation.set(Math.PI / 2 - s * 0.35, 0, s * 0.3);
    rig.add(mirror);
  }

  // --- Lampu depan (bezel + lensa) + sein depan ---
  const bezel = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.105, 0.07, 20), mat(0x334155, { metalness: 0.55, roughness: 0.4 }));
  bezel.position.set(0.99, 0.42, 0); bezel.rotation.z = Math.PI / 2; rig.add(bezel);
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.082, 0.082, 0.022, 20), mat(0xfde68a, { emissive: 0xf59e0b, emissiveIntensity: 0.5, roughness: 0.22 }));
  lens.position.set(1.03, 0.42, 0); lens.rotation.z = Math.PI / 2; rig.add(lens);
  const headLight = new THREE.PointLight(0xfbbf24, 0.42, 2.4);
  headLight.position.set(1.5, 0.42, 0); rig.add(headLight);
  for (const s of [1, -1]) {
    const sig = new THREE.Mesh(new THREE.SphereGeometry(0.032, 12, 10), mat(0xf79009, { emissive: 0xf79009, emissiveIntensity: 0.35, roughness: 0.35 }));
    sig.position.set(0.93, 0.35, s * 0.17); rig.add(sig);
  }

  // --- Lampu belakang + sein belakang ---
  const tailLight = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.075, 0.17), mat(0xef4444, { emissive: 0xef4444, emissiveIntensity: 0.5 }));
  tailLight.position.set(-1.155, 0.31, 0); rig.add(tailLight);
  for (const s of [1, -1]) {
    const sig = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 10), mat(0xf79009, { emissive: 0xf79009, emissiveIntensity: 0.35, roughness: 0.35 }));
    sig.position.set(-1.12, 0.24, s * 0.15); rig.add(sig);
  }

  // --- Knalpot: header + muffler + heat shield ---
  const header = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.052, 0.95, 14), mat(0x94a3b8, { metalness: 0.78, roughness: 0.3 }));
  header.position.set(-0.42, -0.19, 0.17); header.rotation.z = 0.1; rig.add(header);
  const muffler = new THREE.Mesh(new THREE.CylinderGeometry(0.056, 0.056, 0.22, 14), mat(steel, { metalness: 0.7, roughness: 0.35 }));
  muffler.position.set(-0.92, -0.14, 0.17); muffler.rotation.z = 1.42; rig.add(muffler);
  const shield = rounded(0.16, 0.055, 0.012, 0.006, mat(0xe2e8f0, { metalness: 0.7, roughness: 0.3 }));
  shield.position.set(-0.72, -0.105, 0.225); shield.rotation.z = 0.12; rig.add(shield);

  // --- Footstep kiri-kanan ---
  for (const s of [1, -1]) {
    const peg = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.12, 10), mat(0x475569, { metalness: 0.6, roughness: 0.45 }));
    peg.position.set(-0.08, -0.32, s * 0.2); peg.rotation.x = Math.PI / 2; rig.add(peg);
  }

  // --- Modul SMARTGUARD + LED status ---
  const mod = rounded(0.26, 0.15, 0.2, 0.03, mat(0x0ea5e9, { metalness: 0.25, roughness: 0.42 }));
  mod.position.set(-0.28, 0.1, -0.19); rig.add(mod);
  const ledMat = mat(toneColor, { emissive: toneColor, emissiveIntensity: 0.6, roughness: 0.3 });
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.028, 12, 10), ledMat);
  led.position.set(-0.28, 0.185, -0.19); rig.add(led);
  const beacon = new THREE.PointLight(toneColor, 0.32, 1.3);
  beacon.position.set(-0.28, 0.3, -0.19); rig.add(beacon);

  // --- Standar samping ---
  const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.48, 8), mat(0x475569, { metalness: 0.6, roughness: 0.45 }));
  stand.position.set(-0.32, -0.58, 0.2); stand.rotation.set(0.55, 0, 0.22); rig.add(stand);

  rig.userData = { ledMat, beacon };
  return rig;
}

// ---------------------------------------------------------------------------
// Lantai: target kalibrasi (alas + cincin + tick keliling)
// ---------------------------------------------------------------------------
function buildFloor() {
  const g = new THREE.Group();

  const base = new THREE.Mesh(new THREE.CircleGeometry(2.62, 64), mat(0xf0f5ff, { transparent: true, opacity: 0.92, roughness: 0.9, metalness: 0 }));
  base.rotation.x = -Math.PI / 2; base.position.y = -0.825; g.add(base);

  const ringA = new THREE.Mesh(new THREE.RingGeometry(0.92, 0.945, 64), mat(0xc7d8f2, { transparent: true, opacity: 0.8, roughness: 0.9 }));
  ringA.rotation.x = -Math.PI / 2; ringA.position.y = -0.818; g.add(ringA);

  const statusMat = mat(0x2f6bff, { emissive: 0x2f6bff, emissiveIntensity: 0.18, transparent: true, opacity: 0.6, roughness: 0.6 });
  const ringB = new THREE.Mesh(new THREE.RingGeometry(1.72, 1.755, 64), statusMat);
  ringB.rotation.x = -Math.PI / 2; ringB.position.y = -0.816; g.add(ringB);

  for (let i = 0; i < 24; i++) {
    const a = (i * Math.PI) / 12;
    const tick = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.012, 0.022), mat(0xb9cfe9, { transparent: true, opacity: 0.85, roughness: 0.9 }));
    tick.position.set(Math.cos(a) * 2.36, -0.812, Math.sin(a) * 2.36);
    tick.rotation.y = -a;
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
  const camera = new THREE.PerspectiveCamera(35, width() / height(), 0.1, 50);
  camera.position.set(3.15, 2.05, 3.65);

  scene.add(new THREE.AmbientLight(0xffffff, 0.56));
  scene.add(new THREE.HemisphereLight(0xdbeafe, 0xe2e8f0, 0.55));
  const key = new THREE.DirectionalLight(0xffffff, 1.1); key.position.set(5, 7, 4); scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.38); fill.position.set(-5, 4, -3); scene.add(fill);
  const rim = new THREE.DirectionalLight(0xbfdbfe, 0.3); rim.position.set(-2, 2.5, 6); scene.add(rim);

  const floor = buildFloor();
  scene.add(floor);
  const motor = buildMotor(TONE_HEX.ok);
  scene.add(motor);

  // Bayangan lembut sederhana (cakram radial di bawah motor)
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(1.5, 40),
    new THREE.MeshBasicMaterial({ color: 0x1e3a5f, transparent: true, opacity: 0.16, depthWrite: false })
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
    motor.rotation.z += (target.pitch * DEG - motor.rotation.z) * k;
    motor.rotation.x += (-target.roll * DEG - motor.rotation.x) * k;

    const shake = target.vibration ? 0.012 : 0;
    motor.position.y = 0.02 + Math.sin(t * 1.1) * 0.012 + (Math.random() - 0.5) * shake;
    motor.position.x = (Math.random() - 0.5) * shake;

    const { ledMat, beacon } = motor.userData;
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
      motor.userData.ledMat.color.setHex(hex);
      motor.userData.ledMat.emissive.setHex(hex);
      motor.userData.beacon.color.setHex(hex);
      floor.userData.statusMat.color.setHex(hex);
      floor.userData.statusMat.emissive.setHex(hex);
      floor.userData.statusMat.emissiveIntensity = key === 'alarm' ? 0.45 : 0.18;
    },
    setVibration(on) { target.vibration = on === true; },
    destroy() {
      ro.disconnect();
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
