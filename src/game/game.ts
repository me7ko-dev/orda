import * as THREE from 'three';
import { cloneModel, fitModel, shadows } from '../engine/assets';
import { QUALITY, type Engine } from '../engine/engine';
import { sfx } from '../audio/sfx';
import { Arms } from './arms';
import { City, type Building } from './city';
import { ALL_WEAPONS, BACKPACK, DIRECTOR, HERO, MAX_TIER, WEAPONS, makeItem, type Item, type WeaponKind, type ZombieKind } from './data';
import { FX } from './fx';
import { Hero } from './hero';
import { Horde, ZS } from './horde';

export type GameState = 'menu' | 'play' | 'pack' | 'paused' | 'over';

/** Сандък „Подобрение“ на някой покрив. */
class Chest {
  root = new THREE.Group();
  sign: THREE.Sprite;
  beam: THREE.Mesh;
  ring: THREE.Mesh;
  t = 0;
  constructor(public b: Building, public x: number, public z: number) {
    const m = fitModel(cloneModel('chest'), 1.1, 'max');
    shadows(m, true, false);
    this.root.add(m);
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.25, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffd23a, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    this.ring.position.y = 0.05;
    this.root.add(this.ring);
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.9, 14, 20, 1, true).translate(0, 7, 0), new THREE.MeshBasicMaterial({ color: 0xffe07a, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    this.root.add(this.beam);
    this.sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: signTexture(), depthTest: false, toneMapped: false }));
    this.sign.scale.set(3.4, 1.1, 1);
    this.sign.position.y = 2.6;
    this.sign.renderOrder = 10;
    this.root.add(this.sign);
    this.root.position.set(x, b.h, z);
  }
  update(dt: number) {
    this.t += dt;
    this.sign.position.y = 2.5 + Math.sin(this.t * 3) * 0.15;
    this.ring.scale.setScalar(1 + Math.sin(this.t * 5) * 0.08);
    (this.beam.material as THREE.MeshBasicMaterial).opacity = 0.16 + Math.sin(this.t * 4) * 0.06;
  }
}

let signTex: THREE.CanvasTexture | null = null;
function signTexture() {
  if (signTex) return signTex;
  const c = document.createElement('canvas');
  c.width = 512; c.height = 160;
  const g = c.getContext('2d')!;
  g.translate(256, 80);
  g.rotate(-0.12);
  g.fillStyle = '#1f2d4d';
  g.strokeStyle = '#0b1222';
  g.lineWidth = 10;
  roundRect(g, -220, -52, 440, 104, 18);
  g.fill();
  g.stroke();
  g.font = '900 64px Rubik, Arial Black, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 12;
  g.strokeStyle = '#3a1d00';
  g.strokeText('ПОДОБРЕНИЕ', 0, 4);
  const gr = g.createLinearGradient(0, -30, 0, 30);
  gr.addColorStop(0, '#fff27a');
  gr.addColorStop(1, '#ffae17');
  g.fillStyle = gr;
  g.fillText('ПОДОБРЕНИЕ', 0, 4);
  signTex = new THREE.CanvasTexture(c);
  signTex.colorSpace = THREE.SRGBColorSpace;
  return signTex;
}
function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

export type Stats = { time: number; kills: number; wave: number; best: { time: number; kills: number } };

export class Game {
  city: City;
  hero: Hero;
  horde: Horde;
  fx: FX;
  arms: Arms;
  state: GameState = 'menu';
  time = 0;
  wave = 1;
  kills = 0;
  slots: (Item | null)[] = new Array(BACKPACK.cols * BACKPACK.rows).fill(null);
  chest: Chest | null = null;
  nextChest = DIRECTOR.chestFirst;
  chestsOpened = 0;
  input = { x: 0, z: 0 };
  cap: number;
  private spawnAcc = 0;
  private bruteT = 0;
  private bossWave = 0;
  boss = -1;
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private overT = 0;
  private groanT = 2;
  /** за тестове: камерата гледа от тук */
  debugCam: { pos: THREE.Vector3; look: THREE.Vector3 } | null = null;
  // към интерфейса
  onHurt?: () => void;
  onBanner?: (text: string, kind?: 'wave' | 'boss' | 'info') => void;
  onPack?: (offers: Item[] | null) => void;
  onOver?: (s: Stats) => void;

