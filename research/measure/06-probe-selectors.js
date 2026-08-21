// Individua, sull'originale, gli elementi osservabili necessari alla Fase 3.
const { chromium } = require('playwright');

(async () => {
  const b = await chromium.launch({ headless: true });
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await p.goto('https://jinleeoffice.com/', { waitUntil: 'networkidle', timeout: 90000 });
  await p.waitForTimeout(6000);

  const r = await p.evaluate(() => {
    const txt = (e) => (e.textContent || '').trim();
    // cerca l'elemento che contiene la percentuale di zoom
    const pctNodes = [...document.querySelectorAll('*')]
      .filter((e) => e.children.length === 0 && /^\d{1,4}%?$/.test(txt(e)))
      .map((e) => ({ tag: e.tagName, cls: e.className, text: txt(e),
                     path: e.parentElement?.className }));
    return {
      zoomHTML: document.querySelector('.zoom')?.outerHTML.slice(0, 600),
      viewHTML: document.querySelector('.view')?.outerHTML.slice(0, 600),
      numericLeaves: pctNodes.slice(0, 20),
      layers: [...document.querySelectorAll('[class*=view-layer],[class*=ui-layer],[class*=main-wrapper]')]
        .map((e) => ({ cls: e.className, op: getComputedStyle(e).opacity })),
      canvasSel: !!document.querySelector('.pixel-grid canvas'),
      navbarAfterH: (() => {
        const n = document.querySelector('.navbar');
        return n ? getComputedStyle(n, '::after').height : null;
      })(),
      tooltip: !!document.querySelector('.intro-tooltip'),
    };
  });
  console.log(JSON.stringify(r, null, 1));
  await b.close();
})();
