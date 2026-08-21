/**
 * spec.js — TUTTE le costanti numeriche del progetto.
 *
 * Regola del progetto: nessun valore di durata, easing, delay, distanza, damping
 * o soglia può comparire altrove nel codice. Ogni costante qui sotto ha il suo
 * riferimento a /research/ANIMATION_SPEC.md e alla riga del bundle originale
 * (N0 = nodes/0.8FshwVoq.js, C0 = css/0.ltaFBs3n.css).
 *
 * Se un numero non è qui, non è stato misurato e non deve essere usato.
 */

export const IS_MOBILE = typeof window !== 'undefined' && window.innerWidth <= 768; // §0 · N0:645

// ─── Geometria di base ────────────────────────────────────────────────────────
export const CELL_BASE = 60;      // §0 · N0:644 — px di riferimento a zoom 1
export const GRID_PAD_RATIO = 0.2; // §0 · N0:786,788 — padding = 20% di w/h per lato
export const DPR_CAP = 2;          // §0 · N0:664 — cap del devicePixelRatio
export const BLEED = 0.5;          // §B1 · N0:783 — anti-gap, in spazio griglia

// ─── Zoom ─────────────────────────────────────────────────────────────────────
export const ZOOM_MIN = IS_MOBILE ? 0.1 : 0.4;  // §0 · N0:646
export const ZOOM_MAX = 5;                       // §0 · N0:647
export const ZOOM_STEP = 1.5;                    // §0 · N0:648 — moltiplicativo
export const ZOOM_IDLE = IS_MOBILE ? 0.1 : 0.4;  // §0 · N0:649
export const ZOOM_DEFAULT = 1.5;                 // §0 · N0:650

// ─── Fisica del pan (§A) ──────────────────────────────────────────────────────
export const LERP = 0.15;              // §A · N0:789,791 — fattore per frame
export const LERP_RESET = 0.06;        // §A · N0:805 — solo durante resetView
export const SETTLE_ZOOM = 0.001;      // §A · N0:794
export const SETTLE_PX = 0.5;          // §A · N0:794
export const INERTIA_MULT = 10;        // §A · N0:916 — target = pos + v × 10
export const INERTIA_MIN_V = 0.5;      // §A · N0:916 — soglia di attivazione
export const VELOCITY_FRAME_MS = 16;   // §A · N0:909 — (Δpos/Δt) × 16
export const TOUCH_DRAG_THRESHOLD = 3; // §A · N0:941 — px

// ─── Squash da velocità (§A) ──────────────────────────────────────────────────
export const SQUASH_DECAY = 0.85;    // §A · N0:704 — decadimento del picco per frame
export const SQUASH_FACTOR = 0.01;   // §A · N0:703 — velocità → intensità
export const SQUASH_AMPLITUDE = 0.2; // §A · N0:702 — ampiezza massima (−20%)
export const SQUASH_LERP = 0.08;     // §A · N0:705
export const SQUASH_STOP = 5e-4;     // §A · N0:834 — soglia di arresto

// ─── LOD (§B2) ────────────────────────────────────────────────────────────────
export const LOD_TIERS = [ // §B2 · N0:666
  { maxZoom: 1,        width: 128 },
  { maxZoom: 2,        width: 256 },
  { maxZoom: 3.5,      width: 512 },
  { maxZoom: Infinity, width: 1024 },
];

// ─── Reveal iniziale (§B3) ────────────────────────────────────────────────────
export const REVEAL_MS = 1500;          // §B3 · N0:651
export const REVEAL_THRESHOLD = 0.7;    // §B3 · N0:778 — pop-in a distanza × 0.7
export const CANVAS_FADE_MS = 800;      // §B3 · N0:866 — desktop, misurato 795 ms
export const CANVAS_FADE_MOBILE_MS = 600; // §B3 · N0:865
export const MOBILE_POST_FADE_MS = 1100;  // §B3 · N0:865

// ─── Hover (§B4) ──────────────────────────────────────────────────────────────
export const HOVER_MS = 250;      // §B4 · N0:678 — identica in entrata e in uscita
export const HOVER_ALPHA = 0.6;   // §B4 · N0:961
export const FILTERED_ALPHA = 0.05; // §B4/§D · N0:780

// ─── Idle (§G4) ───────────────────────────────────────────────────────────────
export const IDLE_MS = 7000;        // §G4 · N0:671
export const IDLE_TWEEN_MS = 1200;  // §G4 · N0:672 — anche per zoomToMin (§C)
export const IDLE_CYCLE_MS = 100;   // §G4 · N0:851

// ─── Layer / view (§E) ────────────────────────────────────────────────────────
export const VIEW_FADE_MS = 400;  // §E1 · C0:814-816 — verificato per fitting: 396 ms
export const UI_FADE_MS = 600;    // §E · C0:808-810,824-826

// ─── Natural grid (§E2) ───────────────────────────────────────────────────────
export const NG_RECALC_FALLBACK_MS = 2000; // §E2 · N0:611

// ─── Tooltip di intro (§G3) ───────────────────────────────────────────────────
export const TOOLTIP_MS = 4000; // §G3 · C0:652 — keyframe 0/15/70/100 → 0/.9/.9/0

// ─── Maschera / galoppo (research/PARITY-MASK.md) ─────────────────────────────
export const MASK_INTRO_FRAME_MS = 50;    // §mask · N0:872 — setInterval(N=50) nell'intro
export const MASK_IDLE_FRAME_MS = 100;    // §mask · N0:851 — setInterval(100) in idle
// Il DEFAULT nel bundle è 3 (N0:643) ma la produzione passa 1. Misurato:
// il galoppo dura 2300 ms ≈ 46 passi (introCycles=1 ⇒ 50 passi/2500 ms;
// introCycles=3 ⇒ 166 passi/8300 ms). Conferma incrociata: con 50 passi il
// frame di riposo è (50−1) %% 58 = 49, che è quello osservato al 100%.
export const MASK_INTRO_CYCLES = 1;
export const MASK_INTRO_TAIL = 0.85;      // §mask · N0:870 — ceil(nFrames × 0.85)
export const MASK_INTRO_PAUSE_MS = 400;   // §mask · N0:872 — pausa prima dello zoom-in
export const MASK_ZOOMIN_MS = 1800;       // §mask · N0:878 — zoom-in finale, easeInOutCubic

/**
 * Easing — le uniche due funzioni del motore originale (§0).
 * Forma chiusa, non approssimazioni di bezier.
 */
export const easeInOutCubic = (t) =>            // §0 · N0:769 ≡ cubic-bezier(.65,0,.35,1)
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

export const easeInOutQuad = (t) =>             // §0 · N0:960,966 ≡ cubic-bezier(.45,0,.55,1)
  t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

/** Tier LOD per uno zoom dato. §B2 · N0:666 */
export const tierFor = (zoom) => LOD_TIERS.find((t) => zoom <= t.maxZoom) ?? LOD_TIERS.at(-1);
