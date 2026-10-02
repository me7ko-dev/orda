import * as THREE from 'three';
import { gltf } from '../engine/assets';
import { QUALITY } from '../engine/engine';
import { bakeVAT, vatDepthMaterial, vatFrame, vatMaterial, type ClipInfo, type VAT } from '../engine/vat';
import type { Building, City } from './city';
import { ZOMBIES, type ZombieKind } from './data';
import type { Hero } from './hero';

export const enum ZS { Free = 0, Ground = 1, Climb = 2, Roof = 3, Fall = 4, Dying = 5 }
const KINDS: ZombieKind[] = ['walker', 'runner', 'brute', 'boss'];
const CLIPS = ['walk', 'run', 'climb', 'attack', 'death', 'fall'] as const;
const enum C { Walk = 0, Run = 1, Climb = 2, Attack = 3, Death = 4, Fall = 5 }

export class Horde {
  max: number;
  vat: VAT;
  mesh: THREE.InstancedMesh;
  clipInfo: ClipInfo[];
  // данни за всяко зомби (масиви — бързо при стотици)
  x: Float32Array; y: Float32Array; z: Float32Array;
  vx: Float32Array; vz: Float32Array; vy: Float32Array;
  yaw: Float32Array;
  state: Uint8Array; kind: Uint8Array; clip: Uint8Array;
  hp: Float32Array; maxHp: Float32Array; speed: Float32Array; scale: Float32Array; dmg: Float32Array; climbSp: Float32Array;
  bld: Int16Array; nx: Float32Array; nz: Float32Array;
  animT: Float32Array; hitT: Float32Array; atkT: Float32Array; stateT: Float32Array;
  tint: Float32Array;
  free: number[] = [];
  live: number[] = [];
  alive = 0;
  // решетка за съседи
  private gcell = 1.2;
  private ggw: number;
  private ggh: number;
  private cellStart: Int32Array;
  private cellItems: Int32Array;
  private cellOfZ: Int32Array;
  flow: Int32Array;
  flowFor = -1;
  private aAnim: THREE.InstancedBufferAttribute;
  private aCol: THREE.InstancedBufferAttribute;
  onAttack?: (i: number, dmg: number) => void;
  onKill?: (i: number) => void;
  onLand?: (i: number) => void;

