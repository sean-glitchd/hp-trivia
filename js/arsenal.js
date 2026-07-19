// ─── arsenal.js: spell inventory (hp_arsenal), spell bar UI, snitch reward ──
// Imports quiz.js primitives + fx/audio only (acyclic: arsenal -> quiz/fx/
// audio; quiz.js never imports this module — round configs are decorated
// with arsenal's hooks by main.js/journey.js/duel.js, the composition sites).

import {
  eliminateWrongOptions, rerollCurrentQuestion, armDoublePoints, armStreakShield, showToast,
} from './quiz.js';
import { FX } from './fx.js';
import { AudioEngine } from './audio.js';

const KEY = 'hp_arsenal';
const CAP = 3;
const COARSE = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;

export const SPELLS = {
  ob: { id: 'ob', name: 'Obliviate',     glyph: '🌀', desc: 'Removes 2 wrong answers', color: '#b080f0' },
  lu: { id: 'lu', name: 'Lumos',         glyph: '🕯️', desc: 'Removes 1 wrong answer',  color: '#f0d080' },
  fe: { id: 'fe', name: 'Felix Felicis', glyph: '🧪', desc: 'Next correct answer scores double', color: '#f5c800' },
  tt: { id: 'tt', name: 'Time-Turner',   glyph: '⏳', desc: 'Reroll this question (once per round)', color: '#6c9fd8' },
  pa: { id: 'pa', name: 'Patronus',      glyph: '🦌', desc: 'Blocks one wrong answer\'s penalty', color: '#c8d8f0' },
};
const SPELL_ORDER = ['ob', 'lu', 'fe', 'tt', 'pa'];
const DEFAULT_WEIGHTS = { lu: 35, ob: 25, fe: 20, tt: 10, pa: 10 };
const TOAST_EARNED = {
  ob: '🌀 Obliviate charge earned!',
  lu: '🕯️ Lumos charge earned!',
  fe: '🧪 Felix Felicis charge earned!',
  tt: '⏳ Time-Turner charge earned!',
  pa: '🦌 Patronus charge earned!',
};

// ─── PERSISTENCE (hp_arsenal v1) ────────────────────────────────────────────
let inv = null;

function freshInv() {
  return { v: 1, c: { ob: 0, lu: 0, fe: 0, tt: 0, pa: 0 }, starter: false };
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) { inv = freshInv(); return; }
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.v !== 1 || !parsed.c) { inv = freshInv(); return; }
    inv = { ...freshInv(), ...parsed, c: { ...freshInv().c, ...parsed.c } };
  } catch (e) {
    inv = freshInv();
  }
}

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(inv)); } catch (e) { /* storage full/blocked */ }
}

load();

// ─── ROUND-SCOPED STATE ──────────────────────────────────────────────────────
// roundFree: charges granted just for this round (quick play's freebie
// Obliviate, snitch top-ups, Ravenclaw's free Lumos) — spent before persistent
// inventory. Persist is untouched until roundFree runs out.
let roundFree = { ob: 0, lu: 0, fe: 0, tt: 0, pa: 0 };
let roundHasFreeObliviate = false; // quick play only — governs onSnitchCaught's flavor/cap
let roundPersistentAllowed = true;
let roundInDuel = false;

let eliminatorUsedThisQuestion = false; // ob OR lu, once per question
let answeredThisQuestion = false;
let feArmedThisTurn = false;
let paArmedThisTurn = false;
let ttUsedThisRound = false;

// ─── grant / spend primitives ───────────────────────────────────────────────
function grant(id, n = 1) {
  if (!SPELLS[id]) return 0;
  const before = inv.c[id] || 0;
  const after = Math.min(CAP, before + n);
  const granted = after - before;
  inv.c[id] = after;
  if (granted > 0) save();
  return granted;
}

