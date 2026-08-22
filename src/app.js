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
};

// Fotografie della cartella Puglia. L'elemento DOM cells[n] riceve sempre
// l'ordinale n, quindi la foto per elemento e FISSA: si assegna una volta in
// buildPool() e draw() non tocca mai il background. Il rimescolamento che si
// vede nasce dal fatto che a ogni fotogramma lo stesso elemento finisce in una
// posizione diversa della griglia.
const PHOTO_COUNT = 158;
const NAME = (i) => `photo${String((i % PHOTO_COUNT) + 1).padStart(3, '0')}.jpg`;

// Due livelli di dettaglio. Il lato corto della miniatura e 240 px: oltre quella
// dimensione a schermo l'immagine viene ingrandita e si sgrana, quindi si passa
// alle HD (lato corto 675 px, che copre anche lo zoom massimo su retina).
// Le HD pesano 28 MB in tutto e si scaricano SOLO se si supera la soglia:
// all'apertura la pagina carica solo i 5.3 MB di miniature.
const TIERS = [
  { dir: 'thumb', maxCellPx: 200 },
  { dir: 'hd', maxCellPx: Infinity },
];
const SRC = (i, dir) => `assets/photos/${dir}/${NAME(i)}`;
let tier = TIERS[0];

// Riferimenti al visore
const viewer = document.getElementById('viewer');
const viewerImg = document.getElementById('viewerImg');
let opened = null;   // cella attualmente aperta, o null

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
}

/* ── Visore ───────────────────────────────────────────────────────────────── */

/** Rettangolo dell'immagine contenuta nel viewport, a proporzioni intatte. */
function containRect(w, h) {
  const vw = window.innerWidth, vh = window.innerHeight;
  const k = Math.min(vw / w, vh / h);
  const rw = w * k, rh = h * k;
  return { x: (vw - rw) / 2, y: (vh - rh) / 2, w: rw, h: rh };
}

function openPhoto(cell) {
  if (opened) return;
  const idx = Number(cell.dataset.i);
  if (!Number.isFinite(idx)) return;
  opened = cell;

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

/* ── Input: solo vista ────────────────────────────────────────────────────── */

let down = null;
let pinchD = 0, pinchScale = 1;

function bindInput() {
  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015));
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
  });

  stage.addEventListener('pointermove', (e) => {
    if (!down) return;
    const dx = e.clientX - down.x, dy = e.clientY - down.y;
    if (!down.moved && Math.hypot(dx, dy) > SPEC.DRAG_THRESHOLD) down.moved = true;
    if (down.moved) { tx = down.tx + dx; ty = down.ty + dy; applyView(); }
  });

  stage.addEventListener('pointerup', (e) => {
    stage.classList.remove('dragging');
    const d = down;
    down = null;
    if (!d || d.moved || !d.cell) return;
    // Riconferma: sotto il puntatore ci deve essere ANCORA la stessa cella.
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (el === d.cell) openPhoto(d.cell);
  });

  stage.addEventListener('pointercancel', () => {
    stage.classList.remove('dragging'); down = null;
  });

  viewer.addEventListener('click', closePhoto);
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePhoto(); });

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
    get viewerSrc() { return (viewerImg.getAttribute('src') || '').split('/').pop(); },
    openPhoto, closePhoto,
    get zoomFactor() { return scale / fitScale; },
    get cellDevicePx() { return cellDevicePx(); },
  };
})();