  constructor(public city: City, scene: THREE.Scene, max: number) {
    this.max = max;
    const g = gltf('zombie')!;
    this.vat = bakeVAT(
      g.scene,
      g.animations,
      [
        { name: 'Walk', as: 'walk', fps: 24, loop: true },
        { name: 'Run_Arms', as: 'run', fps: 24, loop: true },
        { name: 'Crawl', as: 'climb', fps: 20, loop: true },
        { name: 'Punch', as: 'attack', fps: 24, loop: true },
        { name: 'Death', as: 'death', fps: 30, loop: false },
        { name: 'Jump_Idle', as: 'fall', fps: 20, loop: true },
      ],
      1.75,
    );
    this.clipInfo = CLIPS.map((c) => this.vat.clips[c] ?? this.vat.clips.walk);

    const geo = this.vat.geometry;
    this.aAnim = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
    this.aAnim.setUsage(THREE.DynamicDrawUsage);
    this.aCol.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aAnim', this.aAnim);
    geo.setAttribute('aCol', this.aCol);
    this.mesh = new THREE.InstancedMesh(geo, vatMaterial(this.vat), max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.customDepthMaterial = vatDepthMaterial(this.vat);
    this.mesh.castShadow = QUALITY.value !== 'low';
    this.mesh.receiveShadow = false;
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    scene.add(this.mesh);

    const F = (n = 1) => new Float32Array(max * n);
    this.x = F(); this.y = F(); this.z = F(); this.vx = F(); this.vz = F(); this.vy = F(); this.yaw = F();
    this.state = new Uint8Array(max); this.kind = new Uint8Array(max); this.clip = new Uint8Array(max);
    this.hp = F(); this.maxHp = F(); this.speed = F(); this.scale = F(); this.dmg = F(); this.climbSp = F();
    this.bld = new Int16Array(max); this.nx = F(); this.nz = F();
    this.animT = F(); this.hitT = F(); this.atkT = F(); this.stateT = F();
    this.tint = F(3);
    for (let i = max - 1; i >= 0; i--) this.free.push(i);

    const B = city.bounds;
    this.ggw = Math.ceil((B.x1 - B.x0) / this.gcell) + 1;
    this.ggh = Math.ceil((B.z1 - B.z0) / this.gcell) + 1;
    this.cellStart = new Int32Array(this.ggw * this.ggh + 1);
    this.cellItems = new Int32Array(max);
    this.cellOfZ = new Int32Array(max);
    this.flow = new Int32Array(city.gw * city.gh);
  }

  clear() {
    this.free.length = 0;
    for (let i = this.max - 1; i >= 0; i--) { this.state[i] = ZS.Free; this.free.push(i); }
    this.alive = 0;
    this.mesh.count = 0;
  }

  spawn(kindName: ZombieKind, x: number, z: number, hpMul: number): number {
    const i = this.free.pop();
    if (i === undefined) return -1;
    const k = ZOMBIES[kindName];
    const r = Math.random;
    this.kind[i] = KINDS.indexOf(kindName);
    this.state[i] = ZS.Ground;
    this.x[i] = x; this.z[i] = z; this.y[i] = 0;
    this.vx[i] = 0; this.vz[i] = 0; this.vy[i] = 0;
    this.yaw[i] = r() * 6.28;
    this.hp[i] = this.maxHp[i] = k.hp * hpMul;
    this.speed[i] = k.speed * (0.85 + r() * 0.3);
    this.scale[i] = k.scale * (0.9 + r() * 0.2);
    this.dmg[i] = k.dmg;
    this.climbSp[i] = k.climb * (0.8 + r() * 0.4);
    this.bld[i] = -1;
    this.animT[i] = r() * 5;
    this.hitT[i] = 0; this.atkT[i] = 0; this.stateT[i] = 0;
    const v = 0.85 + r() * 0.25;
    this.tint[i * 3] = k.tint[0] * v * (0.92 + r() * 0.16);
    this.tint[i * 3 + 1] = k.tint[1] * v;
    this.tint[i * 3 + 2] = k.tint[2] * v * (0.92 + r() * 0.16);
    this.alive++;
    return i;
  }

  damage(i: number, dmg: number, kx = 0, kz = 0, knock = 0) {
    if (this.state[i] === ZS.Free || this.state[i] === ZS.Dying) return false;
    this.hp[i] -= dmg;
    this.hitT[i] = 0.1;
    if (knock > 0 && (this.state[i] === ZS.Ground || this.state[i] === ZS.Roof)) {
      const k = knock / Math.max(1, this.scale[i] * this.scale[i]);
      this.vx[i] += kx * k * 6;
      this.vz[i] += kz * k * 6;
    }
    if (this.hp[i] <= 0) {
      this.kill(i);
      return true;
    }
    return false;
  }

  kill(i: number) {
    const wasClimbing = this.state[i] === ZS.Climb;
    this.state[i] = ZS.Dying;
    this.stateT[i] = 0;
    this.animT[i] = 0;
    this.vy[i] = wasClimbing ? 1 : 0;
    if (wasClimbing) {
      this.x[i] += this.nx[i] * 0.5;
      this.z[i] += this.nz[i] * 0.5;
    }
    this.alive--;
    this.onKill?.(i);
  }

  isTargetable(i: number) {
    const s = this.state[i];
    return s === ZS.Ground || s === ZS.Climb || s === ZS.Roof || s === ZS.Fall;
  }

  /** Подрежда живите по клетки (за бързо търсене на съседи). */
  private buildGrid() {
    const B = this.city.bounds;
    const cs = this.cellStart;
    cs.fill(0);
    const live = this.live;
    for (const i of live) {
      const gi = Math.min(this.ggw - 1, Math.max(0, Math.floor((this.x[i] - B.x0) / this.gcell)));
      const gj = Math.min(this.ggh - 1, Math.max(0, Math.floor((this.z[i] - B.z0) / this.gcell)));
      const c = gj * this.ggw + gi;
      this.cellOfZ[i] = c;
      cs[c + 1]++;
    }
    for (let c = 1; c < cs.length; c++) cs[c] += cs[c - 1];
    const fill = cs.slice(0, cs.length - 1);
    for (const i of live) {
      const c = this.cellOfZ[i];
      this.cellItems[fill[c]++] = i;
    }
  }

  /** Всички в радиус r от (x, z) — за взривове и сачми. */
  near(x: number, z: number, r: number, out: number[]) {
    out.length = 0;
    const B = this.city.bounds;
    const g = this.gcell;
    const i0 = Math.max(0, Math.floor((x - r - B.x0) / g)), i1 = Math.min(this.ggw - 1, Math.floor((x + r - B.x0) / g));
    const j0 = Math.max(0, Math.floor((z - r - B.z0) / g)), j1 = Math.min(this.ggh - 1, Math.floor((z + r - B.z0) / g));
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const c = j * this.ggw + i;
        for (let k = this.cellStart[c]; k < this.cellStart[c + 1]; k++) {
          const zi = this.cellItems[k];
          if (!this.isTargetable(zi)) continue;
          const dx = this.x[zi] - x, dz = this.z[zi] - z;
          if (dx * dx + dz * dz <= r * r) out.push(zi);
        }
      }
    return out;
  }

