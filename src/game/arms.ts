import * as THREE from 'three';
import { cloneModel } from '../engine/assets';
import { TIERS, WEAPONS, weaponStats, type Item, type WeaponKind } from './data';
import type { FX } from './fx';
import type { Hero } from './hero';
import type { Horde } from './horde';

const RINGS = 20; // пръстени на една ръка (пружината)

/** Модел на оръжие, насочен по +Z (дулото напред), с дадена дължина. */
const gunCache = new Map<string, { obj: THREE.Object3D; muzzle: number }>();
export function gunModel(kind: WeaponKind, tier: number): { obj: THREE.Object3D; muzzle: number } {
  const key = kind + tier;
  const c = gunCache.get(key);
  if (c) return { obj: c.obj.clone(), muzzle: c.muzzle };
  const w = WEAPONS[kind];
  const m = cloneModel(w.model);
  m.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(m);
  const size = box.getSize(new THREE.Vector3());
  // дългата ос е цевта; моделите на Quaternius гледат по +X или -X/Z
  const inner = new THREE.Group();
  inner.add(m);
  if (size.x >= size.z) m.rotation.y = -Math.PI / 2; // X → Z
  const flip = GUN_FLIP[kind] ? Math.PI : 0;
  m.rotation.y += flip;
  m.updateMatrixWorld(true);
  const b2 = new THREE.Box3().setFromObject(inner);
  const s2 = b2.getSize(new THREE.Vector3());
  const k = w.size / Math.max(s2.z, 0.001);
  inner.scale.setScalar(k);
  inner.updateMatrixWorld(true);
  const b3 = new THREE.Box3().setFromObject(inner);
  const ctr = b3.getCenter(new THREE.Vector3());
  m.position.sub(ctr.divideScalar(k));
  // оцветяване по редкост (тъмните части)
  const tint = new THREE.Color(TIERS[tier].hex);
  m.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map((mm) => {
      const n = (mm as THREE.MeshStandardMaterial).clone();
      if (tier > 1 && n.color) {
        const l = n.color.r * 0.3 + n.color.g * 0.59 + n.color.b * 0.11;
        if (l < 0.45) n.color.lerp(tint, 0.75);
        n.emissive = tint.clone().multiplyScalar(tier >= 4 ? 0.18 : 0.06);
      }
      return n;
    });
    mesh.material = Array.isArray(mesh.material) ? mats : mats[0];
  });
  const res = { obj: inner, muzzle: w.size * 0.5 };
  gunCache.set(key, res);
  return { obj: inner.clone(), muzzle: res.muzzle };
}

/** Кои модели са обърнати назад (дулото към -Z след завъртането). */
const GUN_FLIP: Partial<Record<WeaponKind, boolean>> = {};

type Arm = {
  item: Item;
  gun: THREE.Object3D;
  muzzle: number;
  base: THREE.Vector3;
  tip: THREE.Vector3;
  tipVel: THREE.Vector3;
  aim: THREE.Vector3;
  cool: number;
  recoil: number;
  target: number;
  idleA: number;
  beamOn: number;
};

export class Arms {
  group = new THREE.Group();
  arms: Arm[] = [];
  rings: THREE.InstancedMesh;
  joints: THREE.InstancedMesh;
  private cand: number[] = [];
  private candD: number[] = [];
  private tmp: number[] = [];
  private v = new THREE.Vector3();
  private v2 = new THREE.Vector3();
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  onShot?: (kind: WeaponKind) => void;
  onExplode?: (x: number, y: number, z: number) => void;
  /** червена бъчва, която си струва да се взриви (около нея има зомбита) */
  barrelPick?: () => { id: number; p: THREE.Vector3 } | null;
  onBarrel?: (id: number) => void;

  constructor(scene: THREE.Scene, public hero: Hero, public horde: Horde, public fx: FX) {
    scene.add(this.group);
    const ringGeo = new THREE.TorusGeometry(0.09, 0.032, 6, 12);
    const metal = new THREE.MeshStandardMaterial({ color: 0xd6dbe1, metalness: 0.95, roughness: 0.28 });
    this.rings = new THREE.InstancedMesh(ringGeo, metal, RINGS * 12);
    this.rings.castShadow = true;
    this.rings.frustumCulled = false;
    this.rings.count = 0;
    this.group.add(this.rings);
    const jGeo = new THREE.SphereGeometry(0.09, 12, 8);
    const dark = new THREE.MeshStandardMaterial({ color: 0x3a4048, metalness: 0.8, roughness: 0.35 });
    this.joints = new THREE.InstancedMesh(jGeo, dark, 24);
    this.joints.castShadow = true;
    this.joints.frustumCulled = false;
    this.joints.count = 0;
    this.group.add(this.joints);
  }

