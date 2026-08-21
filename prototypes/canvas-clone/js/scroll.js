/**
 * scroll.js — fisica del pan. §A dello spec.
 *
 * Attenzione: sull'originale NON esiste scroll di pagina né smooth scroll.
 * Le tre sorgenti di input hanno tre comportamenti diversi e non vanno unificate:
 *   wheel/trackpad → 1:1 diretto, zero smoothing
 *   drag           → 1:1 mentre premuto, poi inerzia al rilascio
 *   pinch          → zoom continuo diretto
 */

import {
  LERP, INERTIA_MULT, INERTIA_MIN_V, VELOCITY_FRAME_MS, TOUCH_DRAG_THRESHOLD,
  SQUASH_DECAY, SQUASH_FACTOR, SQUASH_AMPLITUDE, SQUASH_LERP, SQUASH_STOP,
  ZOOM_MIN, ZOOM_MAX,
} from './spec.js';
import { state, render, clampPan, startLerp, stopLerp, scaleFor, cellAt, isVisible } from './grid.js';
import { THUMBS } from './data.js';

let dragging = false;
let moved = false;
let startX = 0, startY = 0, originX = 0, originY = 0;
let vx = 0, vy = 0, lastT = 0;

// pinch
let pinching = false;
let pinchDist0 = 1, pinchZoom0 = 1, pinchMidX = 0, pinchMidY = 0;

let onActivity = () => {};
let onHover = () => {};
let onOpen = () => {};

/* ── Squash da velocità (§A · N0:834) ─────────────────────────────────────── */

function squashStep() {
  state.velocityPeak *= SQUASH_DECAY;
  const target = 1 - Math.min(state.velocityPeak * SQUASH_FACTOR, 1) * SQUASH_AMPLITUDE;
  state.squash += (target - state.squash) * SQUASH_LERP;
  render();
  if (dragging || Math.abs(1 - state.squash) > SQUASH_STOP) {
    state.rafSquash = requestAnimationFrame(squashStep);
  } else {
    state.rafSquash = null;
    state.squash = 1;
    state.velocityPeak = 0;
    render();
  }
}

function startSquash() {
  if (!state.rafSquash) state.rafSquash = requestAnimationFrame(squashStep);
}

/* ── Velocità (§A · N0:909) ───────────────────────────────────────────────── */

function trackVelocity(nextX, nextY) {
  const now = Date.now();
  const dt = now - lastT;
  if (dt > 0) {
    vx = ((nextX - state.panX) / dt) * VELOCITY_FRAME_MS;
    vy = ((nextY - state.panY) / dt) * VELOCITY_FRAME_MS;
  }
  lastT = now;
  state.velocityPeak = Math.max(state.velocityPeak, Math.hypot(vx, vy));
}

/* ── Rilascio: inerzia (§A · N0:916-919) ──────────────────────────────────── */

function release() {
  if (!dragging) return;
  dragging = false;
  state.canvas.style.cursor = 'grab';
  if (Math.abs(vx) > INERTIA_MIN_V || Math.abs(vy) > INERTIA_MIN_V) {
    const c = clampPan(state.panX + vx * INERTIA_MULT, state.panY + vy * INERTIA_MULT);
    state.panTargetX = c.px;
    state.panTargetY = c.py;
  }
  stopLerp();
  startLerp();
}

/* ── Wheel: 1:1, nessuno smoothing (§A · N0:923-927) ──────────────────────── */

function onWheel(e) {
  if (state.phase !== 'done') return;
  e.preventDefault();
  onActivity();
  const c = clampPan(state.panX - e.deltaX, state.panY - e.deltaY);
  state.panX = state.panTargetX = c.px;
  state.panY = state.panTargetY = c.py;
  render();
}

/* ── Mouse ────────────────────────────────────────────────────────────────── */

function onPointerDown(e) {
  if (state.phase !== 'done' || e.pointerType === 'touch') return;
  onActivity();
  dragging = true;
  moved = false;
  startX = e.clientX;
  startY = e.clientY;
  originX = state.panX;
  originY = state.panY;
  lastT = Date.now();
  vx = vy = 0;
  state.velocityPeak = 0;
  stopLerp();
  state.canvas.style.cursor = 'grabbing';
  startSquash();
}