  private target(hero: Hero): Building {
    return hero.leap ? hero.leap.to : hero.bld;
  }

  update(dt: number, hero: Hero) {
    const city = this.city;
    const tgt = this.target(hero);
    if (this.flowFor !== tgt.i) {
      city.flowTo(tgt, this.flow);
      this.flowFor = tgt.i;
    }
    // живите
    this.live.length = 0;
    for (let i = 0; i < this.max; i++) if (this.state[i] !== ZS.Free) this.live.push(i);
    this.buildGrid();

    const hx = hero.pos.x, hz = hero.pos.z;
    const heroOn = hero.leap ? null : hero.bld;
    const flow = this.flow;
    const gw = city.gw;
    const tmp = { x: 0, z: 0 };
    const B = city.bounds;

    for (const i of this.live) {
      const st = this.state[i];
      this.hitT[i] = Math.max(0, this.hitT[i] - dt);
      this.stateT[i] += dt;
      const sc = this.scale[i];
      let wantX = 0, wantZ = 0;
      let moving = true;

      if (st === ZS.Dying) {
        // пада, ако е бил във въздуха, после лежи и потъва
        const floor = this.floorAt(this.x[i], this.z[i], this.y[i]);
        if (this.y[i] > floor + 0.01) {
          this.vy[i] -= 22 * dt;
          this.y[i] = Math.max(floor, this.y[i] + this.vy[i] * dt);
        } else if (this.stateT[i] > 2.4) {
          this.y[i] -= dt * 0.7;
          if (this.stateT[i] > 3.6) {
            this.state[i] = ZS.Free;
            this.free.push(i);
            continue;
          }
        } else this.y[i] = floor;
        this.vx[i] *= 1 - Math.min(1, dt * 6);
        this.vz[i] *= 1 - Math.min(1, dt * 6);
        this.x[i] += this.vx[i] * dt;
        this.z[i] += this.vz[i] * dt;
        this.clip[i] = C.Death;
        this.animT[i] += dt;
        continue;
      }

      if (st === ZS.Ground) {
        const near = this.distToRect(this.x[i], this.z[i], tgt);
        if (near < 7) {
          wantX = hx - this.x[i];
          wantZ = hz - this.z[i];
        } else {
          const k = city.cellOf(this.x[i], this.z[i]);
          let best = k >= 0 ? flow[k] : 0x3fffffff, bk = -1;
          if (k >= 0) {
            const nb = [k - 1, k + 1, k - gw, k + gw, k - gw - 1, k - gw + 1, k + gw - 1, k + gw + 1];
            for (let n = 0; n < 8; n++) {
              const c = nb[n];
              if (c < 0 || c >= flow.length) continue;
              if (n >= 4) {
                // диагонал — само ако и двете съседни са свободни
                const a = n === 4 ? k - gw : n === 5 ? k - gw : n === 6 ? k + gw : k + gw;
                const b2 = n === 4 ? k - 1 : n === 5 ? k + 1 : n === 6 ? k - 1 : k + 1;
                if (city.blocked[a] || city.blocked[b2]) continue;
              }
              if (flow[c] < best) { best = flow[c]; bk = c; }
            }
          }
          if (bk >= 0) {
            city.cellCenter(bk, tmp);
            wantX = tmp.x - this.x[i];
            wantZ = tmp.z - this.z[i];
          } else {
            wantX = hx - this.x[i];
            wantZ = hz - this.z[i];
          }
        }
      } else if (st === ZS.Roof) {
        wantX = hx - this.x[i];
        wantZ = hz - this.z[i];
        const b = city.buildings[this.bld[i]];
        if (heroOn === b) {
          const d = Math.hypot(wantX, wantZ);
          const reach = 0.55 * sc + 0.55;
          if (d < reach && Math.abs(hero.pos.y - this.y[i]) < 1.2) {
            moving = false;
            this.atkT[i] += dt;
            this.yaw[i] = Math.atan2(wantX, wantZ);
            if (this.atkT[i] > 1.0) {
              this.atkT[i] = 0;
              this.onAttack?.(i, this.dmg[i]);
            }
          } else this.atkT[i] = Math.max(0, this.atkT[i] - dt);
        }
      } else if (st === ZS.Climb) {
        const b = city.buildings[this.bld[i]];
        const busy = this.crowdAbove(i);
        this.y[i] += this.climbSp[i] * dt * (busy ? 0.35 : 1);
        // героят избяга на друг покрив — пада обратно (ако още е ниско)
        if (tgt !== b && this.y[i] < b.h * 0.55) {
          this.state[i] = ZS.Fall;
          this.vx[i] = this.nx[i] * 1.5; this.vz[i] = this.nz[i] * 1.5; this.vy[i] = 0;
          this.x[i] += this.nx[i] * 0.4; this.z[i] += this.nz[i] * 0.4;
        } else if (this.y[i] >= b.h) {
          this.state[i] = ZS.Roof;
          this.y[i] = b.h;
          this.x[i] -= this.nx[i] * 0.9;
          this.z[i] -= this.nz[i] * 0.9;
          this.vx[i] = -this.nx[i] * 2; this.vz[i] = -this.nz[i] * 2;
        }
        this.clip[i] = C.Climb;
        this.animT[i] += dt * this.climbSp[i] * 0.8;
        continue;
      } else if (st === ZS.Fall) {
        this.vy[i] -= 24 * dt;
        this.x[i] += this.vx[i] * dt;
        this.z[i] += this.vz[i] * dt;
        this.y[i] += this.vy[i] * dt;
        const b = city.buildingAt(this.x[i], this.z[i]);
        const floor = b ? b.h : 0;
        if (this.y[i] <= floor) {
          this.y[i] = floor;
          this.state[i] = b ? ZS.Roof : ZS.Ground;
          this.bld[i] = b ? b.i : -1;
          this.vx[i] *= 0.2; this.vz[i] *= 0.2;
          this.stateT[i] = 0;
          this.onLand?.(i);
        }
        this.clip[i] = C.Fall;
        this.animT[i] += dt;
        continue;
      }

      // ходене (земя или покрив)
      const wl = Math.hypot(wantX, wantZ);
      const sp = moving ? this.speed[i] * (st === ZS.Ground && this.stateT[i] < 0.5 ? 0.3 : 1) : 0;
      let tvx = 0, tvz = 0;
      if (wl > 0.001 && moving) { tvx = (wantX / wl) * sp; tvz = (wantZ / wl) * sp; }
      const a = 1 - Math.exp(-dt * 5);
      this.vx[i] += (tvx - this.vx[i]) * a;
      this.vz[i] += (tvz - this.vz[i]) * a;

      // разбутване от съседите
      let px = 0, pz = 0;
      const c = this.cellOfZ[i];
      const ci = c % this.ggw, cj = (c / this.ggw) | 0;
      for (let dj = -1; dj <= 1; dj++) {
        const jj = cj + dj;
        if (jj < 0 || jj >= this.ggh) continue;
        for (let di = -1; di <= 1; di++) {
          const ii = ci + di;
          if (ii < 0 || ii >= this.ggw) continue;
          const cc = jj * this.ggw + ii;
          for (let k = this.cellStart[cc]; k < this.cellStart[cc + 1]; k++) {
            const j = this.cellItems[k];
            if (j === i) continue;
            const sj = this.state[j];
            if (sj === ZS.Dying || sj === ZS.Fall) continue;
            if (Math.abs(this.y[j] - this.y[i]) > 0.9) continue;
            const dx = this.x[i] - this.x[j], dz = this.z[i] - this.z[j];
            const rr = 0.34 * (sc + this.scale[j]);
            const d2 = dx * dx + dz * dz;
            if (d2 < rr * rr && d2 > 1e-6) {
              const d = Math.sqrt(d2);
              const push = (rr - d) / d;
              const w = sj === ZS.Climb ? 1.4 : this.scale[j] / (sc + this.scale[j]) * 2;
              px += dx * push * w;
              pz += dz * push * w;
            }
          }
        }
      }
      this.x[i] += this.vx[i] * dt + px * Math.min(1, dt * 10);
      this.z[i] += this.vz[i] * dt + pz * Math.min(1, dt * 10);

      if (st === ZS.Ground) {
        this.x[i] = Math.min(B.x1 - 1, Math.max(B.x0 + 1, this.x[i]));
        this.z[i] = Math.min(B.z1 - 1, Math.max(B.z0 + 1, this.z[i]));
        // стени и препятствия
        const r = 0.3 * sc;
        const b = city.buildingAt(this.x[i], this.z[i], r);
        if (b) {
          const nrm = this.pushOut(i, b, r);
          if (b === tgt && nrm) {
            this.state[i] = ZS.Climb;
            this.bld[i] = b.i;
            this.nx[i] = nrm[0];
            this.nz[i] = nrm[1];
            this.y[i] = 0.05;
            this.stateT[i] = 0;
            continue;
          }
        }
        for (const o of city.obstacles) {
          if (this.x[i] > o.x0 - r && this.x[i] < o.x1 + r && this.z[i] > o.z0 - r && this.z[i] < o.z1 + r) this.pushOut(i, o, r);
        }
      } else if (st === ZS.Roof) {
        const b = city.buildings[this.bld[i]];
        const m = 0.15;
        if (this.x[i] < b.x0 - m || this.x[i] > b.x1 + m || this.z[i] < b.z0 - m || this.z[i] > b.z1 + m) {
          // стъпи отвъд ръба — пада
          this.state[i] = ZS.Fall;
          this.vy[i] = 1.5;
          this.vx[i] *= 0.8; this.vz[i] *= 0.8;
        } else if (heroOn === b) {
          // не излизат от покрива, докато героят е тук
          const mm = 0.45;
          this.x[i] = Math.min(b.x1 - mm, Math.max(b.x0 + mm, this.x[i]));
          this.z[i] = Math.min(b.z1 - mm, Math.max(b.z0 + mm, this.z[i]));
        }
      }

      const v = Math.hypot(this.vx[i], this.vz[i]);
      if (v > 0.2) {
        const want = Math.atan2(this.vx[i], this.vz[i]);
        let d = want - this.yaw[i];
        d = Math.atan2(Math.sin(d), Math.cos(d));
        this.yaw[i] += d * Math.min(1, dt * 8);
      }
      if (!moving) {
        this.clip[i] = C.Attack;
        this.animT[i] += dt * 1.1;
      } else {
        const runner = this.kind[i] === 1 || this.kind[i] === 3;
        this.clip[i] = runner ? C.Run : C.Walk;
        this.animT[i] += dt * (runner ? v / 4.5 : v / 1.7) / Math.max(0.6, sc);
      }
    }
    this.render();
  }

