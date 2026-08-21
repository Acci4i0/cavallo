/**
 * data.js — dataset PLACEHOLDER + costruzione dei frame della maschera.
 *
 * Tutto il contenuto è segnaposto dichiarato: nomi, categorie, immagini.
 * Le matrici della maschera NON sono hardcoded: arrivano da
 * src/data/mask-frames.json, generato da scripts/build-mask.js a partire dalle
 * silhouette in /assets/gallop/.
 *
 * La griglia NON è una matrice piena: ogni frame è una LISTA SPARSA di celle
 * accese, esattamente come l'originale (research/PARITY-MASK.md).
 */

export const IS_PLACEHOLDER = true;
export const SITE_TITLE = 'Studio Placeholder';

export const CATEGORIES = [
  { id: 'all', label: 'All' },
  { id: 'cat-a', label: 'Placeholder A' },
  { id: 'cat-b', label: 'Placeholder B' },
  { id: 'cat-c', label: 'Placeholder C' },
];

const PLACEHOLDER_COUNT = 24;
const CAT_IDS = ['cat-a', 'cat-b', 'cat-c'];

export function srcFor(placeholderIndex, tierWidth) {
  const id = `ph-${String(placeholderIndex % PLACEHOLDER_COUNT).padStart(2, '0')}`;
  return `assets/placeholders/${id}-${tierWidth}.png`;
}

/** I "thumbnail" disponibili: è il pool che le celle accese consumano. */
export const WORKS = Array.from({ length: 12 }, (_, w) => ({
  id: `work-${w}`,
  slug: `work-${w}`,
  title: `Placeholder Work ${String(w + 1).padStart(2, '0')}`,
  categoryId: CAT_IDS[w % CAT_IDS.length],
  slides: Array.from({ length: 3 }, (_, s) => ({
    slideIndex: s,
    placeholderIndex: (w * 5 + s * 3) % PLACEHOLDER_COUNT,
  })),
}));

export const THUMBS = WORKS.flatMap((work) =>
  work.slides.map((slide) => ({
    workId: work.id,
    workSlug: work.slug,
    title: work.title,
    categoryId: work.categoryId,
    slideIndex: slide.slideIndex,
    placeholderIndex: slide.placeholderIndex,
  })),
);

/* ── Maschera ─────────────────────────────────────────────────────────────── */

export async function loadMask(url = '../../src/data/mask-frames.json') {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`maschera non caricata: ${res.status} ${url}`);
  return res.json();
}

/**
 * Da matrice booleana a lista di celle, nell'ordine ROW-MAJOR.
 *
 * `thumbIndex` è l'ORDINALE della cella dentro il frame, modulo il numero di
 * thumbnail — non una proprietà della posizione nella griglia. Conseguenza
 * misurata (PARITY-MASK §3): le immagini si RIMESCOLANO a ogni frame. Sulla
 * sorgente originale, 0 posizioni su 384 accese in due frame consecutivi
 * mantengono la stessa immagine. È ciò che rende l'effetto percepito quello che
 * è: non celle che si accendono su un campo stabile, ma un campo che si rimescola.
 */
export function buildFrames(mask, thumbCount) {
  const { cols, rows, cellSize, spacing } = mask.grid;
  return mask.frames.map((matrix, frameIndex) => {
    const cells = [];
    let ordinal = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (!matrix[r * cols + c]) continue; // cella SPENTA: non esiste affatto
        cells.push({
          x: c * cellSize,
          y: r * cellSize,
          gridCol: c,
          gridRow: r,
          thumbIndex: ordinal % thumbCount,
        });
        ordinal++;
      }
    }
    return {
      frameIndex,
      gridData: {
        cells,
        cellSize,
        spacing,
        // costanti su tutti i frame: la griglia non deve saltare tra un frame e
        // l'altro (verificato sull'originale: width/height identiche sui 58 frame)
        width: cols * cellSize,
        height: rows * cellSize,
        cols,
        rows,
      },
    };
  });
}
