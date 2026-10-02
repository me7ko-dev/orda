// Следи състоянията на зомбитата във времето: node test/probe.mjs [сек]
import { createRequire } from 'module';
import { execSync } from 'child_process';
const require = createRequire(import.meta.url);
const { chromium } = require(execSync('npm root -g').toString().trim() + '/playwright');
const secs = +(process.argv[2] || 30);
const exe = process.env.LOCALAPPDATA + '/ms-playwright/chromium-1234/chrome-win64/chrome.exe';
const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto('http://localhost:5193/');
await page.waitForFunction(() => window.__orda?.ready, null, { timeout: 120000 });
await page.evaluate(() => localStorage.setItem('orda-tut', 'done'));
await page.click('.play');
for (let s = 0; s < secs; s += 3) {
  await page.waitForTimeout(3000);
  const r = await page.evaluate(() => {
    const g = window.__orda.game, H = g.horde;
    const c = [0, 0, 0, 0, 0, 0];
    let near = 0, minD = 1e9, onHero = 0;
    for (const i of H.live) {
      c[H.state[i]]++;
      const d = Math.hypot(H.x[i] - g.hero.pos.x, H.z[i] - g.hero.pos.z);
      if (H.state[i] === 1) { minD = Math.min(minD, d); if (d < 12) near++; }
      if ((H.state[i] === 3 || H.state[i] === 2) && H.bld[i] === g.hero.bld.i) onHero++;
    }
    return { t: Math.round(g.time), states: c.join('/'), near, minD: Math.round(minD), onHero, kills: g.kills, hp: Math.round(g.hero.hp), fps: Math.round(g.engine.fps) };
  });
  console.log(JSON.stringify(r));
}
await browser.close();
