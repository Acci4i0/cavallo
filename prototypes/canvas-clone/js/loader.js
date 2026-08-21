/**
 * loader.js — §G2 e §G4 dello spec.
 *
 * Il loader NON è una progress bar né una percentuale: è una macchina a stati
 * gated sul caricamento reale delle immagini.
 *   loading → fadeIn (desktop) | playFrames (mobile) → done
 *
 * Include anche la modalità idle (§G4), che sull'originale parte dopo 7 s di
 * inattività e fa una auto-demo.
 */

import {
  IS_MOBILE, ZOOM_DEFAULT, ZOOM_IDLE, REVEAL_MS,
  CANVAS_FADE_MS, CANVAS_FADE_MOBILE_MS, MOBILE_POST_FADE_MS,
  IDLE_MS, IDLE_TWEEN_MS, IDLE_CYCLE_MS, easeInOutCubic,
  MASK_INTRO_FRAME_MS, MASK_INTRO_CYCLES, MASK_INTRO_TAIL,
  MASK_INTRO_PAUSE_MS, MASK_ZOOMIN_MS,
} from './spec.js';
import { state, render, loadTier, centeredPan, startLerp, stopLerp, setFrame } from './grid.js';

let idleTimer = null;
let idleRaf = null;
let idleCycle = null;
let isIdle = false;
let preIdle = null;
let enabled = true;

/* ── Sequenza di loading (§G2 · N0:865-868) ───────────────────────────────── */

export async function runLoadingSequence() {
  const canvas = state.canvas;

  // L'intro parte a zoom minimo e ci resta per tutto il galoppo; è zoomInFinal()
  // a portarlo a 1.5 alla fine (§mask · N0:865,874-880).
  state.zoom = state.zoomTarget = ZOOM_IDLE;
  const p = centeredPan(ZOOM_IDLE);
  state.panX = state.panTargetX = p.px;
  state.panY = state.panTargetY = p.py;

  await loadTier(state.zoom);

  // opacity 0 con transition:none, poi doppio rAF prima di installare la
  // transizione — senza il doppio rAF il fade non parte (§B3 · N0:866)
  canvas.style.opacity = '0';
  canvas.style.transition = 'none';

  if (IS_MOBILE) {
    // Percorso mobile: nessun wipe radiale (§B3 · N0:865)
    state.phase = 'playFrames';
    render();
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        canvas.style.transition = `opacity ${CANVAS_FADE_MOBILE_MS / 1000}s ease`;
        canvas.style.opacity = '1';
        setTimeout(playFrames, MOBILE_POST_FADE_MS);
      });
    });
    return;
  }

  state.phase = 'fadeIn';
  state.revealProgress = 0;
  render();

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      canvas.style.transition = `opacity ${CANVAS_FADE_MS / 1000}s ease`;
      canvas.style.opacity = '1';

      const t0 = performance.now();
      const step = (now) => {
        // Progresso LINEARE: nessuna easing sul wipe (§B3 · N0:868)
        state.revealProgress = Math.min(1, (now - t0) / REVEAL_MS);
        render();
        if (state.revealProgress < 1) requestAnimationFrame(step);
        else playFrames();
      };
      requestAnimationFrame(step);
    });
  });
}

/**
 * Galoppo di intro (§mask · N0:870-872).
 *
 * Numero di passi: (introCycles − 1) × nFrames + ceil(nFrames × 0.85).
 * Con 58 frame e introCycles = 3 → 2×58 + 50 = 166 passi a 50 ms = 8.3 s.
 * Il frame su cui ci si ferma è quindi (166 − 1) % 58 = 49, che è ciò che ho
 * misurato sull'originale (PARITY-MASK §3: coincidenza 100%).
 */
let introTimer = null;

function playFrames() {
  state.phase = 'playFrames';
  const n = state.frames.length;
  const tail = Math.ceil(n * MASK_INTRO_TAIL);
  if (tail <= 1) { setTimeout(zoomInFinal, MASK_INTRO_PAUSE_MS); return; }
  const steps = (Math.max(1, MASK_INTRO_CYCLES) - 1) * n + tail;

  setFrame(0);
  render();
  let k = 0;
  introTimer = setInterval(() => {
    k++;
    if (k >= steps) {
      clearInterval(introTimer);
      introTimer = null;
      setTimeout(zoomInFinal, MASK_INTRO_PAUSE_MS); // §mask · I=400
    } else {
      setFrame(k % n); // hard-cut: nessuna interpolazione tra frame
      render();
    }
  }, MASK_INTRO_FRAME_MS);
}

