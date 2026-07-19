// ─── snitch.js: golden snitch entity + wander AI + catch/reward ─────────────
// Registers a single layer on FX's fx canvas. Zero per-frame allocation: all
// state lives in module-level scalars / typed arrays, reused every tick.
// Scheduling API (Snitch.onQuizStart/onQuizEnd) is driven by quiz.js. Reward
// is delivered via an injected callback (Snitch.setRewardCallback) rather
// than importing quiz.js directly, so there is no import cycle: quiz.js ->
// snitch.js is the only edge.

import { FX } from './fx.js';
import { AudioEngine } from './audio.js';

const MARGIN = 60;
const CRUISE = 250; // px/s
const ACCEL = 500; // px/s^2
const DASH_MULT = 2.5;
const TRAIL_LEN = 5;

const COARSE = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;

// position / motion
let x = 0, y = 0, vx = 0, vy = 0, heading = 0;
let targetX = 0, targetY = 0, nextTargetAt = 0;

// scheduling
let state = 'idle'; // idle | waiting | visiting | exiting
let quizActive = false;
let caughtThisRound = false;
let visitEndAt = 0;
let nextVisitAt = 0;

// dash
let dashActiveUntil = 0;
let nextDashAt = 0;
let lastFlutterAt = -999;

// ghost trail (fixed-size ring buffer, no per-frame allocation)
const trailX = new Float64Array(TRAIL_LEN);
const trailY = new Float64Array(TRAIL_LEN);
let trailHead = 0;
let trailFilled = 0;

let lastT = 0;
let rewardCallback = null;

function clampAbs(v, max) {
  if (v > max) return max;
  if (v < -max) return -max;
  return v;
}

function pushTrail(px, py) {
  trailHead = (trailHead + 1) % TRAIL_LEN;
  trailX[trailHead] = px;
  trailY[trailHead] = py;
  if (trailFilled < TRAIL_LEN) trailFilled++;
}

// A padded box around the question card that wander targets steer clear of,
// so the snitch stops darting across the words the player is trying to read.
function overlapsQuestionCard(px, py) {
  const card = document.getElementById('question-card');
  if (!card) return false;
  const r = card.getBoundingClientRect();
  const pad = 30;
  return px > r.left - pad && px < r.right + pad && py > r.top - pad && py < r.bottom + pad;
}

function pickWanderTarget(t) {
  const w = window.innerWidth, h = window.innerHeight;
  // Try a few times to land a target off the question card; give up gracefully.
  for (let i = 0; i < 6; i++) {
    const tx = MARGIN + Math.random() * Math.max(1, w - 2 * MARGIN);
    const ty = MARGIN + Math.random() * Math.max(1, h - 2 * MARGIN);
    if (!overlapsQuestionCard(tx, ty)) { targetX = tx; targetY = ty; break; }
    targetX = tx; targetY = ty; // fallback keeps the last try if all overlap
  }
  nextTargetAt = t + 0.4 + Math.random() * 0.5;
}

function spawnVisit(t) {
  const w = window.innerWidth, h = window.innerHeight;
  const edge = Math.floor(Math.random() * 4);
  if (edge === 0) { x = -40; y = Math.random() * h; }
  else if (edge === 1) { x = w + 40; y = Math.random() * h; }
  else if (edge === 2) { x = Math.random() * w; y = -40; }
  else { x = Math.random() * w; y = h + 40; }
  vx = 0; vy = 0; heading = 0;
  trailFilled = 0; trailHead = 0;
  state = 'visiting';
  // Shorter visits (5–7s) so the snitch is a quick treat, not a distraction.
  visitEndAt = t + 5 + Math.random() * 2;
  dashActiveUntil = 0;
  nextDashAt = t + 1.5 + Math.random() * 1.5;
  pickWanderTarget(t);
}

function beginExit() {
  state = 'exiting';
  const w = window.innerWidth, h = window.innerHeight;
  const dirX = Math.cos(heading), dirY = Math.sin(heading);
  targetX = x + dirX * (w + h);
  targetY = y + dirY * (w + h);
}

function despawn(t) {
  state = 'waiting';
  nextVisitAt = t + 30 + Math.random() * 30;
  trailFilled = 0; trailHead = 0;
}

