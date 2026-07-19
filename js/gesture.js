// ─── gesture.js: draw-the-wand-movement spell casting (replaces typing) ─────
// The "Cast the spell!" challenge: an on-screen guide path shows the wand
// movement (Wingardium Leviosa = swish and flick); the player traces it with
// finger or mouse. A compact $1-recognizer-style matcher scores the trace with
// generous tolerance. No timer, unlimited retries, always skippable, no
// penalty. Imports fx/audio only (a leaf). Same {incantation, onDone} contract
// the journey lesson slot and the duel opening previously used for typing.

import { FX } from './fx.js';
import { AudioEngine } from './audio.js';

// ─── templates (wand movements, in a ~300×260 guide space) ──────────────────
const TEMPLATES = {
  // Wingardium Leviosa — the iconic swish (down-and-across) then flick up.
  'swish-flick': [[24,150],[80,168],[140,172],[200,158],[248,128],[270,78],[280,34]],
  // A decisive downward slash — Expelliarmus, Stupefy.
  'slash': [[40,40],[100,100],[160,160],[220,210],[264,244]],
  // A rising V / checkmark — Expecto Patronum.
  'vee': [[40,60],[150,232],[264,48]],
  // A loop — Accio, Levicorpus.
  'loop': [[150,40],[240,110],[200,220],[100,220],[60,110],[150,40]],
  // A shield zigzag — Protego.
  'zigzag': [[36,60],[150,150],[36,240],[150,240],[264,150],[150,60]],
};

const SPELL_TEMPLATE = {
  'Wingardium Leviosa': 'swish-flick',
  'Expelliarmus': 'slash',
  'Expecto Patronum': 'vee',
  'Accio': 'loop',
  'Stupefy': 'slash',
  'Levicorpus': 'loop',
  'Protego': 'zigzag',
};

// ─── $1-style matcher ────────────────────────────────────────────────────────
const N = 32;                 // resample count
const MATCH_THRESHOLD = 0.42; // normalized avg point distance; generous

function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function pathLen(pts) { let s = 0; for (let i = 1; i < pts.length; i++) s += dist(pts[i - 1], pts[i]); return s; }

function resample(points) {
  const pts = points.map(p => ({ x: p.x, y: p.y }));
  const I = pathLen(pts) / (N - 1) || 1;
  let D = 0;
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    let d = dist(pts[i - 1], pts[i]);
    if (D + d >= I) {
      const t = (I - D) / d;
      const np = { x: pts[i - 1].x + t * (pts[i].x - pts[i - 1].x), y: pts[i - 1].y + t * (pts[i].y - pts[i - 1].y) };
      out.push(np);
      pts.splice(i, 0, np);
      D = 0;
    } else { D += d; }
  }
  while (out.length < N) out.push({ ...pts[pts.length - 1] });
  return out.slice(0, N);
}

function normalize(points) {
  const cx = points.reduce((s, p) => s + p.x, 0) / points.length;
  const cy = points.reduce((s, p) => s + p.y, 0) / points.length;
  const tr = points.map(p => ({ x: p.x - cx, y: p.y - cy }));
  const xs = tr.map(p => p.x), ys = tr.map(p => p.y);
  const s = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) || 1;
  return tr.map(p => ({ x: p.x / s, y: p.y / s }));
}

function avgDist(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += dist(a[i], b[i]); return s / a.length; }

function matchScore(drawn, template) {
  if (drawn.length < 4) return Infinity;
  const d = normalize(resample(drawn));
  const t = normalize(resample(template.map(p => ({ x: p[0], y: p[1] }))));
  const tRev = t.slice().reverse();
  // Lenient about stroke direction — take the better of forward / reversed.
  return Math.min(avgDist(d, t), avgDist(d, tRev));
}

// ─── overlay ─────────────────────────────────────────────────────────────────
let overlayEl = null, canvas = null, ctx = null;
let templatePts = [], drawing = false, stroke = [], onDoneCb = null, done = false;
const STAGE_W = 300, STAGE_H = 260;

function ensureOverlay() {
  if (overlayEl) return;
  overlayEl = document.createElement('div');
  overlayEl.id = 'gesture-overlay';
  overlayEl.className = 'gesture-overlay hidden';
  overlayEl.innerHTML = `
    <div class="gesture-card">
      <div class="gesture-label">Cast the spell!</div>
      <div class="gesture-spell" id="gesture-spell"></div>
      <div class="gesture-instruction">Trace the wand movement with your finger or mouse.</div>
      <div class="gesture-stage">
        <canvas id="gesture-canvas" width="${STAGE_W}" height="${STAGE_H}"></canvas>
        <div class="gesture-feedback" id="gesture-feedback"></div>
      </div>
      <button class="link-btn gesture-skip" id="gesture-skip" type="button">Not now ▸</button>
    </div>`;
  document.body.appendChild(overlayEl);
  canvas = overlayEl.querySelector('#gesture-canvas');
  ctx = canvas.getContext('2d');
  overlayEl.querySelector('#gesture-skip').addEventListener('click', () => finish(false));
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointerleave', onUp);
}

