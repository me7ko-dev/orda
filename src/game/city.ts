import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { cloneModel, fitModel } from '../engine/assets';
import { QUALITY } from '../engine/engine';

/** Сграда: правоъгълник x0..x1, z0..z1 и височина h. */
export type Building = { i: number; x0: number; z0: number; x1: number; z1: number; h: number; playable: boolean; style: number };
export type Rect = { x0: number; z0: number; x1: number; z1: number };

export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FLOOR = 3; // височина на етаж (м)
const PARAPET_H = 0.55;
const PARAPET_T = 0.28;

/** Цветове на фасадите */
const STYLES = [
  { wall: '#d9dde2', trim: '#f4f5f6', glass: ['#2e4a66', '#6f93b5'], kind: 'plain' },
  { wall: '#c3ccd6', trim: '#eef1f4', glass: ['#29425c', '#6a8db0'], kind: 'plain' },
  { wall: '#e9e4da', trim: '#ffffff', glass: ['#334a5e', '#7896ae'], kind: 'plain' },
  { wall: '#9eaebf', trim: '#e4e9ee', glass: ['#223548', '#5b7d9c'], kind: 'band' },
  { wall: '#b8664f', trim: '#efe6dc', glass: ['#2b3d50', '#6b8aa6'], kind: 'brick' },
  { wall: '#d6c7ad', trim: '#f6efe2', glass: ['#30475b', '#7795ad'], kind: 'band' },
  { wall: '#6d7a88', trim: '#c9d2db', glass: ['#1d2c3b', '#4f6f8c'], kind: 'band' },
];

function noise(ctx: CanvasRenderingContext2D, w: number, h: number, amt: number, r: () => number) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() - 0.5) * amt;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
}

