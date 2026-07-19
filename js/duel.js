// ─── duel.js: Year 7 Voldemort duel — HP-based boss battle mode ─────────────
// Runs through startRound(config) hooks exactly like a quick-play round or a
// journey lesson/exam — quiz.js never imports this module. Imports quiz.js
// primitives + dialogue/audio/fx/questions only (acyclic: duel -> quiz/
// dialogue/fx/audio/questions; journey -> duel is the only edge back, since
// journey owns navigation/flow and duel.start() hands control back to it via
// a callback once the fight is over).

import { startRound, renderResultShell, getPoints, getHouse, showToast } from './quiz.js';
import { allQuestions } from './questions.js';
import * as Dialogue from './dialogue.js';
import { AudioEngine } from './audio.js';
import { FX } from './fx.js';
import { ArsenalDuel } from './arsenal.js';
import { composeRoundHooks } from './abilities.js';
import { Typing } from './typing.js';

// ─── question pool ────────────────────────────────────────────────────────
// Mirrors Year 7's exam blend in journey.js (YEARS[6].blend = {medium:1,
// hard:4, expert:5} = 10 questions) so the duel draws from the same
// difficulty mix as the rest of Year 7. duel.js can't import journey.js
// (journey -> duel is the only allowed edge), so this is a small, stable,
// manually-kept-in-sync literal rather than a shared export.
const DUEL_BLEND = { medium: 1, hard: 4, expert: 5 };
const RESERVE_SIZE = 12; // sudden-death continuation pool (hard/expert)

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildDuelPool() {
  const picked = [];
  const used = new Set();
  for (const [diff, count] of Object.entries(DUEL_BLEND)) {
    const chosen = shuffle(allQuestions.filter(q => q.diff === diff)).slice(0, count);
    chosen.forEach(q => used.add(q.q));
    picked.push(...chosen);
  }
  const reservePool = allQuestions.filter(q => (q.diff === 'expert' || q.diff === 'hard') && !used.has(q.q));
  return { questions: shuffle(picked), reserve: shuffle(reservePool).slice(0, RESERVE_SIZE) };
}

// ─── color helpers (local — FX's parseColor is module-private) ─────────────
function hexToRgba(hex, alpha) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((hex || '').trim());
  if (!m) return `rgba(57,255,106,${alpha})`;
  let h = m[1];
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function getHouseAccentHex() {
  try {
    const raw = getComputedStyle(document.body).getPropertyValue('--accent').trim();
    return /^#[0-9a-f]{3,6}$/i.test(raw) ? raw : '#c9a84c';
  } catch (e) {
    return '#c9a84c';
  }
}

// ─── duel state ──────────────────────────────────────────────────────────
let onCompleteCb = null;
let playerHP = 5, voldHP = 5;
let reserveQuestions = [];
let activeConfig = null;
let introPlayed = false;

// ─── wraith visual: one FX layer, registered once via Duel.init() ─────────
// Zero per-frame allocation: anchor/recoil/beam state all live in module
// scalars and a fixed 2-slot beam pool, reused every tick.
let wraithActive = false;
let presence = 0;            // 0..1 materialize/dissolve
let materializeStartT = -1;
let dissolveStartT = -1;
let anchorX = 0, anchorY = 150; // cached on question-show + resize, never per-frame
let recoilX = 0, recoilY = 0;
let hitFlash = 0;
let ambientSmokeTimer = 0.8;
let lastT = 0;

const MAX_BEAMS = 2;
const beams = [
  { active: false, t: 0, dur: 0.6, x0: 0, y0: 0, x1: 0, y1: 0, cx: 0, cy: 0, color: '#39ff6a', onArrive: null, arrived: false },
  { active: false, t: 0, dur: 0.6, x0: 0, y0: 0, x1: 0, y1: 0, cx: 0, cy: 0, color: '#39ff6a', onArrive: null, arrived: false },
];

function resetBeams() {
  for (const b of beams) { b.active = false; b.arrived = false; b.onArrive = null; }
}