  /** Колко високо е „подът“ под точката (покрив или земя). */
  private floorAt(x: number, z: number, y: number) {
    const b = this.city.buildingAt(x, z);
    return b && b.h <= y + 0.5 ? b.h : 0;
  }

  private crowdAbove(i: number) {
    // друг катерач точно над него на същото място → бави
    const c = this.cellOfZ[i];
    for (let k = this.cellStart[c]; k < this.cellStart[c + 1]; k++) {
      const j = this.cellItems[k];
      if (j === i || this.state[j] !== ZS.Climb) continue;
      const dy = this.y[j] - this.y[i];
      if (dy > 0 && dy < 0.9) {
        const dx = this.x[j] - this.x[i], dz = this.z[j] - this.z[i];
        if (dx * dx + dz * dz < 0.25) return true;
      }
    }
    return false;
  }

  private distToRect(x: number, z: number, b: { x0: number; z0: number; x1: number; z1: number }) {
    const dx = Math.max(b.x0 - x, 0, x - b.x1);
    const dz = Math.max(b.z0 - z, 0, z - b.z1);
    return Math.hypot(dx, dz);
  }

  /** Изтласква зомбито извън правоъгълника; връща нормалата на стената. */
  private pushOut(i: number, b: { x0: number; z0: number; x1: number; z1: number }, r: number): [number, number] | null {
    const x = this.x[i], z = this.z[i];
    const dl = x - (b.x0 - r), dr = b.x1 + r - x, dn = z - (b.z0 - r), df = b.z1 + r - z;
    const m = Math.min(dl, dr, dn, df);
    if (m < 0) return null;
    if (m === dl) { this.x[i] = b.x0 - r; return [-1, 0]; }
    if (m === dr) { this.x[i] = b.x1 + r; return [1, 0]; }
    if (m === dn) { this.z[i] = b.z0 - r; return [0, -1]; }
    this.z[i] = b.z1 + r;
    return [0, 1];
  }

  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v3 = new THREE.Vector3();
  private s3 = new THREE.Vector3();
  private fr = [0, 0, 0];
  private bx = new THREE.Vector3();
  private by = new THREE.Vector3();
  private bz = new THREE.Vector3();

