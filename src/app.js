/**
 * Cavallo al galoppo a schermo intero. Nessuna interfaccia.
 *
 * Il galoppo non si ferma MAI: gira anche durante zoom e pan.
 * L'unica interazione è la vista — zoom e trascinamento. Le celle non sono
 * cliccabili: toccarle non apre nulla.
 *
 * Costanti della griglia e dello zoom: research/ANIMATION_SPEC.md §2.
 */

const SPEC = {
  CELL_BASE: 60,        // §2 — px di riferimento a zoom 1
  ZOOM_MIN: 0.4,        // §2 — limite inferiore
  ZOOM_MAX: 5,          // §2 — limite superiore
  FRAME_MS: 100,        // §2 — un fotogramma del galoppo
  DRAG_THRESHOLD: 3,    // §2 — px oltre i quali è trascinamento
  ZOOM_EPS: 1.01,       // tolleranza per considerarsi "alla scala di partenza"
  OPEN_MS: 1200,        // apertura/chiusura del visore (3Dgallery, FOCUS)
  IDLE_MS: 7000,        // §G4 — inattivita prima del rientro automatico
  RETURN_MS: 1200,      // §G4 — durata del rientro, easeInOutCubic
};

// Fotografie della cartella Puglia. L'elemento DOM cells[n] riceve sempre
// l'ordinale n, quindi la foto per elemento e FISSA: si assegna una volta in
// buildPool() e draw() non tocca mai il background. Il rimescolamento che si
// vede nasce dal fatto che a ogni fotogramma lo stesso elemento finisce in una
// posizione diversa della griglia.
const PHOTO_COUNT = 158;
const NAME = (i) => `photo${String((i % PHOTO_COUNT) + 1).padStart(3, '0')}`;

// Tre livelli per la griglia, scelti sul lato della cella in pixel REALI.
// Ognuno si scarica solo se si supera la sua soglia: all'apertura la pagina
// carica i soli ritagli da 320 px.
//
// A zoom massimo una cella misura ~605 px reali e viene servita a 1536:
// 2.54x di sovracampionamento, contro l'1.71x del sito di riferimento.
const TIERS = [
  { dir: 'thumb', maxCellPx: 200 },
  { dir: 'hd', maxCellPx: 600 },
  { dir: 'xl', maxCellPx: Infinity },   // 1536 px nativi: nessuna riduzione
];

// I livelli quadrati sono WebP, che a parita di peso ritiene molto piu
// dettaglio del JPEG. `full` e il sorgente copiato senza ricodifica: resta JPEG.
const SRC = (i, dir) => `assets/photos/${dir}/${NAME(i)}.${dir === 'full' ? 'jpg' : 'webp'}`;
let tier = TIERS[0];

// Riferimenti al visore
const viewer = document.getElementById('viewer');
const viewerImg = document.getElementById('viewerImg');
let opened = null;    // cella attualmente aperta, o null
let openedPhoto = 0;  // indice della fotografia mostrata (0..PHOTO_COUNT-1)
let idleTimer = null;
let returnRaf = null;

const easeInOutCubic = (t) =>          // §0 — easing del sito di riferimento
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

/** Lato della cella in pixel REALI del dispositivo, non CSS. */
function cellDevicePx() {
  const { cellSize, spacing } = MASK.grid;
  return (cellSize - spacing) * scale * (window.devicePixelRatio || 1);
}

/** Se il livello cambia, riscrive lo sfondo di tutto il pool. */
function applyTier() {
  const px = cellDevicePx();
  const next = TIERS.find((t) => px <= t.maxCellPx) || TIERS[TIERS.length - 1];
  if (next === tier) return;
  tier = next;
  for (let i = 0; i < cells.length; i++) {
    cells[i].style.backgroundImage = `url("${SRC(i, tier.dir)}")`;
  }
}

const stage = document.getElementById('stage');
const grid = document.getElementById('grid');

let MASK = null;
let cells = [];
let frame = 0;
let gallop = null;                     // handle dell'intervallo del galoppo
let bbox = null;                       // [c0, r0, c1, r1] unione di tutti i frame
let scale = 1, tx = 0, ty = 0, fitScale = 1;

/* ── Vista ────────────────────────────────────────────────────────────────── */

const applyView = () => {
  grid.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
};

/** Adatta la sagoma al viewport: il cavallo riempie lo schermo. */
function fitToScreen() {
  const { cellSize } = MASK.grid;
  const w = (bbox[2] - bbox[0] + 1) * cellSize;
  const h = (bbox[3] - bbox[1] + 1) * cellSize;
  fitScale = Math.min(stage.clientWidth / w, stage.clientHeight / h);
  scale = fitScale;
  tx = (stage.clientWidth - w * scale) / 2 - bbox[0] * cellSize * scale;
  ty = (stage.clientHeight - h * scale) / 2 - bbox[1] * cellSize * scale;
  applyView();
}

