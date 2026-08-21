/**
 * FASE 3 — analisi. Confronta le registrazioni di originale e clone ed emette
 * il diff numerico + research/PARITY.md.
 *
 * Soglie del brief: <2% sulle durate, <0.02 sui punti di controllo delle bezier.
 *
 * NOTA METODO: il lerp del pan/zoom è per-frame e NON compensato per delta-time
 * (§A · N0:791). Confrontarlo in millisecondi misurerebbe il frame rate, non il
 * codice. Si confronta quindi il RAPPORTO DI DECADIMENTO PER FRAME, che è
 * l'invariante corretto: (target − z[n+1]) / (target − z[n]) = 1 − fattore.
 */
const fs = require('fs');
const path = require('path');

const RAW = path.join(__dirname, '..', 'raw', 'parity');
const A = JSON.parse(fs.readFileSync(path.join(RAW, 'original.json'), 'utf8'));
const B = JSON.parse(fs.readFileSync(path.join(RAW, 'clone.json'), 'utf8'));
// Passaggio DOM-only (sonda leggera, 60 fps pieni): è la fonte per le meccaniche
// puramente CSS. Il passaggio a pixel serve solo a zoom e hover, dove non c'è
// alternativa, e lì paga un campionamento più rado.
const AD = JSON.parse(fs.readFileSync(path.join(RAW, 'original-dom.json'), 'utf8'));
const BD = JSON.parse(fs.readFileSync(path.join(RAW, 'clone-dom.json'), 'utf8'));

/* ── utilità ──────────────────────────────────────────────────────────────── */