  constructor(public engine: Engine) {
    const scene = engine.scene;
    scene.background = new THREE.Color(0xbfd3e6);
    scene.fog = new THREE.Fog(0xbfd3e6, 70, 170);
    this.city = new City(11);
    this.city.buildLinks(HERO.leapGap, HERO.leapUp);
    scene.add(this.city.group);
    this.cap = QUALITY.value === 'high' ? 380 : QUALITY.value === 'medium' ? 260 : 160;
    this.fx = new FX(scene);
    this.horde = new Horde(this.city, scene, this.cap + 30);
    this.hero = new Hero(this.city);
    scene.add(this.hero.root);
    this.arms = new Arms(scene, this.hero, this.horde, this.fx);

    this.hero.onLeap = () => sfx.leap();
    this.hero.onLand = () => sfx.land();
    this.horde.onAttack = (_i, dmg) => {
      if (this.state !== 'play') return;
      if (this.hero.hurt(dmg)) {
        sfx.hurt();
        this.fx.shake = Math.min(1, this.fx.shake + 0.25);
        this.onHurt?.();
      }
    };
    this.horde.onKill = (i) => {
      this.kills++;
      const H = this.horde;
      const big = H.scale[i];
      this.fx.blood(H.x[i], H.y[i], H.z[i], this.floorUnder(H.x[i], H.z[i], H.y[i]), big, H.vx[i] * 0.1, H.vz[i] * 0.1);
      sfx.splat();
      if (i === this.boss) {
        this.boss = -1;
        this.onBanner?.('БОСЪТ ПАДНА!', 'info');
        // награда: сандък веднага до героя
        this.spawnChest(true);
      }
    };
    this.arms.onShot = (k) => sfx.shot(WEAPONS[k].sound);
    this.arms.onExplode = () => sfx.explosion();

    this.camLook.copy(this.hero.pos);
    this.camPos.copy(this.hero.pos).add(new THREE.Vector3(0, 30, 22));
    // за менюто: малко зомбита наоколо
    for (let k = 0; k < 40; k++) this.spawnOne('walker', 1, 10, 30);
    this.arms.setItems([makeItem('pistol', 1), makeItem('smg', 2)]);
    engine.onUpdate((dt, raw) => this.update(dt, raw));
  }

  floorUnder(x: number, z: number, y: number) {
    const b = this.city.buildingAt(x, z);
    return b && b.h <= y + 0.5 ? b.h : 0;
  }

  newGame() {
    this.horde.clear();
    this.fx.clear();
    this.hero.reset();
    const b = this.hero.bld = this.city.buildings.reduce((best, bb) => {
      if (!bb.playable) return best;
      const d = Math.hypot((bb.x0 + bb.x1) / 2 - this.city.center.x, (bb.z0 + bb.z1) / 2 - this.city.center.z);
      const bd = Math.hypot((best.x0 + best.x1) / 2 - this.city.center.x, (best.z0 + best.z1) / 2 - this.city.center.z);
      return d < bd ? bb : best;
    });
    this.hero.pos.set((b.x0 + b.x1) / 2, b.h, (b.z0 + b.z1) / 2);
    this.time = 0;
    this.wave = 1;
    this.kills = 0;
    this.spawnAcc = 0;
    this.bruteT = 0;
    this.bossWave = 0;
    this.boss = -1;
    this.overT = 0;
    this.chestsOpened = 0;
    if (this.chest) { this.engine.scene.remove(this.chest.root); this.chest = null; }
    this.nextChest = DIRECTOR.chestFirst;
    this.slots.fill(null);
    this.slots[4] = makeItem('pistol', 1);
    this.arms.clear();
    this.syncArms();
    for (let k = 0; k < 30; k++) this.spawnOne('walker', 1, 14, 34);
    this.state = 'play';
    this.engine.timeScale = 1;
    this.onBanner?.('ВЪЛНА 1', 'wave');
  }

  syncArms() {
    this.arms.setItems(this.slots.filter((s): s is Item => !!s));
  }

  /** Слага предмет в клетка. Връща 'place' | 'merge' | 'swap' | null. */
  put(item: Item, slot: number, from: number | null): 'place' | 'merge' | 'swap' | null {
    const cur = this.slots[slot];
    if (from === slot) return null;
    if (!cur) {
      this.slots[slot] = item;
      if (from !== null) this.slots[from] = null;
      this.syncArms();
      return 'place';
    }
    if (cur.kind === item.kind && cur.tier === item.tier && cur.tier < MAX_TIER) {
      this.slots[slot] = makeItem(cur.kind, cur.tier + 1);
      if (from !== null) this.slots[from] = null;
      this.syncArms();
      return 'merge';
    }
    if (from !== null) {
      this.slots[from] = cur;
      this.slots[slot] = item;
      this.syncArms();
      return 'swap';
    }
    return null;
  }

  remove(slot: number) {
    this.slots[slot] = null;
    this.syncArms();
  }

