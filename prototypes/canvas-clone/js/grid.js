/**
 * grid.js — stato condiviso, caricamento immagini per tier LOD, e renderer canvas 2D.
 *
 * Il renderer replica l'ordine di trasformazione dello spec §B3-bis: dopo il
 * translate del padding si disegna in SPAZIO GRIGLIA, quindi spacing e bleed
 * non vanno pre-moltiplicati per la scala.
 */

import {
  CELL_BASE, GRID_PAD_RATIO, DPR_CAP, BLEED,
  ZOOM_DEFAULT, LERP, SETTLE_ZOOM, SETTLE_PX,
  REVEAL_THRESHOLD, HOVER_ALPHA, FILTERED_ALPHA,
  tierFor,
} from './spec.js';
import { THUMBS, srcFor } from './data.js';

/** Stato del motore. Mutato dai moduli di interazione, letto dal renderer. */
export const state = {
  phase: 'loading',      // 'loading' → 'fadeIn'|'playFrames' → 'done'  (§G2 · N0:654)
  frames: [],            // frame della maschera: ogni frame ha la sua lista sparsa
  frameIndex: 0,
  gridData: null,        // = frames[frameIndex].gridData, aggiornato da setFrame()
  canvas: null,
  ctx: null,
  host: null,

  zoom: ZOOM_DEFAULT,       // valore corrente, interpolato
  zoomTarget: ZOOM_DEFAULT, // bersaglio del lerp
  panX: 0, panY: 0,
  panTargetX: 0, panTargetY: 0,

  lerp: LERP,               // §A — 0.15, temporaneamente 0.06 nel resetView
  onSettle: null,           // callback one-shot a fine lerp (§C · resetView)
  rafLerp: null,

  squash: 1,                // §A — deformazione da velocità
  velocityPeak: 0,
  rafSquash: null,

  revealProgress: 0,        // §B3 — 0→1 in 1500 ms lineari
  cellDistance: [],         // §B3 — distanza normalizzata dal centro, per cella

  hoverKey: null,           // "col,row" della cella sotto il puntatore
  hoverAlpha: 1,            // §B4 — anima verso 0.6
  leaveKey: null,
  leaveAlpha: 1,            // §B4 — anima verso 1

  activeCategory: 'all',
  tierWidth: null,
  images: new Map(),        // placeholderIndex → { img, gray }
};

/* ── Caricamento immagini per tier LOD (§B2) ──────────────────────────────── */

function grayscaleCopy(img) {
  // L'originale tiene DUE atlas, uno a colori e uno in scala di grigi (§B1 · N0:782).
  // Qui la copia è per-immagine: i soggetti unici sono 24, non 144.
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const g = c.getContext('2d');
  g.filter = 'grayscale(1)';
  g.drawImage(img, 0, 0);
  return c;
}

export function loadTier(zoom) {
  const width = tierFor(zoom).width; // §B2
  if (state.tierWidth === width) return Promise.resolve();
  state.tierWidth = width;

  const unique = [...new Set(THUMBS.map((t) => t.placeholderIndex))];
  return Promise.all(
    unique.map(
      (idx) =>
        new Promise((resolve) => {
          const img = new Image();
          img.decoding = 'async';
          img.onload = () => {
            state.images.set(idx, { img, gray: grayscaleCopy(img) });
            resolve();
          };
          img.onerror = () => resolve();
          img.src = srcFor(idx, width);
        }),
    ),
  );
}

/* ── Geometria ────────────────────────────────────────────────────────────── */

export const scaleFor = (zoom) => (CELL_BASE / state.gridData.cellSize) * zoom; // §B1

function padding() {
  const { width, height } = state.gridData;
  return {
    x: Math.floor(width * GRID_PAD_RATIO),  // §0 · N0:786
    y: Math.floor(height * GRID_PAD_RATIO),
  };
}

