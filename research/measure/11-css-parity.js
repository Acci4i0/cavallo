/**
 * FASE 3 — confronto DIRETTO delle dichiarazioni CSS calcolate.
 *
 * Per le meccaniche guidate dal CSS questo è un controllo più forte del fitting
 * di una curva: confronta i valori dichiarati che il browser userà, senza il
 * rumore del campionamento. Il fitting resta utile solo dove l'animazione è in
 * JS (il lerp) e non esiste una dichiarazione da leggere.
 *
 *   node 11-css-parity.js
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const TARGETS = {
  original: 'https://jinleeoffice.com/',
  clone: 'http://localhost:4173/',
};

// [etichetta, selettore, pseudo|null, proprietà...]
const CHECKS = [
  ['view-layer', '.view-layer', null, 'transition-duration', 'transition-timing-function', 'transition-property'],
  ['ui-layer', '.ui-layer', null, 'transition-duration', 'transition-timing-function'],
  ['main-wrapper', '.main-wrapper', null, 'transition-duration', 'transition-timing-function'],
  ['navbar scrim', '.navbar', '::after', 'transition-duration', 'transition-timing-function', 'height'],
  ['tooltip', '.intro-tooltip', null, 'animation-duration', 'animation-timing-function', 'animation-fill-mode', 'padding', 'line-height'],
  ['filter', '.filter', null, 'transition-duration', 'transition-timing-function', 'transition-property', 'opacity'],
  ['view__btn', '.view__btn', null, 'transition-duration', 'transition-timing-function', 'transition-property', 'width', 'height'],
  ['zoom button', '.zoom button', null, 'transition-duration', 'transition-timing-function', 'transition-property'],
  ['canvas', '.pixel-grid canvas', null, 'cursor'],
  ['body', 'body', null, 'font-size', 'letter-spacing', 'line-height', 'text-transform'],
  ['natural grid', '.grid.hide-scrollbar', null, 'grid-template-columns', 'gap', 'overflow-y', 'padding', 'position'],
  ['natural item', '.grid.hide-scrollbar > a', null, 'transform', 'will-change'],
  ['natural img', '.grid.hide-scrollbar img', null, 'transition-duration', 'transition-timing-function'],
];

const VARS = ['--margin', '--gap', '--columns'];

(async () => {
  const browser = await chromium.launch({ headless: true });
  const res = {};

  for (const [name, url] of Object.entries(TARGETS)) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: 'networkidle', timeout: 90000 });
    await page.waitForTimeout(7000);
    // apre filtri e costruisce il natural grid, così tutti gli elementi esistono
    for (const b of await page.locator(name === 'original' ? 'button.navbar__filters' : '[data-filters-toggle]').all()) {
      if (await b.isVisible().catch(() => false)) { await b.click(); break; }
    }
    await page.waitForTimeout(600);
    await page.locator(name === 'original' ? 'button[aria-label="Natural Grid view"]' : '[data-view="natural"]')
      .first().click().catch(() => {});
    await page.waitForTimeout(4000);

    res[name] = await page.evaluate(([checks, vars]) => {
      const out = {};
      for (const [label, sel, pseudo, ...props] of checks) {
        const el = document.querySelector(sel);
        if (!el) { out[label] = { missing: true }; continue; }
        const cs = getComputedStyle(el, pseudo || undefined);
        const o = {};
        for (const p of props) o[p] = cs.getPropertyValue(p);
        out[label] = o;
      }
      const rs = getComputedStyle(document.documentElement);
      out['__vars'] = Object.fromEntries(vars.map((v) => [v, rs.getPropertyValue(v).trim()]));
      return out;
    }, [CHECKS, VARS]);

    await ctx.close();
  }

  // diff
  const rows = [];
  for (const [label, ...rest] of [...CHECKS.map((c) => [c[0]]), ['__vars']]) {
    const a = res.original[label], b = res.clone[label];
    if (!a || !b) continue;
    if (a.missing || b.missing) {
      // assente su ENTRAMBI = corrispondenza (es. il tooltip, staccato dal DOM
      // fuori dallo stato idle su entrambi i target)
      rows.push({
        label, prop: '(elemento)',
        orig: a.missing ? 'assente' : 'presente',
        clone: b.missing ? 'assente' : 'presente',
        ok: !!a.missing === !!b.missing,
      });
      continue;
    }
    for (const k of Object.keys(a)) {
      const va = String(a[k]).trim(), vb = String(b[k] ?? '').trim();
      rows.push({ label, prop: k, orig: va, clone: vb, ok: va === vb });
    }
  }

  fs.writeFileSync(path.join(__dirname, '..', 'raw', 'parity', 'css-diff.json'), JSON.stringify({ res, rows }, null, 1));

  console.log('elemento'.padEnd(15), 'proprietà'.padEnd(26), 'originale'.padEnd(30), 'clone'.padEnd(30), 'ok');
  console.log('-'.repeat(112));
  for (const r of rows) {
    console.log(
      r.label.padEnd(15), r.prop.padEnd(26),
      r.orig.slice(0, 29).padEnd(30), r.clone.slice(0, 29).padEnd(30),
      r.ok ? '✓' : '✗',
    );
  }
  const ok = rows.filter((r) => r.ok).length;
  console.log(`\n${ok}/${rows.length} proprietà identiche`);
  await browser.close();
})();
