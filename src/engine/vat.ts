import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * „Изпечена“ анимация (Vertex Animation Texture).
 * Анимираният модел се изиграва веднъж при зареждане и мястото на всеки връх за всеки кадър
 * се записва в текстура. После стотици копия (InstancedMesh) четат кадъра си от текстурата —
 * едно рисуване за цялата орда, вместо стотици скелети.
 */

export type ClipInfo = { start: number; frames: number; loop: boolean; fps: number };

export type VAT = {
  geometry: THREE.BufferGeometry;
  posTex: THREE.DataTexture;
  nrmTex: THREE.DataTexture;
  width: number;
  rowsPerFrame: number;
  clips: Record<string, ClipInfo>;
  map: THREE.Texture | null;
  height: number;
};

type ClipReq = { name: string; as: string; fps: number; loop: boolean };

export function bakeVAT(scene: THREE.Object3D, animations: THREE.AnimationClip[], req: ClipReq[], targetHeight: number): VAT {
  const root = scene;
  root.updateMatrixWorld(true);
  const skinned: THREE.SkinnedMesh[] = [];
  root.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned.push(o as THREE.SkinnedMesh);
  });
  let map: THREE.Texture | null = null;
  for (const s of skinned) {
    const m = (Array.isArray(s.material) ? s.material[0] : s.material) as THREE.MeshStandardMaterial;
    if (m.map && !map) map = m.map;
  }

  // Обща геометрия (всички части на модела в едно)
  const parts = skinned.map((s) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', s.geometry.attributes.position.clone());
    g.setAttribute('normal', s.geometry.attributes.normal.clone());
    if (s.geometry.attributes.uv) g.setAttribute('uv', s.geometry.attributes.uv.clone());
    else g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(s.geometry.attributes.position.count * 2), 2));
    if (s.geometry.index) g.setIndex(s.geometry.index.clone());
    return g;
  });
  const geometry = mergeGeometries(parts, false)!;
  const N = geometry.attributes.position.count;
  const width = Math.min(1024, N);
  const rowsPerFrame = Math.ceil(N / width);

  // Колко кадъра общо
  const clips: Record<string, ClipInfo> = {};
  let total = 0;
  const found: { clip: THREE.AnimationClip; r: ClipReq }[] = [];
  for (const r of req) {
    const clip =
      animations.find((a) => a.name === 'CharacterArmature|' + r.name) ??
      animations.find((a) => a.name === r.name) ??
      animations.find((a) => a.name.endsWith('|' + r.name));
    if (!clip) {
      console.warn('VAT: няма анимация', r.name);
      continue;
    }
    const frames = Math.max(2, Math.round(clip.duration * r.fps) + (r.loop ? 0 : 1));
    clips[r.as] = { start: total, frames, loop: r.loop, fps: (r.loop ? frames : frames - 1) / clip.duration };
    total += frames;
    found.push({ clip, r });
  }
  const H = total * rowsPerFrame;
  const pos = new Float32Array(width * H * 4);
  const nrm = new Float32Array(width * H * 4);

  const mixer = new THREE.AnimationMixer(root);
  const v = new THREE.Vector3(), p2 = new THREE.Vector3(), n = new THREE.Vector3();
  const nm = new THREE.Matrix3();

  // Мащаб: височина по първия кадър на първата анимация
  let scale = 1;
  let offX = 0, offZ = 0, offY = 0;

  const sample = (write: (vi: number, px: number, py: number, pz: number, nx: number, ny: number, nz: number) => void) => {
    root.updateMatrixWorld(true);
    let vi = 0;
    for (const s of skinned) {
      const pa = s.geometry.attributes.position, na = s.geometry.attributes.normal;
      nm.getNormalMatrix(s.matrixWorld);
      for (let i = 0; i < pa.count; i++) {
        v.fromBufferAttribute(pa, i);
        n.fromBufferAttribute(na, i);
        p2.copy(v).addScaledVector(n, 0.01);
        s.applyBoneTransform(i, v);
        s.applyBoneTransform(i, p2);
        v.applyMatrix4(s.matrixWorld);
        p2.applyMatrix4(s.matrixWorld);
        n.subVectors(p2, v).normalize();
        write(vi++, v.x, v.y, v.z, n.x, n.y, n.z);
      }
    }
  };

  // Нормализиране (височина, стъпало на y=0, център)
  if (found.length) {
    const a = mixer.clipAction(found[0].clip);
    a.play();
    mixer.setTime(0);
    let minY = Infinity, maxY = -Infinity, sx = 0, sz = 0, c = 0;
    sample((_vi, x, y, z) => {
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      sx += x; sz += z; c++;
    });
    scale = targetHeight / (maxY - minY);
    offX = -sx / c; offZ = -sz / c; offY = -minY;
    a.stop();
  }

  for (const { clip, r } of found) {
    const info = clips[r.as];
    mixer.stopAllAction();
    const a = mixer.clipAction(clip);
    a.reset();
    a.setLoop(r.loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    a.clampWhenFinished = true;
    a.play();
    for (let f = 0; f < info.frames; f++) {
      const t = r.loop ? (f / info.frames) * clip.duration : Math.min(clip.duration, (f / (info.frames - 1)) * clip.duration);
      mixer.setTime(t);
      const rowBase = (info.start + f) * rowsPerFrame;
      sample((vi, x, y, z, nx, ny, nz) => {
        const px = vi % width, py = rowBase + Math.floor(vi / width);
        const k = (py * width + px) * 4;
        pos[k] = (x + offX) * scale;
        pos[k + 1] = (y + offY) * scale;
        pos[k + 2] = (z + offZ) * scale;
        pos[k + 3] = 1;
        nrm[k] = nx; nrm[k + 1] = ny; nrm[k + 2] = nz; nrm[k + 3] = 0;
      });
    }
  }
  mixer.stopAllAction();

  // Основната геометрия — първият кадър (за ограничаваща сфера и т.н.)
  const gp = geometry.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < N; i++) {
    const px = i % width, py = Math.floor(i / width);
    const k = (py * width + px) * 4;
    gp.setXYZ(i, pos[k], pos[k + 1], pos[k + 2]);
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  const mk = (data: Float32Array) => {
    const half = new Uint16Array(data.length);
    for (let i = 0; i < data.length; i++) half[i] = THREE.DataUtils.toHalfFloat(data[i]);
    const t = new THREE.DataTexture(half, width, H, THREE.RGBAFormat, THREE.HalfFloatType);
    t.minFilter = t.magFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.needsUpdate = true;
    return t;
  };
  return { geometry, posTex: mk(pos), nrmTex: mk(nrm), width, rowsPerFrame, clips, map, height: targetHeight };
}

