// Genera placeholder PNG neri in /assets/placeholders/, uno per ogni tier LOD
// dello spec (ANIMATION_SPEC §B2: 128 / 256 / 512 / 1024).
// PNG grayscale 8-bit, encoder minimale: zero dipendenze.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, '..', 'assets', 'placeholders');
fs.mkdirSync(OUT, { recursive: true });

const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return (buf) => {
    let c = -1;
    for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
})();

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(CRC(body));
  return Buffer.concat([len, body, crc]);
}

// PNG nero pieno, grayscale 8bit (colorType 0) — il formato più compatto per un solido
function blackPng(w, h) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 0;   // color type: grayscale
  ihdr[10] = 0;  // compression
  ihdr[11] = 0;  // filter
  ihdr[12] = 0;  // interlace
  // scanline: 1 byte di filtro (0 = None) + w byte a 0x00 (nero)
  const raw = Buffer.alloc(h * (w + 1), 0);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Rapporti d'aspetto plausibili per un portfolio: quadrati, verticali, orizzontali.
// Sono i MIEI placeholder: nessuna dimensione derivata dagli asset originali.
const RATIOS = [
  [1, 1], [1, 1], [1, 1], [1, 1],
  [4, 5], [4, 5], [2, 3], [3, 4],
  [5, 4], [3, 2], [16, 9], [16, 9],
];
const TIERS = [128, 256, 512, 1024]; // ANIMATION_SPEC §B2
const COUNT = 24;

let n = 0;
const manifest = [];
for (let i = 0; i < COUNT; i++) {
  const [rw, rh] = RATIOS[i % RATIOS.length];
  const entry = { id: `ph-${String(i).padStart(2, '0')}`, ratio: [rw, rh], files: {} };
  for (const t of TIERS) {
    const w = rw >= rh ? t : Math.round((t * rw) / rh);
    const h = rh > rw ? t : Math.round((t * rh) / rw);
    const name = `${entry.id}-${t}.png`;
    fs.writeFileSync(path.join(OUT, name), blackPng(w, h));
    entry.files[t] = `assets/placeholders/${name}`;
    n++;
  }
  manifest.push(entry);
}
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));

const bytes = fs.readdirSync(OUT)
  .filter(f => f.endsWith('.png'))
  .reduce((s, f) => s + fs.statSync(path.join(OUT, f)).size, 0);
console.log(`${n} PNG neri generati in assets/placeholders/ (${COUNT} soggetti × ${TIERS.length} tier)`);
console.log(`peso totale: ${(bytes / 1024).toFixed(1)} KB`);
