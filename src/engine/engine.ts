import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export type Quality = 'low' | 'medium' | 'high';

export const IS_TOUCH = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

function detectQuality(): Quality {
  let saved: string | null = null;
  try { saved = localStorage.getItem('orda-quality'); } catch { /* */ }
  if (saved === 'low' || saved === 'medium' || saved === 'high') return saved;
  const cores = navigator.hardwareConcurrency || 4;
  if (IS_TOUCH) return cores >= 8 ? 'medium' : 'low';
  return 'high';
}

export type Updater = (dt: number, t: number) => void;

/** Текущото качество (за модули, които нямат достъп до Engine). */
export const QUALITY: { value: Quality } = { value: 'high' };

/** Рендерер, сцена, светлини и главният цикъл. */
export class Engine {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  quality: Quality;
  time = { value: 0 };
  private updaters: Updater[] = [];
  private last = performance.now();
  private sunOffset = new THREE.Vector3(-22, 48, 18);
  fps = 60;
  /** Мащаб на времето (0 = пауза, 0.2 = забавяне). */
  timeScale = 1;

  constructor(public canvas: HTMLCanvasElement) {
    this.quality = detectQuality();
    QUALITY.value = this.quality;
    const r = new THREE.WebGLRenderer({ canvas, antialias: this.quality !== 'low', powerPreference: 'high-performance', stencil: false });
    this.renderer = r;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.NeutralToneMapping;
    r.toneMappingExposure = 1.05;
    r.shadowMap.enabled = true;
    r.shadowMap.type = this.quality === 'low' ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
    this.applyPixelRatio();

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.5, 400);

    // Меко околно осветление — отражения по металните ръце и колите
    const pmrem = new THREE.PMREMGenerator(r);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.5;

    this.hemi = new THREE.HemisphereLight(0xdfeaff, 0x5d5a58, 1.0);
    this.scene.add(this.hemi);

    const sun = new THREE.DirectionalLight(0xfff4e6, 2.35);
    sun.castShadow = true;
    const ms = this.quality === 'high' ? 4096 : this.quality === 'medium' ? 2048 : 1024;
    sun.shadow.mapSize.set(ms, ms);
    const sc = sun.shadow.camera;
    sc.left = -40; sc.right = 40; sc.top = 40; sc.bottom = -40; sc.near = 1; sc.far = 160;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.04;
    sun.shadow.radius = 2;
    this.sun = sun;
    this.scene.add(sun, sun.target);

    addEventListener('resize', () => this.resize());
    this.resize();
  }

  applyPixelRatio() {
    const cap = this.quality === 'high' ? 2 : this.quality === 'medium' ? 1.5 : 1;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, cap));
  }

  setQuality(q: Quality) {
    try { localStorage.setItem('orda-quality', q); } catch { /* */ }
    location.reload();
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // На вертикален екран (телефон) — по-широк ъгъл, за да се вижда ордата отстрани
    this.camera.fov = w < h ? 50 : 38;
    this.camera.updateProjectionMatrix();
  }

  /** Сянката следва героя (за по-остри сенки). */
  followShadow(target: THREE.Vector3, span: number) {
    const s = Math.max(24, span);
    const sc = this.sun.shadow.camera;
    if (Math.abs(sc.right - s) > 2) {
      sc.left = -s; sc.right = s; sc.top = s; sc.bottom = -s;
      sc.updateProjectionMatrix();
    }
    const texel = (2 * s) / this.sun.shadow.mapSize.x;
    const tx = Math.round(target.x / texel) * texel, tz = Math.round(target.z / texel) * texel;
    this.sun.target.position.set(tx, 0, tz);
    this.sun.position.set(tx + this.sunOffset.x, this.sunOffset.y, tz + this.sunOffset.z);
  }

  onUpdate(f: Updater) {
    this.updaters.push(f);
  }

  start() {
    const loop = (now: number) => {
      requestAnimationFrame(loop);
      const raw = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.fps = this.fps * 0.95 + (1 / Math.max(raw, 0.001)) * 0.05;
      const dt = raw * this.timeScale;
      this.time.value += dt;
      for (const u of this.updaters) u(dt, raw);
      this.renderer.render(this.scene, this.camera);
    };
    requestAnimationFrame(loop);
  }
}