  /** Три оръжия за избор от сандъка. */
  makeOffers(): Item[] {
    const t = this.time;
    const offers: Item[] = [];
    const owned = this.slots.filter((s): s is Item => !!s);
    const used = new Set<string>();
    // едно от вече притежаваните — за сливане (като в рекламите)
    if (owned.length && Math.random() < 0.75) {
      const o = owned[Math.floor(Math.random() * owned.length)];
      if (o.tier < MAX_TIER) {
        offers.push(makeItem(o.kind, o.tier));
        used.add(o.kind + o.tier);
      }
    }
    const pool = ALL_WEAPONS.filter((k) => WEAPONS[k].baseTier <= 2 + Math.floor(t / 70) + (this.chestsOpened >= 2 ? 1 : 0));
    let guard = 0;
    while (offers.length < 3 && guard++ < 50) {
      const kind = pool[Math.floor(Math.random() * pool.length)] as WeaponKind;
      let tier = WEAPONS[kind].baseTier;
      if (Math.random() < Math.min(0.35, t / 600)) tier++;
      tier = Math.min(MAX_TIER, tier);
      if (used.has(kind + tier)) continue;
      used.add(kind + tier);
      offers.push(makeItem(kind, tier));
    }
    // първият сандък: винаги втори пистолет (учи на сливане)
    if (this.chestsOpened === 0) offers[0] = makeItem('pistol', 1);
    return offers.sort(() => Math.random() - 0.5);
  }

  openPack(fromChest: boolean) {
    if (this.state !== 'play') return;
    this.state = 'pack';
    this.engine.timeScale = 0;
    this.onPack?.(fromChest ? this.makeOffers() : null);
    if (fromChest) this.chestsOpened++;
  }

  closePack() {
    if (this.state !== 'pack') return;
    this.state = 'play';
    this.engine.timeScale = 1;
  }

  pause(on: boolean) {
    if (on && this.state === 'play') { this.state = 'paused'; this.engine.timeScale = 0; }
    else if (!on && this.state === 'paused') { this.state = 'play'; this.engine.timeScale = 1; }
  }

  private spawnOne(kind: ZombieKind, hpMul: number, dmin = 16, dmax = 38): number {
    const c = this.city;
    const hp = this.hero.pos;
    const tmp = { x: 0, z: 0 };
    for (let tries = 0; tries < 30; tries++) {
      const k = c.walkable[Math.floor(Math.random() * c.walkable.length)];
      c.cellCenter(k, tmp);
      const d = Math.hypot(tmp.x - hp.x, tmp.z - hp.z);
      if (d < dmin || d > dmax) continue;
      return this.horde.spawn(kind, tmp.x + (Math.random() - 0.5) * 0.6, tmp.z + (Math.random() - 0.5) * 0.6, hpMul);
    }
    return -1;
  }

  spawnChest(nearHero = false) {
    // само покриви на 1–2 скока (първият сандък — на съседен покрив)
    const hops = this.city.hops(this.hero.leap ? this.hero.leap.to : this.hero.bld);
    const maxHop = nearHero || this.chestsOpened === 0 ? 1 : 2;
    let cand = this.city.buildings.filter((b) => b.playable && hops[b.i] >= 1 && hops[b.i] <= maxHop);
    if (!nearHero && this.chestsOpened > 0) {
      const far = cand.filter((b) => hops[b.i] === 2);
      if (far.length && Math.random() < 0.6) cand = far;
    }
    const b = cand.length ? cand[Math.floor(Math.random() * cand.length)] : this.hero.bld;
    const x = b.x0 + 2 + Math.random() * (b.x1 - b.x0 - 4);
    const z = b.z0 + 2 + Math.random() * (b.z1 - b.z0 - 4);
    if (this.chest) this.engine.scene.remove(this.chest.root);
    this.chest = new Chest(b, x, z);
    this.engine.scene.add(this.chest.root);
  }