  /** Подрежда ръцете според раницата. */
  setItems(items: Item[]) {
    const keep = new Map(this.arms.map((a) => [a.item.id, a]));
    const next: Arm[] = [];
    items.forEach((it, idx) => {
      const old = keep.get(it.id);
      if (old && old.item.tier === it.tier) {
        next.push(old);
        keep.delete(it.id);
        return;
      }
      const g = gunModel(it.kind, it.tier);
      this.group.add(g.obj);
      const start = this.hero.backpack.getWorldPosition(new THREE.Vector3());
      next.push({ item: it, gun: g.obj, muzzle: g.muzzle, base: start.clone(), tip: start.clone(), tipVel: new THREE.Vector3(), aim: new THREE.Vector3(0, 0, 1), cool: Math.random() * 0.3, recoil: 0, target: -1, idleA: idx, beamOn: 0 });
    });
    for (const a of keep.values()) this.group.remove(a.gun);
    this.arms = next;
  }

  clear() {
    for (const a of this.arms) this.group.remove(a.gun);
    this.arms = [];
  }

  maxRange() {
    let r = 0;
    for (const a of this.arms) r = Math.max(r, weaponStats(a.item.kind, a.item.tier).range);
    return r;
  }

  /** Най-близките зомбита (за прицелване). */
  private gatherTargets(cx: number, cy: number, cz: number, range: number) {
    const H = this.horde;
    this.cand.length = 0;
    this.candD.length = 0;
    const r2 = range * range;
    for (const i of H.live) {
      if (!H.isTargetable(i)) continue;
      const dx = H.x[i] - cx, dz = H.z[i] - cz;
      const dy = (H.y[i] + 0.9 * H.scale[i] - cy) * 1.6; // по-ниските (на улицата) — по-маловажни
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < r2) {
        this.cand.push(i);
        this.candD.push(d2);
      }
    }
    // сортиране по разстояние
    const idx = this.cand.map((_, k) => k).sort((a, b) => this.candD[a] - this.candD[b]);
    this.tmp = idx.map((k) => this.cand[k]);
    const d = idx.map((k) => this.candD[k]);
    this.cand = this.tmp;
    this.candD = d;
  }

  update(dt: number, active: boolean) {
    const hero = this.hero;
    const H = this.horde;
    const n = this.arms.length;
    const hp = hero.pos;
    const center = this.v.set(hp.x, hp.y + 1.3, hp.z);
    this.gatherTargets(center.x, center.y, center.z, this.maxRange() + 1);
    const bt = active ? this.barrelPick?.() ?? null : null;
    let barrelShot = false;

    const bp = hero.backpack.getWorldPosition(new THREE.Vector3());
    const face = hero.facing;
    const fwdX = Math.sin(face), fwdZ = Math.cos(face);
    const rightX = Math.cos(face), rightZ = -Math.sin(face);

    let ri = 0, ji = 0;
    this.arms.forEach((a, k) => {
      const st = weaponStats(a.item.kind, a.item.tier);
      const w = WEAPONS[a.item.kind];
      // основа: ветрило зад гърба
      const spread = n > 1 ? (k / (n - 1) - 0.5) : 0;
      const ang = spread * 2.4;
      a.base.set(bp.x + rightX * Math.sin(ang) * 0.16 - fwdX * 0.12, bp.y + 0.05 + Math.cos(ang) * 0.08, bp.z + rightZ * Math.sin(ang) * 0.16 - fwdZ * 0.12);

      // цел: всяка ръка взима различно зомби, ако може
      let t = -1;
      if (this.cand.length && active) {
        const range2 = st.range * st.range;
        const span = Math.min(this.cand.length, Math.max(n, 1) * 2);
        for (let c = 0; c < span; c++) {
          const ci = (k + c) % span;
          if (this.candD[ci] <= range2) { t = this.cand[ci]; break; }
        }
      }
      a.target = t;

      // къде иска да е върхът (с дулото)
      const reach = 1.25 + Math.min(0.8, n * 0.06);
      const sideOff = spread * Math.min(2.2, 0.55 * n);
      const want = this.v2;
      if (t >= 0) {
        const tx = H.x[t], ty = H.y[t] + 0.95 * H.scale[t], tz = H.z[t];
        const dx = tx - hp.x, dz = tz - hp.z;
        const dl = Math.hypot(dx, dz) || 1;
        const px = -dz / dl, pz = dx / dl;
        want.set(hp.x + (dx / dl) * reach + px * sideOff * 0.6, hp.y + 1.55 + Math.abs(spread) * 0.5, hp.z + (dz / dl) * reach + pz * sideOff * 0.6);
        a.aim.set(tx - want.x, ty - want.y, tz - want.z).normalize();
      } else {
        // покой: ръцете се поклащат над раменете
        const tt = performance.now() / 1000;
        const ia = ang + Math.sin(tt * 1.3 + k) * 0.15;
        want.set(hp.x + rightX * Math.sin(ia) * (0.8 + 0.2 * n * 0.1) - fwdX * 0.3, hp.y + 1.75 + Math.cos(ia) * 0.35 + Math.sin(tt * 2 + k * 1.7) * 0.06, hp.z + rightZ * Math.sin(ia) * (0.8 + 0.2 * n * 0.1) - fwdZ * 0.3);
        a.aim.set(fwdX + rightX * Math.sin(ia) * 0.5, -0.15, fwdZ + rightZ * Math.sin(ia) * 0.5).normalize();
      }
      // пружина към желаното място (живо движение)
      const kSpring = 90, damp = 14;
      a.tipVel.x += ((want.x - a.tip.x) * kSpring - a.tipVel.x * damp) * dt;
      a.tipVel.y += ((want.y - a.tip.y) * kSpring - a.tipVel.y * damp) * dt;
      a.tipVel.z += ((want.z - a.tip.z) * kSpring - a.tipVel.z * damp) * dt;
      a.tip.addScaledVector(a.tipVel, dt);
      if (a.tip.distanceTo(hp) > 6) a.tip.copy(want);
      a.recoil = Math.max(0, a.recoil - dt * 8);

      // оръжието
      const gunPos = this.v2.copy(a.tip).addScaledVector(a.aim, -a.recoil * 0.25);
      a.gun.position.copy(gunPos);
      a.gun.lookAt(gunPos.x + a.aim.x, gunPos.y + a.aim.y, gunPos.z + a.aim.z);

      // стрелба
      a.cool -= dt;
      if (w.mode === 'beam') {
        if (t >= 0) {
          a.beamOn += dt;
          const muzzle = new THREE.Vector3().copy(a.tip).addScaledVector(a.aim, a.muzzle);
          const end = new THREE.Vector3(H.x[t], H.y[t] + 0.95 * H.scale[t], H.z[t]);
          const dir = end.clone().sub(muzzle).normalize();
          end.copy(muzzle).addScaledVector(dir, st.range);
          this.fx.beam(muzzle, end, w.tracer, 0.06 + a.item.tier * 0.012);
          this.fx.flash(muzzle, 0.5, w.tracer, 0.03);
          if (a.cool <= 0) {
            a.cool = 1 / st.rate;
            this.lineHits(muzzle, dir, st.range, st.dmg / st.rate, 99, 0);
            if (Math.random() < 0.3) this.onShot?.(a.item.kind);
          }
        } else a.beamOn = 0;
      } else if (bt && !barrelShot && a.cool <= 0 && (w.mode === 'bullet' || w.mode === 'pellets') && bt.p.distanceTo(a.tip) < st.range + 2) {
        // изстрел по бъчвата → голям взрив сред тълпата
        barrelShot = true;
        a.cool = 1 / st.rate;
        a.recoil = 1;
        a.aim.copy(bt.p).sub(a.tip).normalize();
        const muzzle = new THREE.Vector3().copy(a.tip).addScaledVector(a.aim, a.muzzle);
        this.fx.flash(muzzle, 0.9, 0xffd890, 0.06);
        this.fx.tracer(muzzle, bt.p, 0xfff0b0, 0.06, 0.08);
        this.onShot?.(a.item.kind);
        this.onBarrel?.(bt.id);
      } else if (t >= 0 && a.cool <= 0) {
        a.cool = 1 / st.rate * (0.9 + Math.random() * 0.2);
        a.recoil = 1;
        this.fire(a, t);
      }

      // рисуване на пружината (крива на Безие от раницата до оръжието)
      const P0 = a.base;
      const P3 = this.v.copy(a.tip).addScaledVector(a.aim, -0.2);
      const P1 = new THREE.Vector3(P0.x - fwdX * 0.25, P0.y + 0.55, P0.z - fwdZ * 0.25);
      const P2 = new THREE.Vector3(P3.x - a.aim.x * 0.45, P3.y + 0.15 - a.aim.y * 0.45, P3.z - a.aim.z * 0.45);
      const pt = new THREE.Vector3(), tg = new THREE.Vector3();
      for (let r = 0; r < RINGS; r++) {
        const u = (r + 0.5) / RINGS;
        bez(P0, P1, P2, P3, u, pt);
        bezD(P0, P1, P2, P3, u, tg);
        tg.normalize();
        this.q.setFromUnitVectors(Z_AXIS, tg);
        const sc = 1 - u * 0.25;
        this.m4.compose(pt, this.q, this.s.set(sc, sc, sc));
        this.rings.setMatrixAt(ri++, this.m4);
      }
      this.m4.compose(P0, this.q.identity(), this.s.set(1.1, 1.1, 1.1));
      this.joints.setMatrixAt(ji++, this.m4);
      this.m4.compose(P3, this.q.identity(), this.s.set(0.8, 0.8, 0.8));
      this.joints.setMatrixAt(ji++, this.m4);
    });
    this.rings.count = ri;
    this.joints.count = ji;
    this.rings.instanceMatrix.needsUpdate = true;
    this.joints.instanceMatrix.needsUpdate = true;
  }

  private fire(a: Arm, t: number) {
    const H = this.horde;
    const w = WEAPONS[a.item.kind];
    const st = weaponStats(a.item.kind, a.item.tier);
    const muzzle = new THREE.Vector3().copy(a.tip).addScaledVector(a.aim, a.muzzle);
    const target = new THREE.Vector3(H.x[t], H.y[t] + 0.95 * H.scale[t], H.z[t]);
    const fs = 0.75 + Math.min(0.6, st.dmg * 0.005) + (w.mode === 'pellets' ? 0.5 : 0);
    this.fx.flash(muzzle, fs, 0xffd890, 0.05);
    this.fx.flash(new THREE.Vector3().copy(muzzle).addScaledVector(a.aim, 0.3 + fs * 0.2), fs * 0.6, 0xffb040, 0.04);
    // гилза настрани
    if (w.mode === 'bullet' || w.mode === 'pellets') {
      if (Math.random() < (st.rate > 5 ? 0.45 : 1)) this.fx.casing(a.tip.x, a.tip.y, a.tip.z, a.aim.z, -a.aim.x, this.hero.pos.y);
      if (w.kind === 'sniper' || w.mode === 'pellets') this.fx.shake = Math.min(0.5, this.fx.shake + 0.06);
    }
    this.onShot?.(a.item.kind);

    if (w.mode === 'bullet') {
      const dir = target.clone().sub(muzzle).normalize();
      jitter(dir, w.spread);
      const hitEnd = this.lineHits(muzzle, dir, st.range, st.dmg, st.pierce + 1, w.knock ?? 0.25);
      this.fx.tracer(muzzle, hitEnd, w.tracer, w.kind === 'sniper' ? 0.07 : 0.045, w.kind === 'sniper' ? 0.12 : 0.07);
    } else if (w.mode === 'pellets') {
      for (let p = 0; p < st.pellets; p++) {
        const dir = target.clone().sub(muzzle).normalize();
        jitter(dir, w.spread);
        const hitEnd = this.lineHits(muzzle, dir, st.range, st.dmg, 1, w.knock ?? 0.5);
        this.fx.tracer(muzzle, hitEnd, w.tracer, 0.035, 0.06);
      }
    } else if (w.mode === 'rocket' || w.mode === 'grenade') {
      // дъга над ръба на покрива: връх на 2.5–4 м над по-високата точка
      const rocket = w.mode === 'rocket';
      const grav = rocket ? 26 : 20;
      const apex = Math.max(muzzle.y, target.y) + (rocket ? 2.5 : 4);
      const up = Math.sqrt(2 * grav * (apex - muzzle.y));
      const down = Math.sqrt(2 * grav * (apex - target.y));
      const tFlight = up / grav + down / grav;
      const vel = new THREE.Vector3((target.x - muzzle.x) / tFlight, up, (target.z - muzzle.z) / tFlight);
      jitter(vel, w.spread * 0.5);
      this.fx.projectile(rocket ? 'rocket' : 'grenade', muzzle, vel, grav, tFlight + 0.3, (x, y, z) => this.explode(x, y, z, st.aoe, st.dmg, w.knock ?? 2), (x, z, y) => {
        // снарядът спира в зомби, покрив или земя
        const b = this.hero.city.buildingAt(x, z);
        if (b && y <= b.h + 0.05) return b.h;
        return 0;
      });
    }
  }

  explode(x: number, y: number, z: number, r: number, dmg: number, knock: number) {
    const H = this.horde;
    const list = H.near(x, z, r, []);
    for (const i of list) {
      if (Math.abs(H.y[i] - y) > r) continue;
      const dx = H.x[i] - x, dz = H.z[i] - z;
      const d = Math.hypot(dx, dz);
      const f = 1 - (d / r) * 0.6;
      H.damage(i, dmg * f, dx / (d || 1), dz / (d || 1), knock);
    }
    this.fx.explosion(x, y, z, r, y);
    this.onExplode?.(x, y, z);
  }

  /** Куршум по права линия; удря до maxHits зомбита. Връща края на следата. */
  lineHits(o: THREE.Vector3, dir: THREE.Vector3, range: number, dmg: number, maxHits: number, knock: number): THREE.Vector3 {
    const H = this.horde;
    const hits: { i: number; t: number }[] = [];
    for (const i of this.cand) {
      if (!H.isTargetable(i)) continue;
      const s = H.scale[i];
      const cx = H.x[i] - o.x, cy = H.y[i] + 0.9 * s - o.y, cz = H.z[i] - o.z;
      const t = cx * dir.x + cy * dir.y + cz * dir.z;
      if (t < 0 || t > range) continue;
      const px = cx - dir.x * t, py = cy - dir.y * t, pz = cz - dir.z * t;
      const r = 0.55 * s;
      // „капсула“ — по-висока, отколкото широка
      if (px * px + pz * pz + (py * py) * 0.35 < r * r) hits.push({ i, t });
    }
    hits.sort((a, b) => a.t - b.t);
    let endT = range;
    const nh = Math.min(maxHits, hits.length);
    for (let k = 0; k < nh; k++) {
      const h = hits[k];
      const floorY = H.y[h.i];
      const killed = H.damage(h.i, dmg, dir.x, dir.z, knock);
      const p = new THREE.Vector3().copy(o).addScaledVector(dir, h.t);
      this.fx.particle(p.x, p.y, p.z, dir.x * 3 + (Math.random() - 0.5) * 2, 1 + Math.random() * 2, dir.z * 3 + (Math.random() - 0.5) * 2, 0.35, 0.07, 0xc0101a, 18, floorY);
      if (Math.random() < 0.5) this.fx.spark(p, 2, 0xffe2a0);
      if (!killed && Math.random() < 0.2) this.fx.decal(H.x[h.i] + dir.x, floorY, H.z[h.i] + dir.z, 0.5);
    }
    // спира в последното ударено, ако не може да мине през още
    if (nh > 0 && nh >= maxHits) endT = hits[nh - 1].t;
    return new THREE.Vector3().copy(o).addScaledVector(dir, endT);
  }

  /** Броят зомбита в обхвата (за подсказки). */
  threats() {
    return this.cand.length;
  }
}

