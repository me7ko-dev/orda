import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

const cache = new Map<string, GLTF>();
const base = import.meta.env.BASE_URL + 'models/';

/** Зарежда всички модели наведнъж; onProgress(0..1). Липсващ модел не спира играта. */
export async function loadModels(names: string[], onProgress?: (p: number) => void) {
  let done = 0;
  await Promise.all(
    names.map(async (n) => {
      try {
        cache.set(n, await loader.loadAsync(base + n + '.glb'));
      } catch (e) {
        console.warn('Липсва модел', n, e);
      }
      done++;
      onProgress?.(done / names.length);
    }),
  );
}

export function gltf(name: string): GLTF | undefined {
  return cache.get(name);
}

/** Копие на модела (с кости, ако е анимиран). */
export function cloneModel(name: string): THREE.Object3D {
  const g = cache.get(name);
  if (!g) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), new THREE.MeshStandardMaterial({ color: 0xff00ff }));
    return m;
  }
  return SkeletonUtils.clone(g.scene);
}

/** Копие, смалено/уголемено до дадена височина (или най-голям размер), стъпило на y=0 и центрирано. */
export function fitModel(o: THREE.Object3D, size: number, by: 'height' | 'max' = 'height') {
  o.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(o);
  const s = b.getSize(new THREE.Vector3());
  const k = size / (by === 'height' ? s.y : Math.max(s.x, s.y, s.z));
  o.scale.multiplyScalar(k);
  o.updateMatrixWorld(true);
  const b2 = new THREE.Box3().setFromObject(o);
  const c = b2.getCenter(new THREE.Vector3());
  o.position.x -= c.x;
  o.position.z -= c.z;
  o.position.y -= b2.min.y;
  const g = new THREE.Group();
  g.add(o);
  return g;
}

export function shadows(o: THREE.Object3D, cast = true, receive = true) {
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (m.isMesh) {
      m.castShadow = cast;
      m.receiveShadow = receive;
    }
  });
  return o;
}
