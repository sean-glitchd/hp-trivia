// ─── daily.js: date-seeded Daily Prophet round, hp_daily, streak calendar ──
// Imports quiz.js primitives + questions/arsenal/cards/journey/audio/abilities.
// The round runs through composeRoundHooks (persistent inventory only, no free
// Obliviate, house: null) so the Daily Prophet draws on the same spell bar as a
// journey lesson but grants no house passive — and, importantly, resets the
// arsenal's per-round state.

import {
  startRound, switchScreen, renderResultShell, updateWelcomeScreen, getPoints,
} from './quiz.js';
import { allQuestions } from './questions.js';
import { AudioEngine } from './audio.js';
import { Arsenal } from './arsenal.js';
import { composeRoundHooks } from './abilities.js';
import { Cards } from './cards.js';
import { Journey } from './journey.js';

// ─── mulberry32 PRNG ──────────────────────────────────────────────────────────
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededShuffle(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ─── local date helpers ──────────────────────────────────────────────────────
function dateParts(d = new Date()) {
  return { y: d.getFullYear(), m: d.getMonth() + 1, day: d.getDate() };
}
function dateKey(d = new Date()) {
  const { y, m, day } = dateParts(d);
  return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
function seedFor(d = new Date()) {
  const { y, m, day } = dateParts(d);
  return y * 10000 + m * 100 + day;
}

// ─── seeded question draw: 2 easy + 2 medium + 1 hard, then a seeded final
// shuffle so difficulty order isn't always easy→medium→hard ─────────────────
export function buildDailyQuestions(d = new Date()) {
  const rng = mulberry32(seedFor(d));
  const easy = seededShuffle(allQuestions.filter(q => q.diff === 'easy'), rng).slice(0, 2);
  const medium = seededShuffle(allQuestions.filter(q => q.diff === 'medium'), rng).slice(0, 2);
  const hard = seededShuffle(allQuestions.filter(q => q.diff === 'hard'), rng).slice(0, 1);
  return seededShuffle([...easy, ...medium, ...hard], rng);
}

// ─── seeded newspaper headline (decoupled seed offset so it's independent of
// the question draw's rng consumption) ────────────────────────────────────────
const TEMPLATES = [
  '{subj} SIGHTED OVER {place}!',
  'MINISTRY DENIES {subj} RUMOURS',
  '{place} IN UPROAR AS {subj} ESCAPES',
  "'{subj}' — FACT OR FICTION?",
];
const SUBJECTS = ['DRAGON', 'GIANT', 'GRIM', 'WEREWOLF', 'FLYING FORD ANGLIA', 'CROWD OF PIXIES'];
const PLACES = ['HOGSMEADE', 'DIAGON ALLEY', 'THE MINISTRY', 'GRINGOTTS', 'LITTLE WHINGING'];
const ONE_LINERS = [
  'Ministry officials declined to comment.',
  'Witnesses report chaos throughout the morning.',
  'Our correspondent was on the scene within minutes.',
  'The Daily Prophet has more on page seven.',
  'Not everyone at the Ministry agrees on what really happened.',
  'Sources close to the story call it "highly irregular."',
];

export function buildHeadline(d = new Date()) {
  const rng = mulberry32(seedFor(d) * 31 + 7);
  const template = TEMPLATES[Math.floor(rng() * TEMPLATES.length)];
  const subject = SUBJECTS[Math.floor(rng() * SUBJECTS.length)];
  const place = PLACES[Math.floor(rng() * PLACES.length)];
  const oneLiner = ONE_LINERS[Math.floor(rng() * ONE_LINERS.length)];
  const headline = template.replace('{subj}', subject).replace('{place}', place);
  return { headline, oneLiner };
}

function formatDateLine(d) {
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

// ─── PERSISTENCE (hp_daily v1) ────────────────────────────────────────────────
const KEY = 'hp_daily';
let dState = null;

function freshDaily() {
  return { v: 1, last: '', streak: 0, best: 0, history: [] };
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) { dState = freshDaily(); return; }
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.v !== 1 || typeof parsed.last !== 'string' || !Array.isArray(parsed.history)) {
      dState = freshDaily(); return;
    }
    dState = { ...freshDaily(), ...parsed };
  } catch (e) {
    dState = freshDaily();
  }
}

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(dState)); } catch (e) { /* storage full/blocked */ }
}

load();

function hasPlayedToday() {
  return dState.last === dateKey();
}

function refreshWelcomeDot() {
  const dot = document.getElementById('daily-dot');
  if (dot) dot.classList.toggle('hidden', hasPlayedToday());
}

// ─── streak calendar (last 7 days) ───────────────────────────────────────────
function buildStreakChips() {
  const today = new Date();
  const chips = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const played = dState.history.includes(dateKey(d));
    chips.push(`<span class="prophet-chip${played ? ' chip-played' : ''}">${played ? '✓' : '·'}</span>`);
  }
  return chips.join('');
}

