/**
 * filters.js — §D dello spec.
 *
 * Misurato: il pannello NON ha stagger né animazione d'ingresso (§D1).
 * getAnimations() è vuoto su tutti i campioni, le voci compaiono già al valore
 * finale di opacity. L'unica cosa animata all'apertura è l'altezza dello scrim
 * della navbar (215% → 260%, 0.3s ease), che sta nel CSS.
 *
 * Il filtro sulle celle è istantaneo al frame: le non-matching passano ad
 * alpha 0.05 e all'immagine in scala di grigi. Nessun FLIP, nessun riordino.
 */

import { CATEGORIES } from './data.js';
import { state, render } from './grid.js';

let open = false;

function setOpen(next, { navbar, panel, toggle }) {
  open = next;
  navbar.classList.toggle('filters-open', open);
  panel.hidden = !open;
  // §D · il bottone commuta il segno, come l'originale
  toggle.textContent = open ? 'Filters −' : 'Filters +';
  toggle.setAttribute('aria-expanded', String(open));
}

export function initFilters({ onChange } = {}) {
  const navbar = document.querySelector('.navbar');
  const toggle = document.querySelector('[data-filters-toggle]');
  const panel = document.querySelector('[data-filters-panel]');
  if (!navbar || !toggle || !panel) return;

  panel.innerHTML = '';
  for (const cat of CATEGORIES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'filter';
    b.textContent = cat.label;
    b.dataset.category = cat.id;
    // Stato iniziale già al valore finale: nessun ingresso animato (§D1)
    b.classList.toggle('active', cat.id === state.activeCategory);
    b.addEventListener('click', () => {
      state.activeCategory = cat.id;
      panel.querySelectorAll('.filter').forEach((el) =>
        el.classList.toggle('active', el.dataset.category === cat.id),
      );
      render(); // §D — il cambio è istantaneo al frame successivo
      onChange?.(cat.id);
    });
    panel.appendChild(b);
  }

  setOpen(false, { navbar, panel, toggle });
  toggle.addEventListener('click', () => setOpen(!open, { navbar, panel, toggle }));
}
