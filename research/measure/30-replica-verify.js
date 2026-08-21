/**
 * FASE 3 — checklist di verifica della replica, voce per voce.
 * Ricostruisce la matrice DAL DOM RESO (leggendo i transform) e la confronta
 * cella per cella con la sorgente estratta.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const URL = 'http://localhost:4174/replica/';
const src = JSON.parse(fs.readFileSync(path.join(ROOT, '_reference', 'mask-source.json'), 'utf8'));
const G = src.frames[0].gridData;
const COLS = G.cols, ROWS = G.rows;
const RESTING = 49;

const srcMatrix = (i) => {
  const m = new Array(COLS * ROWS).fill(0);
  for (const c of src.frames[i].gridData.cells) m[c.gridRow * COLS + c.gridCol] = 1;
  return m;
};

const results = [];
const check = (item, ok, detail) => { results.push({ item, ok, detail }); };

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })).newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });

  // traccia le richieste: nessuna deve uscire dall'origine locale
  const external = [];
  page.on('request', (r) => { if (!r.url().startsWith('http://localhost')) external.push(r.url()); });

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  // ferma l'animazione e porta alla posa statica
  // ferma intro/idle, poi imposta la posa statica: senza lo stop l'intervallo
  // di intro sovrascrive il frame e si campiona uno stato casuale del galoppo
  await page.evaluate((f) => { window.__replica.stop(); window.__replica.drawFrame(f); }, RESTING);
  await page.waitForTimeout(300);

  /* 1. conteggio celle rese == conteggio celle attive */
  const counts = await page.evaluate((f) => {
    const r = window.__replica, m = r.mask();
    return { visible: r.visibleCells(), matrix: m.frames[f].reduce((a, b) => a + b, 0) };
  }, RESTING);
  check('Conteggio celle rese == celle attive della matrice',
    counts.visible === counts.matrix, `rese ${counts.visible} · matrice ${counts.matrix}`);

  /* 2. matrice ricostruita dal DOM vs sorgente */
  const domMatrix = await page.evaluate(([cols, rows]) => {
    const m = window.__replica.mask();
    const cell = m.grid.cellSize, half = m.grid.spacing / 2;
    const out = new Array(cols * rows).fill(0);
    let bad = 0;
    for (const el of document.querySelectorAll('.cell:not([hidden])')) {
      const t = el.style.transform.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/);
      if (!t) { bad++; continue; }
      const c = Math.round((parseFloat(t[1]) - half) / cell);
      const r = Math.round((parseFloat(t[2]) - half) / cell);
      if (c < 0 || c >= cols || r < 0 || r >= rows) { bad++; continue; }
      out[r * cols + c] = 1;
    }
    return { out, bad };
  }, [COLS, ROWS]);

  const ref = srcMatrix(RESTING);
  let same = 0, diff = 0, onlySrc = 0, onlyDom = 0;
  for (let i = 0; i < ref.length; i++) {
    if (ref[i] === domMatrix.out[i]) same++;
    else { diff++; if (ref[i]) onlySrc++; else onlyDom++; }
  }
  check('Matrice ricostruita dal DOM identica alla sorgente',
    diff === 0, `${same}/${ref.length} celle coincidenti · differenze ${diff} (solo sorgente ${onlySrc}, solo DOM ${onlyDom}) · transform illeggibili ${domMatrix.bad}`);

  /* 2b. allineamento dei bordi della sagoma */
  const bbox = (m) => {
    let c0 = COLS, c1 = -1, r0 = ROWS, r1 = -1;
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (m[r * COLS + c]) {
      if (c < c0) c0 = c; if (c > c1) c1 = c; if (r < r0) r0 = r; if (r > r1) r1 = r;
    }
    return [c0, r0, c1, r1];
  };
  const bs = bbox(ref), bd = bbox(domMatrix.out);
  const edge = bs.map((v, i) => Math.abs(v - bd[i]));
  check('Allineamento sagoma < 2 celle su ogni bordo',
    edge.every((e) => e < 2), `scarti [sx ${edge[0]}, alto ${edge[1]}, dx ${edge[2]}, basso ${edge[3]}] celle · bbox sorgente [${bs}] · DOM [${bd}]`);

  /* 3. anatomia: per costruzione, se la matrice è bit-identica lo è anche l'anatomia */
  check('Anatomia (testa, criniera, zampe ant./post., fantino) nella stessa posizione relativa',
    diff === 0, diff === 0
      ? 'garantito per costruzione: la matrice resa è bit-identica alla sorgente, quindi ogni elemento occupa esattamente le stesse celle'
      : 'NON garantito: la matrice diverge');

  /* 4. rapporto di scala zoom min→max */
  const ratio = await page.evaluate(() => window.__replica.ratioMinMax);
  const expected = 5 / 0.4;
  check('Zoom min→max stesso rapporto di scala dell\'originale',
    Math.abs(ratio - expected) < 1e-9, `replica ${ratio} · originale ${expected} (5 / 0.4)`);

  /* 4b. lo step è quello estratto */
  const step = await page.evaluate(async () => {
    const r = window.__replica;
    r.setZoom(1); const a = r.scale;
    document.querySelector('#zin').click();
    return { a, b: r.scale, zoom: r.zoom };
  });
  check('Step di zoom == ×1.5 estratto',
    Math.abs(step.b / step.a - 1.5) < 1e-9, `rapporto misurato ${(step.b / step.a).toFixed(6)}`);

  /* 5. nessun asset di terze parti */
  check('Nessuna richiesta a origini esterne', external.length === 0,
    external.length ? external.slice(0, 5).join(', ') : 'tutte le richieste su localhost');

  /* 6. errori console */
  check('Nessun errore in console', errs.length === 0, errs.length ? errs.join(' | ') : 'nessuno');

  await page.screenshot({ path: path.join(ROOT, 'research', 'raw', 'mask', 'replica-verify.png') });
  await browser.close();

  /* ── audit statico: asset di terze parti nei file di progetto ───────────── */
  const prodDirs = ['replica', 'src', 'assets'];
  const offenders = [];
  const walk = (d) => {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, f.name);
      if (f.isDirectory()) { walk(p); continue; }
      if (/\.(js|css|html|json)$/i.test(f.name)) {
        const t = fs.readFileSync(p, 'utf8');
        if (/jinleeoffice\.com|cdn\.sanity\.io/.test(t)) offenders.push(path.relative(ROOT, p));
      }
    }
  };
  for (const d of prodDirs) { const p = path.join(ROOT, d); if (fs.existsSync(p)) walk(p); }
  check('Nessun URL di terze parti nei file serviti', offenders.length === 0,
    offenders.length ? offenders.join(', ') : 'nessuno in replica/, src/, assets/');

  /* ── report ─────────────────────────────────────────────────────────────── */
  console.log('\nCHECKLIST FASE 3\n' + '='.repeat(100));
  for (const r of results) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.item}`);
    console.log(`      ${r.detail}`);
  }
  const pass = results.filter((r) => r.ok).length;
  console.log('='.repeat(100));
  console.log(`${pass}/${results.length} voci superate`);
  fs.writeFileSync(path.join(ROOT, 'research', 'raw', 'mask', 'replica-checklist.json'), JSON.stringify(results, null, 1));
})();