function grantAndToast(id, n = 1) {
  const granted = grant(id, n);
  if (granted > 0) showToast(TOAST_EARNED[id] || `${SPELLS[id]?.glyph || ''} ${SPELLS[id]?.name || id} charge earned!`);
  render();
  return granted;
}

function pickWeighted(weights) {
  const entries = Object.entries(weights);
  const total = entries.reduce((s, [, v]) => s + v, 0);
  let r = Math.random() * total;
  for (const [id, w] of entries) {
    if (r < w) return id;
    r -= w;
  }
  return entries[entries.length - 1][0];
}

function grantRandom(weights) {
  const id = pickWeighted(weights || DEFAULT_WEIGHTS);
  grantAndToast(id, 1);
  return id; // callers that just want the grant ignore this; the letter uses it
}

function grantStarterKit() {
  if (inv.starter) return false;
  inv.starter = true;
  grant('ob', 1);
  grant('lu', 1);
  save();
  showToast('🎒 A starter kit awaits: Obliviate + Lumos charges granted!');
  render();
  return true;
}

// Round-scoped grant (Ravenclaw's free Lumos, snitch top-ups) — separate pool
// from persistent inventory, spent first, never persisted.
function grantRoundScoped(id, n = 1) {
  if (!SPELLS[id]) return;
  roundFree[id] = (roundFree[id] || 0) + n;
  render();
}

function available(id) {
  return (roundFree[id] || 0) + (roundPersistentAllowed ? (inv.c[id] || 0) : 0);
}

// Returns the source spent from ('free'|'persistent') or null if nothing to spend.
function spendCharge(id) {
  if (roundFree[id] > 0) { roundFree[id]--; return 'free'; }
  if (roundPersistentAllowed && (inv.c[id] || 0) > 0) { inv.c[id]--; save(); return 'persistent'; }
  return null;
}

function refundCharge(id, source) {
  if (source === 'free') roundFree[id] = (roundFree[id] || 0) + 1;
  else if (source === 'persistent') { inv.c[id] = Math.min(CAP, (inv.c[id] || 0) + 1); save(); }
}

// ─── round lifecycle ─────────────────────────────────────────────────────────
function beginRound({ freeObliviate = false, persistentAllowed = true, duel = false } = {}) {
  roundFree = { ob: freeObliviate ? 1 : 0, lu: 0, fe: 0, tt: 0, pa: 0 };
  roundHasFreeObliviate = freeObliviate;
  roundPersistentAllowed = persistentAllowed;
  roundInDuel = duel;
  eliminatorUsedThisQuestion = false;
  answeredThisQuestion = false;
  feArmedThisTurn = false;
  paArmedThisTurn = false;
  ttUsedThisRound = false;
  selectedSpell = null;
  setHint('');
  render();
}

function onQuestionShown() {
  eliminatorUsedThisQuestion = false;
  answeredThisQuestion = false;
  selectedSpell = null;
  setHint('');
  render();
}

function onAnswer(isScoreCorrect) {
  answeredThisQuestion = true;
  // Mirror quiz.js's own consumption rules for the UI-only "armed" flags —
  // armDoublePoints() is consumed on the next scored-correct answer,
  // armStreakShield() only on the next wrong one. Patronus in duel is
  // consumed explicitly by ArsenalDuel.consumePatronus() instead.
  if (feArmedThisTurn && isScoreCorrect) feArmedThisTurn = false;
  if (paArmedThisTurn && !roundInDuel && !isScoreCorrect) paArmedThisTurn = false;
  render();
}

