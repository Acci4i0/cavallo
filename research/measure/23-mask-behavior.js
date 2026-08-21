/**
 * FASE 3 — comportamento della maschera, non solo forma.
 * Risponde per misura a: quando parte, se si ferma e su quale frame, cosa
 * succede alle celle spente, come cambia con zoom/filtri/view, e su mobile.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const RAW = path.join(__dirname, '..', 'raw', 'mask');
fs.mkdirSync(RAW, { recursive: true });
const SITE = 'https://jinleeoffice.com/';

const PROBE = `
window.__B = { log: [] };
// Firma compatta dello stato disegnato: numero di celle accese + hash.
// Serve a dire SE la maschera cambia, senza il costo di estrarre la matrice.
window.__B.sig = () => {
  const c = document.querySelector('.pixel-grid canvas');
  if (!c || !c.width) return null;
  const g = c.getContext('2d');
  let d;
  try { d = g.getImageData(0, 0, c.width, c.height); } catch (e) { return { err: e.name }; }
  const a = d.data;
  let on = 0, h = 2166136261;
  // campiona a griglia rada: basta per distinguere i frame
  for (let y = 0; y < c.height; y += 6) {
    for (let x = 0; x < c.width; x += 6) {
      const v = a[(y * c.width + x) * 4 + 3] > 128 ? 1 : 0;
      if (v) { on++; h ^= (x * 73856093) ^ (y * 19349663); h = (h * 16777619) >>> 0; }
    }
  }
  return { on, h };
};
window.__B.watch = (label, ms) => new Promise((res) => {
  const seq = []; const t0 = performance.now();
  let prev = null, prevT = t0;
  const tick = () => {
    const now = performance.now();
    const s = window.__B.sig();
    if (s && !s.err) {
      const k = s.on + ':' + s.h;
      if (k !== prev) {
        if (seq.length) seq[seq.length - 1].dur = +(now - prevT).toFixed(1);
        seq.push({ t: +(now - t0).toFixed(1), on: s.on, dur: null });
        prev = k; prevT = now;
      }
    }
    if (now - t0 < ms) requestAnimationFrame(tick);
    else { if (seq.length) seq[seq.length - 1].dur = +(now - prevT).toFixed(1); res(seq); }
  };
  requestAnimationFrame(tick);
});
`;

async function makePage(browser, viewport, isMobile) {
  const ctx = await browser.newContext({
    viewport, deviceScaleFactor: 2, isMobile, hasTouch: isMobile,
    userAgent: isMobile ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' : undefined,
  });
  await ctx.route('**://cdn.sanity.io/**', async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, headers: { ...res.headers(), 'access-control-allow-origin': '*' } });
  });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    const N = window.Image;
    function P(...a) { const i = new N(...a); i.crossOrigin = 'anonymous'; return i; }
    P.prototype = N.prototype; window.Image = P;
  });
  await page.addInitScript(PROBE);
  return { ctx, page };
}

const stats = (seq) => {
  const d = seq.map((s) => s.dur).filter((x) => x > 0).sort((a, b) => a - b);
  if (!d.length) return { n: seq.length, med: null };
  return { n: seq.length, med: d[Math.floor(d.length / 2)], p10: d[Math.floor(d.length * .1)], p90: d[Math.floor(d.length * .9)] };
};

(async () => {
  const browser = await chromium.launch({ headless: true });
  const R = {};

  /* ── A. dal load: intro, poi stato di riposo, poi idle ─────────────────── */
  {
    const { ctx, page } = await makePage(browser, { width: 1600, height: 1200 }, false);
    await page.goto(SITE, { waitUntil: 'domcontentloaded', timeout: 90000 });
    // registra ininterrottamente 30 s dal caricamento
    const seq = await page.evaluate(() => window.__B.watch('load', 30000));
    R.fromLoad = seq;

    // segmenta: intro veloce (~50ms), riposo (lungo), idle (~100ms)
    const fast = seq.filter((s) => s.dur > 20 && s.dur < 80);
    const slow = seq.filter((s) => s.dur >= 80 && s.dur < 160);
    const rest = seq.filter((s) => s.dur >= 400);
    R.segments = {
      introFrames: fast.length, introMed: stats(fast).med,
      idleFrames: slow.length, idleMed: stats(slow).med,
      pauses: rest.map((s) => ({ t: s.t, dur: s.dur, on: s.on })),
    };
    console.log('=== A. sequenza dal caricamento (30 s) ===');
    console.log(`  cambi totali: ${seq.length}`);
    console.log(`  frame a passo ~50ms (intro): ${fast.length}, mediana ${stats(fast).med}ms`);
    console.log(`  frame a passo ~100ms (idle): ${slow.length}, mediana ${stats(slow).med}ms`);
    console.log(`  pause >400ms: ${rest.length} →`, JSON.stringify(rest.map((s) => ({ t: s.t, dur: s.dur }))).slice(0, 300));
    await ctx.close();
  }

  /* ── B. stato "done": la maschera è ferma? su quale frame? ─────────────── */
  {
    const { ctx, page } = await makePage(browser, { width: 1600, height: 1200 }, false);
    await page.goto(SITE, { waitUntil: 'networkidle', timeout: 90000 });
    await page.waitForTimeout(14000); // dopo l'intro, prima dell'idle
    // tiene sveglio per impedire l'idle, e osserva 5 s
    const t = setInterval(() => page.mouse.move(800 + Math.random() * 10, 600).catch(() => {}), 1200);
    const seq = await page.evaluate(() => window.__B.watch('done', 5000));
    clearInterval(t);
    R.doneState = seq;
    console.log('\n=== B. stato di riposo (attività continua, niente idle) ===');
    console.log(`  cambi di maschera in 5 s: ${seq.length - 1} → ${seq.length <= 1 ? 'FERMA' : 'in movimento'}`);
    console.log(`  celle accese: ${seq.map((s) => s.on).join(', ')}`);
    await ctx.close();
  }

  /* ── C. zoom: la maschera viene ricampionata o scalata? ────────────────── */
  {
    const { ctx, page } = await makePage(browser, { width: 1600, height: 1200 }, false);
    await page.goto(SITE, { waitUntil: 'networkidle', timeout: 90000 });
    await page.waitForTimeout(14000);
    const t = setInterval(() => page.mouse.move(800 + Math.random() * 10, 600).catch(() => {}), 1200);
    const read = async () => {
      await page.waitForTimeout(2500);
      return page.evaluate(() => {
        const c = document.querySelector('.pixel-grid canvas');
        const g = c.getContext('2d');
        const d = g.getImageData(0, 0, c.width, c.height).data;
        // passo dai fronti + conteggio celle accese via bbox/passo
        let x0 = c.width, x1 = -1, y0 = c.height, y1 = -1;
        for (let y = 0; y < c.height; y += 2) for (let x = 0; x < c.width; x += 2) {
          if (d[(y * c.width + x) * 4 + 3] > 16) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
        }
        let bestN = 0, pitch = 0;
        for (let y = Math.max(0, y0); y <= y1; y += 4) {
          const pos = [];
          for (let x = Math.max(1, x0); x <= x1; x++) {
            const a0 = d[(y * c.width + x - 1) * 4 + 3], a1 = d[(y * c.width + x) * 4 + 3];
            if (a0 < 128 && a1 >= 128) pos.push(x);
          }
          if (pos.length > bestN) {
            bestN = pos.length;
            const df = []; for (let i = 1; i < pos.length; i++) df.push(pos[i] - pos[i - 1]);
            df.sort((a, b) => a - b); pitch = df[Math.floor(df.length * .25)] || 0;
          }
        }
        return { bbox: [x0, y0, x1, y1], w: x1 - x0, h: y1 - y0, pitch,
                 cellsW: pitch ? Math.round((x1 - x0) / pitch) + 1 : null,
                 cellsH: pitch ? Math.round((y1 - y0) / pitch) + 1 : null };
      });
    };
    const zoomIn = 'button[aria-label="Zoom in"]';
    const zoomOut = 'button[aria-label="Zoom out"]';
    R.zoomLevels = [];
    R.zoomLevels.push({ step: 'default', ...(await read()) });
    await page.locator(zoomIn).first().click(); R.zoomLevels.push({ step: '+1', ...(await read()) });
    await page.locator(zoomOut).first().click();
    await page.locator(zoomOut).first().click(); R.zoomLevels.push({ step: '-1', ...(await read()) });
    clearInterval(t);
    console.log('\n=== C. zoom: ricampionata o scalata? ===');
    for (const z of R.zoomLevels) {
      console.log(`  ${String(z.step).padEnd(8)} passo=${String(z.pitch).padStart(4)}px  celle=${z.cellsW}×${z.cellsH}  bbox=${z.w}×${z.h}`);
    }
    const same = new Set(R.zoomLevels.map((z) => `${z.cellsW}x${z.cellsH}`)).size === 1;
    console.log(`  → conteggio celle ${same ? 'INVARIATO' : 'CAMBIATO'} ⇒ maschera ${same ? 'SCALATA (non ricampionata)' : 'RICAMPIONATA'}`);
    await ctx.close();
  }

  /* ── D. mobile ──────────────────────────────────────────────────────────── */
  {
    const { ctx, page } = await makePage(browser, { width: 390, height: 844 }, true);
    await page.goto(SITE, { waitUntil: 'domcontentloaded', timeout: 90000 });
    const seq = await page.evaluate(() => window.__B.watch('mobile', 26000));
    R.mobile = seq;
    const fast = seq.filter((s) => s.dur > 20 && s.dur < 80);
    const slow = seq.filter((s) => s.dur >= 80 && s.dur < 160);
    console.log('\n=== D. mobile 390×844 ===');
    console.log(`  cambi totali: ${seq.length}`);
    console.log(`  passo ~50ms: ${fast.length} (mediana ${stats(fast).med}) · passo ~100ms: ${slow.length} (mediana ${stats(slow).med})`);
    console.log(`  celle accese (primi 12): ${seq.slice(0, 12).map((s) => s.on).join(', ')}`);
    await ctx.close();
  }

  fs.writeFileSync(path.join(RAW, 'behavior.json'), JSON.stringify(R, null, 1));
  console.log('\nscritto research/raw/mask/behavior.json');
  await browser.close();
})();