/**
 * Clamp dei bordi (§A · N0:786): se il contenuto sta nel viewport è centrato e
 * il pan è bloccato; altrimenti è vincolato ai due estremi. Clamp secco, senza
 * rubber-band, applicato al TARGET prima del lerp.
 */
export function clampPan(px, py) {
  const gd = state.gridData;
  if (!gd || !state.host) return { px, py };
  const s = scaleFor(state.zoom);
  const pad = padding();
  const vw = state.host.clientWidth;
  const vh = state.host.clientHeight;

  const contentW = gd.width * s;
  const contentH = gd.height * s;
  const padW = pad.x * s;
  const padH = pad.y * s;

  const maxX = -padW;
  const minX = vw - padW - contentW;
  const maxY = -padH;
  const minY = vh - padH - contentH;

  return {
    px: contentW <= vw ? (vw - contentW) / 2 - padW : Math.max(minX, Math.min(px, maxX)),
    py: contentH <= vh ? (vh - contentH) / 2 - padH : Math.max(minY, Math.min(py, maxY)),
  };
}

/** Centra la griglia (padding incluso) per uno zoom dato. §C · N0:788 */
export function centeredPan(zoom) {
  const gd = state.gridData;
  const s = scaleFor(zoom) * (zoom / state.zoom || 1);
  const sc = (CELL_BASE / gd.cellSize) * zoom;
  const pad = padding();
  const totalW = (gd.width + pad.x * 2) * sc;
  const totalH = (gd.height + pad.y * 2) * sc;
  void s;
  return {
    px: (state.host.clientWidth - totalW) / 2,
    py: (state.host.clientHeight - totalH) / 2,
  };
}

/** Cella sotto una coordinata di viewport, o null. */
export function cellAt(clientX, clientY) {
  const gd = state.gridData;
  if (!gd) return null;
  const s = scaleFor(state.zoom);
  const pad = padding();
  const gx = (clientX - state.panX) / s - pad.x;
  const gy = (clientY - state.panY) / s - pad.y;
  const col = Math.floor(gx / gd.cellSize);
  const row = Math.floor(gy / gd.cellSize);
  return gd.cells.find((c) => c.gridCol === col && c.gridRow === row) ?? null;
}

export const isVisible = (thumb) =>
  state.activeCategory === 'all' || thumb.categoryId === state.activeCategory;

/* ── Lerp: il cuore della fisica (§A · N0:791-798) ────────────────────────── */

export function startLerp() {
  if (state.rafLerp) return;
  const step = () => {
    const f = state.lerp;
    const dz = state.zoomTarget - state.zoom;
    const dx = state.panTargetX - state.panX;
    const dy = state.panTargetY - state.panY;

    // Soglie di settle: §A · N0:794
    if (Math.abs(dz) > SETTLE_ZOOM || Math.abs(dx) > SETTLE_PX || Math.abs(dy) > SETTLE_PX) {
      // Smoothing esponenziale NON compensato per delta-time — voluto (§UNKNOWNS note)
      state.zoom += dz * f;
      const nx = state.panX + dx * f;
      const ny = state.panY + dy * f;
      if (state.phase === 'done') {
        const c = clampPan(nx, ny);
        state.panX = c.px;
        state.panY = c.py;
      } else {
        state.panX = nx;
        state.panY = ny;
      }
      render();
      state.rafLerp = requestAnimationFrame(step);
    } else {
      state.zoom = state.zoomTarget;
      state.panX = state.panTargetX;
      state.panY = state.panTargetY;
      render();
      state.rafLerp = null;
      if (state.onSettle) {
        const cb = state.onSettle;
        state.onSettle = null;
        cb();
      }
      if (state.phase === 'done') loadTier(state.zoom).then(render);
    }
  };
  state.rafLerp = requestAnimationFrame(step);
}

export function stopLerp() {
  if (state.rafLerp) cancelAnimationFrame(state.rafLerp);
  state.rafLerp = null;
}

/* ── Renderer (§B3-bis) ───────────────────────────────────────────────────── */

