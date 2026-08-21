/**
 * FASE 1/2 — analisi della registrazione: frame unici, lunghezza del ciclo,
 * fps, tipo di loop. Poi confronto con la sorgente JSON (fase 2).
 *
 *   node 21-mask-analyze.js [nome=original]
 */
const fs = require('fs');
const path = require('path');

const NAME = process.argv[2] || 'original';
const RAW = path.join(__dirname, '..', 'raw', 'mask');
const RES = path.join(__dirname, '..');
const rec = JSON.parse(fs.readFileSync(path.join(RAW, `${NAME}-raw.json`), 'utf8'));

const { cols, rows } = rec.grid;
const seq = rec.sequence;

/* ── 1. frame unici e mappa della sequenza ────────────────────────────────── */
const keyOf = (m) => m.join('');
const uniq = new Map();
const order = [];
for (const s of seq) {
  const k = keyOf(s.m);
  if (!uniq.has(k)) uniq.set(k, { id: uniq.size, m: s.m, hits: 0, durs: [] });
  const u = uniq.get(k);
  u.hits++;
  if (s.dur) u.durs.push(s.dur);
  order.push(u.id);
}
console.log(`campioni: ${seq.length} · frame UNICI: ${uniq.size}`);

/* ── 2. periodo del ciclo per autocorrelazione sulla sequenza di id ───────── */
function period(ids) {
  for (let p = 2; p <= Math.floor(ids.length / 2); p++) {
    let ok = true;
    for (let i = 0; i + p < ids.length; i++) if (ids[i] !== ids[i + p]) { ok = false; break; }
    if (ok) return p;
  }
  return null;
}
// tollerante: cerca il periodo con match >= 98% (qualche frame può saltare)
function periodTolerant(ids, minMatch = 0.98) {
  let best = null;
  for (let p = 2; p <= Math.floor(ids.length / 2); p++) {
    let hit = 0, tot = 0;
    for (let i = 0; i + p < ids.length; i++) { tot++; if (ids[i] === ids[i + p]) hit++; }
    const r = tot ? hit / tot : 0;
    if (r >= minMatch && (!best || p < best.p)) best = { p, ratio: r };
  }
  return best;
}
const pExact = period(order);
const pTol = periodTolerant(order);
console.log(`periodo esatto: ${pExact ?? '—'} · periodo tollerante(98%): ${pTol ? `${pTol.p} (match ${(pTol.ratio * 100).toFixed(1)}%)` : '—'}`);

/* ── 3. durate ────────────────────────────────────────────────────────────── */
const durs = seq.map((s) => s.dur).filter((d) => d && d > 0).sort((a, b) => a - b);
const med = durs[Math.floor(durs.length / 2)];
// scarta gli outlier (frame identici consecutivi deduplicati => durata doppia)
const near = durs.filter((d) => d > med * 0.6 && d < med * 1.6);
const mean = near.reduce((a, b) => a + b, 0) / near.length;
console.log(`durata frame: mediana ${med}ms · media(filtrata) ${mean.toFixed(2)}ms · fps ${(1000 / mean).toFixed(3)}`);
console.log(`  distribuzione: p10 ${durs[Math.floor(durs.length * .1)]} · p90 ${durs[Math.floor(durs.length * .9)]}`);

/* ── 4. hard-cut o transizione? ───────────────────────────────────────────── */
// se ci fosse una dissolvenza, tra due frame stabili comparirebbero matrici
// intermedie con vita brevissima. Si contano i campioni molto più corti del passo.
const shorts = durs.filter((d) => d < med * 0.5).length;
console.log(`campioni di durata < 50% del passo: ${shorts} su ${durs.length} → ${shorts === 0 ? 'HARD-CUT (nessuna transizione)' : 'possibile transizione'}`);

/* ── 5. ritaglio all'area realmente usata ─────────────────────────────────── */
const union = new Array(cols * rows).fill(0);
for (const [, u] of uniq) for (let i = 0; i < u.m.length; i++) if (u.m[i]) union[i] = 1;
let c0 = cols, c1 = -1, r0 = rows, r1 = -1;
for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (union[r * cols + c]) {
  if (c < c0) c0 = c; if (c > c1) c1 = c;
  if (r < r0) r0 = r; if (r > r1) r1 = r;
}
const W = c1 - c0 + 1, H = r1 - r0 + 1;
console.log(`estensione accesa (unione di tutti i frame): ${W}×${H} celle`);

const frames = [];
for (const [, u] of [...uniq].sort((a, b) => a[1].id - b[1].id)) {
  const f = [];
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) f.push(u.m[r * cols + c]);
  frames.push(f);
}

/* ── 6. ordina i frame secondo la sequenza osservata ──────────────────────── */
const cycleLen = pExact ?? pTol?.p ?? uniq.size;
const cycleIds = order.slice(0, cycleLen);
const ordered = cycleIds.map((id) => frames[id]);

/* ── 7. output ────────────────────────────────────────────────────────────── */
const out = {
  source: 'osservazione runtime (metodo primario)',
  url: rec.url,
  grid: { cols: W, rows: H },
  sampledGrid: { cols, rows },
  pitchBackingPx: rec.pitch,
  fps: +(1000 / mean).toFixed(4),
  frameDurationMs: +mean.toFixed(2),
  frameCount: ordered.length,
  uniqueMatrices: uniq.size,
  loop: pExact ? 'perfetto' : (pTol ? `quasi-perfetto (${(pTol.ratio * 100).toFixed(1)}%)` : 'non rilevato'),
  transition: shorts === 0 ? 'hard-cut' : 'da verificare',
  frames: ordered,
};
fs.writeFileSync(path.join(RES, `mask-frames${NAME === 'original' ? '' : '-' + NAME}.json`), JSON.stringify(out));
console.log(`\nscritto research/mask-frames${NAME === 'original' ? '' : '-' + NAME}.json`);

// preview ASCII
let txt = `Maschera ricostruita per osservazione — ${rec.url}\n`;
txt += `griglia ${W}x${H} · ${ordered.length} frame · ${(1000 / mean).toFixed(2)} fps · loop ${out.loop} · ${out.transition}\n\n`;
ordered.forEach((f, i) => {
  txt += `--- frame ${i} (${f.reduce((a, b) => a + b, 0)} celle accese) ---\n`;
  for (let r = 0; r < H; r++) {
    let line = '';
    for (let c = 0; c < W; c++) line += f[r * W + c] ? '#' : '.';
    txt += line + '\n';
  }
  txt += '\n';
});
fs.writeFileSync(path.join(RES, `mask-frames${NAME === 'original' ? '' : '-' + NAME}.txt`), txt);
console.log(`scritto research/mask-frames${NAME === 'original' ? '' : '-' + NAME}.txt`);

// anteprima a schermo del primo frame
console.log(`\nanteprima frame 0 (${W}x${H}):`);
for (let r = 0; r < H; r++) {
  let line = '';
  for (let c = 0; c < W; c++) line += ordered[0][r * W + c] ? '#' : '.';
  console.log('  ' + line);
}
console.log(`\ncelle accese per frame: ${ordered.map((f) => f.reduce((a, b) => a + b, 0)).join(', ')}`);
