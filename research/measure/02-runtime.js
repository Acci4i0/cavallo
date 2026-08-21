// FASE 1 — misura runtime: valida lerp, sequenza di loading, UI, parametri Sanity.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, '..', 'raw');
const SITE = 'https://jinleeoffice.com/';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const out = {};

  // --- A. sequenza di loading: campiona lo stato del canvas a 60fps dal navigation start
  await page.addInitScript(() => {
    window.__samples = [];
    window.__t0 = performance.now();
    const tick = () => {
      const c = document.querySelector('.pixel-grid canvas');
      if (c) {
        const cs = getComputedStyle(c);
        window.__samples.push({
          t: +(performance.now() - window.__t0).toFixed(2),
          opacity: cs.opacity,
          transition: cs.transition,
        });
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  await page.goto(SITE, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForTimeout(9000);
  out.loadingSamples = await page.evaluate(() => window.__samples.slice(0, 700));

  // --- B. UI reale: struttura navbar / zoom / filter / view
  out.ui = await page.evaluate(() => {
    const pick = (sel) => [...document.querySelectorAll(sel)].map(e => ({
      tag: e.tagName, cls: e.className, text: (e.textContent || '').trim().slice(0, 60),
      aria: e.getAttribute('aria-label'), html: e.outerHTML.slice(0, 200),
    }));
    return {
      navbar: pick('.navbar > *'),
      zoom: pick('[class*=zoom] *'),
      filters: pick('[class*=filter]'),
      view: pick('[class*=view__]'),
      canvases: [...document.querySelectorAll('canvas')].map(c => ({
        cls: c.className, w: c.width, h: c.height,
        cssW: c.style.width, cssH: c.style.height,
        ctx: !!c.getContext('webgl') ? 'webgl-capable' : '2d',
      })),
      cursorOnCanvas: getComputedStyle(document.querySelector('.pixel-grid canvas') || document.body).cursor,
      customCursorEl: !!document.querySelector('[class*=cursor]'),
      tooltip: (document.querySelector('.intro-tooltip') || {}).textContent || null,
    };
  });

  // --- C. drag + inerzia: misura la posizione per frame durante un drag e dopo il rilascio
  await page.evaluate(() => {
    window.__drag = [];
    const c = document.querySelector('.pixel-grid canvas');
    const t0 = performance.now();
    const g = () => {
      // legge lo stato reale via pixel-diff non è possibile: campiona invece il DOM zoom label
      const z = document.querySelector('[class*=zoom]');
      window.__drag.push({ t: +(performance.now() - t0).toFixed(2), z: z ? z.textContent.trim() : null });
      requestAnimationFrame(g);
    };
    requestAnimationFrame(g);
  });
  const box = await page.locator('.pixel-grid canvas').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(box.x + box.width / 2 - i * 18, box.y + box.height / 2 - i * 10);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  await page.waitForTimeout(2500);
  out.zoomLabelDuringDrag = await page.evaluate(() => window.__drag.slice(0, 200));

  // --- D. zoom: clicca + e campiona la label percentuale per frame
  const zoomBtns = await page.locator('.zoom button').all();
  out.zoomBtnCount = zoomBtns.length;
  if (zoomBtns.length) {
    await page.evaluate(() => {
      window.__zoom = [];
      const t0 = performance.now();
      const el = document.querySelector('.zoom');
      const g = () => {
        window.__zoom.push({ t: +(performance.now() - t0).toFixed(2), label: el ? el.textContent.trim() : null });
        requestAnimationFrame(g);
      };
      requestAnimationFrame(g);
    });
    await zoomBtns[0].click();
    await page.waitForTimeout(2000);
    out.zoomSamples = await page.evaluate(() => window.__zoom.slice(0, 150));
  }

  // --- E. parametri immagine Sanity effettivamente richiesti
  const urls = [];
  page.on('request', r => { if (r.url().includes('cdn.sanity.io')) urls.push(r.url()); });
  await page.waitForTimeout(1500);
  out.sanityParams = [...new Set(urls.map(u => (u.split('?')[1] || '')))].slice(0, 20);

  fs.writeFileSync(path.join(OUT, 'runtime.json'), JSON.stringify(out, null, 2));

  console.log('=== UI: navbar ===');
  out.ui.navbar.forEach(n => console.log(' ', n.tag, '|', n.cls, '|', JSON.stringify(n.text)));
  console.log('=== UI: zoom ===');
  out.ui.zoom.forEach(n => console.log(' ', n.tag, '|', n.cls, '|', JSON.stringify(n.text)));
  console.log('=== UI: filters ===');
  out.ui.filters.slice(0, 15).forEach(n => console.log(' ', n.tag, '|', n.cls, '|', JSON.stringify(n.text)));
  console.log('=== UI: view ===');
  out.ui.view.forEach(n => console.log(' ', n.tag, '|', n.cls, '|', JSON.stringify(n.text), '|', n.aria));
  console.log('=== canvases ===', JSON.stringify(out.ui.canvases));
  console.log('=== cursor on canvas ===', out.ui.cursorOnCanvas, '| custom cursor el:', out.ui.customCursorEl);
  console.log('=== tooltip ===', JSON.stringify(out.ui.tooltip));
  console.log('=== sanity params ===', JSON.stringify(out.sanityParams, null, 1));
  console.log('=== loading opacity transitions (cambi) ===');
  let prev = null;
  for (const s of out.loadingSamples) {
    const k = s.opacity + '|' + s.transition;
    if (k !== prev) { console.log(`  t=${s.t}ms opacity=${s.opacity} transition=${s.transition}`); prev = k; }
  }
  console.log('=== zoom label samples (cambi) ===');
  let pz = null;
  for (const s of (out.zoomSamples || [])) {
    if (s.label !== pz) { console.log(`  t=${s.t}ms  ${JSON.stringify(s.label)}`); pz = s.label; }
  }
  await browser.close();
})();
