// Fitting della curva di crossfade misurata contro easing candidate.
// Serve a verificare il letterale CSS (.view-layer { transition: opacity .4s ease }).
const fs = require('fs');
const path = require('path');

const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'raw', 'phase1bis.json'), 'utf8'));

// estrae la serie del layer che sale 0 -> 1
const series = [];
for (const f of data.viewswap) {
  const ops = f.items.map(i => parseFloat(i.op));
  const rising = ops[2];
  if (rising !== undefined) series.push({ t: f.t, y: rising });
}
// tiene solo il tratto di transizione (primo valore >0 fino al primo 1)
const first = series.findIndex(p => p.y > 0.0001);
let last = series.findIndex((p, i) => i > first && p.y >= 0.99999);
if (last < 0) last = series.length - 1;
const seg = series.slice(Math.max(0, first - 1), last + 1);

function bezier(x1, y1, x2, y2) {
  const A = (a, b) => 1 - 3 * b + 3 * a, B = (a, b) => 3 * b - 6 * a, C = a => 3 * a;
  const calc = (t, a, b) => ((A(a, b) * t + B(a, b)) * t + C(a)) * t;
  const slope = (t, a, b) => 3 * A(a, b) * t * t + 2 * B(a, b) * t + C(a);
  return (x) => {
    if (x <= 0) return 0; if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 12; i++) {
      const d = slope(t, x1, x2); if (Math.abs(d) < 1e-7) break;
      t -= (calc(t, x1, x2) - x) / d;
    }
    return calc(t, y1, y2);
  };
}

const candidates = {
  'linear':               bezier(0, 0, 1, 1),
  'ease (.25,.1,.25,1)':  bezier(.25, .1, .25, 1),
  'ease-out (0,0,.58,1)': bezier(0, 0, .58, 1),
  'ease-in-out (.42,0,.58,1)': bezier(.42, 0, .58, 1),
  'easeInOutCubic (.65,0,.35,1)': bezier(.65, 0, .35, 1),
  'easeOutCubic (.33,1,.68,1)': bezier(.33, 1, .68, 1),
  'easeOutQuad (.5,1,.89,1)': bezier(.5, 1, .89, 1),
};

// cerca (t0, D) che minimizzano l'errore, per ogni candidata
function fit(fn) {
  let best = { rms: Infinity };
  const tEnd = seg[seg.length - 1].t;
  for (let D = 250; D <= 700; D += 2) {
    for (let t0 = tEnd - D - 120; t0 <= tEnd - D + 120; t0 += 2) {
      let s = 0, n = 0;
      for (const p of seg) {
        const x = (p.t - t0) / D;
        if (x < -0.15 || x > 1.15) continue;
        const d = fn(Math.max(0, Math.min(1, x))) - p.y;
        s += d * d; n++;
      }
      if (n < 6) continue;
      const rms = Math.sqrt(s / n);
      if (rms < best.rms) best = { rms, D, t0, n };
    }
  }
  return best;
}

console.log(`Campioni nel tratto di transizione: ${seg.length}`);
console.log(`Finestra: t=${seg[0].t}ms (y=${seg[0].y}) -> t=${seg[seg.length-1].t}ms (y=${seg[seg.length-1].y})\n`);
console.log('easing'.padEnd(32), 'durata'.padStart(8), 'RMS'.padStart(9));
console.log('-'.repeat(52));
const rows = Object.entries(candidates)
  .map(([name, fn]) => ({ name, ...fit(fn) }))
  .sort((a, b) => a.rms - b.rms);
for (const r of rows) {
  console.log(r.name.padEnd(32), `${r.D}ms`.padStart(8), r.rms.toFixed(5).padStart(9));
}
console.log('\nVincitore:', rows[0].name, '| durata', rows[0].D + 'ms', '| RMS', rows[0].rms.toFixed(5));
console.log('\nResidui punto per punto (vincitore):');
const w = rows[0];
const fn = candidates[w.name];
for (const p of seg) {
  const x = Math.max(0, Math.min(1, (p.t - w.t0) / w.D));
  console.log(`  t=${String(p.t).padStart(7)}ms  x=${x.toFixed(3)}  misurato=${p.y.toFixed(5)}  atteso=${fn(x).toFixed(5)}  Δ=${(fn(x) - p.y).toFixed(5)}`);
}