// ─── intro / already-played screen states ────────────────────────────────────
function renderIntro() {
  document.getElementById('prophet-date').textContent = formatDateLine(new Date());
  const { headline, oneLiner } = buildHeadline();
  const body = document.getElementById('prophet-body');
  body.innerHTML = `
    <div class="prophet-edition-tag">Special Edition</div>
    <div class="prophet-headline">${headline}</div>
    <div class="prophet-oneliner">${oneLiner}</div>
    ${dState.streak > 0 ? `<div class="prophet-streak-line">🔥 ${dState.streak}-day streak</div>` : ''}
    <button class="next-btn" id="daily-read-btn" type="button">Read today's edition</button>`;
  document.getElementById('daily-read-btn').addEventListener('click', (e) => startDailyRound(e));
}

function renderAlreadyPlayed() {
  document.getElementById('prophet-date').textContent = formatDateLine(new Date());
  const body = document.getElementById('prophet-body');
  body.innerHTML = `
    <div class="prophet-owl-msg">🦉 The owl post returns at midnight.</div>
    <div class="prophet-streak-line prophet-streak-big">🔥 ${dState.streak}-day streak</div>
    <div class="prophet-calendar">${buildStreakChips()}</div>`;
}

// ─── round ─────────────────────────────────────────────────────────────────────
function startDailyRound(ev) {
  AudioEngine.playClick();
  AudioEngine.playCast();
  const questions = buildDailyQuestions();
  const cfg = composeRoundHooks({
    questions,
    tagHTML: '<span class="quiz-diff-tag journey-tag">🗞️ The Daily Prophet</span>',
    color: '#c9a84c',
    lifelines: 0,
    fromScreen: 'screen-daily',
    onRoundEnd: dailyRoundEnd,
    primaryLabel: 'Back to the Prophet',
    primaryAction: () => {
      AudioEngine.playClick();
      renderAlreadyPlayed();
      switchScreen('screen-result', 'screen-daily');
    },
    secondaryLabel: '🏰 Home',
    secondaryAction: () => {
      AudioEngine.playClick();
      switchScreen('screen-result', 'screen-welcome', updateWelcomeScreen);
    },
  }, { freeObliviate: false, house: null });
  startRound(cfg, ev);
}

function dailyRoundEnd(score, total) {
  renderResultShell(score, total, null);
  document.getElementById('expert-unlocked-banner')?.classList.add('hidden');

  const today = dateKey();
  let rewardLine = '';
  // marked on COMPLETION only — a refresh/abandon never reaches onRoundEnd,
  // so a day can never be double-burned by re-finishing (hasPlayedToday()
  // already gates the CTA, this guard is just belt-and-braces).
  if (dState.last !== today) {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    dState.streak = (dState.last === dateKey(yesterday)) ? dState.streak + 1 : 1;
    dState.best = Math.max(dState.best, dState.streak);
    dState.last = today;
    dState.history = [today, ...dState.history.filter(d => d !== today)].slice(0, 30);
    save();
    refreshWelcomeDot();

    Journey.bankDailyPoints(getPoints());
    if (score >= 3) Arsenal.grantRandom();

    if (dState.streak === 3) { Cards.awardRoll('common'); rewardLine = ' · 🐸 a common card arrives!'; }
    else if (dState.streak === 7 || dState.streak === 14) { Cards.awardRoll('rare'); rewardLine = ' · 🐸 a rare card arrives!'; }
    else if (dState.streak === 30) { Cards.awardRoll('legendary'); rewardLine = ' · 🐸 a LEGENDARY card arrives!'; }
  }

  const banner = document.getElementById('journey-result-banner');
  if (banner) {
    banner.innerHTML = `
      <div class="journey-banner-headline${score >= 3 ? ' pass' : ' fail'}">🗞️ The Daily Prophet — ${score}/${total}</div>
      <div class="journey-banner-points">🔥 ${dState.streak}-day streak${rewardLine}</div>`;
    banner.classList.remove('hidden');
  }
}

// ─── open / init ──────────────────────────────────────────────────────────────
function open(ev) {
  AudioEngine.playClick();
  if (hasPlayedToday()) renderAlreadyPlayed();
  else renderIntro();
  switchScreen('screen-welcome', 'screen-daily');
}

export const Daily = {
  init() {
    document.getElementById('daily-back')?.addEventListener('click', () => {
      AudioEngine.playClick();
      switchScreen('screen-daily', 'screen-welcome', updateWelcomeScreen);
    });
    refreshWelcomeDot();
  },
  open,
  refreshWelcomeRow: refreshWelcomeDot,
};
