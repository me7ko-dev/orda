import * as THREE from 'three';
import { gunModel } from '../game/arms';
import type { WeaponKind } from '../game/data';

/** Картинки на оръжията за раницата (рисуват се веднъж с малък отделен рендерер). */
let r: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene;
let cam: THREE.PerspectiveCamera;
const cache = new Map<string, string>();

function setup() {
  const c = document.createElement('canvas');
  c.width = c.height = 192;
  r = new THREE.WebGLRenderer({ canvas: c, alpha: true, antialias: true, preserveDrawingBuffer: true });
  r.setSize(192, 192, false);
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.toneMapping = THREE.NeutralToneMapping;
  scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 2.2));
  const d = new THREE.DirectionalLight(0xffffff, 2.4);
  d.position.set(2, 4, 3);
  scene.add(d);
  cam = new THREE.PerspectiveCamera(30, 1, 0.01, 50);
}

export function weaponIcon(kind: WeaponKind, tier: number): string {
  const key = kind + tier;
  const hit = cache.get(key);
  if (hit) return hit;
  if (!r) setup();
  const { obj } = gunModel(kind, tier);
  const holder = new THREE.Group();
  holder.add(obj);
  // настрани, с дулото надясно и леко нагоре
  obj.rotation.set(0, Math.PI / 2, 0);
  holder.rotation.set(0.35, 0, 0.32);
  scene.add(holder);
  holder.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(holder);
  const size = box.getSize(new THREE.Vector3());
  const ctr = box.getCenter(new THREE.Vector3());
  holder.position.sub(ctr);
  const dist = Math.max(size.x, size.y) / (2 * Math.tan(THREE.MathUtils.degToRad(15))) * 1.15;
  cam.position.set(0, 0, dist + size.z);
  cam.lookAt(0, 0, 0);
  r!.render(scene, cam);
  const url = r!.domElement.toDataURL('image/png');
  scene.remove(holder);
  cache.set(key, url);
  return url;
}
