// ─── hedwig.js: white-owl flyer + letter reward (parallel to snitch.js) ─────
// Registers one layer on FX's fx canvas, scheduled by quiz.js exactly like
// Snitch (Hedwig.onQuizStart/onQuizEnd mirror Snitch.onQuizStart/onQuizEnd).
// Imports fx/audio/snitch ONLY — deliberately NOT arsenal.js/cards.js, even
// though the plan's import list allows it, because arsenal.js already imports
// quiz.js (arsenal -> quiz) and quiz.js needs to import hedwig.js to drive it
// (mirroring how it hardwires Snitch) — hedwig -> arsenal -> quiz -> hedwig
// would be a real cycle. Instead the actual reward grant (Arsenal.grantRandom
// / Cards.awardRoll) lives in main.js's injected setLetterCallback, which
// returns the reward's display line; hedwig.js only presents it. This keeps
// every edge one-way: quiz -> hedwig -> {fx, audio, snitch}.

import { FX } from './fx.js';
import { AudioEngine } from './audio.js';
import { Snitch } from './snitch.js';

const COARSE = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
const VISIT_CHANCE = 0.35;

// position / motion (module-level scalars only — zero per-frame allocation)
let x = 0, y = 0, vx = 0, baseY = 0, dir = 1, flap = 0, t0 = 0, lastT = 0;

// scheduling
let state = 'idle'; // idle | waiting | gliding
let quizActive = false;
let nextVisitAt = 0;

let letterCallback = null;

// ─── AI / motion ──────────────────────────────────────────────────────────────
function spawnGlide(t) {
  const w = window.innerWidth, h = window.innerHeight;
  dir = Math.random() < 0.5 ? 1 : -1;
  x = dir === 1 ? -90 : w + 90;
  baseY = 40 + Math.random() * Math.min(220, h * 0.28); // upper third
  y = baseY;
  vx = dir * (66 + Math.random() * 8); // ~70px/s
  t0 = t;
  flap = 0;
  state = 'gliding';
}

function stepGlide(dt, t) {
  x += vx * dt;
  y = baseY + Math.sin((t - t0) * 1.1) * 14; // gentle sine bob
  flap += dt * 5; // slow wing flap
  const w = window.innerWidth;
  if ((dir === 1 && x > w + 110) || (dir === -1 && x < -110)) {
    state = 'waiting';
    nextVisitAt = Infinity; // one visit per round, spent whether caught or not
  }
}

function update(dt, t) {
  lastT = t;
  if (!quizActive || FX.reduced) return;
  if (state === 'idle') return;
  if (state === 'waiting') {
    if (t >= nextVisitAt) {
      if (Snitch.isActive()) { state = 'idle'; return; } // skipped — chance spent, no reschedule
      spawnGlide(t);
    }
    return;
  }
  stepGlide(dt, t);
}

