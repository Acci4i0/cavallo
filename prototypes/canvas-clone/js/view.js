/**
 * view.js — §E dello spec. Toggle Pixel Grid ⇄ Natural Grid.
 *
 * Non c'è morph e non c'è FLIP: due layer sovrapposti che fanno crossfade
 * (0.4s ease, verificato per fitting a 396 ms — §E1). Il Natural Grid è una
 * CSS grid reale con scroll nativo sul contenitore e parallasse per-item.
 */

import { NG_RECALC_FALLBACK_MS } from './spec.js';
import { state, render } from './grid.js';
import { THUMBS, srcFor } from './data.js';

let current = 'pixel';
let resizeObserver = null;

/**
 * --extra-space per item = (altezza massima della sua riga) − propria altezza.
 * Righe raggruppate per offsetTop identico. §E2 · N0:599-601
 */
function computeExtraSpace(container) {
  const items = container.querySelectorAll(':scope > a');
  if (!items.length) return;
  const rows = new Map();
  for (const el of items) {
    const top = el.offsetTop;
    if (!rows.has(top)) rows.set(top, []);
    rows.get(top).push(el);
  }
  for (const [, group] of rows) {
    let max = 0;
    for (const el of group) max = Math.max(max, el.offsetHeight);
    for (const el of group) el.style.setProperty('--extra-space', `${max - el.offsetHeight}px`);
  }
}

/** --scroll-progress = scrollTop / (scrollHeight − clientHeight). §E2 · N0:603-605 */
function updateScrollProgress(container) {
  const max = container.scrollHeight - container.clientHeight;
  const p = max > 0 ? container.scrollTop / max : 0;
  container.style.setProperty('--scroll-progress', String(p));
}

function buildNaturalGrid(container, { onOpen }) {
  container.innerHTML = '';
  for (const thumb of THUMBS) {
    const a = document.createElement('a');
    a.href = `#/works/${thumb.workSlug}?slide=${thumb.slideIndex}`;
    a.dataset.category = thumb.categoryId;
    a.setAttribute('aria-label', thumb.title);

    const wrap = document.createElement('span');
    wrap.className = 'image-container';
    const img = document.createElement('img');
    img.src = srcFor(thumb.placeholderIndex, 512);
    img.alt = '';
    img.decoding = 'async';
    img.loading = 'lazy';
    // Fade-in per immagine: opacity 0 → 1, 0.3s ease alla classe .loaded (§E2)
    img.addEventListener('load', () => img.classList.add('loaded'), { once: true });
    if (img.complete) img.classList.add('loaded');

    wrap.appendChild(img);
    a.appendChild(wrap);
    a.addEventListener('click', (e) => {
      e.preventDefault();
      onOpen?.(thumb);
    });
    container.appendChild(a);
  }

  const recalc = () => {
    computeExtraSpace(container);
    updateScrollProgress(container);
  };

  // Aggiornamento diretto a ogni evento di scroll, nessuno smoothing (§E2)
  container.addEventListener('scroll', () => updateScrollProgress(container), { passive: true });

  // Ricalcolo: a tutte le immagini caricate + ResizeObserver + fallback 2000 ms (§E2 · N0:607-611)
  const imgs = container.querySelectorAll('img');
  let loaded = 0;
  const bump = () => { if (++loaded >= imgs.length) recalc(); };
  if (!imgs.length) requestAnimationFrame(recalc);
  else {
    for (const im of imgs) {
      if (im.complete) bump();
      else im.addEventListener('load', bump, { once: true });
    }
  }
  setTimeout(recalc, NG_RECALC_FALLBACK_MS);
  resizeObserver?.disconnect();
  resizeObserver = new ResizeObserver(() => computeExtraSpace(container));
  resizeObserver.observe(container);
}

export function applyFilterToNatural(container, categoryId) {
  for (const a of container.querySelectorAll(':scope > a')) {
    // §E2 — grayscale(1) contrast(4) + opacity .05 + pointer-events none
    a.classList.toggle('inactive', categoryId !== 'all' && a.dataset.category !== categoryId);
  }
}

export function initView({ onOpen } = {}) {
  const pixelLayer = document.querySelector('[data-layer="pixel"]');
  const naturalLayer = document.querySelector('[data-layer="natural"]');
  const naturalGrid = document.querySelector('[data-natural-grid]');
  const buttons = document.querySelectorAll('[data-view]');
  if (!pixelLayer || !naturalLayer || !naturalGrid) return {};

  buildNaturalGrid(naturalGrid, { onOpen });

  const setView = (next) => {
    if (next === current) return;
    current = next;
    pixelLayer.classList.toggle('active', next === 'pixel');
    naturalLayer.classList.toggle('active', next === 'natural');
    buttons.forEach((b) => b.classList.toggle('active', b.dataset.view === next));
    if (next === 'natural') {
      computeExtraSpace(naturalGrid);
      updateScrollProgress(naturalGrid);
    } else {
      render();
    }
  };

  buttons.forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
  setView('pixel');
  buttons.forEach((b) => b.classList.toggle('active', b.dataset.view === 'pixel'));
  pixelLayer.classList.add('active');

  return { setView, naturalGrid, getView: () => current };
}

export { state };