function canvasPoint(e) {
  const r = canvas.getBoundingClientRect();
  return { x: (e.clientX - r.left) * (STAGE_W / r.width), y: (e.clientY - r.top) * (STAGE_H / r.height) };
}

function redraw() {
  ctx.clearRect(0, 0, STAGE_W, STAGE_H);
  // guide path — faint dashed
  ctx.save();
  ctx.setLineDash([6, 7]);
  ctx.strokeStyle = 'rgba(201,168,76,0.45)';
  ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath();
  templatePts.forEach((p, i) => { i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); });
  ctx.stroke();
  ctx.restore();
  // start dot + end arrow
  const s = templatePts[0], en = templatePts[templatePts.length - 1];
  ctx.fillStyle = '#7ee8a8';
  ctx.beginPath(); ctx.arc(s[0], s[1], 7, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(240,208,128,0.9)';
  ctx.beginPath(); ctx.arc(en[0], en[1], 5, 0, Math.PI * 2); ctx.fill();
  // player's stroke — bright gold
  if (stroke.length > 1) {
    ctx.strokeStyle = '#f0d080'; ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.shadowColor = 'rgba(240,208,128,0.7)'; ctx.shadowBlur = 8;
    ctx.beginPath();
    stroke.forEach((p, i) => { i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); });
    ctx.stroke();
    ctx.shadowBlur = 0;
  }
}

function onDown(e) {
  if (done) return;
  e.preventDefault();
  drawing = true; stroke = [canvasPoint(e)];
  document.getElementById('gesture-feedback').textContent = '';
  redraw();
}
function onMove(e) {
  if (!drawing) return;
  e.preventDefault();
  const p = canvasPoint(e);
  stroke.push(p);
  if (!FX.reduced) {
    const r = canvas.getBoundingClientRect();
    FX.trail(r.left + (p.x / STAGE_W) * r.width, r.top + (p.y / STAGE_H) * r.height, 0, 0);
  }
  redraw();
}
// A real trace has to actually span the stage — reject tiny taps/scribbles
// (which would otherwise normalize up and match almost anything).
function strokeSpan(pts) {
  if (pts.length < 2) return 0;
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  return Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
}

function onUp(e) {
  if (!drawing) return;
  drawing = false;
  if (stroke.length < 8 || strokeSpan(stroke) < 120) {
    const fb = document.getElementById('gesture-feedback');
    fb.textContent = 'Trace the whole movement.';
    stroke = [];
    setTimeout(redraw, 120);
    return;
  }
  const score = matchScore(stroke, templatePts);
  if (score <= MATCH_THRESHOLD) {
    finish(true);
  } else {
    const fb = document.getElementById('gesture-feedback');
    fb.textContent = 'Not quite — try again.';
    if (!FX.reduced) { canvas.classList.remove('gesture-shake'); void canvas.offsetWidth; canvas.classList.add('gesture-shake'); }
    AudioEngine.playWrong && AudioEngine.playWrong();
    stroke = [];
    setTimeout(redraw, 120);
  }
}

function finish(success) {
  if (done) return;
  done = true;
  if (success) {
    const r = canvas.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    FX.burst(cx, cy, { count: 40, color: '#f0d080' });
    FX.ringPulse(cx, cy, '#f0d080');
    AudioEngine.playChime && AudioEngine.playChime();
  }
  document.body.classList.remove('quill-mode');
  overlayEl.classList.remove('gesture-show');
  setTimeout(() => overlayEl.classList.add('hidden'), FX.reduced ? 0 : 260);
  const cb = onDoneCb; onDoneCb = null;
  cb && cb({ success });
}

export const Gesture = {
  // { incantation, onDone({success}) } — same call contract as the old Typing.run.
  run({ incantation, onDone } = {}) {
    ensureOverlay();
    done = false; stroke = [];
    onDoneCb = onDone || null;
    const key = SPELL_TEMPLATE[incantation] || 'swish-flick';
    templatePts = TEMPLATES[key];
    document.getElementById('gesture-spell').textContent = incantation || 'Lumos';
    document.getElementById('gesture-feedback').textContent = '';
    redraw();
    document.body.classList.add('quill-mode');
    overlayEl.classList.remove('hidden');
    void overlayEl.offsetWidth;
    overlayEl.classList.add('gesture-show');
  },
  isActive() { return overlayEl && !overlayEl.classList.contains('hidden'); },
};