const VAT_COMMON = /* glsl */ `
uniform sampler2D uVatP;
uniform sampler2D uVatN;
uniform int uVatW;
uniform int uVatRows;
attribute vec3 aAnim;
attribute vec4 aCol;
varying vec4 vCol;
vec3 vatFetch(sampler2D t, float frame) {
  int id = gl_VertexID;
  int row = int(frame + 0.5) * uVatRows + id / uVatW;
  return texelFetch(t, ivec2(id - (id / uVatW) * uVatW, row), 0).xyz;
}
`;

function vatUniforms(vat: VAT) {
  return {
    uVatP: { value: vat.posTex },
    uVatN: { value: vat.nrmTex },
    uVatW: { value: vat.width },
    uVatRows: { value: vat.rowsPerFrame },
  };
}

/** Материал за ордата: Lambert + кадър от текстурата + оцветяване + бяло примигване при удар. */
export function vatMaterial(vat: VAT): THREE.MeshLambertMaterial {
  const m = new THREE.MeshLambertMaterial({ map: vat.map ?? null });
  const u = vatUniforms(vat);
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + VAT_COMMON)
      .replace(
        '#include <beginnormal_vertex>',
        `vec3 objectNormal = normalize(mix(vatFetch(uVatN, aAnim.x), vatFetch(uVatN, aAnim.y), aAnim.z));
#ifdef USE_TANGENT
vec3 objectTangent = vec3( tangent.xyz );
#endif`,
      )
      .replace(
        '#include <begin_vertex>',
        `vec3 transformed = mix(vatFetch(uVatP, aAnim.x), vatFetch(uVatP, aAnim.y), aAnim.z);
vCol = aCol;`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec4 vCol;')
      .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb *= vCol.rgb;')
      .replace('#include <opaque_fragment>', 'outgoingLight = mix(outgoingLight, vec3(1.0, 0.95, 0.9), vCol.a);\n#include <opaque_fragment>');
  };
  m.customProgramCacheKey = () => 'vat-lambert';
  return m;
}

/** Материал за сенките на ордата. */
export function vatDepthMaterial(vat: VAT): THREE.MeshDepthMaterial {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  const u = vatUniforms(vat);
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + VAT_COMMON)
      .replace('#include <begin_vertex>', 'vec3 transformed = mix(vatFetch(uVatP, aAnim.x), vatFetch(uVatP, aAnim.y), aAnim.z);\nvCol = aCol;');
  };
  m.customProgramCacheKey = () => 'vat-depth';
  return m;
}

/** Кадър (ред в текстурата) за дадена анимация и време. Връща [кадърA, кадърB, смес]. */
export function vatFrame(c: ClipInfo, t: number, out: number[]) {
  let f = t * c.fps;
  if (c.loop) {
    f = f % c.frames;
    if (f < 0) f += c.frames;
    const a = Math.floor(f);
    out[0] = c.start + a;
    out[1] = c.start + ((a + 1) % c.frames);
    out[2] = f - a;
  } else {
    f = Math.min(f, c.frames - 1);
    const a = Math.floor(f);
    out[0] = c.start + a;
    out[1] = c.start + Math.min(a + 1, c.frames - 1);
    out[2] = f - a;
  }
  return out;
}