// ─── casting ─────────────────────────────────────────────────────────────────
function castSpell(id) {
  if (id === 'ob' || id === 'lu') {
    if (eliminatorUsedThisQuestion || answeredThisQuestion) return false;
    const src = spendCharge(id);
    if (!src) return false;
    eliminatorUsedThisQuestion = true;
    eliminateWrongOptions(id === 'ob' ? 2 : 1);
    render();
    return true;
  }
  if (id === 'fe') {
    if (feArmedThisTurn) return false;
    const src = spendCharge(id);
    if (!src) return false;
    feArmedThisTurn = true;
    armDoublePoints();
    render();
    return true;
  }
  if (id === 'tt') {
    if (ttUsedThisRound || answeredThisQuestion) return false;
    const src = spendCharge(id);
    if (!src) return false;
    const ok = rerollCurrentQuestion();
    if (!ok) { refundCharge(id, src); return false; }
    ttUsedThisRound = true;
    render();
    return true;
  }
  if (id === 'pa') {
    if (paArmedThisTurn) return false;
    const src = spendCharge(id);
    if (!src) return false;
    paArmedThisTurn = true;
    if (!roundInDuel) armStreakShield();
    render();
    return true;
  }
  return false;
}

// ─── snitch reward ───────────────────────────────────────────────────────────
// main.js wires Snitch.setRewardCallback(Arsenal.onSnitchCaught) — replaces
// quiz.js's old snitchReward(). In a freeObliviate round (quick play), tops
// the round-scoped Obliviate up to a cap of 2, byte-identical wording to the
// legacy 50/50 restore. Elsewhere (journey/duel), the snitch instead grants a
// persistent Obliviate charge — Hedwig (batch 5) remains the "surprise"
// reward, this just keeps a snitch catch meaningful outside quick play too.
function onSnitchCaught() {
  if (roundHasFreeObliviate) {
    roundFree.ob = Math.min(2, (roundFree.ob || 0) + 1);
    render();
    showToast('You caught the Golden Snitch! ⚡ 50/50 restored.');
  } else {
    const granted = grant('ob', 1);
    render();
    showToast(granted > 0
      ? 'You caught the Golden Snitch! 🌀 Obliviate charge earned!'
      : 'You caught the Golden Snitch! ⚡ (Obliviate charges already full)');
  }
}

// ─── duel-only Patronus consumption ──────────────────────────────────────────
export const ArsenalDuel = {
  isPatronusArmed() { return paArmedThisTurn; },
  consumePatronus() {
    if (!paArmedThisTurn) return false;
    paArmedThisTurn = false;
    render();
    return true;
  },
};

// ─── hook composition helper ─────────────────────────────────────────────────
// Combines any number of hook fragments ({onRoundStart, onQuestionShown,
// onAnswer, adjudicate}) into one object whose functions call every
// fragment's function in turn. adjudicate is special: the first fragment to
// return a truthy verdict wins, later fragments are skipped that call.
export function mergeHooks(...fragments) {
  const merged = {};
  const plain = ['onRoundStart', 'onQuestionShown', 'onAnswer'];
  for (const key of plain) {
    const fns = fragments.filter(f => f && typeof f[key] === 'function').map(f => f[key]);
    if (!fns.length) continue;
    merged[key] = (...args) => { fns.forEach(fn => fn(...args)); };
  }
  const adjFns = fragments.filter(f => f && typeof f.adjudicate === 'function').map(f => f.adjudicate);
  if (adjFns.length) {
    merged.adjudicate = (isCorrect, ctx) => {
      for (const fn of adjFns) {
        const v = fn(isCorrect, ctx);
        if (v) return v;
      }
      return null;
    };
  }
  return merged;
}

// ─── spell bar UI ────────────────────────────────────────────────────────────
function computeState(id) {
  if (id === 'fe' && feArmedThisTurn) return { disabled: true, armed: true, reason: 'armed' };
  if (id === 'pa' && paArmedThisTurn) return { disabled: true, armed: true, reason: 'armed' };
  const count = available(id);
  if (count <= 0) return { disabled: true, armed: false, reason: 'empty' };
  if ((id === 'ob' || id === 'lu') && answeredThisQuestion) return { disabled: true, armed: false, reason: 'inapplicable' };
  if ((id === 'ob' || id === 'lu') && eliminatorUsedThisQuestion) return { disabled: true, armed: false, reason: 'used' };
  if (id === 'tt' && (ttUsedThisRound || answeredThisQuestion)) return { disabled: true, armed: false, reason: 'inapplicable' };
  return { disabled: false, armed: false, reason: 'none' };
}