function facadeTexture(si: number, ground: boolean): THREE.CanvasTexture {
  const st = STYLES[si];
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const r = rng(si * 31 + (ground ? 7 : 1));
  g.fillStyle = st.wall;
  g.fillRect(0, 0, S, S);
  if (st.kind === 'brick') {
    g.strokeStyle = 'rgba(70,30,20,0.35)';
    g.lineWidth = 1;
    for (let y = 0; y < S; y += 6) {
      g.beginPath(); g.moveTo(0, y); g.lineTo(S, y); g.stroke();
      for (let x = (y / 6) % 2 ? 0 : 7; x < S; x += 14) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 6); g.stroke(); }
    }
  }
  if (st.kind === 'band') {
    g.fillStyle = 'rgba(0,0,0,0.09)';
    g.fillRect(0, 0, S, 14);
  }
  // плоча между етажите
  g.fillStyle = 'rgba(0,0,0,0.12)';
  g.fillRect(0, 0, S, 4);
  g.fillStyle = 'rgba(255,255,255,0.18)';
  g.fillRect(0, 4, S, 2);
  noise(g, S, S, 10, r);

  if (ground) {
    // приземен етаж: витрина/врата
    const x0 = 10, x1 = S - 10, y0 = 22, y1 = S;
    g.fillStyle = st.trim;
    g.fillRect(x0 - 4, y0 - 4, x1 - x0 + 8, y1 - y0 + 4);
    const gr = g.createLinearGradient(0, y0, 0, y1);
    gr.addColorStop(0, st.glass[1]);
    gr.addColorStop(1, st.glass[0]);
    g.fillStyle = gr;
    g.fillRect(x0, y0, x1 - x0, y1 - y0);
    g.fillStyle = 'rgba(255,255,255,0.12)';
    g.beginPath(); g.moveTo(x0, y1); g.lineTo(x0 + 30, y0); g.lineTo(x0 + 48, y0); g.lineTo(x0 + 18, y1); g.fill();
    // тента
    g.fillStyle = ['#c0392b', '#2e86c1', '#27ae60', '#d68910'][si % 4];
    g.fillRect(x0 - 6, y0 - 12, x1 - x0 + 12, 9);
  } else {
    // прозорец
    const x0 = 30, x1 = S - 30, y0 = 30, y1 = S - 26;
    g.fillStyle = 'rgba(0,0,0,0.18)';
    g.fillRect(x0 - 3, y1 + 2, x1 - x0 + 6, 6); // перваз-сянка
    g.fillStyle = st.trim;
    g.fillRect(x0 - 5, y0 - 5, x1 - x0 + 10, y1 - y0 + 10);
    g.fillRect(x0 - 8, y1 + 2, x1 - x0 + 16, 5); // перваз
    const gr = g.createLinearGradient(x0, y0, x1, y1);
    gr.addColorStop(0, st.glass[1]);
    gr.addColorStop(0.55, st.glass[0]);
    gr.addColorStop(1, st.glass[0]);
    g.fillStyle = gr;
    g.fillRect(x0, y0, x1 - x0, y1 - y0);
    g.fillStyle = 'rgba(255,255,255,0.16)';
    g.beginPath(); g.moveTo(x0, y0 + 30); g.lineTo(x0 + 22, y0); g.lineTo(x0 + 34, y0); g.lineTo(x0, y0 + 44); g.fill();
    g.fillStyle = st.trim;
    g.fillRect((x0 + x1) / 2 - 2, y0, 4, y1 - y0);
    g.fillRect(x0, y0 + (y1 - y0) * 0.38, x1 - x0, 3);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

function roofTexture(): THREE.CanvasTexture {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  g.fillStyle = '#a2a8b0';
  g.fillRect(0, 0, S, S);
  const r = rng(5);
  noise(g, S, S, 16, r);
  g.strokeStyle = 'rgba(0,0,0,0.13)';
  g.lineWidth = 2;
  g.strokeRect(1, 1, S - 2, S - 2);
  g.strokeStyle = 'rgba(255,255,255,0.25)';
  g.lineWidth = 1;
  g.strokeRect(3, 3, S - 6, S - 6);
  // петна
  for (let i = 0; i < 5; i++) {
    g.fillStyle = `rgba(80,80,80,${0.03 + r() * 0.05})`;
    g.beginPath();
    g.arc(r() * S, r() * S, 8 + r() * 22, 0, 7);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

function asphaltTexture(): THREE.CanvasTexture {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  g.fillStyle = '#7d8187';
  g.fillRect(0, 0, S, S);
  const r = rng(9);
  noise(g, S, S, 22, r);
  for (let i = 0; i < 6; i++) {
    g.fillStyle = `rgba(40,40,45,${0.015 + r() * 0.025})`;
    g.beginPath();
    g.arc(r() * S, r() * S, 20 + r() * 50, 0, 7);
    g.fill();
  }
  // пукнатини
  g.strokeStyle = 'rgba(30,30,34,0.35)';
  g.lineWidth = 1;
  for (let i = 0; i < 5; i++) {
    let x = r() * S, y = r() * S;
    g.beginPath();
    g.moveTo(x, y);
    for (let k = 0; k < 6; k++) { x += (r() - 0.5) * 30; y += (r() - 0.5) * 30; g.lineTo(x, y); }
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/** Стените на кутия (без горе/долу) с UV в етажи. */
function wallGeometry(b: Rect, y0: number, y1: number): THREE.BufferGeometry {
  const pos: number[] = [], nrm: number[] = [], uv: number[] = [], idx: number[] = [];
  const quad = (ax: number, az: number, bx: number, bz: number, nx: number, nz: number) => {
    const len = Math.hypot(bx - ax, bz - az);
    const i = pos.length / 3;
    const bays = Math.max(1, Math.round(len / 3));
    const uMax = bays;
    pos.push(ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y1, az);
    for (let k = 0; k < 4; k++) nrm.push(nx, 0, nz);
    uv.push(0, y0 / FLOOR, uMax, y0 / FLOOR, uMax, y1 / FLOOR, 0, y1 / FLOOR);
    idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
  };
  quad(b.x0, b.z1, b.x1, b.z1, 0, 1);
  quad(b.x1, b.z1, b.x1, b.z0, 1, 0);
  quad(b.x1, b.z0, b.x0, b.z0, 0, -1);
  quad(b.x0, b.z0, b.x0, b.z1, -1, 0);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

function boxAt(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return g;
}

function planeXZ(r: Rect, y: number, uvScale: number) {
  const g = new THREE.PlaneGeometry(r.x1 - r.x0, r.z1 - r.z0);
  g.rotateX(-Math.PI / 2);
  g.translate((r.x0 + r.x1) / 2, y, (r.z0 + r.z1) / 2);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getX(i) / uvScale, p.getZ(i) / uvScale);
  return g;
}

/** Събира статичните модели по материал и ги слепва (по-малко рисувания). */
class StaticBatch {
  groups = new Map<THREE.Material, THREE.BufferGeometry[]>();
  add(o: THREE.Object3D) {
    o.updateMatrixWorld(true);
    o.traverse((c) => {
      const m = c as THREE.Mesh;
      if (!m.isMesh) return;
      const mat = Array.isArray(m.material) ? m.material[0] : m.material;
      let g = m.geometry.clone();
      g.applyMatrix4(m.matrixWorld);
      // само общите атрибути, за да могат да се слепят
      const keep = ['position', 'normal', 'uv'];
      for (const k of Object.keys(g.attributes)) if (!keep.includes(k)) g.deleteAttribute(k);
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      if (!g.attributes.normal) g.computeVertexNormals();
      if (g.index) g = g.toNonIndexed();
      const arr = this.groups.get(mat) ?? [];
      arr.push(g);
      this.groups.set(mat, arr);
    });
  }
  build(parent: THREE.Object3D) {
    for (const [mat, list] of this.groups) {
      const g = mergeGeometries(list, false);
      if (!g) continue;
      const mesh = new THREE.Mesh(g, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parent.add(mesh);
    }
    this.groups.clear();
  }
}

export class City {
  group = new THREE.Group();
  buildings: Building[] = [];
  /** препятствия по улиците (коли, кофи) */
  obstacles: Rect[] = [];
  bounds: Rect;
  /** решетка за пътя на зомбитата */
  cell = 1;
  gw: number;
  gh: number;
  blocked: Uint8Array;
  walkable: number[] = [];
  center = new THREE.Vector3();
  /** горящи коли и пожари (за ефектите) */
  fires: { x: number; y: number; z: number; s: number }[] = [];
  /** препятствия по покривите (кулички, капандури, климатици) — героят и зомбитата ги заобикалят */
  roofBlocks: (Rect & { b: number })[] = [];
  /** места за червените бъчви */
  barrelSpots: { x: number; y: number; z: number }[] = [];

  constructor(seed = 7) {
    const r = rng(seed);
    const N = 6;
    // ширини на парцелите и празнините (улички) между тях
    const ws: number[] = [], ds: number[] = [], gx: number[] = [], gz: number[] = [];
    for (let i = 0; i < N; i++) {
      ws.push(10 + Math.round(r() * 5));
      ds.push(10 + Math.round(r() * 5));
      gx.push(2.8 + Math.round(r() * 4) * 0.5);
      gz.push(2.8 + Math.round(r() * 4) * 0.5);
    }
    const totalW = ws.reduce((a, b) => a + b, 0) + gx.slice(0, N - 1).reduce((a, b) => a + b, 0);
    const totalD = ds.reduce((a, b) => a + b, 0) + gz.slice(0, N - 1).reduce((a, b) => a + b, 0);
    const xs: number[] = [], zs: number[] = [];
    let x = -totalW / 2;
    for (let i = 0; i < N; i++) { xs.push(x); x += ws[i] + gx[i]; }
    let z = -totalD / 2;
    for (let j = 0; j < N; j++) { zs.push(z); z += ds[j] + gz[j]; }

    // обединени парцели (по-големи сгради)
    const owner: number[][] = [];
    for (let i = 0; i < N; i++) owner.push(new Array(N).fill(-1));
    const lots: { i0: number; j0: number; i1: number; j1: number }[] = [];
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        if (owner[i][j] >= 0) continue;
        let i1 = i, j1 = j;
        const roll = r();
        if (roll < 0.16 && i + 1 < N && owner[i + 1][j] < 0) i1 = i + 1;
        else if (roll < 0.3 && j + 1 < N) j1 = j + 1;
        for (let a = i; a <= i1; a++) for (let b = j; b <= j1; b++) owner[a][b] = lots.length;
        lots.push({ i0: i, j0: j, i1, j1 });
      }

    for (const L of lots) {
      const b: Building = {
        i: this.buildings.length,
        x0: xs[L.i0], x1: xs[L.i1] + ws[L.i1],
        z0: zs[L.j0], z1: zs[L.j1] + ds[L.j1],
        h: 0, playable: true, style: Math.floor(r() * 4) === 0 ? 3 + Math.floor(r() * 4) : Math.floor(r() * 3),
      };
      this.buildings.push(b);
    }

    // височини: случайни, но съседите се различават с най-много 3 м (за да може да се скача нагоре)
    const steps = [6, 7.5, 9, 10.5, 12];
    for (const b of this.buildings) b.h = steps[Math.floor(r() * steps.length)];
    const adj = (a: Building, b: Building) => {
      const gapX = Math.max(a.x0 - b.x1, b.x0 - a.x1);
      const gapZ = Math.max(a.z0 - b.z1, b.z0 - a.z1);
      return (gapX < 7 && gapZ < -2) || (gapZ < 7 && gapX < -2);
    };
    for (let it = 0; it < 30; it++) {
      let changed = false;
      for (const a of this.buildings)
        for (const b of this.buildings) {
          if (a === b || !adj(a, b)) continue;
          if (a.h - b.h > 3) { a.h = b.h + 3; changed = true; }
        }
      if (!changed) break;
    }
    // героят започва в средата — там сградата да е средна
    const mid = this.buildings.reduce((best, b) => {
      const d = Math.hypot((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2);
      const bd = Math.hypot((best.x0 + best.x1) / 2, (best.z0 + best.z1) / 2);
      return d < bd ? b : best;
    });
    this.center.set((mid.x0 + mid.x1) / 2, mid.h, (mid.z0 + mid.z1) / 2);

    // широка улица наоколо, после високи сгради за фон
    const ring = 13;
    this.bounds = { x0: -totalW / 2 - ring, x1: totalW / 2 + ring, z0: -totalD / 2 - ring, z1: totalD / 2 + ring };
    const B = this.bounds;
    const back = (x0: number, z0: number, x1: number, z1: number) => {
      this.buildings.push({ i: this.buildings.length, x0, z0, x1, z1, h: 15 + Math.round(r() * 4) * 3, playable: false, style: Math.floor(r() * STYLES.length) });
    };
    for (let k = B.x0 - 6; k < B.x1 + 6; ) {
      const w = 12 + r() * 10;
      back(k, B.z0 - 22, Math.min(k + w, B.x1 + 26), B.z0);
      back(k, B.z1, Math.min(k + w, B.x1 + 26), B.z1 + 22);
      k += w + 1.5;
    }
    for (let k = B.z0; k < B.z1; ) {
      const w = 12 + r() * 10;
      back(B.x0 - 22, k, B.x0, Math.min(k + w, B.z1));
      back(B.x1, k, B.x1 + 22, Math.min(k + w, B.z1));
      k += w + 1.5;
    }

    // решетка
    this.gw = Math.ceil((B.x1 - B.x0) / this.cell);
    this.gh = Math.ceil((B.z1 - B.z0) / this.cell);
    this.blocked = new Uint8Array(this.gw * this.gh);

    this.buildMeshes(r);
    this.rasterize();
  }

  private buildMeshes(r: () => number) {
    const facades = STYLES.map((_, i) => new THREE.MeshStandardMaterial({ map: facadeTexture(i, false), roughness: 0.85, metalness: 0 }));
    const grounds = STYLES.map((_, i) => new THREE.MeshStandardMaterial({ map: facadeTexture(i, true), roughness: 0.8, metalness: 0 }));
    const roofMat = new THREE.MeshStandardMaterial({ map: roofTexture(), roughness: 0.95 });
    const parapetMat = new THREE.MeshStandardMaterial({ color: 0xc4cad1, roughness: 0.8 });
    const walls: THREE.BufferGeometry[][] = STYLES.map(() => []);
    const gwalls: THREE.BufferGeometry[][] = STYLES.map(() => []);
    const roofs: THREE.BufferGeometry[] = [];
    const parapets: THREE.BufferGeometry[] = [];

    for (const b of this.buildings) {
      gwalls[b.style].push(wallGeometry(b, 0, FLOOR));
      walls[b.style].push(wallGeometry(b, FLOOR, b.h));
      roofs.push(planeXZ(b, b.h, 2.5));
      const t = PARAPET_T, ph = b.h + PARAPET_H;
      parapets.push(boxAt(b.x0, b.h - 0.25, b.z0, b.x1, ph, b.z0 + t));
      parapets.push(boxAt(b.x0, b.h - 0.25, b.z1 - t, b.x1, ph, b.z1));
      parapets.push(boxAt(b.x0, b.h - 0.25, b.z0 + t, b.x0 + t, ph, b.z1 - t));
      parapets.push(boxAt(b.x1 - t, b.h - 0.25, b.z0 + t, b.x1, ph, b.z1 - t));
      // корниз
      parapets.push(boxAt(b.x0 - 0.12, b.h - 0.55, b.z0 - 0.12, b.x1 + 0.12, b.h - 0.3, b.z1 + 0.12));
    }
    const add = (g: THREE.BufferGeometry | null, m: THREE.Material, cast = true) => {
      if (!g) return;
      const mesh = new THREE.Mesh(g, m);
      mesh.castShadow = cast;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    };
    walls.forEach((list, i) => list.length && add(mergeGeometries(list), facades[i]));
    gwalls.forEach((list, i) => list.length && add(mergeGeometries(list), grounds[i]));
    add(mergeGeometries(roofs), roofMat, false);
    add(mergeGeometries(parapets), parapetMat);

    // земя: асфалт + тротоари около сградите + маркировка
    const B = this.bounds;
    const ground = planeXZ({ x0: B.x0 - 60, z0: B.z0 - 60, x1: B.x1 + 60, z1: B.z1 + 60 }, 0, 9);
    add(ground, new THREE.MeshStandardMaterial({ map: asphaltTexture(), roughness: 0.95 }), false);
    const walks: THREE.BufferGeometry[] = [];
    for (const b of this.buildings) {
      const w = 1.3;
      walks.push(boxAt(b.x0 - w, 0, b.z0 - w, b.x1 + w, 0.12, b.z1 + w));
    }
    add(mergeGeometries(walks), new THREE.MeshStandardMaterial({ color: 0xb4b7bb, roughness: 0.9 }), false);
    const lines: THREE.BufferGeometry[] = [];
    const ringMid = 13 / 2 + 1.3 / 2;
    for (let x = B.x0 + 2; x < B.x1 - 2; x += 4) {
      lines.push(boxAt(x, 0.01, B.z0 + ringMid - 0.08, x + 2, 0.025, B.z0 + ringMid + 0.08));
      lines.push(boxAt(x, 0.01, B.z1 - ringMid - 0.08, x + 2, 0.025, B.z1 - ringMid + 0.08));
    }
    for (let z = B.z0 + 2; z < B.z1 - 2; z += 4) {
      lines.push(boxAt(B.x0 + ringMid - 0.08, 0.01, z, B.x0 + ringMid + 0.08, 0.025, z + 2));
      lines.push(boxAt(B.x1 - ringMid - 0.08, 0.01, z, B.x1 - ringMid + 0.08, 0.025, z + 2));
    }
    add(mergeGeometries(lines), new THREE.MeshStandardMaterial({ color: 0xf2f0e6, roughness: 0.7 }), false);

    // неща по покривите
    const batch = new StaticBatch();
    const roofProps: [string, number, number][] = [
      ['ac', 1.1, 0.5], ['ac_double', 1.6, 0.5], ['vent', 1.0, 0.4], ['dish', 1.4, 0.3], ['antenna', 2.6, 0.2], ['watertank', 2.2, 0.15], ['watertower', 4.2, 0.18],
    ];
    const place = (name: string, size: number, x: number, y: number, z: number, rot: number, by: 'height' | 'max' = 'height', block?: Building) => {
      const o = fitModel(cloneModel(name), size, by);
      o.position.set(x, y, z);
      o.rotation.y = rot;
      batch.add(o);
      if (block) {
        const bb = new THREE.Box3().setFromObject(o);
        this.roofBlocks.push({ x0: bb.min.x, z0: bb.min.z, x1: bb.max.x, z1: bb.max.z, b: block.i });
      }
    };
    // кулички на стълбища, капандури и слънчеви панели (направени от кутии)
    const hutWall = new THREE.MeshStandardMaterial({ color: 0xc9cdd3, roughness: 0.85 });
    const hutTop = new THREE.MeshStandardMaterial({ color: 0x8d949c, roughness: 0.9 });
    const doorMat = new THREE.MeshStandardMaterial({ color: 0x3b4a5a, roughness: 0.6 });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x5f8db5, roughness: 0.15, metalness: 0.6 });
    const frameMat = new THREE.MeshStandardMaterial({ color: 0xe4e7ea, roughness: 0.6 });
    const panelMat = new THREE.MeshStandardMaterial({ color: 0x1d3557, roughness: 0.25, metalness: 0.5 });
    const gHut: THREE.BufferGeometry[] = [], gTop: THREE.BufferGeometry[] = [], gDoor: THREE.BufferGeometry[] = [], gGlass: THREE.BufferGeometry[] = [], gFrame: THREE.BufferGeometry[] = [], gPanel: THREE.BufferGeometry[] = [];
    const block = (b: Building, x0: number, z0: number, x1: number, z1: number) => this.roofBlocks.push({ x0, z0, x1, z1, b: b.i });
    for (const b of this.buildings) {
      if (!b.playable) continue;
      const w = b.x1 - b.x0, d = b.z1 - b.z0, area = w * d;
      // куличка в ъгъла
      if (area > 120 && r() < 0.75) {
        const cx = r() < 0.5 ? b.x0 + 2.2 : b.x1 - 2.2, cz = r() < 0.5 ? b.z0 + 2.0 : b.z1 - 2.0;
        gHut.push(boxAt(cx - 1.3, b.h, cz - 1.1, cx + 1.3, b.h + 2.3, cz + 1.1));
        gTop.push(boxAt(cx - 1.45, b.h + 2.3, cz - 1.25, cx + 1.45, b.h + 2.45, cz + 1.25));
        const dz = cz < (b.z0 + b.z1) / 2 ? cz + 1.11 : cz - 1.12;
        gDoor.push(boxAt(cx - 0.45, b.h, dz - 0.01, cx + 0.45, b.h + 1.9, dz + 0.01));
        block(b, cx - 1.3, cz - 1.1, cx + 1.3, cz + 1.1);
      }
      // капандури (стъклени)
      const nSky = area > 150 ? 1 + Math.floor(r() * 2) : r() < 0.5 ? 1 : 0;
      for (let k = 0; k < nSky; k++) {
        const cx = b.x0 + 3 + r() * (w - 6), cz = b.z0 + 3 + r() * (d - 6);
        const along = r() < 0.5;
        const hx = along ? 1.6 : 0.9, hz = along ? 0.9 : 1.6;
        gFrame.push(boxAt(cx - hx, b.h, cz - hz, cx + hx, b.h + 0.35, cz + hz));
        gGlass.push(boxAt(cx - hx + 0.12, b.h + 0.35, cz - hz + 0.12, cx + hx - 0.12, b.h + 0.6, cz + hz - 0.12));
        block(b, cx - hx, cz - hz, cx + hx, cz + hz);
      }
      // слънчеви панели (ред)
      if (area > 140 && r() < 0.45) {
        const cz = r() < 0.5 ? b.z0 + 2.6 : b.z1 - 2.6;
        const x0 = b.x0 + 3, x1 = b.x1 - 3;
        for (let x = x0; x < x1 - 1.2; x += 1.5) {
          const g = new THREE.BoxGeometry(1.3, 0.06, 1.8);
          g.rotateX(-0.45);
          g.translate(x + 0.65, b.h + 0.6, cz);
          gPanel.push(g);
          gFrame.push(boxAt(x + 0.6, b.h, cz - 0.05, x + 0.7, b.h + 0.55, cz + 0.05));
        }
        block(b, x0, cz - 0.9, x1, cz + 0.9);
      }
    }
    for (const [list, mat] of [[gHut, hutWall], [gTop, hutTop], [gDoor, doorMat], [gGlass, glassMat], [gFrame, frameMat], [gPanel, panelMat]] as const) {
      if (!list.length) continue;
      const nonIdx = list.map((g) => (g.index ? g.toNonIndexed() : g));
      add(mergeGeometries(nonIdx), mat);
    }
    for (const b of this.buildings) {
      if (!b.playable && r() < 0.5) continue;
      const n = b.playable ? 2 + Math.floor(r() * 3) + Math.floor(((b.x1 - b.x0) * (b.z1 - b.z0)) / 90) : 1 + Math.floor(r() * 2);
      for (let k = 0; k < n; k++) {
        let pick = roofProps[Math.floor(r() * roofProps.length)];
        if (pick[0] === 'watertower' && (b.x1 - b.x0 < 12 || r() < 0.5)) pick = roofProps[0];
        // близо до ръба, за да има място за бягане
        const side = Math.floor(r() * 4);
        const m = 1.4;
        let px = b.x0 + m + r() * (b.x1 - b.x0 - 2 * m);
        let pz = b.z0 + m + r() * (b.z1 - b.z0 - 2 * m);
        if (side === 0) pz = b.z0 + m; else if (side === 1) pz = b.z1 - m; else if (side === 2) px = b.x0 + m; else px = b.x1 - m;
        const rot = side < 2 ? 0 : Math.PI / 2;
        place(pick[0], pick[1], px, b.h, pz, rot + (r() < 0.5 ? Math.PI : 0), 'height', b.playable ? b : undefined);
      }
    }

    // улицата: коли, кофи, конуси, лампи
    const cars = ['car_sport', 'car_hatch', 'car_police', 'car_sport2', 'car_sedan'];
    const ringIn = 1.3 + 1.6; // разстояние от тротоара
    const charred = new THREE.MeshStandardMaterial({ color: 0x2b2725, roughness: 1, metalness: 0.2 });
    const carAt = (x: number, z: number, along: 'x' | 'z') => {
      const o = fitModel(cloneModel(cars[Math.floor(r() * cars.length)]), 4.3, 'max');
      o.position.set(x, 0, z);
      o.rotation.y = (along === 'x' ? Math.PI / 2 : 0) + (r() < 0.5 ? Math.PI : 0);
      // някои коли горят (апокалипсис)
      if (r() < 0.22) {
        o.traverse((c) => { if ((c as THREE.Mesh).isMesh) (c as THREE.Mesh).material = charred; });
        this.fires.push({ x, y: 0.9, z, s: 1.1 });
      }
      batch.add(o);
      const hw = along === 'x' ? 2.2 : 1.0, hd = along === 'x' ? 1.0 : 2.2;
      this.obstacles.push({ x0: x - hw, z0: z - hd, x1: x + hw, z1: z + hd });
    };
    for (let x = B.x0 + 8; x < B.x1 - 8; x += 6 + r() * 9) {
      if (r() < 0.55) carAt(x, B.z0 + 13 - ringIn, 'x');
      if (r() < 0.55) carAt(x + 3, B.z1 - 13 + ringIn, 'x');
    }
    for (let z = B.z0 + 10; z < B.z1 - 10; z += 6 + r() * 9) {
      if (r() < 0.55) carAt(B.x0 + 13 - ringIn, z, 'z');
      if (r() < 0.55) carAt(B.x1 - 13 + ringIn, z + 3, 'z');
    }
    // лампи по тротоара
    for (let x = B.x0 + 6; x < B.x1; x += 16) {
      place('streetlight', 5.5, x, 0, B.z0 + 13 - 0.6, Math.PI / 2);
      place('streetlight', 5.5, x, 0, B.z1 - 13 + 0.6, -Math.PI / 2);
    }
    // кофи и боклук в уличките
    for (const b of this.buildings) {
      if (!b.playable || r() < 0.45) continue;
      const side = Math.floor(r() * 2);
      const x = side ? b.x1 + 0.9 : b.x0 + 2 + r() * (b.x1 - b.x0 - 4);
      const z = side ? b.z0 + 2 + r() * (b.z1 - b.z0 - 4) : b.z1 + 0.9;
      if (r() < 0.5) {
        place('dumpster', 1.4, x, 0, z, side ? Math.PI / 2 : 0);
        this.obstacles.push({ x0: x - 0.8, z0: z - 0.8, x1: x + 0.8, z1: z + 0.8 });
        if (r() < 0.35) this.fires.push({ x, y: 1.3, z, s: 0.75 });
      } else place('trashbags', 0.8, x, 0, z, r() * 6);
    }
    // пожари по високите сгради отзад (дим в далечината)
    for (const b of this.buildings) if (!b.playable && r() < 0.12) this.fires.push({ x: (b.x0 + b.x1) / 2, y: b.h + 0.5, z: (b.z0 + b.z1) / 2, s: 1.6 });
    // червени бъчви: в уличките до сградите и по ъглите на покривите
    for (const b of this.buildings) {
      if (!b.playable) continue;
      if (r() < 0.7) {
        const side = Math.floor(r() * 4);
        const t = 0.2 + r() * 0.6;
        const x = side < 2 ? b.x0 + (b.x1 - b.x0) * t : side === 2 ? b.x0 - 0.8 : b.x1 + 0.8;
        const z = side < 2 ? (side === 0 ? b.z0 - 0.8 : b.z1 + 0.8) : b.z0 + (b.z1 - b.z0) * t;
        this.barrelSpots.push({ x, y: 0, z });
      }
      if (r() < 0.35) {
        const cx = r() < 0.5 ? b.x0 + 1.1 : b.x1 - 1.1, cz = r() < 0.5 ? b.z0 + 1.1 : b.z1 - 1.1;
        this.barrelSpots.push({ x: cx, y: b.h, z: cz });
      }
    }
    for (let k = 0; k < 10; k++) {
      const x = B.x0 + 4 + r() * (B.x1 - B.x0 - 8);
      const z = r() < 0.5 ? B.z0 + 3 + r() * 6 : B.z1 - 3 - r() * 6;
      place(r() < 0.6 ? 'cone' : 'barrier', r() < 0.6 ? 0.75 : 1.1, x, 0, z, r() * 6);
    }
    batch.build(this.group);
    if (QUALITY.value === 'low') this.group.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = false; });
  }

  /** Решетката: къде могат да ходят зомбитата. */
  private rasterize() {
    const B = this.bounds;
    const mark = (rc: Rect, pad: number) => {
      const i0 = Math.max(0, Math.floor((rc.x0 - pad - B.x0) / this.cell));
      const i1 = Math.min(this.gw - 1, Math.floor((rc.x1 + pad - B.x0) / this.cell));
      const j0 = Math.max(0, Math.floor((rc.z0 - pad - B.z0) / this.cell));
      const j1 = Math.min(this.gh - 1, Math.floor((rc.z1 + pad - B.z0) / this.cell));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) this.blocked[j * this.gw + i] = 1;
    };
    for (const b of this.buildings) mark(b, 0.1);
    for (const o of this.obstacles) mark(o, 0);
    // краищата на картата са затворени
    for (let i = 0; i < this.gw; i++) { this.blocked[i] = 1; this.blocked[(this.gh - 1) * this.gw + i] = 1; }
    for (let j = 0; j < this.gh; j++) { this.blocked[j * this.gw] = 1; this.blocked[j * this.gw + this.gw - 1] = 1; }
    for (let k = 0; k < this.blocked.length; k++) if (!this.blocked[k]) this.walkable.push(k);
  }

  cellOf(x: number, z: number) {
    const i = Math.floor((x - this.bounds.x0) / this.cell), j = Math.floor((z - this.bounds.z0) / this.cell);
    if (i < 0 || j < 0 || i >= this.gw || j >= this.gh) return -1;
    return j * this.gw + i;
  }
  cellCenter(k: number, out: { x: number; z: number }) {
    out.x = this.bounds.x0 + ((k % this.gw) + 0.5) * this.cell;
    out.z = this.bounds.z0 + (Math.floor(k / this.gw) + 0.5) * this.cell;
    return out;
  }

  /** Поле „накъде е най-близо до сградата“ (BFS от клетките около нея). */
  flowTo(b: Building, dist: Int32Array) {
    dist.fill(0x3fffffff);
    const q = new Int32Array(this.gw * this.gh);
    let qh = 0, qt = 0;
    const B = this.bounds;
    const i0 = Math.max(1, Math.floor((b.x0 - 1.6 - B.x0) / this.cell)), i1 = Math.min(this.gw - 2, Math.floor((b.x1 + 1.6 - B.x0) / this.cell));
    const j0 = Math.max(1, Math.floor((b.z0 - 1.6 - B.z0) / this.cell)), j1 = Math.min(this.gh - 2, Math.floor((b.z1 + 1.6 - B.z0) / this.cell));
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const k = j * this.gw + i;
        if (!this.blocked[k]) { dist[k] = 0; q[qt++] = k; }
      }
    const gw = this.gw;
    while (qh < qt) {
      const k = q[qh++];
      const d = dist[k] + 1;
      const n4 = [k - 1, k + 1, k - gw, k + gw];
      for (const n of n4) {
        if (n < 0 || n >= dist.length || this.blocked[n] || dist[n] <= d) continue;
        dist[n] = d;
        q[qt++] = n;
      }
    }
  }

  private blockIdx: (Rect & { b: number })[][] | null = null;
  /** Препятствията на даден покрив. */
  blocksOf(bi: number) {
    if (!this.blockIdx) {
      this.blockIdx = this.buildings.map(() => []);
      for (const k of this.roofBlocks) this.blockIdx[k.b].push(k);
    }
    return this.blockIdx[bi];
  }

  /** Покриви, до които се стига с един скок (от → към). */
  links: number[][] = [];
  buildLinks(leapGap: number, leapUp: number) {
    this.links = this.buildings.map(() => []);
    for (const a of this.buildings) {
      if (!a.playable) continue;
      for (const b of this.buildings) {
        if (a === b || !b.playable || b.h - a.h > leapUp) continue;
        const gx = Math.max(a.x0 - b.x1, b.x0 - a.x1, 0);
        const gz = Math.max(a.z0 - b.z1, b.z0 - a.z1, 0);
        if (Math.hypot(gx, gz) <= leapGap) this.links[a.i].push(b.i);
      }
    }
  }
  /** Брой скокове от покрив до всички покриви (BFS); -1 = недостъпен. */
  hops(from: Building): Int16Array {
    const d = new Int16Array(this.buildings.length).fill(-1);
    d[from.i] = 0;
    const q = [from.i];
    while (q.length) {
      const a = q.shift()!;
      for (const b of this.links[a]) if (d[b] < 0) { d[b] = d[a] + 1; q.push(b); }
    }
    return d;
  }
  /** Следващият покрив по най-краткия път (за робота-тестер и стрелката). */
  nextRoof(from: Building, to: Building): Building | null {
    const prev = new Int16Array(this.buildings.length).fill(-1);
    prev[from.i] = from.i;
    const q = [from.i];
    while (q.length) {
      const a = q.shift()!;
      if (a === to.i) break;
      for (const b of this.links[a]) if (prev[b] < 0) { prev[b] = a; q.push(b); }
    }
    if (prev[to.i] < 0) return null;
    let c = to.i;
    while (prev[c] !== from.i && c !== from.i) c = prev[c];
    return this.buildings[c];
  }

  buildingAt(x: number, z: number, pad = 0): Building | null {
    for (const b of this.buildings) if (x >= b.x0 - pad && x <= b.x1 + pad && z >= b.z0 - pad && z <= b.z1 + pad) return b;
    return null;
  }
}
