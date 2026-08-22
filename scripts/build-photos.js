/**
 * build-photos.js — genera i livelli di immagine da una cartella di sorgenti.
 *
 *   node scripts/build-photos.js [cartella]        (default: puglia)
 *
 * Usa Chrome, via Playwright, come RICAMPIONATORE. Non e un vezzo: `sips`
 * usa un filtro scadente e su immagini ricche di dettaglio perde fino al 38%
 * dell'energia dei bordi. Chrome con imageSmoothingQuality "high" la ritiene
 * per intero. Misurato su tre file, ritenzione media rispetto a un ideale non
 * compresso: sips q82 77.2%, WebP q82 via Chrome 100.5%.
 * Per confronto, la pipeline del sito di riferimento (AVIF q75) ritiene 72.6%.
 *
 * Quattro livelli:
 *   thumb  quadrato 320   WebP  scala di partenza
 *   hd     quadrato 1024  WebP  griglia sotto zoom
 *   xl     quadrato 1536  WebP  massimo zoom — pixel nativi, nessuna riduzione
 *   full   fotogramma intero    visore
 *
 * I livelli della griglia sono QUADRATI perche le celle lo sono e usano
 * background-size: cover: di un'immagine 4:3 il lato lungo verrebbe scartato
 * comunque. Ritagliando a monte ogni pixel scaricato finisce a schermo.
 *
 * Nessun livello INGRANDISCE mai la sorgente: il lato di destinazione e
 * limitato al lato corto disponibile.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const SRC_DIR = path.join(ROOT, process.argv[2] || 'puglia');
const OUT = path.join(ROOT, 'assets', 'photos');

const SQUARE_TIERS = [
  { dir: 'thumb', side: 320, quality: 0.82 },
  { dir: 'hd', side: 1024, quality: 0.82 },
  { dir: 'xl', side: 1536, quality: 0.84 },
];
const FULL_MAX = 2048;

/** Elenca i JPEG in modo ricorsivo. `withFileTypes` regge i nomi con spazi. */
function listImages(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listImages(p));
    else if (/\.(jpe?g|png)$/i.test(e.name)) out.push(p);
  }
  return out.sort();
}

/** Scarta i file con contenuto identico: nella cartella ce ne sono. */
function dedupe(files) {
  const seen = new Map();
  for (const f of files) {
    const h = crypto.createHash('md5').update(fs.readFileSync(f)).digest('hex');
    if (!seen.has(h)) seen.set(h, f);
  }
  return [...seen.values()].sort();
}

(async () => {
  if (!fs.existsSync(SRC_DIR)) {
    console.error(`Cartella non trovata: ${path.relative(ROOT, SRC_DIR)}`);
    process.exit(1);
  }
  const all = listImages(SRC_DIR);
  const files = dedupe(all);
  console.log(`sorgenti: ${all.length}  uniche: ${files.length}  duplicati scartati: ${all.length - files.length}`);

  for (const t of SQUARE_TIERS) {
    fs.rmSync(path.join(OUT, t.dir), { recursive: true, force: true });
    fs.mkdirSync(path.join(OUT, t.dir), { recursive: true });
  }
  fs.rmSync(path.join(OUT, 'full'), { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, 'full'), { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext()).newPage();
  await page.goto('about:blank');

  let copied = 0, resized = 0;
  const stats = Object.fromEntries(SQUARE_TIERS.map((t) => [t.dir, 0]));

  for (let i = 0; i < files.length; i++) {
    const src = files[i];
    const name = `photo${String(i + 1).padStart(3, '0')}`;
    const b64 = fs.readFileSync(src).toString('base64');
    const mime = /\.png$/i.test(src) ? 'image/png' : 'image/jpeg';

    // Un solo passaggio nel browser per file: decodifica una volta, produce
    // tutti i ritagli quadrati e dice se il fotogramma intero va ridotto.
    const res = await page.evaluate(async ([data, mime, tiers, fullMax]) => {
      const bin = atob(data);
      const buf = new Uint8Array(bin.length);
      for (let k = 0; k < bin.length; k++) buf[k] = bin.charCodeAt(k);
      const bmp = await createImageBitmap(new Blob([buf], { type: mime }));
      const W = bmp.width, H = bmp.height;
      const short = Math.min(W, H), long = Math.max(W, H);

      const toB64 = async (blob) => {
        const ab = await blob.arrayBuffer();
        let s = '';
        const u8 = new Uint8Array(ab);
        for (let k = 0; k < u8.length; k++) s += String.fromCharCode(u8[k]);
        return btoa(s);
      };

      const squares = {};
      for (const t of tiers) {
        // mai ingrandire: il lato si ferma a quello disponibile
        const side = Math.min(t.side, short);
        const c = new OffscreenCanvas(side, side);
        const g = c.getContext('2d');
        g.imageSmoothingEnabled = true;
        g.imageSmoothingQuality = 'high';
        g.drawImage(bmp, (W - short) / 2, (H - short) / 2, short, short, 0, 0, side, side);
        squares[t.dir] = { b64: await toB64(await c.convertToBlob({ type: 'image/webp', quality: t.quality })), side };
      }

      let full = null;
      if (long > fullMax) {
        const k = fullMax / long;
        const fw = Math.round(W * k), fh = Math.round(H * k);
        const c = new OffscreenCanvas(fw, fh);
        const g = c.getContext('2d');
        g.imageSmoothingEnabled = true;
        g.imageSmoothingQuality = 'high';
        g.drawImage(bmp, 0, 0, fw, fh);
        full = { b64: await toB64(await c.convertToBlob({ type: 'image/jpeg', quality: 0.92 })), w: fw, h: fh };
      }
      bmp.close();
      return { squares, full, W, H };
    }, [b64, mime, SQUARE_TIERS, FULL_MAX]);

    for (const t of SQUARE_TIERS) {
      fs.writeFileSync(path.join(OUT, t.dir, `${name}.webp`), Buffer.from(res.squares[t.dir].b64, 'base64'));
      stats[t.dir] = Math.max(stats[t.dir], res.squares[t.dir].side);
    }

    // `full`: copiare il sorgente quando e gia entro il limite. Ricodificarlo
    // sarebbe una seconda compressione senza alcun guadagno.
    if (res.full) {
      fs.writeFileSync(path.join(OUT, 'full', `${name}.jpg`), Buffer.from(res.full.b64, 'base64'));
      resized++;
    } else {
      fs.copyFileSync(src, path.join(OUT, 'full', `${name}.jpg`));
      copied++;
    }

    if ((i + 1) % 25 === 0 || i === files.length - 1) {
      process.stdout.write(`\r  ${i + 1}/${files.length}`);
    }
  }
  console.log();
  await browser.close();

  const size = (d) => {
    const dir = path.join(OUT, d);
    const b = fs.readdirSync(dir).reduce((s, f) => s + fs.statSync(path.join(dir, f)).size, 0);
    return `${(b / 1024 / 1024).toFixed(1)} MB`;
  };
  console.log(`\nlivelli generati (${files.length} file ciascuno):`);
  for (const t of SQUARE_TIERS) console.log(`  ${t.dir.padEnd(6)} quadrato ${String(stats[t.dir]).padStart(4)} px  WebP  ${size(t.dir)}`);
  console.log(`  full   fotogramma intero    ${size('full')}  (${copied} copiati senza ricodifica, ${resized} ridotti)`);
  console.log(`\nPHOTO_COUNT da impostare in src/app.js: ${files.length}`);
})();
