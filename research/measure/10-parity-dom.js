/**
 * FASE 3 — passaggio DOM-only. Solo getComputedStyle, nessuna lettura di pixel.
 *
 * Motivo della separazione: la sonda a pixel (getImageData per frame) fa
 * scendere il campionamento a 13-25 fps e, sull'originale, il jank rende
 * inutilizzabili le transizioni CSS brevi. Qui si misurano le meccaniche
 * puramente CSS con una sonda leggerissima, che campiona a 60 fps pieni.
 *
 *   node 10-parity-dom.js original|clone
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const TARGET = process.argv[2];
const CONF = {
  original: {
    url: 'https://jinleeoffice.com/',
    viewNatural: 'button[aria-label="Natural Grid view"]',
    viewPixel: 'button[aria-label="Pixel Grid view"]',
    filters: 'button.navbar__filters',
  },
  clone: {
    url: 'http://localhost:4173/',
    viewNatural: '[data-view="natural"]',
    viewPixel: '[data-view="pixel"]',
    filters: '[data-filters-toggle]',
  },
}[TARGET];
if (!CONF) { console.error('uso: node 10-parity-dom.js original|clone'); process.exit(1); }

const OUT = path.join(__dirname, '..', 'raw', 'parity');
fs.mkdirSync(OUT, { recursive: true });

const REC = `
window.__rec = (fn, ms) => new Promise((res) => {
  const out = []; const t0 = performance.now();
  const tick = () => {
    const t = performance.now() - t0;
    out.push({ t: +t.toFixed(2), v: fn() });
    if (t < ms) requestAnimationFrame(tick); else res(out);
  };
  requestAnimationFrame(tick);
});
`;

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.addInitScript(REC);

  // Sequenza di load: opacity del canvas e del tooltip, dal primo frame.
  await page.addInitScript(() => {
    window.__load = [];
    const t0 = performance.now();
    const tick = () => {
      const c = document.querySelector('.pixel-grid canvas');
      const tt = document.querySelector('.intro-tooltip');
      window.__load.push({
        t: +(performance.now() - t0).toFixed(2),
        canvasOp: c ? getComputedStyle(c).opacity : null,
        tipOp: tt ? getComputedStyle(tt).opacity : null,
      });
      if (performance.now() - t0 < 14000) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  const R = { target: TARGET, scenarios: {} };
  await page.goto(CONF.url, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForTimeout(15000);
  R.scenarios.loadSequence = await page.evaluate(() => window.__load);

  R.frameRate = await page.evaluate(() => new Promise((r) => {
    const ts = []; let n = 0;
    const tick = (t) => { ts.push(t); if (++n < 90) requestAnimationFrame(tick); else {
      const d = []; for (let i = 1; i < ts.length; i++) d.push(ts[i] - ts[i - 1]);
      d.sort((a, b) => a - b);
      r({ medianDelta: d[Math.floor(d.length / 2)], fps: 1000 / d[Math.floor(d.length / 2)] });
    } };
    requestAnimationFrame(tick);
  }));

  const wake = async (ms = 2000) => {
    await page.mouse.move(700 + Math.random() * 8, 430 + Math.random() * 8);
    await page.mouse.move(720 + Math.random() * 8, 450 + Math.random() * 8);
    await page.waitForTimeout(ms);
  };

  // PRE-WARM: costruzione del DOM del Natural Grid, costo una-tantum non animato
  await page.locator(CONF.viewNatural).first().click();
  await page.waitForTimeout(4000);
  await page.locator(CONF.viewPixel).first().click();
  await page.waitForTimeout(3000);

  // Scrim navbar all'apertura dei filtri
  await wake();
  const scrim = page.evaluate(() => window.__rec(() => {
    const n = document.querySelector('.navbar');
    return n ? parseFloat(getComputedStyle(n, '::after').height) : null;
  }, 1200));
  await page.waitForTimeout(100);
  for (const b of await page.locator(CONF.filters).all()) {
    if (await b.isVisible().catch(() => false)) { await b.click(); break; }
  }
  R.scenarios.filtersScrim = await scrim;
  R.scenarios.filtersOpened = await page.evaluate(() =>
    /filters-open/.test(document.querySelector('.navbar')?.className || ''));
  await page.waitForTimeout(500);

  // Crossfade del View toggle (DOM già costruito grazie al pre-warm)
  await wake();
  const view = page.evaluate(() => window.__rec(() =>
    [...document.querySelectorAll('.view-layer')].map((e) => parseFloat(getComputedStyle(e).opacity)), 1600));
  await page.waitForTimeout(100);
  await page.locator(CONF.viewNatural).first().click();
  R.scenarios.viewCrossfade = await view;

  fs.writeFileSync(path.join(OUT, `${TARGET}-dom.json`), JSON.stringify(R, null, 1));

  const distinct = (s, f) => new Set(s.map(f).map(String)).size;
  console.log(`[${TARGET}-dom] ${R.frameRate.fps.toFixed(1)} fps`);
  console.log(`  load: ${R.scenarios.loadSequence.length} campioni · tooltip non nulli: ${R.scenarios.loadSequence.filter(p => p.tipOp !== null).length}`);
  console.log(`  scrim: ${R.scenarios.filtersScrim.length} campioni, ${distinct(R.scenarios.filtersScrim, x => x.v)} distinti · aperto: ${R.scenarios.filtersOpened}`);
  console.log(`  view:  ${R.scenarios.viewCrossfade.length} campioni, ${distinct(R.scenarios.viewCrossfade, x => JSON.stringify(x.v))} distinti`);
  await browser.close();
})();
