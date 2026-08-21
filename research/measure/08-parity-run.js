/**
 * FASE 3 — registrazione. Esegue le stesse interazioni su originale e clone,
 * campionando a 60fps, ed esporta una serie temporale per meccanica.
 *
 *   node 08-parity-run.js original
 *   node 08-parity-run.js clone
 *
 * Osservabile per lo zoom: il PASSO della griglia in px schermo, che per
 * costruzione vale 60 × zoom (ANIMATION_SPEC §B1: scala = 60/cellSize × zoom,
 * passo in unità griglia = cellSize ⇒ passo schermo = 60 × zoom, indipendente
 * da cellSize). Stimato per autocorrelazione sul profilo dei bordi: funziona
 * identico sui due siti nonostante il contenuto delle celle sia diverso.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const TARGET = process.argv[2];
const CONF = {
  original: {
    url: 'https://jinleeoffice.com/',
    sel: {
      canvas: '.pixel-grid canvas',
      zoomIn: 'button[aria-label="Zoom in"]',
      viewNatural: 'button[aria-label="Natural Grid view"]',
      filters: 'button.navbar__filters',
      tooltip: '.intro-tooltip',
      layers: '.view-layer',
      navbar: '.navbar',
    },
    untaint: true,
  },
  clone: {
    url: 'http://localhost:4173/',
    sel: {
      canvas: '.pixel-grid canvas',
      zoomIn: '[data-zoom-in]',
      viewNatural: '[data-view="natural"]',
      filters: '[data-filters-toggle]',
      tooltip: '.intro-tooltip',
      layers: '.view-layer',
      navbar: '.navbar',
    },
    untaint: false,
  },
}[TARGET];

if (!CONF) { console.error('uso: node 08-parity-run.js original|clone'); process.exit(1); }

const OUT = path.join(__dirname, '..', 'raw', 'parity');
fs.mkdirSync(OUT, { recursive: true });

/* Funzioni iniettate nella pagina. */
const PROBES = `
window.__P = {};

// IMPORTANTE: nei gap tra le celle il canvas è TRASPARENTE, e getImageData
// restituisce RGB (0,0,0) — indistinguibile da un contenuto nero. Il segnale
// va quindi letto sul canale ALPHA, non sulla luminanza. Vale su entrambi i siti.
// Passo della griglia dai FRONTI DI SALITA dell'alpha (bordo sinistro di ogni
// cella). O(n) in un passo solo: niente autocorrelazione, costo trascurabile.
// Passo schermo = 60 × zoom (§B1) ⇒ pitch_backing = 60 × zoom × dpr.
window.__P.pitch = (canvasSel) => {
  const c = document.querySelector(canvasSel);
  if (!c || !c.width) return null;
  const g = c.getContext('2d');

  // UNA sola getImageData per frame: il readback dalla GPU ha un costo fisso
  // di ~15 ms a chiamata, quindi ripeterlo per più righe faceva crollare il
  // campionamento a 8 fps. Si legge una patch 2D e si sceglie la riga in memoria.
  const W = Math.min(c.width, 1280);
  const H = 24;
  const y0 = Math.floor(c.height * 0.5 - H / 2);
  let d;
  try { d = g.getImageData(0, y0, W, H).data; } catch (e) { return { error: e.name }; }

  for (let r = 0; r < H; r += 6) {
    const base = r * W * 4;
    // fronti di salita con posizione sub-pixel per interpolazione lineare
    const pos = [];
    for (let i = 1; i < W; i++) {
      const a0 = d[base + (i - 1) * 4 + 3], a1 = d[base + i * 4 + 3];
      if (a0 < 128 && a1 >= 128) {
        const t = (128 - a0) / (a1 - a0 || 1);
        pos.push(i - 1 + t);
      }
    }
    if (pos.length < 4) continue;

    const diffs = [];
    for (let i = 1; i < pos.length; i++) diffs.push(pos[i] - pos[i - 1]);
    diffs.sort((x, y2) => x - y2);
    const med = diffs[Math.floor(diffs.length / 2)];
    if (!(med > 4)) continue;

    // Raffinamento: ordinale = round(offset/med), poi regressione lineare
    // posizione↔ordinale. La pendenza è il passo, con precisione molto
    // superiore alla mediana (serve: 1 px ≈ 0.55% di zoom).
    const x0 = pos[0];
    let sx = 0, sy = 0, sxx = 0, sxy = 0, n = 0;
    for (const p of pos) {
      const k = Math.round((p - x0) / med);
      sx += k; sy += p; sxx += k * k; sxy += k * p; n++;
    }
    const den = n * sxx - sx * sx;
    if (!den) continue;
    const slope = (n * sxy - sx * sy) / den;
    if (!(slope > 4)) continue;

    const dpr = c.width / c.clientWidth;
    return { pitch: slope, zoom: slope / (60 * dpr), edges: n, row: r };
  }
  return { pitch: 0, zoom: null, edges: 0, flat: true };
};

// Alpha medio in una finestra: sull'hover il globalAlpha finisce nel canale
// alpha del pixel, quindi questa è una misura DIRETTA di §B4, non inferita.
window.__P.alphaAt = (canvasSel, cx, cy, half) => {
  const c = document.querySelector(canvasSel);
  if (!c) return null;
  const dpr = c.width / c.clientWidth;
  const x = Math.max(0, Math.round(cx * dpr - half)), y = Math.max(0, Math.round(cy * dpr - half));
  const w = Math.min(half * 2, c.width - x), h = Math.min(half * 2, c.height - y);
  try {
    const d = c.getContext('2d').getImageData(x, y, w, h).data;
    let s = 0, n = 0;
    for (let i = 3; i < d.length; i += 4) { s += d[i]; n++; }
    return n ? s / n / 255 : null;
  } catch (e) { return null; }
};

// Cerca un punto INTERNO a una cella (alpha piena su tutta la finestra).
// Necessario: a coordinate fisse si finiva su un gap e l'alpha restava
// costante, rendendo l'hover non misurabile.
window.__P.findOpaque = (canvasSel, half) => {
  const c = document.querySelector(canvasSel);
  if (!c) return null;
  const dpr = c.width / c.clientWidth;
  const W = c.clientWidth, H = c.clientHeight;
  const g = c.getContext('2d');
  // spirale grossolana attorno al centro, evitando la navbar
  for (let ring = 0; ring < 14; ring++) {
    for (let k = 0; k < 16; k++) {
      const ang = (k / 16) * Math.PI * 2;
      const rad = ring * 26;
      const cx = Math.round(W / 2 + Math.cos(ang) * rad);
      const cy = Math.round(H / 2 + Math.sin(ang) * rad);
      if (cx < 60 || cx > W - 60 || cy < 120 || cy > H - 60) continue;
      const x = Math.round(cx * dpr - half), y = Math.round(cy * dpr - half);
      if (x < 0 || y < 0 || x + half * 2 > c.width || y + half * 2 > c.height) continue;
      let d;
      try { d = g.getImageData(x, y, half * 2, half * 2).data; } catch (e) { return null; }
      let min = 255;
      for (let i = 3; i < d.length; i += 4) if (d[i] < min) min = d[i];
      if (min === 255) return { cx, cy };
    }
  }
  return null;
};

// Variante LEGGERA: legge UNA sola riga stretta, scelta una volta sola.
// La patch 1280x24 costava troppo e faceva droppare frame; i drop corrompono
// il rapporto di decadimento per frame, che è proprio la grandezza da misurare.
window.__P.pickRow = (canvasSel) => {
  const c = document.querySelector(canvasSel);
  if (!c) return null;
  const g = c.getContext('2d');
  const W = Math.min(c.width, 900);
  for (let y = Math.floor(c.height * 0.30); y < c.height * 0.72; y += 7) {
    let d;
    try { d = g.getImageData(0, y, W, 1).data; } catch (e) { return null; }
    let edges = 0;
    for (let i = 1; i < W; i++) if (d[(i-1)*4+3] < 128 && d[i*4+3] >= 128) edges++;
    if (edges >= 4) return { y, W };
  }
  return null;
};

window.__P.pitchRow = (canvasSel, row) => {
  const c = document.querySelector(canvasSel);
  if (!c || !row) return null;
  let d;
  try { d = c.getContext('2d').getImageData(0, row.y, row.W, 1).data; }
  catch (e) { return { error: e.name }; }
  const pos = [];
  for (let i = 1; i < row.W; i++) {
    const a0 = d[(i-1)*4+3], a1 = d[i*4+3];
    if (a0 < 128 && a1 >= 128) { const t = (128 - a0) / (a1 - a0 || 1); pos.push(i - 1 + t); }
  }
  if (pos.length < 3) return { pitch: 0, zoom: null, edges: pos.length };
  const diffs = [];
  for (let i = 1; i < pos.length; i++) diffs.push(pos[i] - pos[i-1]);
  diffs.sort((a, b) => a - b);
  const med = diffs[Math.floor(diffs.length / 2)];
  if (!(med > 4)) return { pitch: 0, zoom: null, edges: pos.length };
  const x0 = pos[0];
  let sx = 0, sy = 0, sxx = 0, sxy = 0, n = 0;
  for (const p of pos) { const k = Math.round((p - x0) / med); sx += k; sy += p; sxx += k*k; sxy += k*p; n++; }
  const den = n * sxx - sx * sx;
  if (!den) return { pitch: 0, zoom: null, edges: n };
  const slope = (n * sxy - sx * sy) / den;
  const dpr = c.width / c.clientWidth;
  return { pitch: slope, zoom: slope / (60 * dpr), edges: n };
};

// Campionatore generico a 60fps.
window.__P.record = (label, fn, ms) => new Promise((resolve) => {
  const rec = [];
  const t0 = performance.now();
  const tick = () => {
    const t = performance.now() - t0;
    let v = null;
    try { v = fn(); } catch (e) { v = null; }
    rec.push({ t: +t.toFixed(2), v });
    if (t < ms) requestAnimationFrame(tick);
    else { window.__P[label] = rec; resolve(rec); }
  };
  requestAnimationFrame(tick);
});
`;