export function render() {
  const gd = state.gridData;
  const { canvas, ctx, host } = state;
  if (!gd || !canvas || !ctx || !host) return;

  const dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP); // §0 · N0:772
  const w = Math.round(host.clientWidth * dpr);
  const h = Math.round(host.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
    canvas.style.width = `${host.clientWidth}px`;
    canvas.style.height = `${host.clientHeight}px`;
  }

  // 1-2. DPR + clear
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, host.clientWidth, host.clientHeight);
  ctx.save();

  // 3. squash attorno al centro del viewport, PRIMA del pan
  if (state.squash !== 1) {
    const cx = host.clientWidth / 2;
    const cy = host.clientHeight / 2;
    ctx.translate(cx, cy);
    ctx.scale(state.squash, state.squash);
    ctx.translate(-cx, -cy);
  }

  // 4-6. pan → scale → padding. Da qui si disegna in spazio griglia.
  const s = scaleFor(state.zoom);
  const pad = padding();
  ctx.translate(state.panX, state.panY);
  ctx.scale(s, s);
  ctx.translate(pad.x, pad.y);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'low'; // §B1 · N0:774

  const drawn = gd.cellSize - gd.spacing; // §B1 · N0:776
  if (drawn <= 0) {
    ctx.restore();
    return;
  }

  for (const cell of gd.cells) {
    let alpha = 1;
    let useGray = false;

    if (state.phase === 'fadeIn') {
      // §B3 — pop-in secco a distanza_normalizzata × 0.7
      const d = state.cellDistance[cell.thumbIndex] ?? 0;
      if (state.revealProgress < d * REVEAL_THRESHOLD) continue;
    } else if (state.phase === 'done') {
      const thumb = THUMBS[cell.thumbIndex];
      if (!isVisible(thumb)) {
        alpha = FILTERED_ALPHA; // §D · N0:780
        useGray = true;
      } else {
        const key = `${cell.gridCol},${cell.gridRow}`;
        if (state.hoverKey === key) alpha = state.hoverAlpha;
        else if (state.leaveKey === key) alpha = state.leaveAlpha;
      }
    }

    const entry = state.images.get(THUMBS[cell.thumbIndex].placeholderIndex);
    if (!entry) continue;
    const src = useGray ? entry.gray : entry.img;

    ctx.globalAlpha = alpha;
    ctx.drawImage(
      src,
      0, 0, src.width, src.height,
      // §B1 · N0:784 — bleed di 0.5 per lato, in spazio griglia
      cell.x + gd.spacing / 2 - BLEED,
      cell.y + gd.spacing / 2 - BLEED,
      drawn + BLEED * 2,
      drawn + BLEED * 2,
    );
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

/** Distanza euclidea normalizzata dal centro griglia, per cella. §B3 · N0:863 */
export function computeCellDistances(gd) {
  const cx = gd.width / 2;
  const cy = gd.height / 2;
  let max = 0;
  const raw = gd.cells.map((c) => {
    const d = Math.hypot(c.x + gd.cellSize / 2 - cx, c.y + gd.cellSize / 2 - cy);
    max = Math.max(max, d);
    return d;
  });
  return raw.map((d) => (max > 0 ? d / max : 0));
}

/** Cambia frame della maschera. Hard-cut: nessuna interpolazione (§mask). */
export function setFrame(i) {
  if (!state.frames.length) return;
  state.frameIndex = ((i % state.frames.length) + state.frames.length) % state.frames.length;
  state.gridData = state.frames[state.frameIndex].gridData;
}

export function initGrid({ canvas, host, frames }) {
  state.canvas = canvas;
  state.host = host;
  state.ctx = canvas.getContext('2d');
  state.frames = frames;
  setFrame(0);
  // Le distanze del wipe si calcolano sul PRIMO frame e si indicizzano per
  // ordinale della cella nel frame corrente, come fa l'originale (N0:866,778).
  state.cellDistance = computeCellDistances(state.frames[0].gridData);
  return state;
}

export { HOVER_ALPHA };