function onPointerMove(e) {
  if (state.phase !== 'done' || e.pointerType === 'touch') return;
  onActivity();

  if (dragging) {
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (Math.abs(dx) > TOUCH_DRAG_THRESHOLD || Math.abs(dy) > TOUCH_DRAG_THRESHOLD) moved = true;
    const c = clampPan(originX + dx, originY + dy);
    trackVelocity(c.px, c.py);
    state.panX = state.panTargetX = c.px;
    state.panY = state.panTargetY = c.py;
    render();
    return;
  }

  // Hover: cursore nativo grab/pointer (§G1 · N0:910,914)
  const cell = cellAt(e.clientX, e.clientY);
  if (!cell) {
    onHover(null);
    state.canvas.style.cursor = 'grab';
    return;
  }
  const thumb = THUMBS[cell.thumbIndex];
  const clickable = isVisible(thumb);
  onHover(clickable ? cell : null);
  state.canvas.style.cursor = clickable ? 'pointer' : 'grab';
}

function onPointerUp(e) {
  if (e.pointerType === 'touch') return;
  const wasDragging = dragging;
  release();
  if (wasDragging && !moved) {
    const cell = cellAt(e.clientX, e.clientY);
    if (cell && isVisible(THUMBS[cell.thumbIndex])) onOpen(THUMBS[cell.thumbIndex], cell);
  }
}

/* ── Touch (§A · N0:932-953) ──────────────────────────────────────────────── */

const pinchDistance = (t) => Math.hypot(
  t[0].clientX - t[1].clientX,
  t[0].clientY - t[1].clientY,
);

function onTouchStart(e) {
  if (state.phase !== 'done') return;
  e.preventDefault();
  onActivity();

  if (e.touches.length === 2) {
    dragging = false;
    pinching = true;
    pinchDist0 = pinchDistance(e.touches);
    pinchZoom0 = state.zoom;
    pinchMidX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
    pinchMidY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
    return;
  }
  if (e.touches.length !== 1) return;

  const t = e.touches[0];
  dragging = true;
  moved = false;
  startX = t.clientX;
  startY = t.clientY;
  originX = state.panX;
  originY = state.panY;
  lastT = Date.now();
  vx = vy = 0;
  state.velocityPeak = 0;
  stopLerp();
  startSquash();
}

function onTouchMove(e) {
  if (state.phase !== 'done') return;
  e.preventDefault();

  if (pinching && e.touches.length === 2) {
    // Pinch: continuo, diretto, nessuno smoothing (§C · N0:936-939)
    const ratio = pinchDistance(e.touches) / pinchDist0;
    const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, pinchZoom0 * ratio));
    const gd = state.gridData;
    const base = 60 / gd.cellSize;
    const sNow = base * state.zoom;
    const sNext = base * next;
    const ax = (pinchMidX - state.panX) / sNow;
    const ay = (pinchMidY - state.panY) / sNow;
    state.panX = state.panTargetX = pinchMidX - ax * sNext;
    state.panY = state.panTargetY = pinchMidY - ay * sNext;
    state.zoom = state.zoomTarget = next;
    render();
    return;
  }

  if (!dragging || e.touches.length !== 1) return;
  const t = e.touches[0];
  const dx = t.clientX - startX;
  const dy = t.clientY - startY;
  // Soglia di attivazione del drag su touch: 3 px (§A · N0:941)
  if (!moved && (Math.abs(dx) > TOUCH_DRAG_THRESHOLD || Math.abs(dy) > TOUCH_DRAG_THRESHOLD)) moved = true;
  if (!moved) return;

  const c = clampPan(originX + dx, originY + dy);
  trackVelocity(c.px, c.py);
  state.panX = state.panTargetX = c.px;
  state.panY = state.panTargetY = c.py;
  render();
}

function onTouchEnd(e) {
  if (pinching) {
    pinching = false;
    return;
  }
  if (!dragging) return;
  if (!moved) {
    const t = e.changedTouches[0];
    if (t) {
      const cell = cellAt(t.clientX, t.clientY);
      if (cell && isVisible(THUMBS[cell.thumbIndex])) onOpen(THUMBS[cell.thumbIndex], cell);
    }
  }
  release();
}

export function initScroll({ onActivity: activity, onHover: hover, onOpen: open }) {
  onActivity = activity ?? (() => {});
  onHover = hover ?? (() => {});
  onOpen = open ?? (() => {});

  const c = state.canvas;
  c.style.cursor = 'grab';
  // passive:false + preventDefault (§A · N0:978)
  c.addEventListener('wheel', onWheel, { passive: false });
  c.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  c.addEventListener('touchstart', onTouchStart, { passive: false });
  c.addEventListener('touchmove', onTouchMove, { passive: false });
  c.addEventListener('touchend', onTouchEnd);
}

export { LERP };