/** Zoom-in finale dell'intro: 1800 ms easeInOutCubic (§mask · N0:878). */
function zoomInFinal() {
  const z0 = state.zoom;
  const t0 = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - t0) / MASK_ZOOMIN_MS);
    const e = easeInOutCubic(t);
    state.zoom = z0 + (ZOOM_DEFAULT - z0) * e;
    const p = centeredPan(state.zoom);
    state.panX = state.panTargetX = p.px;
    state.panY = state.panTargetY = p.py;
    render();
    if (t < 1) requestAnimationFrame(step);
    else {
      state.zoom = state.zoomTarget = ZOOM_DEFAULT;
      finish();
    }
  };
  requestAnimationFrame(step);
}

function finish() {
  showTooltip(false); // nasconde finché non scatta l'idle (§G3)
  state.phase = 'done';
  render();
  document.documentElement.dataset.phase = 'done';
  scheduleIdle();
}

/* ── Idle (§G4 · N0:838-861) ──────────────────────────────────────────────── */

function tweenTo(zoom, pan, done) {
  const z0 = state.zoom, x0 = state.panX, y0 = state.panY;
  const t0 = performance.now();
  stopLerp();
  if (idleRaf) cancelAnimationFrame(idleRaf);
  const step = (now) => {
    const t = Math.min(1, (now - t0) / IDLE_TWEEN_MS);
    const e = easeInOutCubic(t); // §G4 · N0:849-850
    state.zoom = z0 + (zoom - z0) * e;
    state.panX = x0 + (pan.px - x0) * e;
    state.panY = y0 + (pan.py - y0) * e;
    state.panTargetX = state.panX;
    state.panTargetY = state.panY;
    render();
    if (t < 1) idleRaf = requestAnimationFrame(step);
    else {
      idleRaf = null;
      state.zoom = state.zoomTarget = zoom;
      done?.();
    }
  };
  idleRaf = requestAnimationFrame(step);
}

/**
 * Il tooltip è legato all'IDLE, non al caricamento (§G3).
 * Misurato in Fase 3: sull'originale compare a t≈9563 ms, cioè fine del
 * loading (~2.5 s) + i 7000 ms di timeout di inattività — non al load.
 * Riavviare l'animazione richiede un reflow tra la rimozione e la riassegnazione.
 */
let tipEl = null;
let tipHost = null;

function showTooltip(show) {
  if (!tipEl) {
    tipEl = document.querySelector('.intro-tooltip');
    if (!tipEl) return;
    tipHost = tipEl.parentElement;
    tipEl.removeAttribute('hidden');
    tipEl.remove(); // l'originale lo tiene STACCATO dal DOM, non solo nascosto
    return;
  }
  if (show) {
    if (!tipEl.isConnected) {
      tipEl.style.animation = 'none';
      tipHost.appendChild(tipEl);
      void tipEl.offsetWidth; // reflow: senza, l'animazione non riparte
      tipEl.style.animation = '';
    }
  } else if (tipEl.isConnected) {
    tipEl.remove();
  }
}

function enterIdle() {
  if (isIdle || state.phase !== 'done') return;
  isIdle = true;
  showTooltip(true);
  preIdle = { zoom: state.zoom, px: state.panX, py: state.panY };
  tweenTo(ZOOM_IDLE, centeredPan(ZOOM_IDLE), () => {
    // Ciclo delle varianti ogni 100 ms (§G4 · N0:851)
    let k = state.frameIndex;
    idleCycle = setInterval(() => {
      setFrame(++k); // §G4 · N0:851 — avanza di un frame ogni 100 ms
      render();
    }, IDLE_CYCLE_MS);
  });
}

export function exitIdle() {
  if (!isIdle) return;
  isIdle = false;
  showTooltip(false);
  if (idleCycle) { clearInterval(idleCycle); idleCycle = null; }
  if (idleRaf) { cancelAnimationFrame(idleRaf); idleRaf = null; }

  // Se lo zoom pre-idle era < 1.5 torna a 1.5 centrato, altrimenti alla
  // posizione salvata (§G4 · N0:856-857)
  const back = preIdle && preIdle.zoom < ZOOM_DEFAULT
    ? { zoom: ZOOM_DEFAULT, pan: centeredPan(ZOOM_DEFAULT) }
    : { zoom: preIdle.zoom, pan: { px: preIdle.px, py: preIdle.py } };

  tweenTo(back.zoom, back.pan, () => {
    state.panTargetX = state.panX;
    state.panTargetY = state.panY;
    startLerp();
  });
}

export function scheduleIdle() {
  if (!enabled) return;
  clearTimeout(idleTimer);
  idleTimer = setTimeout(enterIdle, IDLE_MS); // §G4 · N0:671
}

export function noteActivity() {
  if (isIdle) exitIdle();
  scheduleIdle();
}

export function stopIntro() {
  if (introTimer) { clearInterval(introTimer); introTimer = null; }
}

export function setIdleEnabled(v) {
  enabled = v;
  if (!v) { clearTimeout(idleTimer); exitIdle(); }
  else scheduleIdle();
}

export const idleActive = () => isIdle;
