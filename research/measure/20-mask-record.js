/**
 * FASE 1 — ricostruzione della maschera PER OSSERVAZIONE (metodo primario).
 *
 * Criterio di "cella accesa", documentato e misurabile:
 *   il canvas viene ridisegnato in un offscreen di esattamente cols×rows pixel;
 *   ogni pixel di destinazione integra l'area di una cella della griglia.
 *   Una cella è ACCESA se l'alpha medio di quel pixel supera 88/255.
 *   Soglia scelta a metà tra i due stati teorici: cella vuota = alpha 0,
 *   cella piena = (cellSize−spacing)²/cellSize² = (10/12)² = 69% ⇒ 177/255.
 *
 * Non usa il DOM: le celle non sono elementi, sono disegnate su canvas.
 *
 *   node 20-mask-record.js [--url=...] [--secs=20] [--out=nome]
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const arg = (k, d) => {
  const a = process.argv.find((x) => x.startsWith(`--${k}=`));
  return a ? a.split('=').slice(1).join('=') : d;
};
const URL = arg('url', 'https://jinleeoffice.com/');
const SECS = parseFloat(arg('secs', '20'));
const OUT = arg('out', 'original');
const RAW = path.join(__dirname, '..', 'raw', 'mask');
fs.mkdirSync(RAW, { recursive: true });

const PROBE = `
window.__M = {};

// Reticolo: passo e origine dai fronti dell'alpha, più bounding box del disegno.
window.__M.lattice = (sel) => {
  const c = document.querySelector(sel);
  if (!c) return null;
  const g = c.getContext('2d');
  let img;
  try { img = g.getImageData(0, 0, c.width, c.height); } catch (e) { return { error: e.name }; }
  const d = img.data, W = c.width, H = c.height;

  // bounding box dei pixel non trasparenti
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y += 2) {
    const row = y * W * 4;
    for (let x = 0; x < W; x += 2) {
      if (d[row + x * 4 + 3] > 16) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return { empty: true };

  // passo: distanza mediana tra fronti di salita, sulla riga con più fronti
  let best = { n: 0 };
  for (let y = y0; y <= y1; y += 3) {
    const row = y * W * 4;
    const pos = [];
    for (let x = x0 + 1; x <= x1; x++) {
      const a0 = d[row + (x - 1) * 4 + 3], a1 = d[row + x * 4 + 3];
      if (a0 < 128 && a1 >= 128) pos.push(x);
    }
    if (pos.length > best.n) best = { n: pos.length, pos, y };
  }
  if (best.n < 4) return { noEdges: true, bbox: [x0, y0, x1, y1] };
  const diffs = [];
  for (let i = 1; i < best.pos.length; i++) diffs.push(best.pos[i] - best.pos[i - 1]);
  diffs.sort((a, b) => a - b);
  // il passo è il minimo ricorrente: celle adiacenti. Si prende il quartile basso
  // per non farsi trascinare dai buchi della maschera (celle spente).
  const pitch = diffs[Math.floor(diffs.length * 0.25)];
  return { bbox: [x0, y0, x1, y1], pitch, edgeRow: best.y, edges: best.n };
};

// Matrice booleana: riduce il canvas a cols×rows pixel e legge l'alpha.
window.__M.setup = (sel, ox, oy, pitch, cols, rows) => {
  const off = document.createElement('canvas');
  off.width = cols; off.height = rows;
  const og = off.getContext('2d', { willReadFrequently: true });
  og.imageSmoothingEnabled = true;
  window.__M._ = { sel, ox, oy, pitch, cols, rows, off, og };
};

window.__M.matrix = () => {
  const s = window.__M._;
  if (!s) return null;
  const c = document.querySelector(s.sel);
  if (!c) return null;
  s.og.clearRect(0, 0, s.cols, s.rows);
  s.og.drawImage(c, s.ox, s.oy, s.pitch * s.cols, s.pitch * s.rows, 0, 0, s.cols, s.rows);
  const d = s.og.getImageData(0, 0, s.cols, s.rows).data;
  const m = new Array(s.cols * s.rows);
  for (let i = 0; i < m.length; i++) m[i] = d[i * 4 + 3] > 88 ? 1 : 0;
  return m;
};

// Registra a ogni rAF, deduplicando le matrici consecutive identiche.
window.__M.record = (ms) => new Promise((res) => {
  const seq = [];
  const t0 = performance.now();
  let prevKey = null, prevT = t0;
  const tick = () => {
    const now = performance.now();
    const m = window.__M.matrix();
    if (m) {
      const key = m.join('');
      if (key !== prevKey) {
        if (seq.length) seq[seq.length - 1].dur = +(now - prevT).toFixed(2);
        seq.push({ t: +(now - t0).toFixed(2), m, dur: null });
        prevKey = key; prevT = now;
      }
    }
    if (now - t0 < ms) requestAnimationFrame(tick);
    else { if (seq.length) seq[seq.length - 1].dur = +(now - prevT).toFixed(2); res(seq); }
  };
  requestAnimationFrame(tick);
});
`;

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    // viewport alto: a zoom minimo la griglia è 42 righe × 24 px = 1008 px,
    // non entrerebbe in 900 e la maschera risulterebbe tagliata
    viewport: { width: 1600, height: 1200 },
    deviceScaleFactor: 2,
  });

  if (URL.includes('jinleeoffice')) {
    await ctx.route('**://cdn.sanity.io/**', async (route) => {
      const res = await route.fetch();
      await route.fulfill({ response: res, headers: { ...res.headers(), 'access-control-allow-origin': '*' } });
    });
  }
  const page = await ctx.newPage();
  if (URL.includes('jinleeoffice')) {
    await page.addInitScript(() => {
      const N = window.Image;
      function P(...a) { const i = new N(...a); i.crossOrigin = 'anonymous'; return i; }
      P.prototype = N.prototype; window.Image = P;
    });
  }
  await page.addInitScript(PROBE);

  await page.goto(URL, { waitUntil: 'networkidle', timeout: 90000 });
  console.log('caricato, attendo intro + ingresso in idle...');
  // l'intro + i 7 s di timeout di inattività portano allo stato idle,
  // dove lo zoom scende al minimo e i frame ciclano
  await page.waitForTimeout(22000);

  const lat = await page.evaluate((s) => window.__M.lattice(s), '.pixel-grid canvas');
  console.log('reticolo:', JSON.stringify(lat));
  if (!lat || lat.error || lat.empty || lat.noEdges) {
    console.error('reticolo non rilevato'); await browser.close(); return;
  }

  const [x0, y0, x1, y1] = lat.bbox;
  const pitch = lat.pitch;
  // estende il reticolo oltre il bbox del frame corrente: altri frame possono
  // accendere celle fuori da questa sagoma
  const PAD = 8;
  const ox = x0 - PAD * pitch;
  const oy = y0 - PAD * pitch;
  const cols = Math.round((x1 - x0) / pitch) + 1 + PAD * 2;
  const rows = Math.round((y1 - y0) / pitch) + 1 + PAD * 2;
  console.log(`passo=${pitch}px  bbox=${x1 - x0}×${y1 - y0}  reticolo campionato=${cols}×${rows}`);

  await page.evaluate(([s, ox, oy, p, c, r]) => window.__M.setup(s, ox, oy, p, c, r),
    ['.pixel-grid canvas', ox, oy, pitch, cols, rows]);

  console.log(`registro ${SECS}s...`);
  const seq = await page.evaluate((ms) => window.__M.record(ms), SECS * 1000);

  const data = { url: URL, grid: { cols, rows }, pitch, origin: [ox, oy], bbox: lat.bbox, sequence: seq };
  fs.writeFileSync(path.join(RAW, `${OUT}-raw.json`), JSON.stringify(data));
  console.log(`frame distinti: ${seq.length}`);
  const durs = seq.map((s) => s.dur).filter((d) => d && d > 0).sort((a, b) => a - b);
  if (durs.length) {
    console.log(`durata frame: mediana ${durs[Math.floor(durs.length / 2)]}ms  min ${durs[0]}  max ${durs[durs.length - 1]}`);
  }
  await browser.close();
})();