  private render() {
    const im = this.mesh.instanceMatrix.array as Float32Array;
    const an = this.aAnim.array as Float32Array;
    const co = this.aCol.array as Float32Array;
    let n = 0;
    const up = new THREE.Vector3(0, 1, 0);
    for (const i of this.live) {
      if (this.state[i] === ZS.Free) continue;
      const s = this.scale[i];
      if (this.state[i] === ZS.Climb) {
        // по стената: гърбът навън, главата нагоре
        const nx = this.nx[i], nz = this.nz[i];
        this.bx.set(-nz, 0, nx);
        this.by.set(nx, 0, nz);
        this.bz.copy(up);
        this.m4.makeBasis(this.bx, this.by, this.bz);
        this.m4.scale(this.s3.set(s, s, s));
        this.m4.setPosition(this.x[i] + nx * 0.05, this.y[i] - 0.6 * s, this.z[i] + nz * 0.05);
      } else {
        this.q.setFromAxisAngle(up, this.yaw[i]);
        this.m4.compose(this.v3.set(this.x[i], this.y[i], this.z[i]), this.q, this.s3.set(s, s, s));
      }
      this.m4.toArray(im, n * 16);
      vatFrame(this.clipInfo[this.clip[i]], this.animT[i], this.fr);
      an[n * 3] = this.fr[0]; an[n * 3 + 1] = this.fr[1]; an[n * 3 + 2] = this.fr[2];
      co[n * 4] = this.tint[i * 3]; co[n * 4 + 1] = this.tint[i * 3 + 1]; co[n * 4 + 2] = this.tint[i * 3 + 2];
      co[n * 4 + 3] = this.hitT[i] > 0 ? 0.75 : 0;
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.aAnim.needsUpdate = true;
    this.aCol.needsUpdate = true;
  }
}
