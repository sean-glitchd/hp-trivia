// ─── guide.js: GBA-RPG dialogue boxes (onboarding + narration) ──────────────
// A recurring companion (Hagrid, with McGonagall/Dumbledore for formal beats)
// explains the game in pixel dialogue boxes: portrait + name plate + typewriter
// text + blinking advance arrow, click/tap/Enter to advance, Skip to bail.
// Tutorial beats fire once (persisted to hp_seen). Imports audio + dialogue
// only (for name interpolation + optional speech) — a leaf module.

import { AudioEngine } from './audio.js';
import * as Dialogue from './dialogue.js';

const KEY = 'hp_seen';

// ─── seen-beats persistence (silent reset on corruption) ─────────────────────
let seenSet = new Set();
(function load() {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY));
    if (parsed && parsed.v === 1 && Array.isArray(parsed.seen)) seenSet = new Set(parsed.seen);
  } catch (e) { seenSet = new Set(); }
})();
function markSeen(beatId) {
  seenSet.add(beatId);
  try { localStorage.setItem(KEY, JSON.stringify({ v: 1, seen: [...seenSet] })); } catch (e) { /* ignore */ }
}

// ─── speakers ────────────────────────────────────────────────────────────────
const HAGRID = { key: 'hagrid', name: 'Hagrid', emoji: '🧑‍🌾', color: '#c98a4c' };
const MCG = { key: 'mcgonagall', name: 'Professor McGonagall', emoji: '🎩', color: '#9db4d0' };
const DUMBLEDORE = { key: 'dumbledore', name: 'Professor Dumbledore', emoji: '🧙‍♂️', color: '#c9a84c' };

// Beat scripts are functions so {name} interpolates at play time.
const BEATS = {
  'journey-intro': () => [
    { ...HAGRID, text: "Blimey, {name}! Welcome ter Hogwarts. I'm Hagrid — I'll show yeh the ropes." },
    { ...HAGRID, text: "Yeh're here ter learn. Each Year has a few lessons — ten questions apiece. Get six right an' yeh pass." },
    { ...HAGRID, text: "Finish all a Year's lessons an' yeh can sit the Final Exam. Pass that, an' yeh move up a Year." },
    { ...HAGRID, text: "Yeh'll earn spells along the way. Tap one ter see what it does, then tap again ter cast it — handy in a tight spot." },
    { ...HAGRID, text: "Every answer earns House Points fer the House Cup. An' keep yer eyes peeled — the Golden Snitch an' Hedwig turn up now an' then. Catch 'em fer a reward!" },
    { ...HAGRID, text: "Right then, {name}. Off yeh go. Make us proud." },
  ],
  'first-exam': () => [
    { ...MCG, text: "This is your Final Exam, {name} — twenty questions, and fourteen correct to pass. Do concentrate." },
  ],
  'first-year-done': () => [
    { ...HAGRID, text: "Yeh did it, {name}! A whole Year behind yeh. Onwards — it only gets more int'restin' from here." },
  ],
  'journey-complete': () => [
    { ...DUMBLEDORE, text: "Seven years, {name}. You have learned that our choices reveal who we truly are. Hogwarts will always be here to welcome you home." },
  ],
};

function interp(text) {
  const name = Dialogue.getName() || 'young wizard';
  return text.replace(/\{name\}/g, name);
}

// ─── dialogue box (built once) ───────────────────────────────────────────────
let boxEl = null;
let queue = [];
let onDoneCb = null;
let typing = false;
let typeTimer = null;
let fullText = '';

function ensureBox() {
  if (boxEl) return boxEl;
  boxEl = document.createElement('div');
  boxEl.id = 'guide-box';
  boxEl.className = 'guide-box hidden';
  boxEl.innerHTML = `
    <div class="guide-panel">
      <div class="guide-portrait" id="guide-portrait"></div>
      <div class="guide-content">
        <div class="guide-name" id="guide-name"></div>
        <div class="guide-text" id="guide-text"></div>
      </div>
      <div class="guide-advance" id="guide-advance">▼</div>
      <button class="guide-skip" id="guide-skip" type="button">Skip ▸</button>
    </div>`;
  document.body.appendChild(boxEl);
  boxEl.addEventListener('click', (e) => {
    if (e.target.id === 'guide-skip') { finish(); return; }
    advance();
  });
  document.addEventListener('keydown', onKey, true);
  return boxEl;
}

function onKey(e) {
  if (!boxEl || boxEl.classList.contains('hidden')) return;
  const tag = document.activeElement && document.activeElement.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') {
    e.preventDefault();
    if (e.key === 'Escape') finish(); else advance();
  }
}

function typeLine(line) {
  const nameEl = document.getElementById('guide-name');
  const portraitEl = document.getElementById('guide-portrait');
  const textEl = document.getElementById('guide-text');
  const advanceEl = document.getElementById('guide-advance');
  nameEl.textContent = line.name;
  nameEl.style.color = line.color || '#c9a84c';
  portraitEl.textContent = line.emoji;
  portraitEl.style.borderColor = line.color || '#c9a84c';
  fullText = interp(line.text);
  advanceEl.classList.add('hidden');

  if (AudioEngine && line.text) Dialogue.speak(fullText, line.key); // no-ops unless voice on

  // Typewriter — instant under reduced motion.
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) { textEl.textContent = fullText; typing = false; advanceEl.classList.remove('hidden'); return; }
  textEl.textContent = '';
  typing = true;
  let i = 0;
  clearInterval(typeTimer);
  typeTimer = setInterval(() => {
    textEl.textContent = fullText.slice(0, ++i);
    if (i % 2 === 0) AudioEngine.playTick && AudioEngine.playTick();
    if (i >= fullText.length) { clearInterval(typeTimer); typing = false; advanceEl.classList.remove('hidden'); }
  }, 22);
}

function advance() {
  if (typing) {
    // Reveal the rest instantly.
    clearInterval(typeTimer);
    typing = false;
    document.getElementById('guide-text').textContent = fullText;
    document.getElementById('guide-advance').classList.remove('hidden');
    return;
  }
  if (queue.length) { typeLine(queue.shift()); }
  else finish();
}

function finish() {
  clearInterval(typeTimer);
  typing = false;
  Dialogue.cancelSpeech && Dialogue.cancelSpeech();
  if (boxEl) boxEl.classList.add('hidden');
  const cb = onDoneCb; onDoneCb = null; queue = [];
  if (cb) cb();
}

function play(lines, onDone) {
  if (!lines || !lines.length) { onDone && onDone(); return; }
  ensureBox();
  queue = lines.slice();
  onDoneCb = onDone || null;
  boxEl.classList.remove('hidden');
  typeLine(queue.shift());
}

export const Guide = {
  init() { ensureBox(); },

  // Play a named beat every time (rare — most use playBeatOnce).
  playBeat(beatId, onDone) {
    const script = BEATS[beatId];
    if (!script) { onDone && onDone(); return; }
    play(script(), onDone);
  },

  // Play a named beat only the first time it's ever reached; otherwise no-op
  // (calls onDone immediately). Marks the beat seen when it starts.
  playBeatOnce(beatId, onDone) {
    if (seenSet.has(beatId)) { onDone && onDone(); return; }
    markSeen(beatId);
    this.playBeat(beatId, onDone);
  },

  // Ad-hoc lines (no persistence) — {speaker emoji, name, color, text}.
  play,

  isSeen(beatId) { return seenSet.has(beatId); },

  // Clear all seen-beat flags (in-memory + storage) so a full journey reset
  // replays the walkthrough in the same session, no refresh needed.
  resetSeen() {
    seenSet = new Set();
    try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
  },
};