/** Zoom ancorato a un punto dello schermo. Il range di §2 è relativo al fit. */
function zoomAt(px, py, factor) {
  const max = fitScale * (SPEC.ZOOM_MAX / SPEC.ZOOM_MIN);
  const next = Math.min(max, Math.max(fitScale, scale * factor));
  if (next === scale) return;
  const k = next / scale;
  tx = px - (px - tx) * k;
  ty = py - (py - ty) * k;
  scale = next;
  applyView();
  applyTier();
  updateMotion();
}

/* ── Griglia, generata dalla sola matrice ─────────────────────────────────── */

function computeBbox() {
  const { cols, rows } = MASK.grid;
  let c0 = cols, r0 = rows, c1 = -1, r1 = -1;
  for (const f of MASK.frames) {
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      if (!f[r * cols + c]) continue;
      if (c < c0) c0 = c; if (c > c1) c1 = c;
      if (r < r0) r0 = r; if (r > r1) r1 = r;
    }
  }
  return [c0, r0, c1, r1];
}

function buildPool() {
  const { cols, rows, cellSize, spacing } = MASK.grid;
  grid.style.width = `${cols * cellSize}px`;
  grid.style.height = `${rows * cellSize}px`;
  grid.style.setProperty('--cell', `${cellSize - spacing}px`);

  const max = Math.max(...MASK.frames.map((f) => f.reduce((a, b) => a + b, 0)));
  const frag = document.createDocumentFragment();
  for (let i = 0; i < max; i++) {
    const d = document.createElement('div');
    d.className = 'cell';
    d.style.backgroundImage = `url("${SRC(i, tier.dir)}")`;
    d.dataset.i = String(i);   // la foto della cella si legge da qui, mai dalla posizione
    d.hidden = true;
    frag.appendChild(d);
    cells.push(d);
  }
  grid.appendChild(frag);
}

/** Disegna un fotogramma: sposta le celle accese, nasconde le altre. */
function draw(f) {
  const { cols, rows, cellSize, spacing } = MASK.grid;
  const m = MASK.frames[f];
  const half = spacing / 2;
  let n = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!m[r * cols + c]) continue;
      const el = cells[n];
      el.style.transform = `translate(${c * cellSize + half}px, ${r * cellSize + half}px)`;
      if (el.hidden) el.hidden = false;
      n++;
    }
  }
  for (let i = n; i < cells.length; i++) if (!cells[i].hidden) cells[i].hidden = true;
  frame = f;
}

/* ── Galoppo: sempre in corso, non lo interrompe nulla ────────────────────── */

function startGallop() {
  if (gallop) return;
  gallop = setInterval(() => draw((frame + 1) % MASK.frames.length), SPEC.FRAME_MS);
}

function stopGallop() {
  if (gallop) { clearInterval(gallop); gallop = null; }
}

/**
 * Il galoppo gira solo alla scala di partenza. Appena si zooma si ferma: con
 * le celle immobili si puo navigare e guardare le fotografie una a una, che e
 * il motivo per cui si zooma. Tornando allo zoom iniziale riparte.
 */
function updateMotion() {
  if (scale > fitScale * SPEC.ZOOM_EPS) stopGallop();
  else startGallop();
  stage.classList.toggle('still', !gallop);
  nudge();
}

/* ── Visore ───────────────────────────────────────────────────────────────── */

/**
 * Rettangolo dell'immagine, a proporzioni intatte e STACCATO dai bordi.
 * Il margine orizzontale deve lasciar passare le frecce (44 px piu aria),
 * altrimenti finiscono sopra la fotografia e su scatti scuri spariscono.
 */
function containRect(w, h) {
  const vw = window.innerWidth, vh = window.innerHeight;
  const mx = Math.max(64, Math.min(vw * 0.14, 140));
  const my = Math.max(40, Math.min(vh * 0.09, 90));
  const k = Math.min((vw - mx * 2) / w, (vh - my * 2) / h);
  const rw = w * k, rh = h * k;
  return { x: (vw - rw) / 2, y: (vh - rh) / 2, w: rw, h: rh };
}

