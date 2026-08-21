/**
 * build-mask.js — genera le matrici della maschera dai MIEI frame sorgente.
 *
 * Pipeline (come da specifica):
 *   immagini in /assets/gallop/
 *     → grayscale
 *     → threshold configurabile        (binarizza il soggetto)
 *     → downsample a cols × rows       (media d'area = copertura della cella)
 *     → soglia di copertura            (matrice booleana)
 *     → JSON in /src/data/mask-frames.json
 *
 * Rigenerabile per qualsiasi cols×rows. Il renderer legge solo il JSON: nessuna
 * matrice è hardcoded nel sorgente.
 *
 * La decodifica delle immagini passa da Chromium headless, così accetta
 * qualunque formato che il browser sappia leggere (PNG, JPEG, WebP, SVG) senza
 * aggiungere dipendenze di decoding.
 *
 * Uso:
 *   node scripts/build-mask.js
 *   node scripts/build-mask.js --cols=54 --rows=42 --threshold=0.5 --coverage=0.5
 *   node scripts/build-mask.js --invert          (soggetto chiaro su fondo scuro)
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const arg = (k, d) => {
  const a = process.argv.find((x) => x.startsWith(`--${k}=`));
  if (a) return a.split('=').slice(1).join('=');
  return process.argv.includes(`--${k}`) ? true : d;
};

const ROOT = path.join(__dirname, '..');
const SRC_DIR = path.join(ROOT, arg('in', 'assets/gallop'));
const OUT_FILE = path.join(ROOT, arg('out', 'src/data/mask-frames.json'));

// Risoluzione della griglia. I default sono i valori MISURATI sull'originale
// (research/PARITY-MASK.md §griglia): 54×42 celle, cellSize 12, spacing 2.
const COLS = parseInt(arg('cols', '54'), 10);
const ROWS = parseInt(arg('rows', '42'), 10);
const CELL_SIZE = parseInt(arg('cellSize', '12'), 10);
const SPACING = parseInt(arg('spacing', '2'), 10);

// Soglie della pipeline.
const THRESHOLD = parseFloat(arg('threshold', '0.5')); // luminanza 0..1 per binarizzare
const COVERAGE = parseFloat(arg('coverage', '0.5'));   // frazione di cella coperta per accenderla
const INVERT = !!arg('invert', false);

// Comportamento di riproduzione — MISURATO in Fase 1, non inventato.
const PLAYBACK = {
  introFrameMs: 50,   // §mask · N0:872 — setInterval(N=50) durante l'intro
  idleFrameMs: 100,   // §mask · N0:851 — setInterval(100) in idle
  introCycles: 1,     // §mask — misurato (il default del bundle è 3, produzione usa 1)
  introTailRatio: 0.85, // §mask · N0:870 — ceil(nFrames × 0.85) nell'ultimo giro
  loop: 'perfetto',
  transition: 'hard-cut',
};

(async () => {
  if (!fs.existsSync(SRC_DIR)) {
    console.error(`Cartella sorgente assente: ${path.relative(ROOT, SRC_DIR)}`);
    console.error('Genera dei segnaposto con: node tools/make-gallop-placeholders.js');
    process.exit(1);
  }
  const files = fs.readdirSync(SRC_DIR)
    .filter((f) => /\.(png|jpe?g|webp|gif|svg)$/i.test(f))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (!files.length) {
    console.error(`Nessuna immagine in ${path.relative(ROOT, SRC_DIR)}`);
    process.exit(1);
  }
  console.log(`${files.length} frame sorgente · griglia ${COLS}×${ROWS} · threshold ${THRESHOLD} · coverage ${COVERAGE}${INVERT ? ' · invertito' : ''}`);

  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext()).newPage();
  await page.goto('about:blank');

  const frames = [];
  for (const f of files) {
    const buf = fs.readFileSync(path.join(SRC_DIR, f));
    const dataUri = `data:image/${path.extname(f).slice(1).replace('jpg', 'jpeg')};base64,${buf.toString('base64')}`;

    const cells = await page.evaluate(async ([uri, cols, rows, thr, cov, inv]) => {
      const img = new Image();
      img.src = uri;
      await img.decode();

      // 1) grayscale + 2) threshold, a piena risoluzione
      const full = document.createElement('canvas');
      full.width = img.naturalWidth; full.height = img.naturalHeight;
      const fg = full.getContext('2d', { willReadFrequently: true });
      fg.drawImage(img, 0, 0);
      const d = fg.getImageData(0, 0, full.width, full.height);
      const px = d.data;
      for (let i = 0; i < px.length; i += 4) {
        const lum = (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255;
        const a = px[i + 3] / 255;
        // un pixel trasparente non è soggetto, qualunque sia la sua luminanza
        let on = a > 0.5 && (inv ? lum < thr : lum >= thr);
        const v = on ? 255 : 0;
        px[i] = px[i + 1] = px[i + 2] = v;
        px[i + 3] = 255;
      }
      fg.putImageData(d, 0, 0);

      // 3) downsample a cols×rows: ogni pixel di destinazione = copertura media
      const small = document.createElement('canvas');
      small.width = cols; small.height = rows;
      const sg = small.getContext('2d', { willReadFrequently: true });
      sg.imageSmoothingEnabled = true;
      sg.imageSmoothingQuality = 'high';
      sg.drawImage(full, 0, 0, cols, rows);
      const sd = sg.getImageData(0, 0, cols, rows).data;

      // 4) soglia di copertura → booleano
      const out = [];
      for (let i = 0; i < cols * rows; i++) out.push(sd[i * 4] / 255 >= cov ? 1 : 0);
      return out;
    }, [dataUri, COLS, ROWS, THRESHOLD, COVERAGE, INVERT]);

    frames.push(cells);
  }
  await browser.close();

  // statistiche + matrici uniche
  const keys = frames.map((f) => f.join(''));
  const unique = new Set(keys).size;
  let dupPairs = 0;
  for (let i = 1; i < keys.length; i++) if (keys[i] === keys[i - 1]) dupPairs++;
  const counts = frames.map((f) => f.reduce((a, b) => a + b, 0));

  const data = {
    generatedAt: new Date().toISOString(),
    source: path.relative(ROOT, SRC_DIR),
    grid: { cols: COLS, rows: ROWS, cellSize: CELL_SIZE, spacing: SPACING },
    pipeline: { threshold: THRESHOLD, coverage: COVERAGE, invert: INVERT },
    playback: PLAYBACK,
    frameCount: frames.length,
    uniqueMatrices: unique,
    consecutiveDuplicates: dupPairs,
    frames,
  };
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(data));

  console.log(`\nscritto ${path.relative(ROOT, OUT_FILE)}`);
  console.log(`  frame: ${frames.length} · matrici uniche: ${unique} · duplicati consecutivi: ${dupPairs}`);
  console.log(`  celle accese: min ${Math.min(...counts)} · max ${Math.max(...counts)} · media ${(counts.reduce((a, b) => a + b, 0) / counts.length).toFixed(1)}`);
  if (Math.min(...counts) === 0) console.warn('  [!] almeno un frame è vuoto: rivedi --threshold / --invert');
  if (unique === 1) console.warn('  [!] tutte le matrici identiche: la sequenza non anima');

  // anteprima ASCII del primo frame, per controllo a occhio
  console.log('\nanteprima frame 0:');
  for (let r = 0; r < ROWS; r++) {
    let line = '';
    for (let c = 0; c < COLS; c++) line += frames[0][r * COLS + c] ? '#' : '.';
    console.log('  ' + line);
  }
})();
