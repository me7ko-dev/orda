import * as THREE from 'three';
import { QUALITY } from '../engine/engine';

/** Петно кръв (рисувано) */
function splatTexture(): THREE.CanvasTexture {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const blob = (x: number, y: number, r: number, a: number) => {
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(150,8,12,${a})`);
    gr.addColorStop(0.7, `rgba(120,5,10,${a * 0.9})`);
    gr.addColorStop(1, 'rgba(110,0,8,0)');
    g.fillStyle = gr;
    g.beginPath();
    g.arc(x, y, r, 0, 7);
    g.fill();
  };
  blob(64, 64, 30, 0.95);
  for (let i = 0; i < 18; i++) {
    const a = Math.random() * 6.28, d = 20 + Math.random() * 36;
    blob(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, 3 + Math.random() * 9, 0.9);
  }
  g.strokeStyle = 'rgba(140,6,10,0.85)';
  for (let i = 0; i < 10; i++) {
    const a = Math.random() * 6.28;
    g.lineWidth = 1 + Math.random() * 3;
    g.beginPath();
    g.moveTo(64 + Math.cos(a) * 18, 64 + Math.sin(a) * 18);
    g.lineTo(64 + Math.cos(a) * (40 + Math.random() * 22), 64 + Math.sin(a) * (40 + Math.random() * 22));
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function scorchTexture(): THREE.CanvasTexture {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 62);
  gr.addColorStop(0, 'rgba(20,18,16,0.6)');
  gr.addColorStop(0.6, 'rgba(30,26,22,0.3)');
  gr.addColorStop(1, 'rgba(30,26,22,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Мека кръгла светлина (за огън, искри, проблясъци) */
function glowTexture(): THREE.CanvasTexture {
  const S = 64;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.25, 'rgba(255,255,255,0.75)');
  gr.addColorStop(0.6, 'rgba(255,255,255,0.2)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, S, S);
  return new THREE.CanvasTexture(c);
}

/** Облаче пушек */
function smokeTexture(): THREE.CanvasTexture {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  for (let i = 0; i < 14; i++) {
    const x = 64 + (Math.random() - 0.5) * 50, y = 64 + (Math.random() - 0.5) * 50, r = 18 + Math.random() * 26;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(255,255,255,0.35)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, S, S);
  }
  return new THREE.CanvasTexture(c);
}

/** Стотици плоски картинки, винаги с лице към камерата (едно рисуване). */
class Billboards {
  mesh: THREE.InstancedMesh;
  aColor: THREE.InstancedBufferAttribute;
  aRot: THREE.InstancedBufferAttribute;
  constructor(tex: THREE.Texture, additive: boolean, public max: number, scene: THREE.Scene) {
    const geo = new THREE.PlaneGeometry(1, 1);
    this.aColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
    this.aRot = new THREE.InstancedBufferAttribute(new Float32Array(max), 1);
    this.aColor.setUsage(THREE.DynamicDrawUsage);
    this.aRot.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aColor', this.aColor);
    geo.setAttribute('aRot', this.aRot);
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: tex } },
      vertexShader: /* glsl */ `
        attribute vec4 aColor;
        attribute float aRot;
        varying vec2 vUv;
        varying vec4 vColor;
        void main() {
          vUv = uv;
          vColor = aColor;
          vec3 center = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          float size = length(instanceMatrix[0].xyz);
          vec4 mv = modelViewMatrix * vec4(center, 1.0);
          float c = cos(aRot), s = sin(aRot);
          mv.xy += vec2(c * position.x - s * position.y, s * position.x + c * position.y) * size;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D map;
        varying vec2 vUv;
        varying vec4 vColor;
        void main() {
          vec4 t = texture2D(map, vUv);
          gl_FragColor = vec4(t.rgb * vColor.rgb, t.a * vColor.a);
          ${additive ? 'gl_FragColor.rgb *= gl_FragColor.a;' : ''}
        }`,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.renderOrder = additive ? 3 : 2;
    scene.add(this.mesh);
  }
}

const enum PK { Solid = 0, Glow = 1, Smoke = 2 }
type Particle = {
  k: PK; x: number; y: number; z: number; vx: number; vy: number; vz: number;
  life: number; max: number; s0: number; s1: number; grav: number; floor: number; drag: number;
  r: number; g: number; b: number; a: number; rot: number; spin: number; splat: boolean;
};

type Tracer = { ax: number; ay: number; az: number; bx: number; by: number; bz: number; life: number; max: number; w: number; color: THREE.Color };
type Proj = { mesh: THREE.Object3D; x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number; grav: number; trail: number; onHit: (x: number, y: number, z: number) => void; floorFn: (x: number, z: number, y: number) => number };

export class FX {
  private tracers: Tracer[] = [];
  private parts: Particle[] = [];
  private projs: Proj[] = [];
  private tracerMesh: THREE.InstancedMesh;
  private tracerMax = 260;
  private solid: THREE.InstancedMesh;
  private glow: Billboards;
  private smoke: Billboards;
  private maxParts: number;
  private decals: THREE.InstancedMesh;
  private scorch: THREE.InstancedMesh;
  private decalN = 0;
  private scorchN = 0;
  private decalMax: number;
  private beams: THREE.Mesh[] = [];
  private beamUsed = 0;
  shake = 0;
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private v2 = new THREE.Vector3();
  private s = new THREE.Vector3();
  private col = new THREE.Color();
  private up = new THREE.Vector3(0, 1, 0);
  private rocketGeo = new THREE.CylinderGeometry(0.08, 0.1, 0.5, 8).rotateX(Math.PI / 2);
  private rocketMat = new THREE.MeshStandardMaterial({ color: 0xd9dde2, metalness: 0.6, roughness: 0.4, emissive: 0x552200 });
  private grenadeGeo = new THREE.SphereGeometry(0.13, 10, 8);
  private grenadeMat = new THREE.MeshStandardMaterial({ color: 0x4b5d2a, roughness: 0.6 });

  constructor(public scene: THREE.Scene) {
    const low = QUALITY.value === 'low';
    this.maxParts = low ? 350 : 800;
    const tmat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    this.tracerMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 0.5), tmat, this.tracerMax);
    this.tracerMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.tracerMesh.frustumCulled = false;
    this.tracerMesh.count = 0;
    this.tracerMesh.setColorAt(0, new THREE.Color());
    scene.add(this.tracerMesh);

    this.solid = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.5, 0), new THREE.MeshLambertMaterial({ color: 0xffffff }), this.maxParts);
    this.solid.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.solid.frustumCulled = false;
    this.solid.count = 0;
    this.solid.setColorAt(0, new THREE.Color());
    scene.add(this.solid);
    this.glow = new Billboards(glowTexture(), true, this.maxParts, scene);
    this.smoke = new Billboards(smokeTexture(), false, low ? 120 : 260, scene);

    this.decalMax = low ? 120 : 320;
    const dgeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const dmat = new THREE.MeshLambertMaterial({ map: splatTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.decals = new THREE.InstancedMesh(dgeo, dmat, this.decalMax);
    this.decals.count = 0;
    this.decals.frustumCulled = false;
    this.decals.receiveShadow = true;
    this.decals.renderOrder = -1;
    scene.add(this.decals);
    const smat = new THREE.MeshLambertMaterial({ map: scorchTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    this.scorch = new THREE.InstancedMesh(dgeo, smat, 30);
    this.scorch.count = 0;
    this.scorch.frustumCulled = false;
    this.scorch.renderOrder = -1;
    scene.add(this.scorch);
  }

  clear() {
    this.tracers.length = 0;
    this.parts.length = 0;
    for (const p of this.projs) this.scene.remove(p.mesh);
    this.projs.length = 0;
    this.decalN = 0;
    this.decals.count = 0;
    this.scorchN = 0;
    this.scorch.count = 0;
  }

  tracer(a: THREE.Vector3, b: THREE.Vector3, color: number, w = 0.05, life = 0.07) {
    if (this.tracers.length >= this.tracerMax) this.tracers.shift();
    this.tracers.push({ ax: a.x, ay: a.y, az: a.z, bx: b.x, by: b.y, bz: b.z, life, max: life, w, color: new THREE.Color(color) });
  }

  private add(p: Partial<Particle> & { k: PK; x: number; y: number; z: number; life: number }) {
    if (this.parts.length >= this.maxParts) this.parts.shift();
    this.parts.push({ vx: 0, vy: 0, vz: 0, max: p.life, s0: 0.3, s1: 0.3, grav: 0, floor: -999, drag: 0, r: 1, g: 1, b: 1, a: 1, rot: Math.random() * 6.28, spin: 0, splat: false, ...p } as Particle);
  }

  /** Проблясък (дуло, удар) */
  flash(p: THREE.Vector3, size = 0.6, color = 0xffd890, life = 0.06) {
    this.col.set(color);
    this.add({ k: PK.Glow, x: p.x, y: p.y, z: p.z, life, s0: size, s1: size * 0.6, r: this.col.r, g: this.col.g, b: this.col.b });
  }

  /** Твърда частица (капка кръв, отломка) */
  particle(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, color: number, grav = 18, floor = 0, splat = false) {
    this.col.set(color);
    this.add({ k: PK.Solid, x, y, z, vx, vy, vz, life, s0: size, s1: size * 0.3, grav, floor, r: this.col.r, g: this.col.g, b: this.col.b, splat });
  }

  /** Кръв: пръски във въздуха + петно отдолу */
  blood(x: number, y: number, z: number, floor: number, amount = 1, dirX = 0, dirZ = 0) {
    const n = Math.round((QUALITY.value === 'low' ? 5 : 10) * amount);
    for (let k = 0; k < n; k++) {
      const a = Math.random() * 6.28;
      const s = 1.5 + Math.random() * 3.5;
      this.particle(x, y + 0.9, z, Math.cos(a) * s + dirX * 3, 2 + Math.random() * 4, Math.sin(a) * s + dirZ * 3, 0.6 + Math.random() * 0.5, 0.08 + Math.random() * 0.1, Math.random() < 0.5 ? 0xa0060c : 0xd01018, 20, floor, k < 2);
    }
    // червена мъгла
    this.add({ k: PK.Smoke, x, y: y + 0.9, z, life: 0.35, s0: 0.4 * amount, s1: 1.1 * amount, r: 0.8, g: 0.05, b: 0.07, a: 0.55, vy: 0.4 });
    this.decal(x, floor, z, 1.2 + Math.random() * 1.4 * amount);
  }

  decal(x: number, y: number, z: number, size: number) {
    const i = this.decalN % this.decalMax;
    this.q.setFromAxisAngle(this.up, Math.random() * 6.28);
    this.m4.compose(this.v.set(x, y + 0.03 + Math.random() * 0.01, z), this.q, this.s.set(size, 1, size));
    this.decals.setMatrixAt(i, this.m4);
    this.decalN++;
    this.decals.count = Math.min(this.decalMax, this.decalN);
    this.decals.instanceMatrix.needsUpdate = true;
  }

  explosion(x: number, y: number, z: number, r: number, floor: number) {
    const low = QUALITY.value === 'low';
    this.flash(this.v.set(x, y + 0.8, z), r * 3.2, 0xffd27a, 0.18);
    this.flash(this.v.set(x, y + 0.8, z), r * 1.6, 0xffffff, 0.08);
    // огнено кълбо
    const nf = low ? 8 : 16;
    for (let k = 0; k < nf; k++) {
      const a = Math.random() * 6.28, el = Math.random() * 1.2, s = 2 + Math.random() * 5;
      this.add({ k: PK.Glow, x, y: y + 0.6, z, vx: Math.cos(a) * Math.cos(el) * s, vy: Math.sin(el) * s + 1.5, vz: Math.sin(a) * Math.cos(el) * s, drag: 4, life: 0.35 + Math.random() * 0.35, s0: r * (0.5 + Math.random() * 0.4), s1: r * 0.15, r: 1, g: 0.45 + Math.random() * 0.3, b: 0.1, spin: (Math.random() - 0.5) * 4 });
    }
    // пушек
    const ns = low ? 3 : 6;
    for (let k = 0; k < ns; k++) {
      const a = Math.random() * 6.28, s = 1 + Math.random() * 2;
      const c = 0.78 + Math.random() * 0.14;
      this.add({ k: PK.Smoke, x: x + Math.cos(a) * 0.5, y: y + 0.9, z: z + Math.sin(a) * 0.5, vx: Math.cos(a) * s, vy: 1.8 + Math.random() * 1.5, vz: Math.sin(a) * s, drag: 1.5, life: 0.9 + Math.random() * 0.6, s0: r * 0.3, s1: r * 0.85, r: c, g: c * 0.97, b: c * 0.94, a: 0.5, spin: (Math.random() - 0.5) * 1.5 });
    }
    // искри и отломки
    const nk = low ? 8 : 18;
    for (let k = 0; k < nk; k++) {
      const a = Math.random() * 6.28, s = 6 + Math.random() * 9;
      this.add({ k: PK.Glow, x, y: y + 0.5, z, vx: Math.cos(a) * s, vy: 3 + Math.random() * 8, vz: Math.sin(a) * s, grav: 20, floor, life: 0.4 + Math.random() * 0.4, s0: 0.22, s1: 0.06, r: 1, g: 0.8, b: 0.35 });
    }
    for (let k = 0; k < 6; k++) {
      const a = Math.random() * 6.28, s = 3 + Math.random() * 5;
      this.particle(x, y + 0.4, z, Math.cos(a) * s, 3 + Math.random() * 5, Math.sin(a) * s, 0.8, 0.12, 0x2b2a28, 20, floor);
    }
    // опърлено място
    const i = this.scorchN % 30;
    this.q.setFromAxisAngle(this.up, Math.random() * 6.28);
    this.m4.compose(this.v.set(x, floor + 0.04, z), this.q, this.s.set(r * 0.9, 1, r * 0.9));
    this.scorch.setMatrixAt(i, this.m4);
    this.scorchN++;
    this.scorch.count = Math.min(30, this.scorchN);
    this.scorch.instanceMatrix.needsUpdate = true;
    this.shake = Math.min(1.2, this.shake + r * 0.18);
  }

  /** Летящ снаряд (ракета или граната). */
  projectile(kind: 'rocket' | 'grenade', from: THREE.Vector3, vel: THREE.Vector3, grav: number, life: number, onHit: Proj['onHit'], floorFn: Proj['floorFn']) {
    const mesh = new THREE.Mesh(kind === 'rocket' ? this.rocketGeo : this.grenadeGeo, kind === 'rocket' ? this.rocketMat : this.grenadeMat);
    mesh.position.copy(from);
    this.scene.add(mesh);
    this.projs.push({ mesh, x: from.x, y: from.y, z: from.z, vx: vel.x, vy: vel.y, vz: vel.z, life, grav, trail: 0, onHit, floorFn });
  }

  /** Лъч (лъчемета) — показва се само в този кадър. */
  beam(a: THREE.Vector3, b: THREE.Vector3, color: number, w: number) {
    let m = this.beams[this.beamUsed];
    if (!m) {
      m = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 8, 1, true).translate(0, 0.5, 0).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
      m.frustumCulled = false;
      this.beams.push(m);
      this.scene.add(m);
    }
    this.beamUsed++;
    m.visible = true;
    (m.material as THREE.MeshBasicMaterial).color.setHex(color);
    m.position.copy(a);
    m.lookAt(b);
    const len = a.distanceTo(b);
    const flick = 0.75 + Math.random() * 0.5;
    m.scale.set(w * flick, w * flick, len);
    if (Math.random() < 0.5) {
      this.col.set(color);
      this.add({ k: PK.Glow, x: b.x, y: b.y, z: b.z, life: 0.08, s0: 0.9, s1: 0.4, r: this.col.r, g: this.col.g, b: this.col.b });
    }
  }

  update(dt: number, _camera: THREE.Camera) {
    for (let k = this.beamUsed; k < this.beams.length; k++) this.beams[k].visible = false;
    this.beamUsed = 0;
    this.shake = Math.max(0, this.shake - dt * 2.5);

    // снаряди
    for (let k = this.projs.length - 1; k >= 0; k--) {
      const p = this.projs[k];
      p.life -= dt;
      p.vy -= p.grav * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.mesh.position.set(p.x, p.y, p.z);
      p.mesh.lookAt(p.x + p.vx, p.y + p.vy, p.z + p.vz);
      p.trail -= dt;
      if (p.trail <= 0) {
        p.trail = 0.025;
        const c = 0.85;
        this.add({ k: PK.Smoke, x: p.x, y: p.y, z: p.z, vx: (Math.random() - 0.5) * 0.5, vy: 0.4, vz: (Math.random() - 0.5) * 0.5, life: 0.55, s0: 0.2, s1: 0.7, r: c, g: c, b: c, a: 0.45 });
        if (p.grav < 1) this.add({ k: PK.Glow, x: p.x, y: p.y, z: p.z, life: 0.06, s0: 0.6, s1: 0.3, r: 1, g: 0.6, b: 0.2 });
      }
      // докато се изкачва — не се удря (минава над парапета)
      const floor = p.vy > 0 ? -99 : p.floorFn(p.x, p.z, p.y);
      if (p.life <= 0 || p.y <= floor) {
        this.scene.remove(p.mesh);
        this.projs.splice(k, 1);
        p.onHit(p.x, Math.max(p.y, floor), p.z);
      }
    }

    // следи от куршуми
    let n = 0;
    for (let k = this.tracers.length - 1; k >= 0; k--) {
      this.tracers[k].life -= dt;
      if (this.tracers[k].life <= 0) this.tracers.splice(k, 1);
    }
    for (const t of this.tracers) {
      const dx = t.bx - t.ax, dy = t.by - t.ay, dz = t.bz - t.az;
      const len = Math.hypot(dx, dy, dz) || 0.001;
      this.m4.lookAt(this.v.set(t.ax, t.ay, t.az), this.v2.set(t.bx, t.by, t.bz), this.up);
      this.q.setFromRotationMatrix(this.m4);
      // къс светъл сегмент, който лети от дулото към целта
      const k = 1 - t.life / t.max;
      const segLen = Math.min(len, 3.5);
      const start = Math.max(0, (len - segLen) * k);
      this.m4.compose(this.v.set(t.ax + (dx / len) * start, t.ay + (dy / len) * start, t.az + (dz / len) * start), this.q, this.s.set(t.w, t.w, segLen));
      this.tracerMesh.setMatrixAt(n, this.m4);
      this.tracerMesh.setColorAt(n, t.color);
      n++;
    }
    this.tracerMesh.count = n;
    this.tracerMesh.instanceMatrix.needsUpdate = true;
    if (this.tracerMesh.instanceColor) this.tracerMesh.instanceColor.needsUpdate = true;

    // частици
    for (let k = this.parts.length - 1; k >= 0; k--) {
      const p = this.parts[k];
      p.life -= dt;
      if (p.life <= 0) { this.parts.splice(k, 1); continue; }
      p.vy -= p.grav * dt;
      if (p.drag) {
        const d = Math.exp(-p.drag * dt);
        p.vx *= d; p.vy *= d; p.vz *= d;
      }
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.rot += p.spin * dt;
      if (p.y < p.floor) {
        p.y = p.floor;
        if (p.splat) { this.decal(p.x, p.floor, p.z, 0.4 + Math.random() * 0.5); p.splat = false; }
        p.vx *= 0.3; p.vz *= 0.3; p.vy = 0;
      }
    }
    let ns = 0, ng = 0, nm = 0;
    const gC = this.glow.aColor.array as Float32Array, gR = this.glow.aRot.array as Float32Array;
    const mC = this.smoke.aColor.array as Float32Array, mR = this.smoke.aRot.array as Float32Array;
    for (const p of this.parts) {
      const life = p.life / p.max; // 1 → 0
      const sz = p.s1 + (p.s0 - p.s1) * life;
      this.q.identity();
      this.m4.compose(this.v.set(p.x, p.y, p.z), this.q, this.s.set(sz, sz, sz));
      if (p.k === PK.Solid) {
        this.solid.setMatrixAt(ns, this.m4);
        this.col.setRGB(p.r, p.g, p.b);
        this.solid.setColorAt(ns, this.col);
        ns++;
      } else if (p.k === PK.Glow) {
        if (ng >= this.glow.max) continue;
        this.glow.mesh.setMatrixAt(ng, this.m4);
        const a = Math.min(1, life * 2.2);
        gC[ng * 4] = p.r; gC[ng * 4 + 1] = p.g; gC[ng * 4 + 2] = p.b; gC[ng * 4 + 3] = a;
        gR[ng] = p.rot;
        ng++;
      } else {
        if (nm >= this.smoke.max) continue;
        this.smoke.mesh.setMatrixAt(nm, this.m4);
        const a = p.a * Math.min(1, life * 1.6) * Math.min(1, (1 - life) * 8 + 0.3);
        mC[nm * 4] = p.r; mC[nm * 4 + 1] = p.g; mC[nm * 4 + 2] = p.b; mC[nm * 4 + 3] = a;
        mR[nm] = p.rot;
        nm++;
      }
    }
    this.solid.count = ns;
    this.solid.instanceMatrix.needsUpdate = true;
    if (this.solid.instanceColor) this.solid.instanceColor.needsUpdate = true;
    for (const [b, c] of [[this.glow, ng], [this.smoke, nm]] as const) {
      b.mesh.count = c;
      b.mesh.instanceMatrix.needsUpdate = true;
      b.aColor.needsUpdate = true;
      b.aRot.needsUpdate = true;
    }
  }
}