const Z_AXIS = new THREE.Vector3(0, 0, 1);

function bez(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, t: number, out: THREE.Vector3) {
  const u = 1 - t;
  const w0 = u * u * u, w1 = 3 * u * u * t, w2 = 3 * u * t * t, w3 = t * t * t;
  out.set(a.x * w0 + b.x * w1 + c.x * w2 + d.x * w3, a.y * w0 + b.y * w1 + c.y * w2 + d.y * w3, a.z * w0 + b.z * w1 + c.z * w2 + d.z * w3);
  return out;
}
function bezD(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, t: number, out: THREE.Vector3) {
  const u = 1 - t;
  const w0 = -3 * u * u, w1 = 3 * u * u - 6 * u * t, w2 = 6 * u * t - 3 * t * t, w3 = 3 * t * t;
  out.set(a.x * w0 + b.x * w1 + c.x * w2 + d.x * w3, a.y * w0 + b.y * w1 + c.y * w2 + d.y * w3, a.z * w0 + b.z * w1 + c.z * w2 + d.z * w3);
  return out;
}
function jitter(v: THREE.Vector3, deg: number) {
  if (!deg) return v;
  const r = THREE.MathUtils.degToRad(deg);
  const len = v.length();
  v.normalize();
  v.x += (Math.random() - 0.5) * r;
  v.y += (Math.random() - 0.5) * r * 0.3;
  v.z += (Math.random() - 0.5) * r;
  return v.normalize().multiplyScalar(len);
}
