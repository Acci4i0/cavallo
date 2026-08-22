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
};

const PHOTOS = Array.from({ length: 20 }, (_, i) => `photo${String(i + 1).padStart(2, '0')}.jpg`);
const THUMB = (n) => `assets/photos/thumb/${n}`;

const stage = document.getElementById('stage');
const grid = document.getElementById('grid');

let MASK = null;
let cells = [];
let frame = 0;
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
    d.hidden = true;
    frag.appendChild(d);
    cells.push(d);
  }
  grid.appendChild(frag);
}

/** Disegna un fotogramma. L'ordinale row-major determina la foto. */
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
      const photo = PHOTOS[n % PHOTOS.length];
      if (el.dataset.photo !== photo) {
        el.dataset.photo = photo;
        el.style.backgroundImage = `url("${THUMB(photo)}")`;
      }
      if (el.hidden) el.hidden = false;
      n++;
    }
  }
  for (let i = n; i < cells.length; i++) if (!cells[i].hidden) cells[i].hidden = true;
  frame = f;
}

/* ── Galoppo: sempre in corso, non lo interrompe nulla ────────────────────── */

function startGallop() {
  setInterval(() => draw((frame + 1) % MASK.frames.length), SPEC.FRAME_MS);
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
    down = { x: e.clientX, y: e.clientY, tx, ty, moved: false };
    stage.setPointerCapture(e.pointerId);
    stage.classList.add('dragging');
  });

  stage.addEventListener('pointermove', (e) => {
    if (!down) return;
    const dx = e.clientX - down.x, dy = e.clientY - down.y;
    if (!down.moved && Math.hypot(dx, dy) > SPEC.DRAG_THRESHOLD) down.moved = true;
    if (down.moved) { tx = down.tx + dx; ty = down.ty + dy; applyView(); }
  });

  const release = () => { stage.classList.remove('dragging'); down = null; };
  stage.addEventListener('pointerup', release);
  stage.addEventListener('pointercancel', release);

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
  });
}

/* ── Boot ─────────────────────────────────────────────────────────────────── */

(async function boot() {
  MASK = await (await fetch('src/data/mask-frames.json')).json();
  bbox = computeBbox();
  buildPool();
  fitToScreen();
  draw(0);
  bindInput();
  startGallop();

  window.__replica = {
    get frame() { return frame; },
    get scale() { return scale; },
    visibleCells: () => grid.querySelectorAll('.cell:not([hidden])').length,
    mask: () => MASK, bbox: () => bbox,
  };
})();