function openPhoto(cell) {
  if (opened) return;
  const idx = Number(cell.dataset.i);
  if (!Number.isFinite(idx)) return;
  opened = cell;
  openedPhoto = idx % PHOTO_COUNT;
  stage.classList.add('viewing');   // desatura la griglia dietro

  const from = cell.getBoundingClientRect();
  const img = new Image();
  img.onload = () => {
    if (opened !== cell) return;
    const to = containRect(img.naturalWidth, img.naturalHeight);
    viewerImg.src = img.src;
    viewerImg.style.left = `${to.x}px`;
    viewerImg.style.top = `${to.y}px`;
    viewerImg.style.width = `${to.w}px`;
    viewerImg.style.height = `${to.h}px`;

    // FLIP: si parte sovrapposti alla cella, si torna all'identita
    const sx = from.width / to.w, sy = from.height / to.h;
    viewerImg.style.transition = 'none';
    viewerImg.style.transform =
      `translate(${from.left - to.x}px, ${from.top - to.y}px) scale(${sx}, ${sy})`;
    viewer.hidden = false;
    void viewerImg.offsetWidth;              // forza il reflow prima di animare
    viewerImg.style.transition = '';
    viewer.classList.add('on');
    viewerImg.style.transform = 'translate(0, 0) scale(1, 1)';
  };
  img.src = SRC(idx, 'full');
}

function closePhoto() {
  if (!opened) return;
  const cell = opened;
  opened = null;
  stage.classList.remove('viewing');
  const to = viewerImg.getBoundingClientRect();
  const from = cell.getBoundingClientRect();
  const sx = from.width / to.width, sy = from.height / to.height;
  viewerImg.style.transform =
    `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${sx}, ${sy})`;
  viewer.classList.remove('on');
  setTimeout(() => {
    if (!opened) { viewer.hidden = true; viewerImg.removeAttribute('src'); }
  }, SPEC.OPEN_MS);
}

/**
 * Passa alla fotografia precedente/successiva.
 *
 * Lo sfondo segue: si cerca la cella che porta la fotografia di destinazione
 * piu vicina al centro dello schermo e ci si sposta sopra, cosi la sagoma dietro
 * accompagna il cambio invece di restare ferma.
 */
function navigate(delta) {
  if (!opened) return;
  const target = (openedPhoto + delta + PHOTO_COUNT) % PHOTO_COUNT;

  // cella piu vicina al centro fra quelle che mostrano la fotografia scelta
  const cx = window.innerWidth / 2, cy = window.innerHeight / 2;
  let best = null, bestD = Infinity;
  for (const el of grid.querySelectorAll('.cell:not([hidden])')) {
    if (Number(el.dataset.i) % PHOTO_COUNT !== target) continue;
    const r = el.getBoundingClientRect();
    const d = Math.hypot(r.left + r.width / 2 - cx, r.top + r.height / 2 - cy);
    if (d < bestD) { bestD = d; best = el; }
  }
  if (!best) return;

  // porta quella cella al centro: e questo il movimento dello sfondo
  const r = best.getBoundingClientRect();
  tx += cx - (r.left + r.width / 2);
  ty += cy - (r.top + r.height / 2);
  applyView();

  opened = best;
  openedPhoto = target;

  // scambio dell'immagine: dissolvenza breve, senza rifare il volo
  const img = new Image();
  img.onload = () => {
    if (openedPhoto !== target) return;
    const to = containRect(img.naturalWidth, img.naturalHeight);
    viewerImg.classList.add('swap');
    setTimeout(() => {
      viewerImg.src = img.src;
      viewerImg.style.left = `${to.x}px`;
      viewerImg.style.top = `${to.y}px`;
      viewerImg.style.width = `${to.w}px`;
      viewerImg.style.height = `${to.h}px`;
      viewerImg.style.transform = 'translate(0, 0) scale(1, 1)';
      viewerImg.classList.remove('swap');
    }, 180);
  };
  img.src = SRC(target, 'full');
}

/* ── Rientro automatico ───────────────────────────────────────────────────── */

/** Torna alla scala di partenza con un tween, poi il galoppo riprende. */
function returnToFit() {
  if (returnRaf) cancelAnimationFrame(returnRaf);
  closePhoto();
  const s0 = scale, x0 = tx, y0 = ty;
  const gw = (bbox[2] - bbox[0] + 1) * MASK.grid.cellSize;
  const gh = (bbox[3] - bbox[1] + 1) * MASK.grid.cellSize;
  const x1 = (stage.clientWidth - gw * fitScale) / 2 - bbox[0] * MASK.grid.cellSize * fitScale;
  const y1 = (stage.clientHeight - gh * fitScale) / 2 - bbox[1] * MASK.grid.cellSize * fitScale;
  const t0 = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - t0) / SPEC.RETURN_MS);
    const e = easeInOutCubic(t);
    scale = s0 + (fitScale - s0) * e;
    tx = x0 + (x1 - x0) * e;
    ty = y0 + (y1 - y0) * e;
    applyView();
    if (t < 1) returnRaf = requestAnimationFrame(step);
    else { returnRaf = null; applyTier(); updateMotion(); }
  };
  returnRaf = requestAnimationFrame(step);
}

