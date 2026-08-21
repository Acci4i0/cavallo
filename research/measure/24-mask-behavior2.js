/**
 * FASE 3 (ripetizione mirata) — usa la sonda LEGGERA (riduzione a cols×rows)
 * invece della firma su tutto il canvas, che droppava frame.
 *
 * Risponde a due domande rimaste aperte:
 *   B. nello stato "done" (nessuna inattività) la maschera è ferma?
 *   C. con lo zoom la maschera è scalata o ricampionata?
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const RAW = path.join(__dirname, '..', 'raw', 'mask');
const SITE = 'https://jinleeoffice.com/';

const PROBE = `
window.__L = {};
// reticolo dal canvas: bbox + passo
window.__L.lattice = () => {
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
  if (best.n < 4) return { noEdges: true, bbox: [x0, y0, x1, y1] };
  const df = []; for (let i = 1; i < best.pos.length; i++) df.push(best.pos[i] - best.pos[i - 1]);
  df.sort((a, b) => a - b);
  return { bbox: [x0, y0, x1, y1], pitch: df[Math.floor(df.length * 0.25)], firstEdge: best.pos[0] };
};
// matrice di una finestra di celle, ancorata a (ox,oy) con passo p
window.__L.window = (ox, oy, p, cols, rows) => {
  const c = document.querySelector('.pixel-grid canvas');
  if (!c) return null;
  const off = document.createElement('canvas');
  off.width = cols; off.height = rows;
  const g = off.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingEnabled = true;
  g.drawImage(c, ox, oy, p * cols, p * rows, 0, 0, cols, rows);
  const d = g.getImageData(0, 0, cols, rows).data;
  const m = [];
  for (let i = 0; i < cols * rows; i++) m.push(d[i * 4 + 3] > 88 ? 1 : 0);
  return m;
};
window.__L.watchLight = (ox, oy, p, cols, rows, ms) => new Promise((res) => {
  const seq = []; const t0 = performance.now();
  let prev = null, prevT = t0;
  const tick = () => {
    const now = performance.now();
    const m = window.__L.window(ox, oy, p, cols, rows);
    if (m) {
      const k = m.join('');
      if (k !== prev) {
        if (seq.length) seq[seq.length - 1].dur = +(now - prevT).toFixed(1);
        seq.push({ t: +(now - t0).toFixed(1), on: m.reduce((a, b) => a + b, 0), dur: null });
        prev = k; prevT = now;
      }
    }
    if (now - t0 < ms) requestAnimationFrame(tick);
    else { if (seq.length) seq[seq.length - 1].dur = +(now - prevT).toFixed(1); res(seq); }
  };
  requestAnimationFrame(tick);
});
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

  const R = {};
  // attende la fine completa dell'intro: fadeIn + galoppo + pausa + zoomIn
  console.log('attendo la fine dell\'intro (28 s)...');
  const keep = setInterval(() => page.mouse.move(800 + Math.random() * 10, 600).catch(() => {}), 1500);
  await page.waitForTimeout(28000);

  /* ── B. lo stato "done" è fermo? ────────────────────────────────────────── */
  const lat = await page.evaluate(() => window.__L.lattice());
  console.log('reticolo in stato done:', JSON.stringify(lat));
  R.doneLattice = lat;
  if (lat && lat.pitch) {
    const [x0, y0] = lat.bbox;
    const seq = await page.evaluate(([ox, oy, p]) => window.__L.watchLight(ox, oy, p, 20, 15, 6000),
      [x0, y0, lat.pitch]);
    R.doneWatch = seq;
    console.log('\n=== B. stato done, 6 s con attività continua ===');
    console.log(`  cambi di maschera: ${seq.length - 1} → ${seq.length <= 1 ? 'FERMA' : 'IN MOVIMENTO'}`);
    console.log(`  celle accese nella finestra 20×15: ${seq.map((s) => s.on).join(', ')}`);
  }

  /* ── C. zoom: scalata o ricampionata? ──────────────────────────────────── */
  // Confronta la stessa finestra di celle a due zoom diversi. Se la maschera è
  // scalata, le celle accese nella finestra sono le STESSE; se ricampionata, no.
  const sample = async (label) => {
    await page.waitForTimeout(2600);
    const l = await page.evaluate(() => window.__L.lattice());
    if (!l || !l.pitch) return { label, fail: true };
    // ancora la finestra al centro del bbox, così è visibile a ogni zoom
    const [x0, y0, x1, y1] = l.bbox;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const COLS = 12, ROWS = 9;
    // allinea l'origine al reticolo (fase dei fronti)
    const ox = cx - (COLS / 2) * l.pitch;
    const oy = cy - (ROWS / 2) * l.pitch;
    const m = await page.evaluate(([ox, oy, p, c, r]) => window.__L.window(ox, oy, p, c, r),
      [ox, oy, l.pitch, COLS, ROWS]);
    return { label, pitch: l.pitch, bbox: l.bbox, m, on: m.reduce((a, b) => a + b, 0) };
  };

  R.zoom = [];
  R.zoom.push(await sample('zoom default (1.5)'));
  await page.locator('button[aria-label="Zoom out"]').first().click();
  R.zoom.push(await sample('zoom -1 (1.0)'));
  await page.locator('button[aria-label="Zoom out"]').first().click();
  R.zoom.push(await sample('zoom -2 (0.667)'));
  clearInterval(keep);

  console.log('\n=== C. zoom: scalata o ricampionata? ===');
  for (const z of R.zoom) {
    console.log(`  ${z.label.padEnd(20)} passo=${String(z.pitch).padStart(4)}px  accese nella finestra 12×9: ${z.on}`);
  }
  const ratios = [];
  for (let i = 1; i < R.zoom.length; i++) {
    if (R.zoom[i].pitch && R.zoom[i - 1].pitch) ratios.push(+(R.zoom[i - 1].pitch / R.zoom[i].pitch).toFixed(4));
  }
  console.log(`  rapporti di passo consecutivi: ${ratios.join(', ')} (atteso 1.5 se lo zoom scala)`);
  const pat = R.zoom.filter((z) => z.m).map((z) => z.m.join(''));
  const identical = pat.length > 1 && pat.every((p) => p === pat[0]);
  console.log(`  pattern nella finestra centrale: ${identical ? 'IDENTICO a tutti gli zoom' : 'DIVERSO tra zoom'}`);
  console.log(`  → maschera ${identical ? 'SCALATA (stessa matrice, solo scala diversa)' : 'da verificare: le finestre potrebbero non essere allineate'}`);

  fs.writeFileSync(path.join(RAW, 'behavior2.json'), JSON.stringify(R, null, 1));
  console.log('\nscritto research/raw/mask/behavior2.json');
  await browser.close();
})();
