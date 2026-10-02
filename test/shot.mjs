// Снимка: node test/shot.mjs [изход.png] [ширина] [височина] [js за изпълнение преди снимката]
// URL=... за друга страница; TOUCH=1 за телефон; WAIT=ms
import { createRequire } from 'module';
import { execSync } from 'child_process';
const require = createRequire(import.meta.url);
const { chromium } = require(execSync('npm root -g').toString().trim() + '/playwright');
const out = process.argv[2] || 'test/tmp/shot.png';
const w = +(process.argv[3] || 1280), h = +(process.argv[4] || 720);
const js = process.argv[5] || '';
const url = process.env.URL || 'http://localhost:5193/';
const exe = process.env.CHROME_PATH || (process.env.LOCALAPPDATA + '/ms-playwright/chromium-1234/chrome-win64/chrome.exe');
const browser = await chromium.launch({ executablePath: exe, headless: process.env.HEADED ? false : true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: !!process.env.TOUCH, isMobile: !!process.env.TOUCH });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning' || process.env.LOG) logs.push(m.type() + ': ' + m.text()); });
page.on('pageerror', (e) => logs.push('PAGEERROR: ' + e.message));
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready || window.__orda?.ready, null, { timeout: 120000 }).catch(() => logs.push('ТАЙМАУТ при зареждане'));
if (js) console.log('js:', JSON.stringify(await page.evaluate(js)));
await page.waitForTimeout(+(process.env.WAIT || 1500));
await page.screenshot({ path: out });
const info = await page.evaluate(() => window.__info || (window.__orda?.stats?.() ?? null));
console.log(JSON.stringify(info));
console.log(logs.slice(0, 20).join('\n'));
await browser.close();