function beamPointAt(b, tt) {
  const u = 1 - tt;
  return {
    x: u * u * b.x0 + 2 * u * tt * b.cx + tt * tt * b.x1,
    y: u * u * b.y0 + 2 * u * tt * b.cy + tt * tt * b.y1,
  };
}

function fireBeam(x0, y0, x1, y1, color, onArrive) {
  const slot = beams.find(b => !b.active);
  if (!slot) { onArrive && onArrive(); return; } // pool full (max 2) — never lose the hit
  const dx = x1 - x0, dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;
  const bow = Math.min(70, len * 0.16) * (Math.random() < 0.5 ? -1 : 1);
  slot.x0 = x0; slot.y0 = y0; slot.x1 = x1; slot.y1 = y1;
  slot.cx = (x0 + x1) / 2 + nx * bow;
  slot.cy = (y0 + y1) / 2 + ny * bow;
  slot.t = 0; slot.dur = 0.6; slot.color = color;
  slot.onArrive = onArrive; slot.arrived = false; slot.active = true;
}

function cacheWraithAnchor() {
  anchorX = window.innerWidth / 2;
  // anchors to #duel-wraith-space, a reserved-height spacer between the HUD
  // and the question card (journey.css) — keeps the cloak clear of the
  // question text instead of overlapping it.
  const spacer = document.getElementById('duel-wraith-space');
  if (spacer && document.body.classList.contains('dueling')) {
    const r = spacer.getBoundingClientRect();
    anchorY = r.top + Math.min(64, r.height * 0.35);
  } else {
    anchorY = 150;
  }
}

function activateWraith() {
  wraithActive = true;
  dissolveStartT = -1;
  materializeStartT = performance.now() / 1000;
  presence = FX.reduced ? 1 : 0;
  recoilX = 0; recoilY = 0; hitFlash = 0;
  ambientSmokeTimer = 0.5;
  resetBeams();
}

function deactivateWraithInstant() {
  wraithActive = false;
  dissolveStartT = -1;
  materializeStartT = -1;
  presence = 0;
  resetBeams();
}

function startDissolve() {
  dissolveStartT = performance.now() / 1000;
  FX.burst(anchorX, anchorY, { color: '#2a1642', count: FX.reduced ? 10 : 44 });
  FX.fizzle(anchorX, anchorY);
  FX.fizzle(anchorX - 20, anchorY + 20);
  FX.fizzle(anchorX + 20, anchorY + 10);
}

function wraithUpdate(dt, t) {
  lastT = t;
  if (!wraithActive) return;

  if (dissolveStartT >= 0) {
    const dp = FX.reduced ? 1 : Math.min(1, (t - dissolveStartT) / 1.2);
    presence = 1 - dp;
    if (dp >= 1) { wraithActive = false; dissolveStartT = -1; presence = 0; }
  } else if (materializeStartT >= 0) {
    presence = FX.reduced ? 1 : Math.min(1, (t - materializeStartT) / 1.2);
  }

  recoilX -= recoilX * Math.min(1, dt * 8);
  recoilY -= recoilY * Math.min(1, dt * 8);
  hitFlash = Math.max(0, hitFlash - dt * 2.2);

  if (!FX.reduced) {
    ambientSmokeTimer -= dt;
    if (ambientSmokeTimer <= 0) {
      ambientSmokeTimer = 0.7 + Math.random() * 0.35;
      const n = 2 + Math.floor(Math.random() * 2);
      for (let i = 0; i < n; i++) {
        FX.fizzle(anchorX + recoilX + (Math.random() - 0.5) * 50, anchorY + recoilY + 50 + Math.random() * 30);
      }
    }
  }

  for (const b of beams) {
    if (!b.active) continue;
    b.t += dt / b.dur;
    if (b.t >= 1) {
      b.active = false;
      if (!b.arrived) { b.arrived = true; b.onArrive && b.onArrive(); }
      continue;
    }
    if (!FX.reduced) {
      const head = beamPointAt(b, b.t);
      const sparkCount = 1 + (Math.random() < 0.5 ? 1 : 0);
      for (let i = 0; i < sparkCount; i++) {
        FX.spark(head.x, head.y, {
          vx: (Math.random() - 0.5) * 40,
          vy: (Math.random() - 0.5) * 40,
          color: b.color,
          size: 1.4 + Math.random(),
          life: 0.22 + Math.random() * 0.15,
        });
      }
    }
  }
}

