// Verifica: si riesce a leggere i pixel del canvas dell'originale?
// Serve per misurare zoom/hover per frame in Fase 3.
const { chromium } = require('playwright');

(async () => {
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });

  // 1) inietta CORS sulle immagini del CDN
  await ctx.route('**://cdn.sanity.io/**', async (route) => {
    const res = await route.fetch();
    await route.fulfill({
      response: res,
      headers: { ...res.headers(), 'access-control-allow-origin': '*' },
    });
  });

  const p = await ctx.newPage();
  // 2) forza crossOrigin su ogni Image PRIMA che venga assegnato il src
  await p.addInitScript(() => {
    const Native = window.Image;
    function Patched(...a) {
      const img = new Native(...a);
      img.crossOrigin = 'anonymous';
      return img;
    }
    Patched.prototype = Native.prototype;
    window.Image = Patched;
  });

  await p.goto('https://jinleeoffice.com/', { waitUntil: 'networkidle', timeout: 90000 });
  await p.waitForTimeout(8000);

  const r = await p.evaluate(() => {
    const c = document.querySelector('.pixel-grid canvas');
    if (!c) return { ok: false, why: 'no canvas' };
    try {
      const g = c.getContext('2d');
      const row = g.getImageData(0, Math.floor(c.height / 2), c.width, 1).data;
      let nonWhite = 0;
      for (let i = 0; i < row.length; i += 4) if (row[i] < 200) nonWhite++;
      return { ok: true, w: c.width, h: c.height, sampled: row.length / 4, darkPixels: nonWhite };
    } catch (e) {
      return { ok: false, why: e.name + ': ' + e.message };
    }
  });
  console.log('lettura pixel canvas originale:', JSON.stringify(r));
  await b.close();
})();