/** Ogni interazione rimanda il rientro. Il timer vive solo sotto zoom. */
function nudge() {
  clearTimeout(idleTimer);
  if (scale > fitScale * SPEC.ZOOM_EPS) idleTimer = setTimeout(returnToFit, SPEC.IDLE_MS);
}

/* ── Input: solo vista ────────────────────────────────────────────────────── */

let down = null;
let pinchD = 0, pinchScale = 1;

function bindInput() {
  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015));
    nudge();
  }, { passive: false });

  stage.addEventListener('pointerdown', (e) => {
    down = { x: e.clientX, y: e.clientY, tx, ty, moved: false, cell: null };
    // Il bersaglio si cattura QUI, e solo a griglia ferma. Nella versione
    // precedente si leggeva al rilascio, con il galoppo in corso: fra tocco e
    // rilascio gli elementi si erano gia spostati e si apriva un'altra foto.
    if (!gallop) {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (el && el.classList.contains('cell')) down.cell = el;
    }
    stage.setPointerCapture(e.pointerId);
    stage.classList.add('dragging');
    nudge();
  });

  stage.addEventListener('pointermove', (e) => {
    if (!down) return;
    const dx = e.clientX - down.x, dy = e.clientY - down.y;
    if (!down.moved && Math.hypot(dx, dy) > SPEC.DRAG_THRESHOLD) down.moved = true;
    // Alla scala di partenza l'inquadratura e FISSA: niente spostamenti.
    // Ci si muove solo dopo aver zoomato.
    if (down.moved && scale > fitScale * SPEC.ZOOM_EPS) {
      tx = down.tx + dx; ty = down.ty + dy; applyView();
    }
  });

  stage.addEventListener('pointerup', (e) => {
    stage.classList.remove('dragging');
    const d = down;
    down = null;
    if (!d || d.moved || !d.cell) return;
    // Riconferma: sotto il puntatore ci deve essere ANCORA la stessa cella.
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (el === d.cell) openPhoto(d.cell);
    nudge();
  });

  stage.addEventListener('pointercancel', () => {
    stage.classList.remove('dragging'); down = null;
  });

  // Il click sullo sfondo del visore chiude; sulle frecce no.
  viewer.addEventListener('click', (e) => {
    nudge();
    if (e.target.closest('button')) return;
    closePhoto();
  });
  document.getElementById('prev').addEventListener('click', () => { navigate(-1); nudge(); });
  document.getElementById('next').addEventListener('click', () => { navigate(1); nudge(); });

  window.addEventListener('keydown', (e) => {
    nudge();
    if (e.key === 'Escape') closePhoto();
    else if (opened && e.key === 'ArrowLeft') navigate(-1);
    else if (opened && e.key === 'ArrowRight') navigate(1);
  });

  stage.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      pinchD = Math.hypot(e.touches[0].clientX - e.touches[1].clientX,
                          e.touches[0].clientY - e.touches[1].clientY);
      pinchScale = scale;
      down = null;
    }
  }, { passive: true });

  stage.addEventListener('touchmove', (e) => {
    if (e.touches.length !== 2 || !pinchD) return;
    e.preventDefault();
    const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX,
                         e.touches[0].clientY - e.touches[1].clientY);
    const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
    const my = (e.touches[0].clientY + e.touches[1].clientY) / 2;
    zoomAt(mx, my, (pinchScale * (d / pinchD)) / scale);
    nudge();
  }, { passive: false });

  stage.addEventListener('touchend', () => { pinchD = 0; });

  // Al resize si ricalcola il fit conservando il livello di zoom relativo
  window.addEventListener('resize', () => {
    const z = scale / fitScale;
    fitToScreen();
    scale = fitScale * z;
    applyView();
    applyTier();
    updateMotion();
  });
}

/* ── Boot ─────────────────────────────────────────────────────────────────── */

(async function boot() {
  MASK = await (await fetch('src/data/mask-frames.json')).json();
  bbox = computeBbox();
  buildPool();
  fitToScreen();
  applyTier();
  draw(0);
  bindInput();
  startGallop();

  window.__replica = {
    get frame() { return frame; },
    get scale() { return scale; },
    visibleCells: () => grid.querySelectorAll('.cell:not([hidden])').length,
    mask: () => MASK, bbox: () => bbox,
    get tier() { return tier.dir; },
    get galloping() { return !!gallop; },
    get opened() { return opened ? Number(opened.dataset.i) : null; },
    get openedPhoto() { return opened ? openedPhoto : null; },
    navigate, returnToFit,
    get viewerSrc() { return (viewerImg.getAttribute('src') || '').split('/').pop(); },
    openPhoto, closePhoto,
    get zoomFactor() { return scale / fitScale; },
    get cellDevicePx() { return cellDevicePx(); },
  };
})();
