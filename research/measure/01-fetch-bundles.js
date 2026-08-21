// FASE 0.3 — scarica tutti i JS/CSS referenziati e li beautifica in /research/bundles/
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const beautify = require('js-beautify');

const OUT = path.join(__dirname, '..', 'bundles');
const SITE = 'https://jinleeoffice.com/';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const seen = new Map();

  page.on('response', async (res) => {
    const url = res.url();
    const type = res.request().resourceType();
    if (!['script', 'stylesheet'].includes(type)) return;
    if (!url.includes('jinleeoffice.com')) return;
    if (seen.has(url)) return;
    try { seen.set(url, await res.text()); } catch {}
  });

  await page.goto(SITE, { waitUntil: 'networkidle', timeout: 90000 });
  // naviga anche /info per catturare i chunk lazy della seconda rotta
  try {
    await page.evaluate(() => {
      const a = [...document.querySelectorAll('a')].find(x => /info/i.test(x.getAttribute('href') || ''));
      if (a) a.click();
    });
    await page.waitForTimeout(4000);
  } catch {}
  await page.waitForTimeout(2000);

  const manifest = [];
  for (const [url, text] of seen) {
    const base = url.split('/').pop().split('?')[0];
    const isCss = base.endsWith('.css');
    const pretty = isCss
      ? beautify.css(text, { indent_size: 2 })
      : beautify.js(text, { indent_size: 2, brace_style: 'collapse,preserve-inline', max_preserve_newlines: 2 });
    const dir = url.includes('/nodes/') ? 'nodes' : url.includes('/entry/') ? 'entry' : isCss ? 'css' : 'chunks';
    fs.mkdirSync(path.join(OUT, dir), { recursive: true });
    const fp = path.join(OUT, dir, base);
    fs.writeFileSync(fp, pretty);
    manifest.push({ url, file: path.relative(OUT, fp), rawBytes: text.length, prettyLines: pretty.split('\n').length });
  }
  // anche l'HTML inline script (dati SSR + hydration)
  const html = await page.content();
  fs.writeFileSync(path.join(OUT, 'page-info.html'), html);

  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.table(manifest.map(m => ({ file: m.file, raw: m.rawBytes, lines: m.prettyLines })));
  await browser.close();
})();
