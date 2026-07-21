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

// ─── drawing: snowy owl ─────────────────────────────────────────────────────
// Body in profile, head turned to face the viewer — the classic owl pose, and
// the thing that makes her read as an owl rather than a white blob: a round
// tuftless head, a facial disc, two amber eyes and a hooked beak. Wings carry
// separated primary "fingers" and light barring instead of a smooth curve.

// One wing, drawn from the shoulder outward along +x, then rotated by `rot`.
function drawWing(ctx, s, rot, fill, barring) {
  const L = 30 * s;
  ctx.save();
  ctx.rotate(rot);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(L * 0.45, -L * 0.32, L, -L * 0.08); // leading edge
  // four primary feather tips along the outer trailing edge
  const tips = [[0.86, 0.10], [0.70, 0.19], [0.53, 0.24], [0.36, 0.25]];
  let px = L, py = -L * 0.08;
  for (const [fx, fy] of tips) {
    const tx = L * fx, ty = L * fy;
    ctx.quadraticCurveTo((px + tx) / 2 + L * 0.04, (py + ty) / 2 + L * 0.09, tx, ty);
    px = tx; py = ty;
  }
  ctx.quadraticCurveTo(L * 0.18, L * 0.22, 0, L * 0.07); // inner trailing edge
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  // sparse dark barring, the snowy owl's speckling
  ctx.strokeStyle = barring;
  ctx.lineWidth = 0.9 * s;
  ctx.lineCap = 'round';
  for (let i = 1; i <= 3; i++) {
    const fx = 0.34 + i * 0.17;
    ctx.beginPath();
    ctx.moveTo(L * fx, -L * 0.10);
    ctx.lineTo(L * (fx - 0.03), L * 0.10);
    ctx.stroke();
  }
  ctx.restore();
}

function draw(ctx) {
  if (state !== 'gliding') return;
  const s = 1.8;
  const wingAngle = Math.sin(flap) * 0.6;

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(dir, 1);

  // Far wing first, dimmer so it reads as behind her. Both wings sweep back
  // (rot near PI points along -x); the far one rides high, the near one low,
  // which is what makes a side-on bird look like it's mid-beat.
  drawWing(ctx, s, Math.PI + 0.45 + wingAngle * 0.5, 'rgba(226,229,243,0.74)', 'rgba(128,132,158,0.26)');

  // tail: short fan sweeping back
  ctx.fillStyle = 'rgba(238,238,248,0.90)';
  ctx.beginPath();
  ctx.moveTo(-6 * s, -1 * s);
  ctx.quadraticCurveTo(-15 * s, -3 * s, -18 * s, 1 * s);
  ctx.quadraticCurveTo(-15 * s, 4 * s, -6 * s, 3 * s);
  ctx.closePath();
  ctx.fill();

  // body: tapered toward the tail
  ctx.fillStyle = 'rgba(250,249,255,0.95)';
  ctx.beginPath();
  ctx.ellipse(-1 * s, 0.5 * s, 10.5 * s, 7 * s, -0.06, 0, Math.PI * 2);
  ctx.fill();
  // belly speckling
  ctx.fillStyle = 'rgba(150,152,175,0.22)';
  [[-5, 2.4], [-2, 3.6], [1.5, 2.8], [-3.5, -1.2]].forEach(([bx, by]) => {
    ctx.beginPath();
    ctx.ellipse(bx * s, by * s, 1.15 * s, 0.6 * s, 0, 0, Math.PI * 2);
    ctx.fill();
  });

  // near wing, brighter and in front
  drawWing(ctx, s, Math.PI - 0.32 - wingAngle * 0.5, 'rgba(252,252,255,0.95)', 'rgba(132,136,164,0.34)');

  // ── head, turned to face the viewer ──
  const hx = 8.5 * s, hy = -4.2 * s, hr = 5.6 * s;
  ctx.fillStyle = 'rgba(253,253,255,0.98)';
  ctx.beginPath();
  ctx.arc(hx, hy, hr, 0, Math.PI * 2);
  ctx.fill();
  // facial disc: two soft lobes around the eyes
  ctx.fillStyle = 'rgba(236,238,248,0.95)';
  for (const sgn of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(hx + sgn * hr * 0.36, hy + hr * 0.06, hr * 0.46, hr * 0.60, sgn * 0.18, 0, Math.PI * 2);
    ctx.fill();
  }
  // eyes: amber iris, dark pupil, catchlight
  for (const sgn of [-1, 1]) {
    const ex = hx + sgn * hr * 0.38, ey = hy - hr * 0.04;
    ctx.fillStyle = 'rgba(238,176,42,0.98)';
    ctx.beginPath();
    ctx.arc(ex, ey, hr * 0.30, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(16,12,22,0.95)';
    ctx.beginPath();
    ctx.arc(ex, ey, hr * 0.15, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.arc(ex - hr * 0.07, ey - hr * 0.09, hr * 0.055, 0, Math.PI * 2);
    ctx.fill();
  }
  // small hooked beak between and just below the eyes
  ctx.fillStyle = 'rgba(46,40,54,0.92)';
  ctx.beginPath();
  ctx.moveTo(hx - hr * 0.10, hy + hr * 0.20);
  ctx.quadraticCurveTo(hx, hy + hr * 0.62, hx + hr * 0.10, hy + hr * 0.20);
  ctx.closePath();
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