function stepAI(dt, t) {
  if (state === 'visiting' && t >= visitEndAt) beginExit();
  if (state === 'visiting' && t >= nextTargetAt) pickWanderTarget(t);

  if (state === 'visiting' && t >= nextDashAt && t >= dashActiveUntil) {
    dashActiveUntil = t + 0.3;
    nextDashAt = t + 1.6 + Math.random() * 1.0;
    // Throttle the flutter SFX harder (2.5s) so a visiting snitch doesn't
    // chirp over and over while the player is mid-question.
    if (t - lastFlutterAt > 2.5) {
      AudioEngine.playFlutter();
      lastFlutterAt = t;
    }
  }

  const speedMult = t < dashActiveUntil ? DASH_MULT : 1;
  const cruise = CRUISE * speedMult;
  const accel = ACCEL * speedMult;

  const dx = targetX - x;
  const dy = targetY - y;
  const dist = Math.hypot(dx, dy) || 1;

  // heading wobble: perpendicular offset from two summed sines
  const wob = Math.sin(t * 2.1) * 22 + Math.sin(t * 5.3) * 11;
  const px = -dy / dist, py = dx / dist;
  let steerX = dx / dist + (px * wob) / cruise;
  let steerY = dy / dist + (py * wob) / cruise;
  const steerLen = Math.hypot(steerX, steerY) || 1;
  steerX /= steerLen; steerY /= steerLen;

  const desiredVx = steerX * cruise;
  const desiredVy = steerY * cruise;

  vx += clampAbs(desiredVx - vx, accel * dt);
  vy += clampAbs(desiredVy - vy, accel * dt);

  x += vx * dt;
  y += vy * dt;

  if (vx !== 0 || vy !== 0) heading = Math.atan2(vy, vx);

  pushTrail(x, y);

  if (state === 'exiting') {
    const w = window.innerWidth, h = window.innerHeight;
    if (x < -80 || x > w + 80 || y < -80 || y > h + 80) despawn(t);
  }
}

function update(dt, t) {
  lastT = t;
  if (!quizActive || FX.reduced) return;
  if (state === 'idle') return;
  if (state === 'waiting') {
    if (!caughtThisRound && t >= nextVisitAt) spawnVisit(t);
    return;
  }
  stepAI(dt, t);
}

function drawWing(ctx, side, flap) {
  const spread = 0.5 + 0.5 * Math.abs(flap);
  ctx.save();
  ctx.scale(side, 1);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(6, -10 - spread * 8, 20, -6 - spread * 10, 24, 2);
  ctx.bezierCurveTo(14, 4, 6, 4, 0, 0);
  ctx.closePath();
  ctx.fillStyle = 'rgba(255,250,230,0.55)';
  ctx.fill();
  ctx.restore();
}

function draw(ctx) {
  if (state !== 'visiting' && state !== 'exiting') return;

  // ghost trail
  for (let i = 0; i < trailFilled; i++) {
    const idx = (trailHead - i + TRAIL_LEN) % TRAIL_LEN;
    const alpha = 0.22 * (1 - i / TRAIL_LEN);
    if (alpha <= 0) continue;
    ctx.beginPath();
    ctx.fillStyle = `rgba(240,208,128,${alpha.toFixed(3)})`;
    ctx.arc(trailX[idx], trailY[idx], Math.max(1, 6 - i * 0.9), 0, Math.PI * 2);
    ctx.fill();
  }

  const flap = Math.sin(lastT * 88);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(heading);

  drawWing(ctx, 1, flap);
  drawWing(ctx, -1, flap);

  const grad = ctx.createRadialGradient(-2, -2, 0, 0, 0, 9);
  grad.addColorStop(0, '#fff6d8');
  grad.addColorStop(0.4, '#f0d080');
  grad.addColorStop(1, '#c9a84c');
  ctx.beginPath();
  ctx.fillStyle = grad;
  ctx.arc(0, 0, 9, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.arc(-3, -3, 1.6, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

const layer = { update, draw };

function onPointerDown(e) {
  if (state !== 'visiting' && state !== 'exiting') return;
  const r = COARSE ? 40 : 28;
  const dx = e.clientX - x, dy = e.clientY - y;
  if (dx * dx + dy * dy <= r * r) {
    e.stopPropagation();
    e.preventDefault();
    catchSnitch();
  }
}

function catchSnitch() {
  caughtThisRound = true;
  const cx = x, cy = y;
  state = 'waiting';
  nextVisitAt = Infinity; // no more spawns this round
  FX.burst(cx, cy, { count: 40, color: '#f0d080' });
  FX.ringPulse(cx, cy, '#f0d080');
  AudioEngine.playSnitchCaught();
  if (rewardCallback) rewardCallback();
}

export const Snitch = {
  init() {
    FX.addLayer(layer, FX.fxCanvas);
    document.addEventListener('pointerdown', onPointerDown, true);
  },

  onQuizStart() {
    caughtThisRound = false;
    quizActive = true;
    if (FX.reduced) { state = 'idle'; return; }
    const now = performance.now() / 1000;
    nextVisitAt = now + 15 + Math.random() * 10;
    state = 'waiting';
  },

  onQuizEnd() {
    quizActive = false;
    state = 'idle';
    trailFilled = 0;
  },

  setRewardCallback(fn) {
    rewardCallback = fn;
  },

  // Hedwig checks this so the two flyers never share the screen.
  isActive() {
    return quizActive && (state === 'visiting' || state === 'exiting');
  },
};
