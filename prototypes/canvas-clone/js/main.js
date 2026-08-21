/**
 * main.js — orchestrazione. Nessuna costante numerica qui: stanno tutte in spec.js.
 */

import { HOVER_MS, HOVER_ALPHA, easeInOutQuad } from './spec.js';
import { state, initGrid, render, startLerp, centeredPan } from './grid.js';
import { initScroll } from './scroll.js';
import { initZoom } from './zoom.js';
import { initFilters } from './filters.js';
import { initView, applyFilterToNatural } from './view.js';
import { initTransitions } from './transitions.js';
import { runLoadingSequence, noteActivity, setIdleEnabled } from './loader.js';
import { SITE_TITLE, THUMBS, loadMask, buildFrames } from './data.js';

/* ── Hover: due animazioni indipendenti, stessa durata e stessa easing (§B4) ─ */

let enterRaf = null;
let leaveRaf = null;

function animateHoverIn(from) {
  const t0 = performance.now();
  if (enterRaf) cancelAnimationFrame(enterRaf);
  const step = (now) => {
    const t = Math.min(1, (now - t0) / HOVER_MS);
    const e = easeInOutQuad(t); // §B4 · N0:960
    state.hoverAlpha = from + (HOVER_ALPHA - from) * e;
    render();
    enterRaf = t < 1 ? requestAnimationFrame(step) : null;
  };
  enterRaf = requestAnimationFrame(step);
}

function animateHoverOut(from) {
  const t0 = performance.now();
  if (leaveRaf) cancelAnimationFrame(leaveRaf);
  const step = (now) => {
    const t = Math.min(1, (now - t0) / HOVER_MS);
    const e = easeInOutQuad(t); // §B4 · N0:966
    state.leaveAlpha = from + (1 - from) * e;
    render();
    if (t < 1) leaveRaf = requestAnimationFrame(step);
    else { leaveRaf = null; state.leaveKey = null; render(); }
  };
  leaveRaf = requestAnimationFrame(step);
}

/**
 * Passaggio da una cella all'altra: la vecchia parte in uscita DAL SUO VALORE
 * CORRENTE e la nuova entra dal suo — niente salti (§B4 · N0:913-914).
 */
function setHover(cell) {
  const key = cell ? `${cell.gridCol},${cell.gridRow}` : null;
  if (key === state.hoverKey) return;

  if (state.hoverKey) {
    if (leaveRaf) { cancelAnimationFrame(leaveRaf); leaveRaf = null; }
    state.leaveKey = state.hoverKey;
    state.leaveAlpha = state.hoverAlpha;
    animateHoverOut(state.leaveAlpha);
  }

  let from = 1;
  if (state.leaveKey === key) {
    from = state.leaveAlpha;
    state.leaveKey = null;
    if (leaveRaf) { cancelAnimationFrame(leaveRaf); leaveRaf = null; }
  }
  if (enterRaf) { cancelAnimationFrame(enterRaf); enterRaf = null; }

  state.hoverKey = key;
  state.hoverAlpha = from;
  if (key) animateHoverIn(from);
  else render();
}

/* ── Boot ─────────────────────────────────────────────────────────────────── */

async function boot() {
  document.querySelectorAll('[data-site-title]').forEach((el) => { el.textContent = SITE_TITLE; });

  const host = document.querySelector('.pixel-grid');
  const canvas = host.querySelector('canvas');

  // La maschera arriva dal JSON generato da scripts/build-mask.js: nessuna
  // matrice è hardcoded. Il thumbIndex è l'ordinale nel frame % numero di thumb,
  // quindi le immagini si rimescolano a ogni frame (PARITY-MASK §3).
  let frames;
  try {
    const mask = await loadMask();
    frames = buildFrames(mask, THUMBS.length);
    if (!frames.length) throw new Error('maschera vuota');
  } catch (err) {
    // Senza questo guard un errore qui lascia la pagina muta: la navbar è HTML
    // statico e si vede, ma il canvas resta bianco senza alcuna spiegazione.
    console.error('[mask]', err);
    const n = document.querySelector('.placeholder-note');
    if (n) n.textContent = `Maschera non caricata (${err.message}). Esegui: node scripts/build-mask.js`;
    return;
  }
  initGrid({ canvas, host, frames });

  // Timbro di versione: se in basso a sinistra NON compare il numero di frame,
  // il browser sta eseguendo un main.js vecchio dalla cache.
  const note = document.querySelector('.placeholder-note');
  if (note) note.textContent = `Segnaposto · maschera ${frames.length} frame · griglia ${frames[0].gridData.cols}x${frames[0].gridData.rows}`;

  const zoomLabel = document.querySelector('[data-zoom-label]');
  initZoom({ onChange: (pct) => { if (zoomLabel) zoomLabel.textContent = `${pct}`; } });

  const view = initView({ onOpen: (t) => console.info('[placeholder] open', t.workSlug) });

  initFilters({
    onChange: (cat) => { if (view.naturalGrid) applyFilterToNatural(view.naturalGrid, cat); },
  });

  initTransitions({ onChange: (open) => setIdleEnabled(!open) });

  initScroll({
    onActivity: noteActivity,
    onHover: setHover,
    onOpen: (t) => console.info('[placeholder] open', t.workSlug),
  });

  // Gli stessi eventi che sull'originale resettano l'idle (§G4 · N0:970)
  for (const ev of ['mousemove', 'mousedown', 'keydown', 'touchstart']) {
    window.addEventListener(ev, noteActivity, { passive: true });
  }

  window.addEventListener('resize', () => {
    if (state.phase !== 'done') {
      const p = centeredPan(state.zoom);
      state.panX = state.panTargetX = p.px;
      state.panY = state.panTargetY = p.py;
    }
    render();
  });

  // Hook di sola lettura per gli script di verifica di Fase 3: permette di
  // validare lo stimatore di zoom (autocorrelazione sui pixel) contro il valore
  // vero. Non è usato dal runtime.
  window.__cloneState = state;

  startLerp();
  runLoadingSequence();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