  private director(dt: number) {
    const t = this.time;
    const wave = Math.floor(t / DIRECTOR.waveLength) + 1;
    if (wave !== this.wave) {
      this.wave = wave;
      if (wave % DIRECTOR.bossEvery === 0 && this.bossWave !== wave) {
        this.bossWave = wave;
        this.boss = this.spawnOne('boss', DIRECTOR.hpMul(t), 18, 32);
        this.onBanner?.('БОС!', 'boss');
        sfx.boss();
      } else {
        this.onBanner?.('ВЪЛНА ' + wave, 'wave');
        sfx.wave();
      }
      for (let k = 0; k < 10 + wave * 4; k++) if (this.horde.alive < this.cap) this.spawnOne(Math.random() < DIRECTOR.runnerShare(t) ? 'runner' : 'walker', DIRECTOR.hpMul(t));
    }
    this.spawnAcc += DIRECTOR.spawnRate(t) * dt;
    while (this.spawnAcc >= 1) {
      this.spawnAcc -= 1;
      if (this.horde.alive >= this.cap) { this.spawnAcc = 0; break; }
      this.spawnOne(Math.random() < DIRECTOR.runnerShare(t) ? 'runner' : 'walker', DIRECTOR.hpMul(t));
    }
    if (t > DIRECTOR.bruteFrom) {
      this.bruteT += dt;
      if (this.bruteT > DIRECTOR.bruteEvery) {
        this.bruteT = 0;
        this.spawnOne('brute', DIRECTOR.hpMul(t));
      }
    }
    // сандъци
    if (!this.chest && t >= this.nextChest) this.spawnChest();
    if (this.chest) {
      const c = this.chest;
      const d = Math.hypot(c.x - this.hero.pos.x, c.z - this.hero.pos.z);
      if (d < 1.5 && this.hero.bld === c.b && !this.hero.leap) {
        this.engine.scene.remove(c.root);
        this.chest = null;
        this.nextChest = t + DIRECTOR.chestEvery(t);
        sfx.chest();
        this.fx.flash(new THREE.Vector3(c.x, c.b.h + 1, c.z), 3, 0xffe07a, 0.3);
        this.openPack(true);
      }
    }
  }

  private update(dt: number, raw: number) {
    const playing = this.state === 'play';
    if (playing) {
      this.time += dt;
      this.director(dt);
    }
    // героят (в менюто стои)
    const ix = playing ? this.input.x : 0, iz = playing ? this.input.z : 0;
    this.hero.update(dt, ix, iz);
    this.horde.update(dt, this.hero);
    this.arms.update(dt, this.state !== 'menu' || true);
    this.chest?.update(dt);
    this.fx.update(dt, this.engine.camera);

    if (playing) {
      this.groanT -= dt;
      if (this.groanT < 0) { this.groanT = 1.5 + Math.random() * 3; if (this.arms.threats() > 3) sfx.groan(); }
    }
    if (this.hero.dead && this.state === 'play') {
      this.overT += dt;
      if (this.overT > 1.6) this.gameOver();
    }
    this.updateCamera(raw);
  }

  private gameOver() {
    this.state = 'over';
    sfx.over();
    let best = { time: 0, kills: 0 };
    try { best = JSON.parse(localStorage.getItem('orda-best') || '{"time":0,"kills":0}'); } catch { /* */ }
    const nb = { time: Math.max(best.time, this.time), kills: Math.max(best.kills, this.kills) };
    try { localStorage.setItem('orda-best', JSON.stringify(nb)); } catch { /* */ }
    this.onOver?.({ time: this.time, kills: this.kills, wave: this.wave, best });
  }

  private updateCamera(raw: number) {
    const cam = this.engine.camera;
    if (this.debugCam) {
      cam.position.copy(this.debugCam.pos);
      cam.lookAt(this.debugCam.look);
      this.engine.followShadow(this.debugCam.look, 20);
      return;
    }
    const portrait = innerWidth < innerHeight;
    const menu = this.state === 'menu';
    const off = menu ? new THREE.Vector3(8, 26, 20) : portrait ? new THREE.Vector3(0, 21, 8.5) : new THREE.Vector3(0, 15.5, 6.8);
    const target = this.hero.pos;
    const k = 1 - Math.exp(-raw * (menu ? 1.5 : 6));
    this.camLook.lerp(target, k);
    if (menu) {
      const a = performance.now() / 9000;
      off.set(Math.sin(a) * 22, 24, Math.cos(a) * 22);
    }
    this.camPos.copy(this.camLook).add(off);
    cam.position.copy(this.camPos);
    if (this.fx.shake > 0) {
      const s = this.fx.shake * 0.35;
      cam.position.x += (Math.random() - 0.5) * s;
      cam.position.y += (Math.random() - 0.5) * s;
      cam.position.z += (Math.random() - 0.5) * s;
    }
    cam.lookAt(this.camLook.x, this.camLook.y + 0.4, this.camLook.z - 0.6);
    this.engine.followShadow(this.camLook, portrait ? 34 : 30);
  }

  /** За теста и бележките. */
  stats() {
    const r = this.engine.renderer.info.render;
    return { fps: Math.round(this.engine.fps), calls: r.calls, tris: r.triangles, zombies: this.horde.alive, t: Math.round(this.time), kills: this.kills, hp: Math.round(this.hero.hp), arms: this.arms.arms.length, state: this.state };
  }
}

export { ZS };