const op = (sel, i = 0) => `(() => { const e = document.querySelectorAll('${sel}')[${i}]; return e ? getComputedStyle(e).opacity : null; })()`;

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });

  if (CONF.untaint) {
    await ctx.route('**://cdn.sanity.io/**', async (route) => {
      const res = await route.fetch();
      await route.fulfill({ response: res, headers: { ...res.headers(), 'access-control-allow-origin': '*' } });
    });
  }

  const page = await ctx.newPage();
  // NB: si è provato a forzare willReadFrequently per abbattere il costo del
  // readback, ma sposta il canvas su backing CPU e il disegno (144 immagini per
  // frame) diventa il nuovo collo di bottiglia: 18 fps. Meglio canvas accelerato
  // + una lettura piccola per frame.
  if (CONF.untaint) {
    await page.addInitScript(() => {
      const Native = window.Image;
      function Patched(...a) { const i = new Native(...a); i.crossOrigin = 'anonymous'; return i; }
      Patched.prototype = Native.prototype;
      window.Image = Patched;
    });
  }
  await page.addInitScript(PROBES);

  const results = { target: TARGET, url: CONF.url, scenarios: {} };
  const S = CONF.sel;

  /* ── S5 + S4: fade del canvas e tooltip, dal load ──────────────────────── */
  await page.addInitScript(() => {
    window.__loadRec = [];
    const t0 = performance.now();
    const tick = () => {
      const c = document.querySelector('.pixel-grid canvas');
      const tt = document.querySelector('.intro-tooltip');
      window.__loadRec.push({
        t: +(performance.now() - t0).toFixed(2),
        canvasOp: c ? getComputedStyle(c).opacity : null,
        tipOp: tt ? getComputedStyle(tt).opacity : null,
      });
      if (performance.now() - t0 < 12000) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  await page.goto(CONF.url, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForTimeout(13000);
  results.scenarios.loadSequence = await page.evaluate(() => window.__loadRec);

  // frame rate effettivo del campionamento (per onestà del confronto)
  const fr = await page.evaluate(() => new Promise((r) => {
    const ts = []; let n = 0;
    const tick = (t) => { ts.push(t); if (++n < 90) requestAnimationFrame(tick); else {
      const d = []; for (let i = 1; i < ts.length; i++) d.push(ts[i] - ts[i-1]);
      d.sort((a,b)=>a-b);
      r({ medianDelta: d[Math.floor(d.length/2)], fps: 1000 / d[Math.floor(d.length/2)] });
    }};
    requestAnimationFrame(tick);
  }));
  results.frameRate = fr;

  // L'originale entra in idle dopo 7 s (§G4) e ne esce con un tween da 1200 ms.
  // Prima di ogni scenario: sveglia + attesa che il tween sia finito e assestato.
  // PRE-WARM: sull'originale il primo passaggio a Natural Grid costruisce 235
  // <img> e blocca il thread ~900 ms, rendendo il crossfade non campionabile.
  // Il costo di costruzione è una-tantum e NON è un parametro di animazione:
  // lo si paga prima di misurare, poi si torna a Pixel e si misura pulito.
  const prewarm = async () => {
    try {
      await page.locator(CONF.sel.viewNatural).first().click();
      await page.waitForTimeout(3500);
      await page.locator('[data-view="pixel"], button[aria-label="Pixel Grid view"]').first().click();
      await page.waitForTimeout(2500);
    } catch (e) { console.warn('  [!] prewarm fallito:', e.message); }
  };

  const keepAwake = async (settle = 2000) => {
    await page.mouse.move(700 + Math.random() * 8, 430 + Math.random() * 8);
    await page.mouse.move(720 + Math.random() * 8, 450 + Math.random() * 8);
    await page.waitForTimeout(settle);
  };

  await prewarm();

  /* ── S1: zoom step, curva di convergenza del lerp ──────────────────────── */
  await keepAwake();
  results.scenarios.zoomBaseline = await page.evaluate((s) => window.__P.pitch(s), S.canvas);

  // Riga scelta una volta sola: durante la registrazione si legge solo quella.
  const row = await page.evaluate((s) => window.__P.pickRow(s), S.canvas);
  results.scenarios.zoomRow = row;
  const zoomRec = page.evaluate(
    ([sel, r]) => window.__P.record('zoom', () => {
      const p = window.__P.pitchRow(sel, r);
      return { ...(p || {}), gt: window.__cloneState ? window.__cloneState.zoom : null };
    }, 2600),
    [S.canvas, row],
  );
  await page.waitForTimeout(120);
  await page.click(S.zoomIn);
  results.scenarios.zoomStep = await zoomRec;

  await page.waitForTimeout(600);
  results.scenarios.zoomAfter = await page.evaluate((s) => window.__P.pitch(s), S.canvas);

  /* ── S6: hover su una cella ────────────────────────────────────────────── */
  await keepAwake();
  const box = await page.locator(S.canvas).boundingBox();
  // Punto scelto a runtime dentro una cella: a coordinate fisse si cadeva su
  // un gap e l'alpha restava costante (hover non misurabile sull'originale).
  const pt = await page.evaluate((s) => window.__P.findOpaque(s, 7), S.canvas);
  if (!pt) { console.warn('  [!] nessun punto opaco trovato: hover non misurabile'); }
  const hx = pt ? pt.cx : Math.round(box.width * 0.42);
  const hy = pt ? pt.cy : Math.round(box.height * 0.58);
  results.scenarios.hoverPoint = { ...(pt || {}), fallback: !pt };
  // parcheggia il mouse lontano, su una cella diversa
  await page.mouse.move(box.x + hx - 150, box.y + hy - 150);
  await page.waitForTimeout(700);

  const hoverRec = page.evaluate(
    ([sel, x, y]) => window.__P.record('hover', () => window.__P.alphaAt(sel, x, y, 7), 1200),
    [S.canvas, hx, hy],
  );
  await page.waitForTimeout(100);
  await page.mouse.move(box.x + hx, box.y + hy);
  results.scenarios.hoverIn = await hoverRec;

  const leaveRec = page.evaluate(
    ([sel, x, y]) => window.__P.record('leave', () => window.__P.alphaAt(sel, x, y, 7), 1200),
    [S.canvas, hx, hy],
  );
  await page.waitForTimeout(100);
  await page.mouse.move(box.x + hx - 150, box.y + hy - 150);
  results.scenarios.hoverOut = await leaveRec;

  /* ── S3: scrim navbar all'apertura dei filtri ──────────────────────────── */
  await keepAwake();
  const scrimRec = page.evaluate(
    ([sel]) => window.__P.record('scrim', () => {
      const n = document.querySelector(sel);
      return n ? parseFloat(getComputedStyle(n, '::after').height) : null;
    }, 1000),
    [S.navbar],
  );
  await page.waitForTimeout(100);
  // Il selettore matcha due bottoni (desktop + mobile): serve quello visibile.
  const fbtns = await page.locator(S.filters).all();
  let clicked = false;
  for (const b of fbtns) {
    if (await b.isVisible().catch(() => false)) { await b.click(); clicked = true; break; }
  }
  if (!clicked) console.warn('  [!] nessun bottone filtri visibile');
  results.scenarios.filtersScrim = await scrimRec;
  results.scenarios.filtersOpened = clicked && await page.evaluate(
    (sel) => { const n = document.querySelector(sel); return n ? /filters-open/.test(n.className) : null; }, S.navbar);
  await page.waitForTimeout(400);

  /* ── S2: crossfade del View toggle ─────────────────────────────────────── */
  await keepAwake();
  const viewRec = page.evaluate(
    ([sel]) => window.__P.record('view', () =>
      [...document.querySelectorAll(sel)].map((e) => parseFloat(getComputedStyle(e).opacity)), 1600),
    [S.layers],
  );
  await page.waitForTimeout(100);
  await page.locator(S.viewNatural).first().click();
  results.scenarios.viewCrossfade = await viewRec;

  fs.writeFileSync(path.join(OUT, `${TARGET}.json`), JSON.stringify(results, null, 1));
  console.log(`[${TARGET}] scritto ${path.join('research/raw/parity', TARGET + '.json')}`);
  console.log(`  frame rate campionamento: ${fr.fps.toFixed(1)} fps (delta mediano ${fr.medianDelta.toFixed(2)} ms)`);
  console.log(`  pitch prima: ${JSON.stringify(results.scenarios.zoomBaseline)}  dopo: ${JSON.stringify(results.scenarios.zoomAfter)}`);
  const tipN = results.scenarios.loadSequence.filter((p) => p.tipOp !== null).length;
  console.log(`  tooltip: ${tipN} campioni non nulli · filtri aperti: ${results.scenarios.filtersOpened}`);
  console.log(`  campioni: zoom ${results.scenarios.zoomStep.length}, hoverIn ${results.scenarios.hoverIn.length}, view ${results.scenarios.viewCrossfade.length}`);
  await browser.close();
})();
