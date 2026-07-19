// ─── cursor.js: wand cursor spark trail + touch tap bursts ──────────────────
// The actual cursor image (SVG data-URI) lives in css/effects.css under a
// `(pointer:fine)` media query. This module only handles the FX trail spawned
// as the pointer moves, plus tap-burst feedback on coarse (touch) pointers.

import { FX } from './fx.js';

const FINE_POINTER = window.matchMedia && window.matchMedia('(pointer: fine)').matches;
const TRAIL_STEP = 8; // px of travel between trail emissions

export function initCursor() {
  if (FINE_POINTER) {
    let lastX = null, lastY = null, lastT = null;
    let accum = 0;

    window.addEventListener('pointermove', (e) => {
      if (FX.reduced) return;
      const x = e.clientX, y = e.clientY;
      const now = performance.now();

      if (lastX === null) {
        lastX = x; lastY = y; lastT = now;
        return;
      }

      const dx = x - lastX;
      const dy = y - lastY;
      const dt = Math.max(1, now - lastT) / 1000;
      const dist = Math.hypot(dx, dy);
      const vx = dx / dt;
      const vy = dy / dt;

      accum += dist;
      // Ink-blue tint while a typing overlay (typing.js) is open — the quill
      // cursor gets its own trail color instead of the house-accent sparks.
      const quill = document.body.classList.contains('quill-mode');
      while (accum >= TRAIL_STEP) {
        FX.trail(x, y, vx, vy, quill ? '#6a8fd8' : undefined);
        accum -= TRAIL_STEP;
      }

      lastX = x; lastY = y; lastT = now;
    });
  }

  // Coarse (touch/pen) pointers: tap feedback instead of a hover trail.
  document.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return;
    FX.tapBurst(e.clientX, e.clientY);
  });
}

// ─── Pointer tilt: .question-card / .diff-btn track the pointer via CSS vars ─
// Fine pointers only, disabled under reduced motion. Elements are static
// (question-card persists across questions, diff buttons are static markup)
// so listeners are attached once here rather than re-bound per render.
export function initTilt() {
  if (!FINE_POINTER || FX.reduced) return;
  const els = document.querySelectorAll('.question-card, .diff-btn');
  els.forEach((el) => {
    el.addEventListener('pointermove', (e) => {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const px = (e.clientX - rect.left) / rect.width;
      const py = (e.clientY - rect.top) / rect.height;
      const tiltX = (py - 0.5) * -8; // max ~4deg
      const tiltY = (px - 0.5) * 8;
      el.style.setProperty('--tilt-x', `${tiltX.toFixed(2)}deg`);
      el.style.setProperty('--tilt-y', `${tiltY.toFixed(2)}deg`);
    });
    el.addEventListener('pointerleave', () => {
      el.style.setProperty('--tilt-x', '0deg');
      el.style.setProperty('--tilt-y', '0deg');
    });
  });
}
