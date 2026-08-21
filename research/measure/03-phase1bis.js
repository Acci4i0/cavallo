// FASE 1-bis — (a) stagger pannello Filters, (b) layout Natural Grid.
// Campiona getAnimations() + computed style a 60fps e cattura i chunk lazy.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const beautify = require('js-beautify');

const RAW = path.join(__dirname, '..', 'raw');
const BUN = path.join(__dirname, '..', 'bundles');
const SITE = 'https://jinleeoffice.com/';

// sampler installato nella pagina: registra ogni frame le proprietà chiave degli elementi che matchano
const SAMPLER = `
window.__startSample = (selector, label) => {
  window.__s = window.__s || {};
  const rec = window.__s[label] = [];
  const t0 = performance.now();
  const tick = () => {
    const els = [...document.querySelectorAll(selector)];
    if (els.length) {
      rec.push({
        t: +(performance.now() - t0).toFixed(1),
        items: els.map(e => {
          const c = getComputedStyle(e);
          return {
            op: c.opacity, tr: c.transform, tt: c.transition,
            h: c.height, vis: c.visibility, disp: c.display,
            anims: e.getAnimations().map(a => {
              const ti = a.effect && a.effect.getComputedTiming ? a.effect.getComputedTiming() : {};
              return {
                name: a.animationName || (a.transitionProperty || null),
                dur: ti.duration, delay: ti.delay, ease: ti.easing,
                fill: ti.fill, it: ti.iterations,
              };
            }),
          };
        }),
      });
    }
    if (performance.now() - t0 < 2500) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};
`;

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.addInitScript(SAMPLER);

  // cattura chunk lazy caricati dopo l'interazione
  const lateChunks = new Map();
  let capturing = false;
  page.on('response', async (res) => {
    if (!capturing) return;
    const u = res.url();
    if (!u.includes('jinleeoffice.com/_app/')) return;
    if (lateChunks.has(u)) return;
    try { lateChunks.set(u, await res.text()); } catch {}
  });

  await page.goto(SITE, { waitUntil: 'networkidle', timeout: 90000 });
  await page.waitForTimeout(5000);
  capturing = true;
  const out = {};

  // ---------- (a) FILTERS ----------
  await page.evaluate(() => window.__startSample('.navbar__list *, .navbar__filter-items > *', 'filters'));
  await page.locator('button.navbar__filters').first().click();
  await page.waitForTimeout(2200);
  out.filters = await page.evaluate(() => window.__s.filters || []);
  out.filtersDom = await page.evaluate(() => {
    const l = document.querySelector('.navbar__list');
    return {
      html: l ? l.outerHTML.slice(0, 1500) : null,
      items: [...document.querySelectorAll('.navbar__list button, .navbar__filter-items > *')].map(e => ({
        cls: e.className, text: (e.textContent || '').trim().slice(0, 40),
        op: getComputedStyle(e).opacity, tt: getComputedStyle(e).transition,
        anim: getComputedStyle(e).animation,
      })),
    };
  });

  // chiudi il pannello
  await page.locator('button.navbar__filters').first().click().catch(() => {});
  await page.waitForTimeout(800);

  // ---------- (b) NATURAL GRID ----------
  await page.evaluate(() => window.__startSample('.view-layer, .ui-layer, .main-wrapper', 'viewswap'));
  const natBtn = page.locator('button[aria-label="Natural Grid view"]').first();
  await natBtn.click();
  await page.waitForTimeout(2500);
  out.viewswap = await page.evaluate(() => window.__s.viewswap || []);

  await page.waitForTimeout(2500);
  out.naturalDom = await page.evaluate(() => {
    const cands = ['.natural-grid', '[class*=natural]', '.view-layer.active', 'main'];
    let root = null;
    for (const c of cands) { const e = document.querySelector(c); if (e && e.children.length) { root = e; break; } }
    if (!root) return { found: false };
    const cs = getComputedStyle(root);
    const kids = [...root.children].slice(0, 6).map(e => {
      const k = getComputedStyle(e);
      return {
        tag: e.tagName, cls: e.className,
        pos: k.position, top: k.top, left: k.left, w: k.width, h: k.height,
        gc: k.gridColumn, gr: k.gridRow, transform: k.transform, tt: k.transition,
        aspect: k.aspectRatio,
      };
    });
    return {
      found: true, rootCls: root.className,
      root: {
        display: cs.display, gridTemplateColumns: cs.gridTemplateColumns,
        gap: cs.gap, columns: cs.getPropertyValue('--columns'),
        position: cs.position, overflow: cs.overflow, height: cs.height,
        columnCount: cs.columnCount, flexWrap: cs.flexWrap,
      },
      kids,
      scrollH: root.scrollHeight, clientH: root.clientHeight,
      docScroll: { sh: document.documentElement.scrollHeight, ch: document.documentElement.clientHeight },
      bodyOverflow: getComputedStyle(document.body).overflow,
      imgCount: root.querySelectorAll('img').length,
    };
  });

  // scroll nel natural grid: nativo o custom?
  out.naturalScroll = await page.evaluate(async () => {
    const before = { y: window.scrollY, sh: document.documentElement.scrollHeight };
    window.scrollTo(0, 400);
    await new Promise(r => setTimeout(r, 500));
    const after = { y: window.scrollY };
    const sc = document.scrollingElement;
    return { before, after, scrollBehavior: getComputedStyle(document.documentElement).scrollBehavior,
             scrollerH: sc ? sc.scrollHeight : null };
  });

  // salva i chunk arrivati tardi (= codice del Natural Grid)
  const late = [];
  for (const [u, text] of lateChunks) {
    const base = u.split('/').pop().split('?')[0];
    const isCss = base.endsWith('.css');
    const pretty = isCss ? beautify.css(text, { indent_size: 2 })
                         : beautify.js(text, { indent_size: 2, max_preserve_newlines: 2 });
    const dir = path.join(BUN, 'late');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, base), pretty);
    late.push({ url: u, file: `late/${base}`, lines: pretty.split('\n').length });
  }
  out.lateChunks = late;

  fs.writeFileSync(path.join(RAW, 'phase1bis.json'), JSON.stringify(out, null, 2));

  // ---- report ----
  const changes = (rec, key) => {
    const res = []; let prev = null;
    for (const f of rec) {
      const sig = JSON.stringify(f.items.map(i => i[key]));
      if (sig !== prev) { res.push(`  t=${f.t}ms  ${sig.slice(0, 220)}`); prev = sig; }
    }
    return res;
  };
  console.log('=== FILTERS: n campioni =', out.filters.length);
  console.log('--- opacity per frame (solo cambi) ---');
  changes(out.filters, 'op').slice(0, 25).forEach(l => console.log(l));
  console.log('--- animazioni attive rilevate ---');
  const anims = new Set();
  out.filters.forEach(f => f.items.forEach(i => i.anims.forEach(a => anims.add(JSON.stringify(a)))));
  [...anims].slice(0, 15).forEach(a => console.log('  ', a));
  console.log('--- DOM voci filtro ---');
  (out.filtersDom.items || []).forEach(i => console.log('  ', JSON.stringify(i)));

  console.log('\n=== VIEW SWAP: opacity layer (solo cambi) ===');
  changes(out.viewswap, 'op').slice(0, 25).forEach(l => console.log(l));

  console.log('\n=== NATURAL GRID DOM ===');
  console.log(JSON.stringify(out.naturalDom, null, 1).slice(0, 2600));
  console.log('\n=== NATURAL SCROLL ===', JSON.stringify(out.naturalScroll));
  console.log('\n=== CHUNK TARDIVI ===');
  late.forEach(l => console.log('  ', l.file, l.lines, 'righe'));
  await browser.close();
})();
