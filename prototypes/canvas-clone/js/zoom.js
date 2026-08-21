/**
 * zoom.js — §C dello spec.
 *
 * Nota: sull'originale lo zoom NON è uno slider. Sono due bottoni con step
 * moltiplicativo. Quattro azioni, con TRE meccaniche diverse:
 *   + / −      → lerp 0.15 (stessa fisica del pan)
 *   resetView  → lerp 0.06, poi ripristino a 0.15
 *   zoomToMin  → tween a tempo, 1200 ms easeInOutCubic
 */

import {
  ZOOM_MIN, ZOOM_MAX, ZOOM_STEP, ZOOM_DEFAULT,
  LERP, LERP_RESET, IDLE_TWEEN_MS, CELL_BASE, easeInOutCubic,
} from './spec.js';
import { state, render, startLerp, stopLerp, centeredPan, loadTier } from './grid.js';

let tweenRaf = null;
let onZoomChange = () => {};

const emit = () => onZoomChange(Math.round(state.zoomTarget * 100)); // §C · label = round(zoom×100)

/** Zoom ancorato al centro del viewport. §C · N0:831-832 */
function zoomTo(next) {
  const gd = state.gridData;
  const base = CELL_BASE / gd.cellSize;
  const cx = state.host.clientWidth / 2;
  const cy = state.host.clientHeight / 2;
  const sNow = base * state.zoom;
  const sNext = base * next;
  const ax = (cx - state.panX) / sNow;
  const ay = (cy - state.panY) / sNow;

  state.panTargetX = cx - ax * sNext;
  state.panTargetY = cy - ay * sNext;
  state.zoomTarget = next;
  emit();
  stopLerp();
  startLerp();
}

export function zoomIn() {
  if (state.phase !== 'done') return;
  zoomTo(Math.min(ZOOM_MAX, state.zoomTarget * ZOOM_STEP)); // §C · N0:800
}

export function zoomOut() {
  if (state.phase !== 'done') return;
  zoomTo(Math.max(ZOOM_MIN, state.zoomTarget / ZOOM_STEP)); // §C · N0:802
}

/** Reset: lerp rallentato a 0.06, ripristinato a 0.15 a settle. §C · N0:804-805 */
export function resetView() {
  if (state.phase !== 'done') return;
  const p = centeredPan(ZOOM_DEFAULT);
  state.panTargetX = p.px;
  state.panTargetY = p.py;
  state.zoomTarget = ZOOM_DEFAULT;
  state.lerp = LERP_RESET;
  state.onSettle = () => { state.lerp = LERP; };
  emit();
  stopLerp();
  startLerp();
}

/** Tween a tempo — l'unica azione di zoom che non usa il lerp. §C · N0:807-812 */
export function zoomToMin() {
  if (state.phase !== 'done') return;
  const target = centeredPan(ZOOM_MIN);
  const z0 = state.zoom, x0 = state.panX, y0 = state.panY;
  const t0 = performance.now();
  stopLerp();
  if (tweenRaf) cancelAnimationFrame(tweenRaf);

  const step = (now) => {
    const t = Math.min(1, (now - t0) / IDLE_TWEEN_MS);
    const e = easeInOutCubic(t);
    state.zoom = z0 + (ZOOM_MIN - z0) * e;
    state.panX = x0 + (target.px - x0) * e;
    state.panY = y0 + (target.py - y0) * e;
    state.panTargetX = state.panX;
    state.panTargetY = state.panY;
    render();
    if (t < 1) {
      tweenRaf = requestAnimationFrame(step);
    } else {
      tweenRaf = null;
      state.zoom = state.zoomTarget = ZOOM_MIN;
      emit();
      loadTier(state.zoom).then(render);
    }
  };
  tweenRaf = requestAnimationFrame(step);
}

export function initZoom({ onChange } = {}) {
  onZoomChange = onChange ?? (() => {});
  document.querySelector('[data-zoom-in]')?.addEventListener('click', zoomIn);
  document.querySelector('[data-zoom-out]')?.addEventListener('click', zoomOut);
  document.querySelector('[data-zoom-reset]')?.addEventListener('click', resetView);
  emit();
}