// ─── drawing: large white owl (sky.js's owl-flyby technique, ~1.8x, white) ──
function draw(ctx) {
  if (state !== 'gliding') return;
  const s = 1.8;
  const wingAngle = Math.sin(flap) * 0.6;

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(dir, 1);

  // wings: gray undersides
  ctx.fillStyle = 'rgba(190,192,208,0.55)';
  for (const sgn of [1, -1]) {
    ctx.beginPath();
    ctx.moveTo(0, -2 * s);
    ctx.quadraticCurveTo(sgn * 18 * s, (-14 - wingAngle * 14) * s, sgn * 30 * s, (-2 - wingAngle * 6) * s);
    ctx.quadraticCurveTo(sgn * 14 * s, 4 * s, 0, -2 * s);
    ctx.closePath();
    ctx.fill();
  }

  // body: white
  ctx.fillStyle = 'rgba(248,246,255,0.92)';
  ctx.beginPath();
  ctx.ellipse(0, 0, 10 * s, 7 * s, 0, 0, Math.PI * 2);
  ctx.fill();

  // small head accent
  ctx.beginPath();
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.arc(6 * s, -2 * s, 3.4 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.fillStyle = 'rgba(20,16,28,0.85)';
  ctx.arc(7.4 * s, -2.6 * s, 0.9 * s, 0, Math.PI * 2);
  ctx.fill();

  // letter, swinging beneath on a short pendulum
  const swing = Math.sin(lastT * 3) * 0.28;
  ctx.save();
  ctx.translate(0, 9 * s);
  ctx.rotate(swing);
  ctx.strokeStyle = 'rgba(230,220,200,0.55)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, 9 * s);
  ctx.stroke();
  ctx.fillStyle = 'rgba(245,230,200,0.95)';
  ctx.fillRect(-4 * s, 9 * s, 8 * s, 5.5 * s);
  ctx.strokeStyle = 'rgba(120,90,40,0.45)';
  ctx.lineWidth = 0.8;
  ctx.strokeRect(-4 * s, 9 * s, 8 * s, 5.5 * s);
  ctx.restore();

  ctx.restore();
}

const layer = { update, draw };

// ─── catch ────────────────────────────────────────────────────────────────────
function onPointerDown(e) {
  if (state !== 'gliding') return;
  const r = COARSE ? 48 : 34;
  const dx = e.clientX - x, dy = e.clientY - y;
  if (dx * dx + dy * dy <= r * r) {
    e.stopPropagation();
    e.preventDefault();
    catchHedwig();
  }
}

function catchHedwig() {
  const cx = x, cy = y;
  state = 'waiting';
  nextVisitAt = Infinity;
  FX.burst(cx, cy, { count: 30, color: '#f8f6ff' });
  FX.burst(cx, cy, { count: 18, color: '#f0d080' });
  FX.ringPulse(cx, cy, '#f0d080');
  AudioEngine.playChime();
  showLetterOverlay();
}

// ─── letter reveal overlay (#hedwig-letter, built once) ─────────────────────
function ensureOverlay() {
  if (document.getElementById('hedwig-letter')) return;
  const el = document.createElement('div');
  el.id = 'hedwig-letter';
  el.className = 'hidden';
  el.innerHTML = `
    <div class="hedwig-letter-card">
      <div class="hedwig-letter-seal"><span>H</span></div>
      <div class="hedwig-letter-title">A letter from Hedwig!</div>
      <div class="hedwig-letter-line" id="hedwig-letter-line"></div>
      <button class="play-again-btn hedwig-letter-dismiss" id="hedwig-letter-dismiss" type="button">Continue</button>
    </div>`;
  document.body.appendChild(el);
  const dismiss = () => {
    el.classList.remove('show');
    setTimeout(() => el.classList.add('hidden'), FX.reduced ? 0 : 280);
  };
  el.addEventListener('click', (e) => { if (e.target === el) dismiss(); });
  el.querySelector('#hedwig-letter-dismiss').addEventListener('click', dismiss);
}

function showLetterOverlay() {
  ensureOverlay();
  const line = typeof letterCallback === 'function'
    ? (letterCallback() || 'A letter arrives — but the ink has smudged.')
    : 'The letter is blank. How curious.';
  const lineEl = document.getElementById('hedwig-letter-line');
  if (lineEl) lineEl.textContent = line;
  const el = document.getElementById('hedwig-letter');
  el.classList.remove('hidden');
  void el.offsetWidth;
  el.classList.add('show');
}

// ─── public API ──────────────────────────────────────────────────────────────
export const Hedwig = {
  init() {
    FX.addLayer(layer, FX.fxCanvas);
    document.addEventListener('pointerdown', onPointerDown, true);
    ensureOverlay();
  },

  onQuizStart() {
    quizActive = true;
    state = 'idle';
    if (FX.reduced) return;
    if (Math.random() < VISIT_CHANCE) {
      const now = performance.now() / 1000;
      nextVisitAt = now + 20 + Math.random() * 30; // 20-50s in
      state = 'waiting';
    }
  },

  onQuizEnd() {
    quizActive = false;
    state = 'idle';
  },

  setLetterCallback(fn) {
    letterCallback = fn;
  },

  isActive() {
    return state === 'gliding';
  },
};
