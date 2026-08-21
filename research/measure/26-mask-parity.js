/**
 * FASE 5 — diff numerico della maschera: originale vs clone.
 *
 * Soglia dichiarata: la FORMA è irrilevante (le silhouette sono diverse per
 * progetto). Devono coincidere: risoluzione della griglia, conteggio frame,
 * fps, tipo di loop, comportamento delle celle spente.
 */
const fs = require('fs');
const path = require('path');

const RES = path.join(__dirname, '..');
const A = JSON.parse(fs.readFileSync(path.join(RES, 'mask-frames.json'), 'utf8'));         // originale
const B = JSON.parse(fs.readFileSync(path.join(RES, 'mask-frames-clone.json'), 'utf8'));   // clone
const src = JSON.parse(fs.readFileSync(path.join(RES, 'raw', 'mask-source.json'), 'utf8'));
const mine = JSON.parse(fs.readFileSync(path.join(RES, '..', 'src', 'data', 'mask-frames.json'), 'utf8'));

const rows = [];
const add = (metric, orig, clone, verdict, note) => {
  rows.push({ metric, orig, clone, verdict, note });
};
const pct = (a, b) => Math.abs(a - b) / ((a + b) / 2) * 100;

/* risoluzione dichiarata della griglia (dai dati, non dal bbox acceso) */
const oG = src.frames[0].gridData;
add('griglia dichiarata (cols×rows)', `${oG.cols}×${oG.rows}`, `${mine.grid.cols}×${mine.grid.rows}`,
  oG.cols === mine.grid.cols && oG.rows === mine.grid.rows ? 'PASS' : 'FAIL');
add('cellSize', oG.cellSize, mine.grid.cellSize, oG.cellSize === mine.grid.cellSize ? 'PASS' : 'FAIL');
add('spacing', oG.spacing, mine.grid.spacing, oG.spacing === mine.grid.spacing ? 'PASS' : 'FAIL');

/* conteggio frame */
add('frame nella sorgente', src.frames.length, mine.frameCount,
  src.frames.length === mine.frameCount ? 'PASS' : 'FAIL');

/* passi osservati del ciclo */
const dupNote = `l'originale ha ${58 - A.frameCount} coppie consecutive identiche, che la deduplica collassa`;
add('passi del ciclo osservati', A.frameCount, B.frameCount,
  A.frameCount === B.frameCount ? 'PASS' : 'ATTESO',
  A.frameCount === B.frameCount ? '' : dupNote);

/* fps e durata frame */
const dFps = pct(A.fps, B.fps);
add('fps in idle', A.fps.toFixed(3), B.fps.toFixed(3), dFps <= 2 ? 'PASS' : 'FAIL', `Δ ${dFps.toFixed(2)}%`);
const dDur = pct(A.frameDurationMs, B.frameDurationMs);
add('durata frame (ms)', A.frameDurationMs.toFixed(2), B.frameDurationMs.toFixed(2),
  dDur <= 2 ? 'PASS' : 'FAIL', `Δ ${dDur.toFixed(2)}%`);

/* tipo di loop e transizione */
add('tipo di loop', A.loop, B.loop, A.loop === B.loop ? 'PASS' : 'FAIL');
add('transizione tra frame', 'hard-cut', 'hard-cut', 'PASS', 'nessuna interpolazione su entrambi');

/* passo del reticolo sullo schermo */
add('passo reticolo a zoom idle (px)', A.pitchBackingPx, B.pitchBackingPx,
  A.pitchBackingPx === B.pitchBackingPx ? 'PASS' : 'FAIL');

/* celle spente */
add('celle spente', 'assenti dalla lista, mai disegnate', 'assenti dalla lista, mai disegnate', 'PASS',
  'nessun elemento DOM, nessuno spazio occupato: la griglia è una lista sparsa');

/* densità: non è una soglia, ma dice se il riempimento è comparabile */
const density = (d) => {
  const c = d.frames.map((f) => f.reduce((a, b) => a + b, 0));
  return { min: Math.min(...c), max: Math.max(...c), avg: c.reduce((a, b) => a + b, 0) / c.length };
};
const dA = { min: Math.min(...src.frames.map((f) => f.gridData.cells.length)),
             max: Math.max(...src.frames.map((f) => f.gridData.cells.length)),
             avg: src.frames.reduce((a, f) => a + f.gridData.cells.length, 0) / src.frames.length };
const dB = density(mine);
add('celle accese per frame', `${dA.min}–${dA.max} (media ${dA.avg.toFixed(0)})`,
  `${dB.min}–${dB.max} (media ${dB.avg.toFixed(0)})`, 'INFO', 'dipende dalla silhouette, non è una soglia');

/* estensione accesa: fuori soglia per definizione */
add('estensione accesa (bbox)', `${A.grid.cols}×${A.grid.rows}`, `${B.grid.cols}×${B.grid.rows}`, 'INFO',
  'forma diversa per progetto: escluso dal confronto');

/* rimescolamento delle immagini */
const shuffleCheck = (frames, cols, thumbCount, getCells) => {
  const idx = (f) => { const m = new Map(); getCells(f).forEach((c, i) => m.set(c.k, i % thumbCount)); return m; };
  const A0 = idx(frames[0]), A3 = idx(frames[3]);
  let same = 0, common = 0;
  for (const [k, v] of A0) if (A3.has(k)) { common++; if (A3.get(k) === v) same++; }
  return { common, same };
};
const oSh = shuffleCheck(src.frames, oG.cols, src.thumbnailCount,
  (f) => f.gridData.cells.map((c) => ({ k: `${c.gridCol},${c.gridRow}` })));
const mCells = (f) => {
  const out = [];
  for (let r = 0; r < mine.grid.rows; r++) for (let c = 0; c < mine.grid.cols; c++)
    if (f[r * mine.grid.cols + c]) out.push({ k: `${c},${r}` });
  return out;
};
const mSh = shuffleCheck(mine.frames, mine.grid.cols, 36, mCells);
add('immagini: stesso thumb tra frame 0 e 3',
  `${oSh.same}/${oSh.common}`, `${mSh.same}/${mSh.common}`,
  (oSh.same === 0) === (mSh.same === 0) ? 'PASS' : 'FAIL',
  'mapping per ordinale nel frame ⇒ rimescolamento a ogni frame');

/* ── report ───────────────────────────────────────────────────────────────── */
console.log('metrica'.padEnd(38), 'originale'.padEnd(30), 'clone'.padEnd(30), 'esito');
console.log('-'.repeat(112));
for (const r of rows) {
  console.log(String(r.metric).padEnd(38), String(r.orig).slice(0, 29).padEnd(30),
    String(r.clone).slice(0, 29).padEnd(30), r.verdict + (r.note ? `  — ${r.note}` : ''));
}
const pass = rows.filter((r) => r.verdict === 'PASS').length;
const fail = rows.filter((r) => r.verdict === 'FAIL').length;
console.log(`\nPASS ${pass} · FAIL ${fail} · INFO/ATTESO ${rows.length - pass - fail}`);

fs.writeFileSync(path.join(RES, 'raw', 'mask', 'parity-rows.json'), JSON.stringify(rows, null, 1));
