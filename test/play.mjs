// Робот, който играе: тича към сандъците, скача между покривите, взима оръжия и снима.
// node test/play.mjs [секунди]   (TOUCH=1 W=412 H=860 — като телефон)
import { createRequire } from 'module';
import { execSync } from 'child_process';
const require = createRequire(import.meta.url);
const { chromium } = require(execSync('npm root -g').toString().trim() + '/playwright');
const secs = +(process.argv[2] || 60);
const W = +(process.env.W || 1280), H = +(process.env.H || 720);
const url = process.env.URL || 'http://localhost:5193/';
const exe = process.env.CHROME_PATH || (process.env.LOCALAPPDATA + '/ms-playwright/chromium-1234/chrome-win64/chrome.exe');
const browser = await chromium.launch({ executablePath: exe, headless: !process.env.HEADED, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1, hasTouch: !!process.env.TOUCH, isMobile: !!process.env.TOUCH });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
await page.goto(url);
await page.waitForFunction(() => window.__orda?.ready, null, { timeout: 120000 });
await page.evaluate(() => localStorage.setItem('orda-tut', 'done'));
await page.click('.play');

// автопилот в самата страница: към сандъка, иначе бяга от най-близките зомбита
await page.evaluate(() => {
  const g = window.__orda.game;
  window.__auto = setInterval(() => {
    if (g.state === 'pack') {
      // изчаква малко (за снимката), взима първото предложение (докосване) и затваря
      window.__packT = (window.__packT || 0) + 50;
      if (window.__packT < 1500) return;
      const o = document.querySelector('.offer');
      if (o && !window.__took) {
        window.__took = true;
        o.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10, pointerId: 1 }));
        window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 10, clientY: 10, pointerId: 1 }));
        return;
      }
      setTimeout(() => { document.querySelector('.pack .go')?.click(); window.__took = false; window.__packT = 0; }, 600);
      return;
    }
    if (g.state !== 'play') return;
    const h = g.hero.pos;
    let tx = 0, tz = 0;
    if (g.chest && !g.hero.leap) {
      if (g.chest.b === g.hero.bld) { tx = g.chest.x - h.x; tz = g.chest.z - h.z; }
      else {
        const nb = g.city.nextRoof(g.hero.bld, g.chest.b) || g.chest.b;
        const cx = Math.min(nb.x1, Math.max(nb.x0, h.x)), cz = Math.min(nb.z1, Math.max(nb.z0, h.z));
        tx = cx - h.x; tz = cz - h.z;
      }
    }
    else {
      const H = g.horde;
      for (const i of H.live) {
        if (H.state[i] !== 3 || H.bld[i] !== g.hero.bld.i) continue;
        const dx = h.x - H.x[i], dz = h.z - H.z[i];
        const d2 = dx * dx + dz * dz + 0.5;
        tx += dx / d2; tz += dz / d2;
      }
    }
    const l = Math.hypot(tx, tz);
    g.input.x = l > 0.3 ? tx / l : 0;
    g.input.z = l > 0.3 ? tz / l : 0;
  }, 50);
});

const t0 = Date.now();
let shot = 0;
const shots = [5, 14, 25, 40, 60, 90, 120];
let packShot = false;
while ((Date.now() - t0) / 1000 < secs) {
  await page.waitForTimeout(500);
  const s = await page.evaluate(() => window.__orda.stats());
  const el = (Date.now() - t0) / 1000;
  if (s.state === 'pack' && !packShot) {
    packShot = true;
    await page.waitForTimeout(300);
    await page.screenshot({ path: `test/tmp/pack.png` });
  }
  if (shot < shots.length && el > shots[shot]) {
    await page.screenshot({ path: `test/tmp/play_${shots[shot]}.png` });
    console.log(Math.round(el) + 's', JSON.stringify(s));
    shot++;
  }
  if (s.state === 'over') { console.log('КРАЙ', JSON.stringify(s)); await page.screenshot({ path: 'test/tmp/over.png' }); break; }
}
console.log('ГРЕШКИ:', errors.length ? errors.slice(0, 10).join('\n') : 'няма');
await browser.close();