function drawWraithFull(ctx, alpha, t) {
  const cx = anchorX + recoilX;
  const cy = anchorY + recoilY;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(cx, cy);

  const layersDef = [
    { scale: 1.18, a: 0.32, dy: 14 },
    { scale: 1.06, a: 0.5, dy: 6 },
    { scale: 1.0, a: 0.72, dy: 0 },
  ];
  const flash = hitFlash;
  for (let i = 0; i < layersDef.length; i++) {
    const L = layersDef[i];
    const w = 70 * L.scale;
    const writhe1 = Math.sin(t * 1.3 + i * 1.9) * 9 + Math.sin(t * 2.7 + i * 0.6) * 4;
    const writhe2 = Math.sin(t * 1.1 + i * 2.4 + 1.5) * 8 + Math.sin(t * 2.3 + i) * 4;
    ctx.beginPath();
    ctx.moveTo(-w, -10 + L.dy);
    ctx.bezierCurveTo(-w - 16 + writhe1, 55, -w * 0.45 + writhe1 * 0.6, 118, 0, 140 + L.dy);
    ctx.bezierCurveTo(w * 0.45 - writhe2 * 0.6, 118, w + 16 - writhe2, 55, w, -10 + L.dy);
    ctx.quadraticCurveTo(0, -34 + L.dy, -w, -10 + L.dy);
    ctx.closePath();
    const r = Math.round(8 + (40 - 8) * flash * 0.4);
    const g = Math.round(4 + (255 - 4) * flash * 0.4);
    const b = Math.round(16 + (110 - 16) * flash * 0.4);
    ctx.fillStyle = `rgba(${r},${g},${b},${L.a})`;
    ctx.fill();
  }

  ctx.beginPath();
  ctx.ellipse(0, -26, 24, 30, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(5,2,10,0.88)';
  ctx.fill();

  const flick = 0.5 + 0.5 * Math.sin(t * 7);
  const eyeA = 0.35 + 0.55 * flick;
  for (const ex of [-8, 8]) {
    const grad = ctx.createRadialGradient(ex, -28, 0, ex, -28, 7);
    grad.addColorStop(0, `rgba(100,255,150,${eyeA})`);
    grad.addColorStop(1, 'rgba(40,180,90,0)');
    ctx.beginPath();
    ctx.fillStyle = grad;
    ctx.arc(ex, -28, 7, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function drawWraithSimple(ctx, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(anchorX, anchorY);
  ctx.beginPath();
  ctx.moveTo(-64, -10);
  ctx.quadraticCurveTo(0, 140, 64, -10);
  ctx.quadraticCurveTo(0, -34, -64, -10);
  ctx.closePath();
  ctx.fillStyle = 'rgba(8,4,16,0.75)';
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(0, -26, 24, 30, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(5,2,10,0.9)';
  ctx.fill();
  for (const ex of [-8, 8]) {
    ctx.beginPath();
    ctx.fillStyle = 'rgba(90,240,140,0.85)';
    ctx.arc(ex, -28, 5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawBeams(ctx) {
  for (const b of beams) {
    if (!b.active) continue;
    const head = beamPointAt(b, b.t);
    const tail = beamPointAt(b, Math.max(0, b.t - 0.25));
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const grad = ctx.createLinearGradient(tail.x, tail.y, head.x, head.y);
    grad.addColorStop(0, hexToRgba(b.color, 0));
    grad.addColorStop(1, hexToRgba(b.color, 0.9));
    ctx.beginPath();
    ctx.strokeStyle = grad;
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.moveTo(tail.x, tail.y);
    ctx.quadraticCurveTo(b.cx, b.cy, head.x, head.y);
    ctx.stroke();
    const glow = ctx.createRadialGradient(head.x, head.y, 0, head.x, head.y, 11);
    glow.addColorStop(0, hexToRgba(b.color, 0.95));
    glow.addColorStop(1, hexToRgba(b.color, 0));
    ctx.beginPath();
    ctx.fillStyle = glow;
    ctx.arc(head.x, head.y, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function wraithDraw(ctx) {
  if (!wraithActive || presence <= 0) return;
  if (FX.reduced) drawWraithSimple(ctx, presence);
  else drawWraithFull(ctx, presence, lastT);
  drawBeams(ctx);
  ctx.globalCompositeOperation = 'source-over';
}

const wraithLayer = {
  update: wraithUpdate,
  draw: wraithDraw,
  resize: () => cacheWraithAnchor(),
};

// ─── HUD ─────────────────────────────────────────────────────────────────
function updateHUDPips() {
  document.querySelectorAll('#duel-player-pips .hp-pip').forEach((el, i) => el.classList.toggle('lost', i >= playerHP));
  document.querySelectorAll('#duel-vold-pips .hp-pip').forEach((el, i) => el.classList.toggle('lost', i >= voldHP));
}

function flashAvada() {
  const el = document.getElementById('avada-flash');
  if (!el) return;
  el.classList.remove('flash');
  void el.offsetWidth;
  el.classList.add('flash');
}

function shakeContainer() {
  const el = document.querySelector('.container');
  if (!el) return;
  el.classList.remove('screen-shake');
  void el.offsetWidth;
  el.classList.add('screen-shake');
  setTimeout(() => el.classList.remove('screen-shake'), 320);
}

// ─── damage application (called from beam onArrive, or instantly under FX.reduced) ──
function applyVoldDamage(color) {
  voldHP = Math.max(0, voldHP - 1);
  updateHUDPips();
  hitFlash = 1;
  recoilX = (Math.random() < 0.5 ? -1 : 1) * 4;
  recoilY = -12;
  FX.burst(anchorX, anchorY, { color, count: FX.reduced ? 8 : 30 });
  FX.ringPulse(anchorX, anchorY, color);
  AudioEngine.playSpellHit();
  if (voldHP > 0) Dialogue.quip('duel-hit');
}

function applyPlayerDamage() {
  playerHP = Math.max(0, playerHP - 1);
  updateHUDPips();
  flashAvada();
  if (!FX.reduced) shakeContainer();
  AudioEngine.playAvada();
}

// Patronus shield consumed (verdict 'shielded' from the composed adjudicate
// below): the curse never lands — silver flash instead of the Avada flash,
// no HP change either side.
function patronusShieldBreakFX() {
  const cx = window.innerWidth / 2, cy = window.innerHeight - 70;
  FX.ringPulse(cx, cy, '#c8d8f0');
  FX.burst(cx, cy, { color: '#c8d8f0', count: FX.reduced ? 10 : 34 });
  AudioEngine.playChime();
  showToast('🦌 Your Patronus blocks the curse!');
}

// Hufflepuff's forgiveness (verdict 'forgiven'): counts correct for scoring
// (quiz.js already applied the green "forgiven" treatment to the option) but
// this is not a strike on Voldemort either — no beam either direction.
function forgivenDuelFX() {
  AudioEngine.playChime();
}

// ─── round hooks ─────────────────────────────────────────────────────────
function duelRoundStart() {
  playerHP = 5; voldHP = 5;
  updateHUDPips();
  document.body.classList.add('dueling');
  document.body.classList.remove('duel-defeat');
}

// Free opening strike (typing success, before Q1 is interactable): a beam
// from bottom-center (the player's position) straight to the wraith, full
// choreography, same damage application as a normal correct answer.
function openingStrike() {
  const color = getHouseAccentHex();
  const x0 = window.innerWidth / 2, y0 = window.innerHeight - 40;
  if (FX.reduced || !wraithActive) {
    applyVoldDamage(color);
  } else {
    fireBeam(x0, y0, anchorX, anchorY, color, () => applyVoldDamage(color));
  }
}

function duelQuestionShown(index) {
  cacheWraithAnchor();
  if (index === 0 && !introPlayed) {
    introPlayed = true;
    activateWraith();
    const card = document.getElementById('question-card');
    card.classList.add('duel-intro-hidden');
    AudioEngine.playDuelStart();
    AudioEngine.startDuelMusic();
    Dialogue.say('duel-start');
    setTimeout(() => {
      card.classList.remove('duel-intro-hidden');
      cacheWraithAnchor();
      Typing.run({
        incantation: 'Expelliarmus',
        seconds: 8,
        onDone: ({ success }) => { if (success) openingStrike(); },
      });
    }, 1300);
  }
  Dialogue.noteQuestionShown();
}

function duelOnAnswer(isCorrect, { btnRect, verdict }) {
  if (verdict === 'forgiven') { forgivenDuelFX(); return; }
  if (verdict === 'shielded') { patronusShieldBreakFX(); return; }
  if (isCorrect) {
    const color = getHouseAccentHex();
    if (FX.reduced || !wraithActive) {
      applyVoldDamage(color);
    } else {
      const x0 = btnRect.left + btnRect.width / 2;
      const y0 = btnRect.top + btnRect.height / 2;
      fireBeam(x0, y0, anchorX, anchorY, color, () => applyVoldDamage(color));
    }
  } else {
    if (FX.reduced || !wraithActive) {
      applyPlayerDamage();
    } else {
      const x1 = window.innerWidth / 2;
      const y1 = window.innerHeight - 70;
      fireBeam(anchorX, anchorY, x1, y1, '#39ff6a', applyPlayerDamage);
    }
  }
}

function duelExtraQuestion() {
  // Sudden death: only reachable if some future adjudicate hook (Patronus
  // shield / Gryffindor retry, batch 4) withholds damage on a question — at
  // 5 HP / 10 questions with today's strict 1-dmg-per-question rule, the
  // pigeonhole principle guarantees a KO by question 9 at the latest, so
  // this path is implemented for forward-compatibility and verified by
  // temporarily lowering HP/pool size in dev (see duel.js's batch-3 notes),
  // not reachable in normal batch-3 play.
  if (voldHP > 0 && playerHP > 0 && voldHP === playerHP && reserveQuestions.length) {
    return reserveQuestions.shift();
  }
  return null;
}

function computeVictory() {
  if (voldHP <= 0) return true;
  if (playerHP <= 0) return false;
  if (playerHP === voldHP) return true; // reserve exhausted mid-tie — generous default
  return playerHP > voldHP; // exhausted, unequal, non-KO: higher HP wins
}

function lineHTML(line) {
  if (!line) return '';
  const char = Dialogue.CHARACTERS[line.char] || Dialogue.CHARACTERS.hat;
  return `<span class="grade-line-char" style="color:${char.color}">${char.emoji} ${char.name}</span><span class="grade-line-text">"${line.text}"</span>`;
}

function applyDuelButtons(primaryLabel, primaryAction, secondaryLabel, secondaryAction) {
  const btns = document.querySelectorAll('.result-btns .play-again-btn');
  if (btns[0]) btns[0].textContent = primaryLabel;
  if (btns[1]) btns[1].textContent = secondaryLabel;
  activeConfig.primaryAction = primaryAction;
  activeConfig.secondaryAction = secondaryAction;
}

function cleanupDuelUI() {
  document.body.classList.remove('dueling', 'duel-defeat');
  AudioEngine.stopDuelMusic();
  deactivateWraithInstant();
}

function duelRoundEnd(finalScore, total) {
  AudioEngine.stopDuelMusic();
  Dialogue.dismissCard();
  document.getElementById('journey-result-banner')?.classList.add('hidden');
  document.getElementById('expert-unlocked-banner')?.classList.add('hidden');

  renderResultShell(finalScore, total);
  // renderResultShell's house pity/praise line is keyed off raw quiz score,
  // not the HP-based duel outcome — "Courage isn't knowing everything" under
  // "THE DARK LORD FALLS" reads as a mismatch, so the duel supplies its own
  // verdict + dialogue line instead and hides the shell's house line.
  document.getElementById('result-house-line')?.classList.add('hidden');

  const victory = computeVictory();
  const pts = getPoints() + (victory ? 10 : 0);
  const ratingEl = document.getElementById('result-rating');
  const commentEl = document.getElementById('result-comment');

  if (victory) {
    document.body.classList.remove('duel-defeat');
    startDissolve();
    FX.confetti({ colors: [getHouseAccentHex(), '#39ff6a', '#f0d080', '#ffffff'], count: 90 });
    AudioEngine.playFanfare();
    if (ratingEl) ratingEl.innerHTML = '<div class="duel-verdict duel-verdict-win">⚔️ The Dark Lord Falls</div>';
    if (commentEl) commentEl.innerHTML = lineHTML(Dialogue.say('duel-win'));
    applyDuelButtons(
      '🏆 To the Great Feast', () => { cleanupDuelUI(); onCompleteCb?.({ victory: true, points: pts, action: 'continue' }); },
      '🗺 Back to the Map', () => { cleanupDuelUI(); onCompleteCb?.({ victory: true, points: pts, action: 'map' }); },
    );
  } else {
    document.body.classList.add('duel-defeat');
    AudioEngine.playDefeat();
    if (ratingEl) ratingEl.innerHTML = '<div class="duel-verdict duel-verdict-loss">The Dark Lord Prevails…</div>';
    if (commentEl) commentEl.innerHTML = lineHTML(Dialogue.say('duel-loss'));
    applyDuelButtons(
      '⚔️ Retry the Duel', () => { document.body.classList.remove('duel-defeat'); beginDuel(); },
      '🏰 Back to the Map', () => { cleanupDuelUI(); onCompleteCb?.({ victory: false, points: pts, action: 'map' }); },
    );
  }
}

function duelAbandon() {
  Dialogue.cancelSpeech();
  Dialogue.dismissCard();
  cleanupDuelUI();
}

// ─── round start ─────────────────────────────────────────────────────────
function beginDuel(ev) {
  introPlayed = false;
  Dialogue.resetRound();
  const { questions, reserve } = buildDuelPool();
  reserveQuestions = reserve;

  // composeRoundHooks({duel:true}) layers the arsenal (spell bar, spells) and
  // the house passives onto the duel: it supplies the adjudicate chain
  // (Gryffindor retry / Hufflepuff forgiven → Patronus 'shielded' → damage)
  // that duelOnAnswer's verdict handling relies on, and pumps
  // Arsenal.beginRound / onQuestionShown / onAnswer around the duel's own hooks.
  activeConfig = composeRoundHooks({
    questions,
    tagHTML: '<span class="quiz-diff-tag journey-tag duel-tag">⚔️ The Final Duel</span>',
    color: '#39ff6a',
    lifelines: 0,
    suppressSnitch: true,
    suppressHedwig: true,
    fromScreen: 'screen-year-intro',
    onRoundStart: duelRoundStart,
    onQuestionShown: duelQuestionShown,
    onAnswer: duelOnAnswer,
    nextDelay: 700,
    isRoundOver: () => voldHP <= 0 || playerHP <= 0,
    extraQuestion: duelExtraQuestion,
    onRoundEnd: duelRoundEnd,
    onAbandon: duelAbandon,
    primaryLabel: '', primaryAction: null,
    secondaryLabel: '', secondaryAction: null,
  }, { duel: true });
  AudioEngine.playCast();
  startRound(activeConfig, ev);
}

// ─── public API ──────────────────────────────────────────────────────────
export const Duel = {
  init() {
    FX.addLayer(wraithLayer, FX.fxCanvas);
  },
  // onComplete(result) is called once when the player leaves the duel's
  // result screen: result = { victory, points, action }. action is
  // 'continue' (victory's "To the Great Feast" button — journey should show
  // the ceremony) or 'map' (either button routes back to the map without
  // opening the ceremony). journey.js owns all navigation from here.
  start(onComplete, ev) {
    onCompleteCb = onComplete;
    beginDuel(ev);
  },
};