function bezier(x1, y1, x2, y2) {
  const A_ = (a, b) => 1 - 3 * b + 3 * a, B_ = (a, b) => 3 * b - 6 * a, C_ = (a) => 3 * a;
  const calc = (t, a, b) => ((A_(a, b) * t + B_(a, b)) * t + C_(a)) * t;
  const slope = (t, a, b) => 3 * A_(a, b) * t * t + 2 * B_(a, b) * t + C_(a);
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
const CANDIDATES = {
  'linear': [0, 0, 1, 1],
  'ease': [.25, .1, .25, 1],
  'ease-out': [0, 0, .58, 1],
  'ease-in-out': [.42, 0, .58, 1],
  'easeInOutCubic': [.65, 0, .35, 1],
  'easeInOutQuad': [.45, 0, .55, 1],
  'easeOutCubic': [.33, 1, .68, 1],
};

/**
 * Isola il tratto di transizione ANIMATO e ne stima durata + easing.
 *
 * Due insidie viste sui dati reali, entrambe gestite qui:
 *  - la serie può contenere un salto ISTANTANEO non animato (lo scrim navbar
 *    passa da 88 a 249 px in un frame perché la navbar cresce, e solo dopo
 *    anima 249→301). Prendere il primo/ultimo campione falserebbe tutto.
 *  - la serie può iniziare al valore finale (canvas: 1 → 0 → 1); va isolato
 *    il tratto in salita, non l'intera finestra.
 */
function fitTransition(series, { minSpan = 0.05 } = {}) {
  const pts = series.filter((p) => p.v !== null && Number.isFinite(p.v));
  if (pts.length < 6) return null;

  // 1. individua il tratto monotono più ampio, saltando i gradini istantanei
  const range = Math.max(...pts.map((p) => p.v)) - Math.min(...pts.map((p) => p.v));
  if (range < minSpan) return null;
  const JUMP = range * 0.35; // un frame che copre >35% del range = gradino, non animazione

  let bestSeg = null;
  let i = 0;
  while (i < pts.length - 1) {
    const dir = Math.sign(pts[i + 1].v - pts[i].v);
    if (dir === 0) { i++; continue; }
    let j = i;
    while (j < pts.length - 1) {
      const d = pts[j + 1].v - pts[j].v;
      if (Math.sign(d) === -dir && Math.abs(d) > range * 0.02) break;
      if (Math.abs(d) > JUMP) { if (j > i) break; i = j + 1; j = i; continue; }
      j++;
    }
    const span = Math.abs(pts[j].v - pts[i].v);
    if (span >= minSpan && (!bestSeg || span > bestSeg.span)) bestSeg = { i, j, span };
    i = Math.max(j, i + 1);
  }
  if (!bestSeg) return null;

  const sub = pts.slice(bestSeg.i, bestSeg.j + 1);
  if (sub.length < 5) return null;
  const v0 = sub[0].v, v1 = sub[sub.length - 1].v;
  if (Math.abs(v1 - v0) < minSpan) return null;

  const norm = sub.map((p) => ({ t: p.t, y: (p.v - v0) / (v1 - v0) }));
  const iStart = Math.max(0, norm.findIndex((p) => p.y > 0.002) - 1);
  let iEnd = norm.length - 1;
  for (let k = norm.length - 1; k > 0; k--) if (norm[k].y < 0.998) { iEnd = Math.min(norm.length - 1, k + 1); break; }
  const seg = norm.slice(iStart, iEnd + 1);
  if (seg.length < 5) return null;
  const tEnd = seg[seg.length - 1].t;

  let best = { rms: Infinity };
  for (const [name, cp] of Object.entries(CANDIDATES)) {
    const fn = bezier(...cp);
    for (let D = 60; D <= 4600; D += 2) {
      for (let t0 = tEnd - D - 140; t0 <= tEnd - D + 140; t0 += 2) {
        let s = 0, n = 0;
        for (const p of seg) {
          const x = (p.t - t0) / D;
          if (x < -0.15 || x > 1.15) continue;
          const d = fn(Math.max(0, Math.min(1, x))) - p.y;
          s += d * d; n++;
        }
        if (n < 5) continue;
        const rms = Math.sqrt(s / n);
        if (rms < best.rms) best = { rms, D, t0, n, easing: name, cp };
      }
    }
  }
  return { ...best, from: v0, to: v1, samples: seg.length };
}

/**
 * Fattore di lerp per REGRESSIONE LOG-LINEARE sull'intera curva di decadimento.
 *
 * Perché non la mediana dei rapporti consecutivi: se il campionamento perde un
 * frame, quel rapporto vale 0.85² = 0.72 e restituisce un fattore 0.28 invece
 * di 0.15. Con pochi drop la mediana si sposta sensibilmente — è successo:
 * due run identici del clone davano 0.1498 e 0.1683.
 *
 * Il decadimento è e[n] = e[0]·r^n ⇒ ln(e[n]) è lineare in n con pendenza ln(r).
 * La regressione usa tutti i punti e i drop isolati pesano molto meno.
 */
function lerpFactor(series) {
  const z = series.filter((p) => p.v && p.v.zoom).map((p) => ({ t: p.t, z: p.v.zoom }));
  if (z.length < 8) return null;
  const target = z[z.length - 1].z;
  const start = z[0].z;
  const span = Math.abs(target - start);
  if (span < 0.05) return null;

  // Il click impiega qualche frame a produrre effetto: la serie comincia con
  // un tratto PIATTO (errore costante). Includerlo nella regressione falsava il
  // fattore — è la causa dei 0.168 letti prima. Si parte dal primo campione in
  // cui l'errore inizia davvero a scendere.
  const e0 = Math.abs(target - z[0].z);
  let first = 0;
  while (first < z.length - 1 && Math.abs(target - z[first].z) > e0 * 0.999) first++;

  // punti nella fascia misurabile: errore tra 5% e 95% dello span
  const pts = [];
  for (let i = first; i < z.length; i++) {
    const e = Math.abs(target - z[i].z);
    if (e > span * 0.05 && e < span * 0.95) pts.push({ n: i - first, ln: Math.log(e) });
  }
  if (pts.length < 5) return null;

  // regressione lineare ln(e) ~ a + b·n
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  const N = pts.length;
  for (const p of pts) { sx += p.n; sy += p.ln; sxx += p.n * p.n; sxy += p.n * p.ln; }
  const den = N * sxx - sx * sx;
  if (!den) return null;
  const b = (N * sxy - sx * sy) / den;
  const a = (sy - b * sx) / N;

  // R² per dichiarare la qualità del fit
  const mean = sy / N;
  let ssTot = 0, ssRes = 0;
  for (const p of pts) { ssTot += (p.ln - mean) ** 2; ssRes += (p.ln - (a + b * p.n)) ** 2; }
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;

  const ratio = Math.exp(b);
  return {
    factor: 1 - ratio, medianRatio: ratio, n: N, r2,
    start, target, steps: z.length,
    framesSampled: z.length,
    spanMs: z[z.length - 1].t - z[0].t,
  };
}

/** Serie di opacity del layer che sale (crossfade). */
const risingLayer = (series) =>
  series.map((p) => ({ t: p.t, v: Array.isArray(p.v) ? Math.max(...p.v.filter(Number.isFinite)) : null }))
        .map((p, i, arr) => p);

function layerPair(series) {
  const arrs = series.filter((p) => Array.isArray(p.v) && p.v.length >= 2);
  if (!arrs.length) return null;
  const k = arrs[0].v.length;
  let bestIdx = 0, bestSpan = 0;
  for (let i = 0; i < k; i++) {
    const vs = arrs.map((p) => p.v[i]).filter(Number.isFinite);
    const span = Math.max(...vs) - Math.min(...vs);
    const rising = vs[vs.length - 1] > vs[0];
    if (rising && span > bestSpan) { bestSpan = span; bestIdx = i; }
  }
  return arrs.map((p) => ({ t: p.t, v: p.v[bestIdx] }));
}

const pct = (a, b) => (a && b ? Math.abs(a - b) / ((a + b) / 2) * 100 : null);
const f2 = (x, d = 2) => (x === null || x === undefined || !Number.isFinite(x) ? '—' : x.toFixed(d));

/* ── analisi ──────────────────────────────────────────────────────────────── */

const out = [];

// 1. Zoom: valore di default, step, e fattore di lerp
const zA = A.scenarios.zoomBaseline, zB = B.scenarios.zoomBaseline;
const zA2 = A.scenarios.zoomAfter, zB2 = B.scenarios.zoomAfter;
out.push({
  group: 'Zoom', metric: 'zoom di default', unit: '×',
  orig: zA?.zoom, clone: zB?.zoom, spec: 1.5, kind: 'value',
});
out.push({
  group: 'Zoom', metric: 'zoom dopo un click su +', unit: '×',
  orig: zA2?.zoom, clone: zB2?.zoom, spec: 2.25, kind: 'value',
});
out.push({
  group: 'Zoom', metric: 'step moltiplicativo', unit: '×',
  orig: zA2?.zoom / zA?.zoom, clone: zB2?.zoom / zB?.zoom, spec: 1.5, kind: 'value',
});

const lA = lerpFactor(A.scenarios.zoomStep);
const lB = lerpFactor(B.scenarios.zoomStep);
out.push({
  group: 'Zoom', metric: 'fattore di lerp per frame', unit: '',
  orig: lA?.factor, clone: lB?.factor, spec: 0.15, kind: 'value',
  note: `regressione log-lineare · R² ${(lA?.r2 ?? 0).toFixed(4)} / ${(lB?.r2 ?? 0).toFixed(4)} su ${lA?.n ?? 0} / ${lB?.n ?? 0} punti`,
});

// 2. Crossfade del View toggle
const vA = fitTransition(layerPair(AD.scenarios.viewCrossfade) || []);
const vB = fitTransition(layerPair(BD.scenarios.viewCrossfade) || []);
out.push({ group: 'View toggle', metric: 'durata crossfade', unit: 'ms', orig: vA?.D, clone: vB?.D, spec: 400, kind: 'duration' });
out.push({ group: 'View toggle', metric: 'easing', unit: '', orig: vA?.easing, clone: vB?.easing, spec: 'ease', kind: 'easing',
           origCp: vA?.cp, cloneCp: vB?.cp, rmsO: vA?.rms, rmsC: vB?.rms });

// 3. Hover
const hA = fitTransition(A.scenarios.hoverIn);
const hB = fitTransition(B.scenarios.hoverIn);
out.push({ group: 'Hover', metric: 'durata entrata', unit: 'ms', orig: hA?.D, clone: hB?.D, spec: 250, kind: 'duration' });
out.push({ group: 'Hover', metric: 'easing entrata', unit: '', orig: hA?.easing, clone: hB?.easing, spec: 'easeInOutQuad', kind: 'easing',
           origCp: hA?.cp, cloneCp: hB?.cp, rmsO: hA?.rms, rmsC: hB?.rms });
out.push({ group: 'Hover', metric: 'alpha finale', unit: '', orig: hA?.to, clone: hB?.to, spec: 0.6, kind: 'value' });

const oA = fitTransition(A.scenarios.hoverOut);
const oB = fitTransition(B.scenarios.hoverOut);
out.push({ group: 'Hover', metric: 'durata uscita', unit: 'ms', orig: oA?.D, clone: oB?.D, spec: 250, kind: 'duration' });

// 4. Scrim navbar
const sA = fitTransition(AD.scenarios.filtersScrim, { minSpan: 2 });
const sB = fitTransition(BD.scenarios.filtersScrim, { minSpan: 2 });
out.push({ group: 'Filtri', metric: 'durata scrim navbar', unit: 'ms', orig: sA?.D, clone: sB?.D, spec: 300, kind: 'duration' });
out.push({ group: 'Filtri', metric: 'rapporto altezza scrim', unit: '×',
           orig: sA ? sA.to / sA.from : null, clone: sB ? sB.to / sB.from : null,
           spec: 260 / 215, kind: 'value' });

// 5. Fade del canvas al load
const cfA = fitTransition(AD.scenarios.loadSequence.map((p) => ({ t: p.t, v: parseFloat(p.canvasOp) })));
const cfB = fitTransition(BD.scenarios.loadSequence.map((p) => ({ t: p.t, v: parseFloat(p.canvasOp) })));
out.push({ group: 'Loading', metric: 'durata fade canvas', unit: 'ms', orig: cfA?.D, clone: cfB?.D, spec: 800, kind: 'duration' });
out.push({ group: 'Loading', metric: 'easing fade canvas', unit: '', orig: cfA?.easing, clone: cfB?.easing, spec: 'ease', kind: 'easing',
           origCp: cfA?.cp, cloneCp: cfB?.cp, rmsO: cfA?.rms, rmsC: cfB?.rms });

// 6. Tooltip
function tooltipShape(series) {
  const pts = series.map((p) => ({ t: p.t, v: parseFloat(p.tipOp) })).filter((p) => Number.isFinite(p.v));
  if (pts.length < 10) return null;
  const peak = Math.max(...pts.map((p) => p.v));
  const first = pts.find((p) => p.v >= peak * 0.99);
  const last = [...pts].reverse().find((p) => p.v >= peak * 0.99);
  const end = pts.find((p) => p.t > (last?.t ?? 0) && p.v <= 0.01);
  const start = pts.find((p) => p.v > 0.01);
  return {
    peak,
    tRise: first && start ? first.t - start.t : null,
    tHold: first && last ? last.t - first.t : null,
    tFall: end && last ? end.t - last.t : null,
    total: end && start ? end.t - start.t : null,
  };
}
const ttA = tooltipShape(AD.scenarios.loadSequence);
const ttB = tooltipShape(BD.scenarios.loadSequence);
out.push({ group: 'Tooltip', metric: 'opacity di picco', unit: '', orig: ttA?.peak, clone: ttB?.peak, spec: 0.9, kind: 'value' });
out.push({ group: 'Tooltip', metric: 'salita (0→15%)', unit: 'ms', orig: ttA?.tRise, clone: ttB?.tRise, spec: 600, kind: 'duration' });
out.push({ group: 'Tooltip', metric: 'tenuta (15→70%)', unit: 'ms', orig: ttA?.tHold, clone: ttB?.tHold, spec: 2200, kind: 'duration' });
out.push({ group: 'Tooltip', metric: 'discesa (70→100%)', unit: 'ms', orig: ttA?.tFall, clone: ttB?.tFall, spec: 1200, kind: 'duration' });

/* ── verdetti ─────────────────────────────────────────────────────────────── */

const DUR_TOL = 2;      // %
const CP_TOL = 0.02;    // punti di controllo bezier
const VAL_TOL = 2;      // % per i valori scalari

for (const r of out) {
  if (r.kind === 'easing') {
    if (!r.orig || !r.clone) { r.verdict = 'N/D'; r.delta = null; continue; }
    const same = r.orig === r.clone;
    const maxCp = same && r.origCp ? 0 : Math.max(...(r.origCp || [0]).map((v, i) => Math.abs(v - (r.cloneCp || [])[i])));
    r.delta = maxCp;
    r.verdict = same && maxCp <= CP_TOL ? 'PASS' : 'FAIL';
  } else {
    const d = pct(r.orig, r.clone);
    r.delta = d;
    const tol = r.kind === 'duration' ? DUR_TOL : VAL_TOL;
    r.verdict = d === null || !Number.isFinite(d) ? 'N/D' : d <= tol ? 'PASS' : 'FAIL';
  }
}

/* ── output ───────────────────────────────────────────────────────────────── */

console.log('\nframe rate — passaggio a pixel: orig', A.frameRate.fps.toFixed(1), '· clone', B.frameRate.fps.toFixed(1), 'fps');
console.log('frame rate — passaggio DOM:     orig', AD.frameRate.fps.toFixed(1), '· clone', BD.frameRate.fps.toFixed(1), 'fps\n');
console.log('gruppo'.padEnd(13), 'metrica'.padEnd(28), 'orig'.padStart(10), 'clone'.padStart(10), 'spec'.padStart(9), 'Δ'.padStart(9), '  esito');
console.log('-'.repeat(96));
for (const r of out) {
  const o = typeof r.orig === 'string' ? r.orig : f2(r.orig, r.unit === 'ms' ? 0 : 4);
  const c = typeof r.clone === 'string' ? r.clone : f2(r.clone, r.unit === 'ms' ? 0 : 4);
  const s = typeof r.spec === 'string' ? r.spec : f2(r.spec, r.unit === 'ms' ? 0 : 4);
  const d = r.kind === 'easing' ? f2(r.delta, 3) : `${f2(r.delta, 2)}%`;
  console.log(r.group.padEnd(13), r.metric.padEnd(28), String(o).padStart(10), String(c).padStart(10), String(s).padStart(9), d.padStart(9), '  ' + r.verdict);
}
const pass = out.filter((r) => r.verdict === 'PASS').length;
const fail = out.filter((r) => r.verdict === 'FAIL').length;
const na = out.filter((r) => r.verdict === 'N/D').length;
console.log(`\nPASS ${pass} · FAIL ${fail} · N/D ${na}`);

fs.writeFileSync(path.join(RAW, 'diff.json'), JSON.stringify({ frameRate: { original: A.frameRate, clone: B.frameRate }, rows: out, lerp: { original: lA, clone: lB } }, null, 1));
console.log('\ndiff completo in research/raw/parity/diff.json');
