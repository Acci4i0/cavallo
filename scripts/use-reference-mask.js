/**
 * use-reference-mask.js — genera src/data/mask-frames.json dalla matrice
 * ESTRATTA da jinleeoffice.com (_reference/mask-data.json).
 *
 * Scelta esplicita dell'utente (EXTRACTION.md §7, opzione b: "replica esatta").
 * L'alternativa è scripts/build-mask.js, che genera le matrici da silhouette
 * proprie: stessa meccanica, sagoma diversa.
 *
 * Il JSON sorgente da 3.7 MB resta in _reference/. Qui si emette solo la
 * matrice booleana compatta, nello stesso schema prodotto da build-mask.js,
 * così il renderer non distingue le due sorgenti.
 *
 *   node scripts/use-reference-mask.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const IN = path.join(ROOT, '_reference', 'mask-data.json');
const OUT = path.join(ROOT, 'src', 'data', 'mask-frames.json');

if (!fs.existsSync(IN)) {
  console.error(`Manca ${path.relative(ROOT, IN)} — esegui prima: node _reference/build-reference.js`);
  process.exit(1);
}
const ref = JSON.parse(fs.readFileSync(IN, 'utf8'));

const data = {
  generatedAt: new Date().toISOString(),
  // Provenienza documentata in _reference/EXTRACTION.md. Nel file servito non
  // compare alcun URL di terze parti: la checklist di Fase 3 lo verifica.
  source: 'estratta — vedi _reference/EXTRACTION.md',
  provenance: 'originale',
  grid: { cols: ref.cols, rows: ref.rows, cellSize: ref.cellSize, spacing: ref.gapX },
  gapX: ref.gapX,
  gapY: ref.gapY,
  rowStagger: ref.rowStagger,
  thumbnailCount: ref.thumbnailCount,
  restingFrame: ref.restingFrame,
  // Riproduzione: valori misurati, non quelli del campo `timestamp` del JSON,
  // che il sito non legge (EXTRACTION.md §6.4).
  playback: {
    introFrameMs: 50,
    idleFrameMs: 100,
    introCycles: 1,
    introTailRatio: 0.85,
    loop: 'perfetto',
    transition: 'hard-cut',
  },
  frameCount: ref.frames.length,
  uniqueMatrices: new Set(ref.frames.map((f) => f.join(''))).size,
  consecutiveDuplicates: ref.frames.reduce(
    (n, f, i) => n + (i > 0 && f.join('') === ref.frames[i - 1].join('') ? 1 : 0), 0),
  frames: ref.frames,
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(data));

const counts = data.frames.map((f) => f.reduce((a, b) => a + b, 0));
console.log(`scritto ${path.relative(ROOT, OUT)}`);
console.log(`  provenienza: ESTRATTA (sagoma originale cavallo+fantino)`);
console.log(`  griglia ${data.grid.cols}×${data.grid.rows} · cellSize ${data.grid.cellSize} · gap ${data.gapX}/${data.gapY} · stagger ${data.rowStagger}`);
console.log(`  frame ${data.frameCount} · uniche ${data.uniqueMatrices} · duplicati consecutivi ${data.consecutiveDuplicates}`);
console.log(`  celle attive: min ${Math.min(...counts)} · max ${Math.max(...counts)} · posa statica (frame ${data.restingFrame}) ${counts[data.restingFrame]}`);
