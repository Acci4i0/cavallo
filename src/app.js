/**
 * Cavallo al galoppo a schermo intero. Nessuna interfaccia.
 *
 * Costanti della griglia e dello zoom: _reference/EXTRACTION.md §2.
 * Costanti di apertura foto: config.js della 3Dgallery dell'utente
 * (FOCUS 1.2 s, FRAME_FADE 1 s, ease [0.43, 0.19, 0.02, 1], BACKGROUND 0.2 s).
 */

const SPEC = {
  CELL_BASE: 60,        // §2 — N0:772
  ZOOM_MIN: 0.4,        // §2 — N0:646
  ZOOM_MAX: 5,          // §2 — N0:647
  IDLE_FRAME_MS: 100,   // §2 — N0:851, ciclo del galoppo
  IDLE_AFTER_MS: 7000,  // §2 — N0:671, inattività prima di riprendere
  DRAG_THRESHOLD: 3,    // §2 — N0:941, px oltre i quali è drag e non click
  FOCUS_MS: 1200,       // 3Dgallery FOCUS.duration
};

const PHOTOS = Array.from({ length: 20 }, (_, i) => `photo${String(i + 1).padStart(2, '0')}.jpg`);
const THUMB = (n) => `assets/photos/thumb/${n}`;
const FULL  = (n) => `assets/photos/${n}`;

const stage = document.getElementById('stage');
const grid = document.getElementById('grid');
const viewer = document.getElementById('viewer');
const viewerImg = document.getElementById('viewerImg');

let MASK = null;
let cells = [];
let frame = 0;
let gallop = null;
let idleTimer = null;
let focused = null;          // cella aperta, o null
const aspect = new Map();    // nome foto → w/h

// vista: scala e traslazione del container
let scale = 1, tx = 0, ty = 0, fitScale = 1;
let bbox = null;             // [c0, r0, c1, r1] unione di tutti i frame

/* ── Vista ────────────────────────────────────────────────────────────────── */

const applyView = () => {
  grid.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
};

/** Adatta il bounding box della sagoma al viewport: il cavallo riempie lo schermo. */
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

/** Zoom ancorato a un punto dello schermo. Range da §2, relativo al fit. */
function zoomAt(px, py, factor) {
  const next = Math.min(fitScale * SPEC.ZOOM_MAX / SPEC.ZOOM_MIN,
                        Math.max(fitScale, scale * factor));
  if (next === scale) return;
  const k = next / scale;
  tx = px - (px - tx) * k;
  ty = py - (py - ty) * k;
  scale = next;
  applyView();
}

/* ── Griglia dalla sola matrice ───────────────────────────────────────────── */

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

/** Disegna un frame. L'ordinale row-major determina la foto, come nell'originale. */
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

/* ── Galoppo ──────────────────────────────────────────────────────────────── */

function startGallop() {
  if (gallop || focused) return;
  gallop = setInterval(() => draw((frame + 1) % MASK.frames.length), SPEC.IDLE_FRAME_MS);
}

function stopGallop() {
  if (gallop) { clearInterval(gallop); gallop = null; }
}

/** Ferma il galoppo durante l'interazione: senza questo le foto non sono mirabili. */
function nudge() {
  if (focused) return;
  stopGallop();
  clearTimeout(idleTimer);
  idleTimer = setTimeout(startGallop, SPEC.IDLE_AFTER_MS);
}

/* ── Apertura foto — stessa procedura della 3Dgallery ─────────────────────── */

