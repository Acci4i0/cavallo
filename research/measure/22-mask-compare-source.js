/**
 * FASE 2 — confronto tra la maschera RICOSTRUITA (osservazione) e la SORGENTE
 * trovata nei bundle. Se divergono vince l'osservazione, come da metodo.
 */
const fs = require('fs');
const path = require('path');

const RES = path.join(__dirname, '..');
const src = JSON.parse(fs.readFileSync(path.join(RES, 'raw', 'mask-source.json'), 'utf8'));
const obs = JSON.parse(fs.readFileSync(path.join(RES, 'mask-frames.json'), 'utf8'));

/* ── matrici dalla sorgente ───────────────────────────────────────────────── */
const G = src.frames[0].gridData;
const COLS = G.cols, ROWS = G.rows;
const srcMats = src.frames.map((f) => {
  const m = new Array(COLS * ROWS).fill(0);
  for (const c of f.gridData.cells) m[c.gridRow * COLS + c.gridCol] = 1;
  return m;
});

// estensione realmente accesa
let c0 = COLS, c1 = -1, r0 = ROWS, r1 = -1;
for (const m of srcMats) for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
  if (m[r * COLS + c]) { if (c < c0) c0 = c; if (c > c1) c1 = c; if (r < r0) r0 = r; if (r > r1) r1 = r; }
}
const W = c1 - c0 + 1, H = r1 - r0 + 1;
const crop = (m) => {
  const o = [];
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) o.push(m[r * COLS + c]);
  return o;
};
const srcCrop = srcMats.map(crop);

/* ── duplicati consecutivi nella sorgente ─────────────────────────────────── */
const key = (m) => m.join('');
let dupPairs = 0;
const collapsed = [];
for (let i = 0; i < srcCrop.length; i++) {
  if (i > 0 && key(srcCrop[i]) === key(srcCrop[i - 1])) { dupPairs++; continue; }
  collapsed.push(srcCrop[i]);
}
const srcUniq = new Set(srcCrop.map(key)).size;

console.log('=== SORGENTE (cdn.sanity.io/files/...json) ===');
console.log(`  versione ${src.version} · esportata ${src.exportedAt}`);
console.log(`  griglia dichiarata: ${COLS}×${ROWS} · cellSize ${G.cellSize} · spacing ${G.spacing}`);
console.log(`  estensione accesa: ${W}×${H}`);
console.log(`  frame: ${src.frames.length} · matrici uniche: ${srcUniq} · duplicati consecutivi: ${dupPairs}`);
console.log(`  dopo collasso dei consecutivi identici: ${collapsed.length}`);
const dt = src.frames[1].timestamp - src.frames[0].timestamp;
console.log(`  timestamp sorgente: Δ ${dt.toFixed(6)}s → ${(1 / dt).toFixed(4)} fps · durata ${src.frames.at(-1).timestamp.toFixed(4)}s`);
console.log(`  thumbnailCount: ${src.thumbnailCount} · settings ${JSON.stringify(src.settings)}`);

console.log('\n=== OSSERVAZIONE (metodo primario) ===');
console.log(`  estensione accesa: ${obs.grid.cols}×${obs.grid.rows}`);
console.log(`  frame nel ciclo: ${obs.frameCount} · matrici uniche: ${obs.uniqueMatrices}`);
console.log(`  ${obs.frameDurationMs} ms/frame → ${obs.fps} fps · loop ${obs.loop} · ${obs.transition}`);

/* ── confronto ────────────────────────────────────────────────────────────── */
console.log('\n=== CONFRONTO ===');
const rowsOut = [];
const cmp = (label, a, b, tol) => {
  const ok = typeof a === 'number' && typeof b === 'number'
    ? Math.abs(a - b) <= (tol ?? 0)
    : String(a) === String(b);
  rowsOut.push({ label, src: a, obs: b, ok });
  console.log(`  ${label.padEnd(34)} sorgente=${String(a).padStart(9)}  osservato=${String(b).padStart(9)}  ${ok ? '✓' : '✗'}`);
};
cmp('estensione accesa (colonne)', W, obs.grid.cols);
cmp('estensione accesa (righe)', H, obs.grid.rows);
cmp('matrici uniche', srcUniq, obs.uniqueMatrices);
cmp('passi del ciclo (post-collasso)', collapsed.length, obs.frameCount);
cmp('fps di riproduzione', +(1 / dt).toFixed(2), +obs.fps.toFixed(2), 0.35);

/* ── allineamento cella-per-cella: cerca l'offset di fase migliore ────────── */
let best = { score: -1 };
for (let shift = 0; shift < collapsed.length; shift++) {
  let tot = 0, hit = 0;
  const n = Math.min(collapsed.length, obs.frameCount);
  for (let i = 0; i < n; i++) {
    const a = collapsed[(i + shift) % collapsed.length];
    const b = obs.frames[i];
    if (a.length !== b.length) { tot = 0; break; }
    for (let k = 0; k < a.length; k++) { tot++; if (a[k] === b[k]) hit++; }
  }
  if (tot && hit / tot > best.score) best = { score: hit / tot, shift, tot, hit };
}
if (best.score >= 0) {
  console.log(`\n  allineamento migliore: shift ${best.shift} · celle coincidenti ${(best.score * 100).toFixed(3)}% (${best.hit}/${best.tot})`);
} else {
  console.log('\n  allineamento non calcolabile (dimensioni diverse)');
}

fs.writeFileSync(path.join(RES, 'raw', 'mask', 'source-vs-observed.json'),
  JSON.stringify({ rows: rowsOut, alignment: best, srcMeta: { cols: COLS, rows: ROWS, W, H, frames: src.frames.length, uniq: srcUniq, dupPairs, fps: 1 / dt } }, null, 1));
console.log('\nscritto research/raw/mask/source-vs-observed.json');
