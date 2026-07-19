// ─── typing.js: "Cast the spell!" typing interstitial ───────────────────────
// Full-screen overlay, built once and reused. Imports fx.js/audio.js only —
// duel.js and journey.js both import this (acyclic: typing -> fx/audio).

import { FX } from './fx.js';
import { AudioEngine } from './audio.js';

let overlayEl = null;
let active = false;
let onDoneCb = null;
let rafId = null;
let startTime = 0;
let durationSeconds = 10;
let normalizedTarget = '';
let lastMatchedLen = 0;

function normalize(s) {
  return (s || '').toLowerCase().replace(/[^a-z]/g, '');
}

function ensureOverlay() {
  if (overlayEl) return overlayEl;
  overlayEl = document.createElement('div');
  overlayEl.id = 'typing-overlay';
  overlayEl.className = 'typing-overlay hidden';
  overlayEl.innerHTML = `
    <div class="typing-card">
      <div class="typing-label">Cast the spell!</div>
      <div class="typing-incantation" id="typing-incantation"></div>
      <input class="typing-input" id="typing-input" type="text" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" inputmode="text">
      <div class="typing-timer-track"><div class="typing-timer-fill" id="typing-timer-fill"></div></div>
      <div class="typing-timer-num hidden" id="typing-timer-num"></div>
      <button class="link-btn typing-skip" id="typing-skip" type="button">Not now</button>
    </div>`;
  document.body.appendChild(overlayEl);
  overlayEl.querySelector('#typing-skip').addEventListener('click', () => finish(false));
  overlayEl.querySelector('#typing-input').addEventListener('input', onInput);
  return overlayEl;
}

function onInput(e) {
  const input = e.target;
  const norm = normalize(input.value);

  if (normalizedTarget.startsWith(norm)) {
    input.classList.remove('typing-wrong');
    if (norm.length > lastMatchedLen) {
      lastMatchedLen = norm.length;
      if (!FX.reduced) {
        const rect = input.getBoundingClientRect();
        const cx = rect.left + Math.min(rect.width - 12, 16 + norm.length * 8);
        FX.burst(cx, rect.top + rect.height / 2, { count: 5, color: '#8fb8ff' });
      }
      AudioEngine.playTick();
    }
    if (norm.length > 0 && norm === normalizedTarget) { finish(true); return; }
  } else {
    input.classList.add('typing-wrong');
    if (!FX.reduced) {
      input.classList.remove('typing-shake');
      void input.offsetWidth;
      input.classList.add('typing-shake');
    }
  }
}

function tick() {
  if (!active) return;
  const elapsed = (performance.now() - startTime) / 1000;
  const remaining = Math.max(0, durationSeconds - elapsed);
  const pct = Math.max(0, Math.min(100, (remaining / durationSeconds) * 100));
  const fill = document.getElementById('typing-timer-fill');
  if (fill) fill.style.width = pct + '%';
  const num = document.getElementById('typing-timer-num');
  if (num) num.textContent = Math.ceil(remaining) + 's';
  if (remaining <= 0) { finish(false); return; }
  rafId = requestAnimationFrame(tick);
}

function finish(success) {
  if (!active) return;
  active = false;
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;

  if (success) {
    const input = document.getElementById('typing-input');
    if (input) {
      const rect = input.getBoundingClientRect();
      const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
      FX.burst(cx, cy, { count: 40, color: '#8fb8ff' });
      FX.ringPulse(cx, cy, '#8fb8ff');
    }
    AudioEngine.playChime();
  }

  overlayEl.classList.remove('quill-open');
  document.body.classList.remove('quill-mode');
  setTimeout(() => { if (overlayEl) overlayEl.classList.add('hidden'); }, FX.reduced ? 0 : 260);

  const cb = onDoneCb;
  onDoneCb = null;
  const elapsed = (performance.now() - startTime) / 1000;
  cb && cb({ success, elapsed });
}

export const Typing = {
  // { incantation, seconds = 10, onDone({success, elapsed}) }
  run({ incantation, seconds = 10, onDone } = {}) {
    ensureOverlay();
    normalizedTarget = normalize(incantation);
    lastMatchedLen = 0;
    durationSeconds = Math.max(1, seconds);
    onDoneCb = onDone || null;
    active = true;
    startTime = performance.now();

    document.getElementById('typing-incantation').textContent = incantation;
    const input = document.getElementById('typing-input');
    input.value = '';
    input.classList.remove('typing-wrong', 'typing-shake');
    document.getElementById('typing-timer-num').classList.toggle('hidden', !FX.reduced);
    document.getElementById('typing-timer-fill').style.width = '100%';

    document.body.classList.add('quill-mode');
    overlayEl.classList.remove('hidden');
    void overlayEl.offsetWidth;
    overlayEl.classList.add('quill-open');
    setTimeout(() => input.focus(), FX.reduced ? 0 : 260);

    rafId = requestAnimationFrame(tick);
  },

  isActive() { return active; },
};