function reasonToast(id, reason) {
  const s = SPELLS[id];
  switch (reason) {
    case 'empty': return `${s.glyph} ${s.name} — ${s.desc}. (No charges left.)`;
    case 'used': return 'Only one eliminator spell (Obliviate or Lumos) per question.';
    case 'inapplicable': return `${s.glyph} ${s.name} — ${s.desc}. (Can't cast right now.)`;
    case 'armed': return `${s.glyph} ${s.name} is already armed — ${s.desc}.`;
    default: return `${s.glyph} ${s.name}: ${s.desc}`;
  }
}

// Tap-to-select, tap-again-to-cast — so a spell never fires before you know
// what it does. First tap on a spell selects it and shows its effect; a second
// tap on the same spell casts. Tapping a disabled spell just explains it.
let selectedSpell = null;

function setHint(html) {
  const hint = document.getElementById('spell-hint');
  if (!hint) return;
  if (html) { hint.innerHTML = html; hint.classList.remove('hidden'); }
  else { hint.innerHTML = ''; hint.classList.add('hidden'); }
}

function onSpellClick(id, btnEl) {
  const spell = SPELLS[id];
  const state = computeState(id);
  if (state.disabled) {
    showToast(reasonToast(id, state.reason)); // always explain, even when unusable
    selectedSpell = null; setHint(''); render();
    return;
  }
  if (selectedSpell !== id) {
    // First tap: select + describe, do NOT cast.
    selectedSpell = id;
    AudioEngine.playClick();
    setHint(`<span class="spell-hint-name">${spell.glyph} ${spell.name}</span> — ${spell.desc}. <span class="spell-hint-confirm">Tap again to cast.</span>`);
    render();
    return;
  }
  // Second tap on the same spell: cast it.
  AudioEngine.playClick();
  const ok = castSpell(id);
  if (ok) {
    const rect = btnEl.getBoundingClientRect();
    FX.burst(rect.left + rect.width / 2, rect.top + rect.height / 2, { count: 18, color: spell.color });
  } else {
    showToast(id === 'tt' ? '⏳ No question left to turn back to.' : reasonToast(id, 'empty'));
  }
  selectedSpell = null;
  setHint('');
  render();
}

function render() {
  const bar = document.getElementById('spell-bar');
  if (!bar) return;
  bar.innerHTML = '';
  SPELL_ORDER.forEach(id => {
    const spell = SPELLS[id];
    const state = computeState(id);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'spell-btn' + (state.disabled ? ' spell-disabled' : '') + (state.armed ? ' spell-armed' : '') + (selectedSpell === id ? ' spell-selected' : '');
    btn.setAttribute('aria-disabled', String(state.disabled));
    btn.title = `${spell.name} — ${spell.desc}`;
    btn.innerHTML = `<span class="spell-glyph">${spell.glyph}</span><span class="spell-label">${spell.name}</span><span class="spell-count">${available(id)}</span>`;
    btn.addEventListener('click', (e) => onSpellClick(id, e.currentTarget));
    bar.appendChild(btn);
  });
}

// ─── public API ──────────────────────────────────────────────────────────────
// Wipe the persistent inventory (including the one-time starter-kit flag) so a
// full journey reset re-grants the kit and re-earns spells from scratch.
function reset() {
  inv = freshInv();
  save();
  render();
}

export const Arsenal = {
  beginRound,
  onQuestionShown,
  onAnswer,
  grant,
  grantAndToast,
  grantRandom,
  grantRoundScoped,
  grantStarterKit,
  onSnitchCaught,
  render,
  reset,
};
