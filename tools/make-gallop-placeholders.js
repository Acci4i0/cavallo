/**
 * Genera silhouette SEGNAPOSTO in /assets/gallop/ — un quadrupede stilizzato in
 * ciclo di galoppo. Servono solo a rendere la pipeline eseguibile end-to-end
 * finché non metti le tue.
 *
 * Sostituiscile con i tuoi frame (PNG/JPG, soggetto chiaro su fondo scuro o
 * viceversa) e rilancia scripts/build-mask.js: il resto non cambia.
 *
 * Il CONTEGGIO dei frame (58) non è arbitrario: è quello misurato in Fase 1.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, '..', 'assets', 'gallop');
fs.mkdirSync(OUT, { recursive: true });

const FRAMES = 58;   // §mask — misurato in Fase 1
const W = 540, H = 420; // 54:42 = stesso rapporto della griglia bersaglio

/* ── encoder PNG grayscale, zero dipendenze ───────────────────────────────── */
const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return (b) => { let c = -1; for (let i = 0; i < b.length; i++) c = t[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
})();
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(CRC(body));
  return Buffer.concat([len, body, crc]);
}
function grayPng(w, h, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 0;
  const raw = Buffer.alloc(h * (w + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w + 1)] = 0;
    pixels.copy(raw, y * (w + 1) + 1, y * w, (y + 1) * w);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ── primitive di test punto-dentro-forma ─────────────────────────────────── */
const ellipse = (px, py, cx, cy, rx, ry, rot = 0) => {
  const c = Math.cos(-rot), s = Math.sin(-rot);
  const dx = px - cx, dy = py - cy;
  const x = dx * c - dy * s, y = dx * s + dy * c;
  return (x * x) / (rx * rx) + (y * y) / (ry * ry) <= 1;
};
const capsule = (px, py, x1, y1, x2, y2, r) => {
  const dx = x2 - x1, dy = y2 - y1;
  const L2 = dx * dx + dy * dy || 1;
  let t = ((px - x1) * dx + (py - y1) * dy) / L2;
  t = Math.max(0, Math.min(1, t));
  const qx = x1 + t * dx, qy = y1 + t * dy;
  return (px - qx) ** 2 + (py - qy) ** 2 <= r * r;
};

/* ── un frame del ciclo ───────────────────────────────────────────────────── */
function drawFrame(k) {
  const ph = (k / FRAMES) * Math.PI * 2;
  const px = Buffer.alloc(W * H, 0); // 0 = fondo

  // oscillazione verticale del corpo (due rimbalzi per ciclo)
  const bob = Math.sin(ph * 2) * 13;
  const bodyX = W * 0.5, bodyY = H * 0.46 + bob;
  const bodyRX = W * 0.28, bodyRY = H * 0.17;

  // collo e testa
  const neckX = bodyX + bodyRX * 0.78, neckY = bodyY - bodyRY * 0.55;
  const headA = -0.5 + Math.sin(ph * 2 + 0.6) * 0.16;
  const headX = neckX + Math.cos(headA) * W * 0.18;
  const headY = neckY + Math.sin(headA) * W * 0.18;

  // coda
  const tailA = Math.PI - 0.35 + Math.sin(ph * 2 + 1.2) * 0.3;
  const tailX = bodyX - bodyRX * 0.92;
  const tailY = bodyY - bodyRY * 0.35;

  // zampe: sfasamento da galoppo rotatorio
  const legPhase = [0, 0.18, 0.55, 0.73].map((o) => ph + o * Math.PI * 2);
  const hipX = [bodyX - bodyRX * 0.62, bodyX - bodyRX * 0.44, bodyX + bodyRX * 0.5, bodyX + bodyRX * 0.68];
  const hipY = bodyY + bodyRY * 0.7;

  const legs = legPhase.map((p, i) => {
    const swing = Math.sin(p);
    const lift = Math.max(0, Math.cos(p));
    const kneeX = hipX[i] + swing * W * 0.072;
    const kneeY = hipY + H * 0.15 - lift * H * 0.065;
    const footX = kneeX + swing * W * 0.065;
    const footY = kneeY + H * 0.155 - lift * H * 0.095;
    return { hx: hipX[i], hy: hipY, kx: kneeX, ky: kneeY, fx: footX, fy: footY };
  });

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let on = ellipse(x, y, bodyX, bodyY, bodyRX, bodyRY, 0.05)
        || capsule(x, y, neckX, neckY, headX, headY, W * 0.042)
        || ellipse(x, y, headX, headY, W * 0.058, H * 0.047, headA)
        || capsule(x, y, tailX, tailY, tailX + Math.cos(tailA) * W * 0.16, tailY + Math.sin(tailA) * W * 0.16, W * 0.021);
      if (!on) {
        for (const l of legs) {
          if (capsule(x, y, l.hx, l.hy, l.kx, l.ky, W * 0.029) || capsule(x, y, l.kx, l.ky, l.fx, l.fy, W * 0.021)) { on = true; break; }
        }
      }
      if (on) px[y * W + x] = 255;
    }
  }
  return px;
}

let n = 0;
for (let k = 0; k < FRAMES; k++) {
  const name = `gallop-${String(k).padStart(3, '0')}.png`;
  fs.writeFileSync(path.join(OUT, name), grayPng(W, H, drawFrame(k)));
  n++;
}
console.log(`${n} silhouette segnaposto generate in assets/gallop/ (${W}×${H})`);
console.log('SEGNAPOSTO DICHIARATI — sostituiscili con i tuoi frame e rilancia scripts/build-mask.js');
