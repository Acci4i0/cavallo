/**
 * FASE 3 — su quale frame si ferma la maschera dopo l'intro?
 * In stato "done" si porta lo zoom al minimo (così l'intera griglia entra nel
 * viewport), si cattura la matrice completa e la si confronta con i 58 frame
 * della sorgente per identificarne l'indice.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SITE = 'https://jinleeoffice.com/';
const src = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'raw', 'mask-source.json'), 'utf8'));

const PROBE = `
window.__R = {};
window.__R.grab = () => {
  const c = document.querySelector('.pixel-grid canvas');
  if (!c || !c.width) return null;
  let d;
  try { d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; } catch (e) { return { err: e.name }; }
  const W = c.width, H = c.height;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2)
    if (d[(y * W + x) * 4 + 3] > 16) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return { empty: true };
  let best = { n: 0 };
  for (let y = y0; y <= y1; y += 3) {
    const pos = [];
    for (let x = Math.max(1, x0); x <= x1; x++) {
      const a0 = d[(y * W + x - 1) * 4 + 3], a1 = d[(y * W + x) * 4 + 3];
      if (a0 < 128 && a1 >= 128) pos.push(x);
    }
    if (pos.length > best.n) best = { n: pos.length, pos };
  }
  if (best.n < 4) return { noEdges: true };
  const df = []; for (let i = 1; i < best.pos.length; i++) df.push(best.pos[i] - best.pos[i - 1]);
  df.sort((a, b) => a - b);
  const p = df[Math.floor(df.length * 0.25)];
  const cols = Math.round((x1 - x0) / p) + 1, rows = Math.round((y1 - y0) / p) + 1;
  const off = document.createElement('canvas');
  off.width = cols; off.height = rows;
  const g = off.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingEnabled = true;
  g.drawImage(c, x0, y0, p * cols, p * rows, 0, 0, cols, rows);
  const dd = g.getImageData(0, 0, cols, rows).data;
  const m = [];
  for (let i = 0; i < cols * rows; i++) m.push(dd[i * 4 + 3] > 88 ? 1 : 0);
  return { cols, rows, pitch: p, m, on: m.reduce((a, b) => a + b, 0) };
};
`;

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1200 }, deviceScaleFactor: 2 });
  await ctx.route('**://cdn.sanity.io/**', async (route) => {
    const r = await route.fetch();
    await route.fulfill({ response: r, headers: { ...r.headers(), 'access-control-allow-origin': '*' } });
  });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    const N = window.Image;
    function P(...a) { const i = new N(...a); i.crossOrigin = 'anonymous'; return i; }
    P.prototype = N.prototype; window.Image = P;
  });
  await page.addInitScript(PROBE);
  await page.goto(SITE, { waitUntil: 'networkidle', timeout: 90000 });

  const keep = setInterval(() => page.mouse.move(800 + Math.random() * 10, 600).catch(() => {}), 1500);
  console.log('attendo la fine dell\'intro...');
  await page.waitForTimeout(28000);

  // zoom al minimo: 1.5 → 1.0 → .667 → .444 → clamp .4
  for (let i = 0; i < 4; i++) {
    await page.locator('button[aria-label="Zoom out"]').first().click();
    await page.waitForTimeout(1400);
  }
  await page.waitForTimeout(2500);
  const g = await page.evaluate(() => window.__R.grab());
  clearInterval(keep);
  console.log('catturato:', g && g.cols ? `${g.cols}×${g.rows} passo ${g.pitch}px, ${g.on} celle accese` : JSON.stringify(g));
  await browser.close();
  if (!g || !g.m) return;

  // confronto con i 58 frame della sorgente, ritagliati all'area accesa
  const G = src.frames[0].gridData, COLS = G.cols, ROWS = G.rows;
  const mats = src.frames.map((f) => {
    const m = new Array(COLS * ROWS).fill(0);
    for (const c of f.gridData.cells) m[c.gridRow * COLS + c.gridCol] = 1;
    return m;
  });
  let c0 = COLS, c1 = -1, r0 = ROWS, r1 = -1;
  for (const m of mats) for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++)
    if (m[r * COLS + c]) { if (c < c0) c0 = c; if (c > c1) c1 = c; if (r < r0) r0 = r; if (r > r1) r1 = r; }

  // il grab parte dal bbox del frame corrente, che può essere più stretto
  // dell'unione: si cerca l'offset migliore dentro l'area unione
  let best = { score: -1 };
  for (let i = 0; i < mats.length; i++) {
    for (let dr = -3; dr <= 3; dr++) for (let dc = -3; dc <= 3; dc++) {
      let hit = 0, tot = 0;
      for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) {
        const R2 = r0 + r + dr, C2 = c0 + c + dc;
        if (R2 < 0 || R2 >= ROWS || C2 < 0 || C2 >= COLS) continue;
        tot++;
        if (mats[i][R2 * COLS + C2] === g.m[r * g.cols + c]) hit++;
      }
      const s = tot ? hit / tot : 0;
      if (s > best.score) best = { score: s, frame: i, dr, dc, tot, hit };
    }
  }
  console.log(`\nframe di riposo identificato: indice ${best.frame} su ${mats.length}`);
  console.log(`  coincidenza celle: ${(best.score * 100).toFixed(3)}% (${best.hit}/${best.tot}) · offset (${best.dr},${best.dc})`);
  console.log(`  celle accese nel frame ${best.frame} della sorgente: ${src.frames[best.frame].gridData.cells.length}`);

  // atteso dal sorgente: a = (introCycles-1)*n + ceil(n*0.85), ultimo j = (a-1) % n
  const n = mats.length, cycles = 3;
  const a = (cycles - 1) * n + Math.ceil(n * 0.85);
  console.log(`\n  atteso dal bundle (introCycles=3): a=${a} passi → ultimo indice = (a-1) %% ${n} = ${(a - 1) % n}`);

  fs.writeFileSync(path.join(__dirname, '..', 'raw', 'mask', 'resting-frame.json'),
    JSON.stringify({ grab: { cols: g.cols, rows: g.rows, pitch: g.pitch, on: g.on }, best, expected: (a - 1) % n }, null, 1));
})();
