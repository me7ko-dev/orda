import '@fontsource/rubik/400.css';
import '@fontsource/rubik/700.css';
import '@fontsource/rubik/900.css';
import './ui/style.css';
import { Engine } from './engine/engine';
import { loadModels } from './engine/assets';
import { Game } from './game/game';
import { UI } from './ui/ui';

declare global {
  interface Window {
    __orda: { ready: boolean; game?: Game; engine?: Engine; ui?: UI; stats?: () => unknown };
  }
}
window.__orda = { ready: false };

const MODELS = [
  'hero', 'zombie', 'chest',
  'gun_pistol', 'gun_revolver', 'gun_smg', 'gun_shotgun', 'gun_rifle', 'gun_sniper', 'gun_rocket', 'gun_ray', 'gun_grenade',
  'ac', 'ac_double', 'watertower', 'watertank', 'dish', 'antenna', 'vent', 'barrel_x',
  'car_sport', 'car_hatch', 'car_police', 'car_sport2', 'car_sedan', 'dumpster', 'cone', 'barrier', 'streetlight', 'trashbags',
];

async function boot() {
  const fill = document.getElementById('load-fill')!;
  const engine = new Engine(document.getElementById('game') as HTMLCanvasElement);
  await loadModels(MODELS, (p) => (fill.style.width = Math.round(p * 90) + '%'));
  await document.fonts.ready;
  const game = new Game(engine);
  const ui = new UI(game, engine);
  fill.style.width = '100%';
  engine.start();
  // компилиране на шейдърите преди първия кадър (по-малко засичане)
  engine.renderer.compile(engine.scene, engine.camera);
  setTimeout(() => document.getElementById('loading')!.classList.add('done'), 150);
  Object.assign(window.__orda, { ready: true, game, engine, ui, stats: () => game.stats() });
}

// офлайн режим (само в публикуваната версия)
if (import.meta.env.PROD && 'serviceWorker' in navigator && location.protocol === 'https:') {
  addEventListener('load', () => navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then((r) => r.update()).catch(() => {}));
}

boot().catch((e) => {
  console.error(e);
  const s = document.querySelector('.load-sub');
  if (s) s.textContent = 'Грешка: ' + (e?.message ?? e);
});
