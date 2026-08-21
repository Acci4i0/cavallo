// Smoke test del clone: errori console, fase raggiunta, interazioni base.
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })).newPage();
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));

  await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(4000);

  const s = await page.evaluate(() => {
    const c = document.querySelector('.pixel-grid canvas');
    const ctx = c.getContext('2d');
    // conta pixel non trasparenti: verifica che si stia disegnando davvero
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let painted = 0;
    for (let i = 3; i < d.length; i += 4 * 200) if (d[i] > 0) painted++;
    return {
      phase: document.documentElement.dataset.phase,
      canvasOpacity: getComputedStyle(c).opacity,
      canvasSize: [c.width, c.height],
      cssSize: [c.style.width, c.style.height],
      paintedSamples: painted,
      zoomLabel: document.querySelector('[data-zoom-label]')?.textContent,
      cursor: getComputedStyle(c).cursor,
      naturalItems: document.querySelectorAll('.grid > a').length,
      filters: document.querySelectorAll('.filter').length,
    };
  });
  console.log('stato dopo il load:', JSON.stringify(s, null, 1));

  // zoom +
  await page.click('[data-zoom-in]');
  await page.waitForTimeout(1200);
  console.log('zoom dopo +:', await page.evaluate(() => document.querySelector('[data-zoom-label]').textContent));

  // filtri
  await page.click('[data-filters-toggle]');
  await page.waitForTimeout(400);
  console.log('voci filtro:', await page.evaluate(() => document.querySelectorAll('.filter').length),
              '| toggle:', await page.evaluate(() => document.querySelector('[data-filters-toggle]').textContent));

  // view natural
  await page.click('[data-view="natural"]');
  await page.waitForTimeout(1200);
  const ng = await page.evaluate(() => {
    const g = document.querySelector('.grid');
    const first = g.querySelector('a');
    return {
      active: document.querySelector('[data-layer=natural]').classList.contains('active'),
      cols: getComputedStyle(g).gridTemplateColumns.split(' ').length,
      scrollable: g.scrollHeight > g.clientHeight,
      extraSpace: first?.style.getPropertyValue('--extra-space'),
      progress: g.style.getPropertyValue('--scroll-progress'),
    };
  });
  console.log('natural grid:', JSON.stringify(ng));

  // parallasse sotto scroll
  await page.evaluate(() => { document.querySelector('.grid').scrollTop = 600; });
  await page.waitForTimeout(300);
  console.log('progress dopo scroll:', await page.evaluate(() => document.querySelector('.grid').style.getPropertyValue('--scroll-progress')));

  await page.click('[data-view="pixel"]');
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'research/raw/clone-shot.png' });

  console.log('\nERRORI CONSOLE:', errs.length ? errs : 'nessuno');
  await browser.close();
})();
