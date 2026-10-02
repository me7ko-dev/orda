import * as THREE from 'three';
import { cloneModel, fitModel, gltf, shadows } from '../engine/assets';
import type { Building, City } from './city';
import { HERO } from './data';

type Leap = { t: number; dur: number; fx: number; fy: number; fz: number; tx: number; ty: number; tz: number; arc: number; to: Building };

export class Hero {
  root = new THREE.Group();
  model: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  actions: Record<string, THREE.AnimationAction> = {};
  current = '';
  pos = new THREE.Vector3();
  vel = new THREE.Vector2();
  facing = 0;
  bld: Building;
  leap: Leap | null = null;
  hp = HERO.hp;
  maxHp = HERO.hp;
  sinceHurt = 99;
  dead = false;
  edgeT = 0;
  /** за ръцете: точка на раницата */
  backpack = new THREE.Object3D();
  onLeap?: (to: Building) => void;
  onLand?: () => void;

  constructor(public city: City) {
    const m = cloneModel('hero');
    // Сам държи брадва — махаме я, оръжията са в механичните ръце
    m.traverse((o) => {
      if (/knife|dagger|sword|blade|axe/i.test(o.name)) o.visible = false;
    });
    this.model = fitModel(m, 1.75);
    shadows(this.model, true, false);
    this.root.add(this.model);
    this.backpack.position.set(0, 1.18, -0.28);
    this.root.add(this.backpack);
    // раница (обикновена, но с метален кожух — от там излизат ръцете)
    const bag = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.5, 0.26), new THREE.MeshStandardMaterial({ color: 0x5b6b3a, roughness: 0.8 }));
    bag.position.set(0, 1.08, -0.24);
    bag.castShadow = true;
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.2, 0.16, 16), new THREE.MeshStandardMaterial({ color: 0xb8bec6, metalness: 0.9, roughness: 0.3 }));
    hub.rotation.x = Math.PI / 2;
    hub.position.set(0, 1.18, -0.38);
    hub.castShadow = true;
    this.root.add(bag, hub);
    // светещ кръг под краката — героят се вижда и в най-голямата тълпа
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.8, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x4fd8ff, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    ring.position.y = 0.04;
    ring.renderOrder = 1;
    this.root.add(ring);

    this.mixer = new THREE.AnimationMixer(m);
    const g = gltf('hero');
    for (const clip of g?.animations ?? []) {
      const n = clip.name.split('|').pop()!;
      this.actions[n] = this.mixer.clipAction(clip);
    }
    for (const n of ['Jump', 'Death', 'HitReact']) {
      const a = this.actions[n];
      if (a) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
    }
    this.play('Idle');

    this.bld = city.buildings.reduce((best, b) => {
      if (!b.playable) return best;
      const d = Math.hypot((b.x0 + b.x1) / 2 - city.center.x, (b.z0 + b.z1) / 2 - city.center.z);
      const bd = Math.hypot((best.x0 + best.x1) / 2 - city.center.x, (best.z0 + best.z1) / 2 - city.center.z);
      return d < bd ? b : best;
    });
    this.pos.set((this.bld.x0 + this.bld.x1) / 2, this.bld.h, (this.bld.z0 + this.bld.z1) / 2);
  }

  play(name: string, fade = 0.15) {
    if (this.current === name || !this.actions[name]) return;
    const next = this.actions[name];
    const prev = this.actions[this.current];
    next.reset().play();
    if (prev) next.crossFadeFrom(prev, fade, false);
    this.current = name;
  }

  reset() {
    this.hp = this.maxHp = HERO.hp;
    this.dead = false;
    this.leap = null;
    this.sinceHurt = 99;
    this.play('Idle');
  }

  hurt(dmg: number) {
    if (this.dead || this.leap) return false;
    this.hp -= dmg;
    this.sinceHurt = 0;
    if (this.hp <= 0) {
      this.hp = 0;
      this.dead = true;
      this.play('Death', 0.1);
    }
    return true;
  }

  /** Къде ще кацне, ако скочи в тази посока (или null). Прощава до ~50° отклонение. */
  findLeap(dx: number, dz: number): { b: Building; x: number; z: number } | null {
    const b0 = this.bld;
    const ox = this.pos.x, oz = this.pos.z;
    let best: { b: Building; x: number; z: number; score: number } | null = null;
    for (const b of this.city.buildings) {
      if (b === b0 || !b.playable) continue;
      if (b.h - b0.h > HERO.leapUp) continue;
      // най-близката точка от покрива до героя
      const cx = THREE.MathUtils.clamp(ox, b.x0, b.x1), cz = THREE.MathUtils.clamp(oz, b.z0, b.z1);
      // и точката по посоката (лъч), ако я пресича
      let tx = cx, tz = cz;
      let tmin = 0, tmax = 40, hit = true;
      for (const [o, d, lo, hi] of [[ox, dx, b.x0, b.x1], [oz, dz, b.z0, b.z1]] as const) {
        if (Math.abs(d) < 1e-6) { if (o < lo || o > hi) hit = false; }
        else {
          let t1 = (lo - o) / d, t2 = (hi - o) / d;
          if (t1 > t2) [t1, t2] = [t2, t1];
          tmin = Math.max(tmin, t1);
          tmax = Math.min(tmax, t2);
        }
      }
      if (hit && tmin <= tmax && tmin < HERO.leapGap + 1.2) { tx = ox + dx * tmin; tz = oz + dz * tmin; }
      const vx = tx - ox, vz = tz - oz;
      const d = Math.hypot(vx, vz);
      if (d > HERO.leapGap + 1.2 || d < 0.01) continue;
      const cos = (vx * dx + vz * dz) / d;
      if (cos < 0.62) continue; // до ~52°
      const score = d * (2 - cos);
      if (!best || score < best.score) {
        const lx = THREE.MathUtils.clamp(tx + (vx / d) * 1.6, b.x0 + 0.8, b.x1 - 0.8);
        const lz = THREE.MathUtils.clamp(tz + (vz / d) * 1.6, b.z0 + 0.8, b.z1 - 0.8);
        best = { b, x: lx, z: lz, score };
      }
    }
    return best;
  }

  update(dt: number, mx: number, mz: number) {
    this.mixer.update(dt);
    this.sinceHurt += dt;
    if (this.dead) {
      this.syncRoot(dt);
      return;
    }
    if (this.sinceHurt > HERO.regenDelay && this.hp < this.maxHp) this.hp = Math.min(this.maxHp, this.hp + HERO.regen * dt);

    if (this.leap) {
      const L = this.leap;
      L.t += dt;
      const k = Math.min(1, L.t / L.dur);
      const e = k;
      this.pos.x = L.fx + (L.tx - L.fx) * e;
      this.pos.z = L.fz + (L.tz - L.fz) * e;
      this.pos.y = L.fy + (L.ty - L.fy) * e + Math.sin(k * Math.PI) * L.arc;
      if (k >= 1) {
        this.leap = null;
        this.bld = L.to;
        this.pos.y = L.to.h;
        this.play(Math.hypot(mx, mz) > 0.1 ? 'Run' : 'Idle', 0.1);
        this.onLand?.();
      }
      this.syncRoot(dt);
      return;
    }

    const len = Math.hypot(mx, mz);
    const sp = HERO.speed;
    const tvx = mx * sp, tvz = mz * sp;
    const acc = 1 - Math.exp(-dt * 14);
    this.vel.x += (tvx - this.vel.x) * acc;
    this.vel.y += (tvz - this.vel.y) * acc;
    let nx = this.pos.x + this.vel.x * dt;
    let nz = this.pos.z + this.vel.y * dt;
    const b = this.bld;
    const m = HERO.radius + 0.28;
    let pushedOut = false;
    if (nx < b.x0 + m) { nx = b.x0 + m; pushedOut ||= mx < -0.3; }
    if (nx > b.x1 - m) { nx = b.x1 - m; pushedOut ||= mx > 0.3; }
    if (nz < b.z0 + m) { nz = b.z0 + m; pushedOut ||= mz < -0.3; }
    if (nz > b.z1 - m) { nz = b.z1 - m; pushedOut ||= mz > 0.3; }
    // кулички, капандури, климатици — заобикаля ги
    const r = HERO.radius;
    for (const k of this.city.blocksOf(b.i)) {
      if (nx < k.x0 - r || nx > k.x1 + r || nz < k.z0 - r || nz > k.z1 + r) continue;
      const dl = nx - (k.x0 - r), dr = k.x1 + r - nx, dn = nz - (k.z0 - r), df = k.z1 + r - nz;
      const mn = Math.min(dl, dr, dn, df);
      if (mn === dl) nx = k.x0 - r; else if (mn === dr) nx = k.x1 + r; else if (mn === dn) nz = k.z0 - r; else nz = k.z1 + r;
    }
    this.pos.x = nx;
    this.pos.z = nz;
    this.pos.y = b.h;

    // на ръба и продължава да бута → скок до съседния покрив
    if (pushedOut && len > 0.5) {
      this.edgeT += dt;
      if (this.edgeT > 0.06) {
        const L = this.findLeap(mx / len, mz / len);
        if (L) this.startLeap(L.b, L.x, L.z);
        this.edgeT = 0;
      }
    } else this.edgeT = 0;

    if (len > 0.1) {
      this.play('Run');
      const want = Math.atan2(this.vel.x, this.vel.y);
      let d = want - this.facing;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.facing += d * Math.min(1, dt * 14);
    } else this.play('Idle');
    this.syncRoot(dt);
  }

  startLeap(to: Building, x: number, z: number) {
    const dist = Math.hypot(x - this.pos.x, z - this.pos.z);
    this.leap = {
      t: 0, dur: 0.42 + dist * 0.035,
      fx: this.pos.x, fy: this.pos.y, fz: this.pos.z,
      tx: x, ty: to.h, tz: z,
      arc: 1.6 + Math.max(0, to.h - this.pos.y) * 0.8 + dist * 0.08,
      to,
    };
    this.facing = Math.atan2(x - this.pos.x, z - this.pos.z);
    this.play('Jump', 0.08);
    this.onLeap?.(to);
  }

  private syncRoot(_dt: number) {
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.facing;
  }
}