function openPhoto(el) {
  const photo = el.dataset.photo;
  if (!photo || focused) return;
  focused = el;
  stopGallop();
  clearTimeout(idleTimer);

  const r = el.getBoundingClientRect();
  viewerImg.src = FULL(photo);
  viewer.hidden = false;
  // parte esattamente dal rettangolo della cella
  viewerImg.style.transition = 'none';
  viewerImg.style.left = `${r.left}px`;
  viewerImg.style.top = `${r.top}px`;
  viewerImg.style.width = `${r.width}px`;
  viewerImg.style.height = `${r.height}px`;

  void viewerImg.offsetWidth;           // forza il reflow prima di transizionare
  viewerImg.style.transition = '';
  stage.classList.add('focus');          // le altre celle svaniscono (1 s)
  viewer.classList.add('on');

  const a = aspect.get(photo) || 1;
  const vw = window.innerWidth, vh = window.innerHeight;
  let w = vw, h = vw / a;
  if (h > vh) { h = vh; w = vh * a; }
  viewerImg.style.left = `${(vw - w) / 2}px`;
  viewerImg.style.top = `${(vh - h) / 2}px`;
  viewerImg.style.width = `${w}px`;
  viewerImg.style.height = `${h}px`;
}

function closePhoto() {
  if (!focused) return;
  const el = focused;
  focused = null;
  const r = el.getBoundingClientRect();
  viewerImg.style.left = `${r.left}px`;
  viewerImg.style.top = `${r.top}px`;
  viewerImg.style.width = `${r.width}px`;
  viewerImg.style.height = `${r.height}px`;
  viewer.classList.remove('on');
  stage.classList.remove('focus');
  setTimeout(() => { if (!focused) { viewer.hidden = true; viewerImg.removeAttribute('src'); } }, SPEC.FOCUS_MS);
  nudge();
}

/* ── Input ────────────────────────────────────────────────────────────────── */

let down = null, moved = false;
let pinchD = 0, pinchScale = 1;

function bindInput() {
  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    nudge();
    zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015));
  }, { passive: false });

  stage.addEventListener('pointerdown', (e) => {
    if (focused) return;
    nudge();
    down = { x: e.clientX, y: e.clientY, tx, ty };
    moved = false;
    stage.setPointerCapture(e.pointerId);
    stage.classList.add('dragging');
  });

  stage.addEventListener('pointermove', (e) => {
    if (!down) { if (!focused) nudge(); return; }
    const dx = e.clientX - down.x, dy = e.clientY - down.y;
    if (!moved && Math.hypot(dx, dy) > SPEC.DRAG_THRESHOLD) moved = true;
    if (moved) { tx = down.tx + dx; ty = down.ty + dy; applyView(); }
  });

  stage.addEventListener('pointerup', (e) => {
    stage.classList.remove('dragging');
    const wasDrag = moved;
    down = null; moved = false;
    if (focused) return;
    if (!wasDrag) {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (el && el.classList.contains('cell')) openPhoto(el);
    }
  });

  stage.addEventListener('pointercancel', () => {
    stage.classList.remove('dragging'); down = null; moved = false;
  });

  // pinch
  stage.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      nudge();
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

  // chiusura
  viewer.addEventListener('click', closePhoto);
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePhoto(); });

  window.addEventListener('resize', () => {
    const z = scale / fitScale;
    fitToScreen();
    scale = fitScale * z;
    applyView();
  });
}

/* ── Boot ─────────────────────────────────────────────────────────────────── */

(async function boot() {
  const res = await fetch('src/data/mask-frames.json');
  MASK = await res.json();

  // aspect ratio delle foto: serve al volo di apertura
  await Promise.all(PHOTOS.map((n) => new Promise((ok) => {
    const im = new Image();
    im.onload = () => { aspect.set(n, im.naturalWidth / im.naturalHeight); ok(); };
    im.onerror = ok;
    im.src = THUMB(n);
  })));

  bbox = computeBbox();
  buildPool();
  fitToScreen();
  draw(0);
  bindInput();
  startGallop();

  window.__replica = {
    get frame() { return frame; },
    get scale() { return scale; },
    get focused() { return !!focused; },
    visibleCells: () => grid.querySelectorAll('.cell:not([hidden])').length,
    mask: () => MASK, bbox: () => bbox,
    stop: () => { stopGallop(); clearTimeout(idleTimer); },
    draw, openPhoto, closePhoto,
  };
})();
