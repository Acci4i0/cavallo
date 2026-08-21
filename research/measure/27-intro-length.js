/**
 * Quanti passi dura il galoppo di intro, e a che ritmo.
 * Determina introCycles: passi = (introCycles − 1)·n + ceil(n·0.85), n = 58.
 * Sonda leggera (riduzione a una piccola matrice) per non perdere frame.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const URL = process.argv[2] || 'https://jinleeoffice.com/';
const PROBE = `
window.__I = {};
window.__I.run = (ms) => new Promise((res) => {
  const seq = []; const t0 = performance.now();
  let prev = null, prevT = t0;
  const off = document.createElement('canvas');
  off.width = 64; off.height = 48;
  const og = off.getContext('2d', { willReadFrequently: true });
  og.imageSmoothingEnabled = true;
  const tick = () => {
    const now = performance.now();
    const c = document.querySelector('.pixel-grid canvas');
    if (c && c.width) {
      og.clearRect(0, 0, 64, 48);
      og.drawImage(c, 0, 0, c.width, c.height, 0, 0, 64, 48);
      const d = og.getImageData(0, 0, 64, 48).data;
      let k = '';
      for (let i = 0; i < 64 * 48; i++) k += d[i * 4 + 3] > 40 ? '1' : '0';
      if (k !== prev) {
        if (seq.length) seq[seq.length - 1].dur = +(now - prevT).toFixed(1);
        seq.push({ t: +(now - t0).toFixed(1), dur: null });
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
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  if (URL.includes('jinleeoffice')) {
    await ctx.route('**://cdn.sanity.io/**', async (r) => {
      const res = await r.fetch();
      await r.fulfill({ response: res, headers: { ...res.headers(), 'access-control-allow-origin': '*' } });
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
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
  const seq = await page.evaluate(() => window.__I.run(26000));
  await browser.close();

  // fase veloce = campioni con durata < 75 ms
  const fast = seq.filter((s) => s.dur > 15 && s.dur < 75);
  const slow = seq.filter((s) => s.dur >= 75 && s.dur < 160);
  const med = (a) => { const d = a.map((x) => x.dur).sort((x, y) => x - y); return d.length ? d[Math.floor(d.length / 2)] : null; };

  console.log(`URL: ${URL}`);
  console.log(`campioni totali: ${seq.length}`);
  console.log(`  fase VELOCE  (intro): ${fast.length} passi · mediana ${med(fast)}ms`);
  if (fast.length) console.log(`     da t=${fast[0].t}ms a t=${fast.at(-1).t}ms · durata ${(fast.at(-1).t - fast[0].t).toFixed(0)}ms`);
  console.log(`  fase LENTA   (idle):  ${slow.length} passi · mediana ${med(slow)}ms`);

  const n = 58;
  console.log('\n  passi attesi per introCycles:');
  for (const c of [1, 2, 3]) {
    const steps = (c - 1) * n + Math.ceil(n * 0.85);
    console.log(`    introCycles=${c} → ${steps} passi · ${(steps * 50 / 1000).toFixed(2)}s`);
  }
  fs.writeFileSync(path.join(__dirname, '..', 'raw', 'mask',
    `intro-length-${URL.includes('localhost') ? 'clone' : 'original'}.json`), JSON.stringify({ seq, fast: fast.length, slow: slow.length }, null, 1));
})();
