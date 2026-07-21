// ─── journey.js: 7-year Hogwarts Journey, Sorting Ceremony, House Cup ───────
// Imports quiz.js primitives + dialogue/audio/fx. quiz.js knows nothing about
// this module — journey rounds run through startRound(config) hooks only.

import {
  startRound, renderResultShell, switchScreen, getPoints, updateWelcomeScreen,
  setJourneyHouse, applyJourneyHouse, getJourneyHouse, showToast, unlockExpert,
} from './quiz.js';
import { allQuestions, HOUSES } from './questions.js';
import * as Dialogue from './dialogue.js';
import { AudioEngine } from './audio.js';
import { FX } from './fx.js';
import { Duel } from './duel.js';
import { Arsenal } from './arsenal.js';
import { composeRoundHooks } from './abilities.js';
import { Gesture } from './gesture.js';
import { Cards } from './cards.js';
import { Guide } from './guide.js';

// Fired once, right after a first-time Sorting completes (see revealHouse's
// Continue handler below) — the exact moment nothing is covering the screen
// and the player has a house worth keeping. Set by main.js so this module
// never imports sync/cloud directly (same outward-callback shape as
// Nav.setHomeCallback / Hedwig.setLetterCallback).
let onSortedCallback = null;

// Once-per-session set of years that have already run their typing challenge,
// so the "Cast the spell!" interstitial fires at most once per year per visit.
const typingDoneThisSession = new Set();
// Year → incantation for that year's typing challenge (Q5→Q6 of a lesson).
const YEAR_INCANT = { 1: 'Wingardium Leviosa', 2: 'Expelliarmus', 3: 'Expecto Patronum', 4: 'Accio', 5: 'Stupefy', 6: 'Levicorpus', 7: 'Protego' };
// Year → fixed spell charge granted the first time its exam is passed.
const YEAR_PASS_GRANT = { 1: ['ob'], 2: ['lu'], 3: ['tt'], 4: ['fe'], 5: ['pa'], 6: ['fe', 'lu'] };

// ─── YEARS CONFIG ────────────────────────────────────────────────────────────
// blend: questions per difficulty for one 10-q lesson. exam = blend ×2 (20 q).
export const YEARS = [
  {
    name: 'The Philosopher\'s Stone', numeral: 'I',
    flavor: 'The letters have arrived. A wall at King\'s Cross is not what it seems.',
    blend: { easy: 8, medium: 2 },
    lessons: [
      { name: 'The Hogwarts Express', icon: '🚂', kw: /express|train|platform|king's cross|station|trolley/i },
      { name: 'First Charms', icon: '✨', kw: /spell|charm|wand|lumos|wingardium|leviosa|incantation|alohomora|expelliarmus/i },
      { name: 'Potions in the Dungeons', icon: '🧪', kw: /potion|brew|felix|polyjuice|bezoar|amortentia|veritaserum|cauldron|snape/i },
      { name: 'Flying Lessons', icon: '🧹', kw: /quidditch|seeker|snitch|quaffle|bludger|broom|keeper|chaser|beater|flying|nimbus|firebolt|hooch/i },
      { name: 'The Forbidden Forest', icon: '🌲', kw: /forest|centaur|unicorn|creature|spider|acromantula|hagrid|thestral|fluffy/i },
    ],
  },
  {
    name: 'The Chamber of Secrets', numeral: 'II',
    flavor: 'A voice in the walls that only you can hear. Enemies of the heir, beware.',
    blend: { easy: 6, medium: 4 },
    lessons: [
      { name: 'Whispers in the Walls', icon: '🧱', kw: /chamber|basilisk|parseltongue|petrif|myrtle|heir/i },
      { name: 'Herbology & Mandrakes', icon: '🌱', kw: /herbolog|plant|mandrake|sprout|gillyweed|devil's snare|greenhouse/i },
      { name: 'Duelling Club', icon: '⚔️', kw: /duel|expelliarmus|disarm|curse|hex|jinx|serpensortia|rictusempra|lockhart/i },
      { name: 'Polyjuice Preparations', icon: '⚗️', kw: /polyjuice|potion|brew|cauldron|bathroom|disguise/i },
      { name: 'The Chamber Below', icon: '🐍', kw: /chamber|basilisk|riddle|slytherin|diary|fawkes|sword/i },
    ],
  },
  {
    name: 'The Prisoner of Azkaban', numeral: 'III',
    flavor: 'A murderer has escaped, the Dementors are circling — and time itself can turn.',
    blend: { easy: 3, medium: 5, hard: 2 },
    lessons: [
      { name: 'Dementors on the Train', icon: '🌫️', kw: /dementor|azkaban|patronus|boggart|lupin|chocolate/i },
      { name: 'Divination', icon: '☕', kw: /divination|trelawney|prophecy|crystal|tea|omen|centaur|firenze|mars/i },
      { name: 'Care of Magical Creatures', icon: '🦅', kw: /hippogriff|buckbeak|dragon|owl|toad|cat|rat|creature|thestral|kneazle|acromantula|basilisk/i },
      { name: 'Hogsmeade Weekend', icon: '🏘️', kw: /hogsmeade|honeydukes|butterbeer|three broomsticks|hog's head|zonko|shrieking|rosmerta/i },
      { name: 'The Time-Turner', icon: '⏳', kw: /time-turner|time|sirius|pettigrew|marauder|animagus|wormtail|padfoot|scabbers/i },
    ],
  },
  {
    name: 'The Goblet of Fire', numeral: 'IV',
    flavor: 'Three schools, three tasks, one cup — and a name that should not have come out.',
    blend: { easy: 1, medium: 5, hard: 4 },
    lessons: [
      { name: 'The Quidditch World Cup', icon: '🏆', kw: /quidditch|world cup|krum|ireland|bulgaria|seeker|snitch|quaffle|bludger/i },
      { name: 'The Goblet of Fire', icon: '🔥', kw: /goblet|triwizard|champion|beauxbatons|durmstrang|tournament|cedric/i },
      { name: 'Dragons & First Task', icon: '🐉', kw: /dragon|horntail|task|egg|gillyweed|maze|sphinx/i },
      { name: 'The Yule Ball', icon: '💃', kw: /yule|ball|dance|dress|sleekeazy|parvati|krum/i },
      { name: 'The Graveyard', icon: '🪦', kw: /graveyard|voldemort|wormtail|cedric|priori|riddle|resurrection|dark mark|morsmordre/i },
    ],
  },
  {
    name: 'The Order of the Phoenix', numeral: 'V',
    flavor: 'The Ministry denies everything. An army rises in a room that isn\'t there.',
    blend: { medium: 4, hard: 5, expert: 1 },
    examLabel: 'O.W.L. Examinations',
    lessons: [
      { name: 'Dumbledore\'s Army', icon: '⚡', kw: /dumbledore's army|room of requirement|patronus|hog's head|defence|d\.a\./i },
      { name: 'Umbridge\'s Regime', icon: '📜', kw: /umbridge|ministry|decree|inquisitor|detention|fudge|quill/i },
      { name: 'Occlumency', icon: '🧠', kw: /occlumency|legilimen|mind|snape|memor|pensieve/i },
      { name: 'The Department of Mysteries', icon: '🔮', kw: /prophecy|department of mysteries|ministry|bellatrix|sirius|veil/i },
      { name: 'Career Advice', icon: '📋', kw: /o\.w\.l|exam|grade|career|auror|newt/i },
    ],
  },
  {
    name: 'The Half-Blood Prince', numeral: 'VI',
    flavor: 'An old textbook full of secrets, and memories that must be gathered before it is too late.',
    blend: { medium: 2, hard: 5, expert: 3 },
    examLabel: 'N.E.W.T. Examinations',
    lessons: [
      { name: 'The Half-Blood Prince', icon: '📖', kw: /half-blood|prince|sectumsempra|textbook|snape|levicorpus/i },
      { name: 'Slug Club', icon: '🎩', kw: /slughorn|slug|hepzibah|memory|riddle|collector/i },
      { name: 'Horcrux Memories', icon: '💍', kw: /horcrux|diary|locket|ring|diadem|nagini|gaunt|soul|cup/i },
      { name: 'Felix Felicis', icon: '🧪', kw: /felix|potion|brew|amortentia|veritaserum|bezoar|draught|poison/i },
      { name: 'The Astronomy Tower', icon: '🗼', kw: /tower|astronomy|dumbledore|draco|malfoy|cave|locket|unbreakable/i },
    ],
  },
  {
    name: 'The Deathly Hallows', numeral: 'VII',
    flavor: 'No more lessons, no more feasts. Three friends, a tent, and seven pieces of a soul.',
    blend: { medium: 1, hard: 4, expert: 5 },
    examLabel: 'The Final Battle',
    lessons: [
      { name: 'On the Run', icon: '🏕️', kw: /hallows|horcrux|taboo|snatcher|malfoy manor|godric's hollow|deathly|locket|tent/i },
      { name: 'Gringotts Break-In', icon: '🐉', kw: /gringotts|vault|goblin|dragon|lestrange|griphook/i },
      { name: 'The Battle Begins', icon: '⚔️', kw: /battle|neville|molly|bellatrix|voldemort|elder wand|hogwarts/i },
      { name: 'The Room of Requirement', icon: '🚪', kw: /room of requirement|diadem|fiendfyre|ravenclaw|aberforth/i },
    ],
  },
];

const LESSON_PASS = 6;
const EXAM_PASS = 14;
const HOUSE_EMOJI = { gryffindor: '🦁', slytherin: '🐍', ravenclaw: '🦅', hufflepuff: '🦡' };
// Keep in sync with the --accent values in css/base.css — Gryffindor is
// scarlet, not gold, so it can't be mistaken for Hufflepuff in the House Cup.
const HOUSE_COLOR = { gryffindor: '#c23b3b', slytherin: '#2ea86e', ravenclaw: '#6c9fd8', hufflepuff: '#e3b53d' };

// ─── PERSISTENCE (hp_journey v2) ─────────────────────────────────────────────
let state = null;

function freshState() {
  const lessons = {};
  YEARS.forEach((y, i) => { lessons['y' + (i + 1)] = y.lessons.map(() => 0); });
  return {
    v: 2, year: 1, lessons,
    examBest: YEARS.map(() => 0),
    cup: { player: 0, rivals: {} },
    xp: 0, complete: false, cupWon: null, challenge: false,
  };
}

function load() {
  try {
    const raw = localStorage.getItem('hp_journey');
    if (!raw) { state = freshState(); return; }
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.v !== 2 || !parsed.lessons || !Array.isArray(parsed.examBest)) {
      state = freshState(); return;
    }
    state = { ...freshState(), ...parsed, cup: { player: 0, rivals: {}, ...(parsed.cup || {}) } };
  } catch (e) {
    state = freshState();
  }
}

function save() {
  try { localStorage.setItem('hp_journey', JSON.stringify(state)); } catch (e) { /* storage full/blocked */ }
}

function hasSavedJourney() {
  return !!localStorage.getItem('hp_journey');
}

// ─── QUESTION SELECTION (per-year used-set) ──────────────────────────────────
let usedYear = 0;
const usedSet = new Set();

function ensureUsedYear(yearNum) {
  if (usedYear !== yearNum) { usedYear = yearNum; usedSet.clear(); }
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Draw per-difficulty counts. Preference tiers: unused+keyword-matching →
// unused → any (repeats allowed only when the year has exhausted a pool).
function drawQuestions(blend, kw, multiplier = 1) {
  const picked = [];
  for (const [diff, count] of Object.entries(blend)) {
    const n = count * multiplier;
    const pool = allQuestions.filter(q => q.diff === diff);
    const unused = pool.filter(q => !usedSet.has(q.q));
    const tiers = [
      kw ? shuffle(unused.filter(q => kw.test(q.q) || kw.test(q.fact))) : [],
      shuffle(unused),
      shuffle(pool),
    ];
    const chosen = [];
    for (const tier of tiers) {
      for (const q of tier) {
        if (chosen.length >= n) break;
        if (!chosen.includes(q)) chosen.push(q);
      }
      if (chosen.length >= n) break;
    }
    chosen.forEach(q => usedSet.add(q.q));
    picked.push(...chosen);
  }
  return shuffle(picked);
}

function drawReserve(blend, count = 3) {
  const diffs = Object.keys(blend);
  const pool = allQuestions.filter(q => diffs.includes(q.diff) && !usedSet.has(q.q));
  const reserve = shuffle(pool).slice(0, count);
  reserve.forEach(q => usedSet.add(q.q));
  return reserve;
}

// ─── HOUSE CUP ───────────────────────────────────────────────────────────────
function bankCup(pts) {
  const player = getJourneyHouse();
  state.cup.player += pts;
  const arch = player === 'slytherin' ? 'gryffindor' : 'slytherin';
  for (const h of Object.keys(HOUSES)) {
    if (h === player) continue;
    let gain = Math.round(pts * (0.65 + Math.random() * 0.4));
    if (h === arch) gain += 1;
    let total = (state.cup.rivals[h] || 0) + gain;
    // rubber-band: rivals stay within ±10 of the player, so the race is
    // always alive going into the last year.
    if (total > state.cup.player + 10) total = state.cup.player + 10;
    if (total < state.cup.player - 10) total = Math.max(0, state.cup.player - 10);
    state.cup.rivals[h] = Math.max(0, total);
  }
}

function cupStandings() {
  const player = getJourneyHouse();
  const rows = [];
  if (player) {
    rows.push({ id: player, label: `${HOUSE_EMOJI[player]} ${HOUSES[player].name}`, pts: state.cup.player, color: HOUSE_COLOR[player], isPlayer: true });
  } else {
    rows.push({ id: 'you', label: '★ You', pts: state.cup.player, color: '#c9a84c', isPlayer: true });
  }
  for (const h of Object.keys(HOUSES)) {
    if (h === player) continue;
    rows.push({ id: h, label: `${HOUSE_EMOJI[h]} ${HOUSES[h].name}`, pts: state.cup.rivals[h] || 0, color: HOUSE_COLOR[h], isPlayer: false });
  }
  rows.sort((a, b) => b.pts - a.pts);
  return rows;
}

// ─── SCREEN NAV HELPERS ──────────────────────────────────────────────────────
function goWelcome(fromId) {
  Dialogue.cancelSpeech();
  Dialogue.dismissCard();
  switchScreen(fromId, 'screen-welcome', () => { updateWelcomeScreen(); refreshCTA(); });
}

// ─── MAP SCREEN ──────────────────────────────────────────────────────────────
const NODE_POS = [
  { x: 22, y: 91 }, { x: 68, y: 79 }, { x: 28, y: 66 }, { x: 72, y: 53 },
  { x: 32, y: 40 }, { x: 66, y: 26 }, { x: 47, y: 10 },
];

function yearStatus(i) { // i = 0-based
  const yearNum = i + 1;
  if (state.complete || state.examBest[i] >= EXAM_PASS) return 'done';
  if (yearNum === state.year) return 'current';
  if (yearNum < state.year) return 'current'; // shouldn't happen, safe fallback
  return 'locked';
}

function renderMap() {
  Dialogue.cancelSpeech();
  // header
  const name = Dialogue.getName();
  const line = document.getElementById('journey-header-line');
  line.textContent = `${name} · Year ${Math.min(state.year, 7)} · ${state.xp.toLocaleString()} XP`;

  // winding path svg
  const svg = document.getElementById('journey-path-svg');
  let d = `M ${NODE_POS[0].x} ${NODE_POS[0].y}`;
  for (let i = 1; i < NODE_POS.length; i++) {
    const a = NODE_POS[i - 1], b = NODE_POS[i];
    const my = (a.y + b.y) / 2;
    d += ` C ${a.x} ${my}, ${b.x} ${my}, ${b.x} ${b.y}`;
  }
  svg.innerHTML = `<path d="${d}" fill="none" stroke="rgba(201,168,76,0.45)" stroke-width="1.1" stroke-dasharray="2.6 2.2" stroke-linecap="round"/>`;

  // nodes
  const nodesEl = document.getElementById('journey-nodes');
  nodesEl.innerHTML = '';
  YEARS.forEach((y, i) => {
    const st = yearStatus(i);
    const btn = document.createElement('button');
    btn.className = `map-node map-node-${st}`;
    btn.style.left = NODE_POS[i].x + '%';
    btn.style.top = NODE_POS[i].y + '%';
    btn.innerHTML = st === 'locked'
      ? `<span class="map-node-numeral">🔒</span>`
      : st === 'done'
        ? `<span class="map-node-numeral">${y.numeral}</span><span class="map-node-check">✓</span>`
        : `<span class="map-node-numeral">${y.numeral}</span>`;
    btn.setAttribute('aria-label', `Year ${i + 1}: ${y.name}${st === 'locked' ? ' (locked)' : ''}`);
    if (st !== 'locked') {
      btn.addEventListener('click', () => {
        AudioEngine.playClick();
        openYear(i + 1, 'screen-journey');
      });
    } else {
      btn.disabled = true;
    }
    nodesEl.appendChild(btn);
  });

  // house cup bars
  const rows = cupStandings();
  const max = Math.max(1, ...rows.map(r => r.pts));
  document.getElementById('cup-bars').innerHTML = rows.map(r => `
    <div class="cup-row${r.isPlayer ? ' cup-row-player' : ''}">
      <span class="cup-label">${r.label}</span>
      <span class="cup-track"><span class="cup-fill" style="width:${Math.round((r.pts / max) * 100)}%;background:${r.color}"></span></span>
      <span class="cup-pts">${r.pts}</span>
    </div>`).join('');

  // CTA
  const cta = document.getElementById('journey-cta');
  if (state.complete) {
    cta.textContent = '🏆 Revisit the Great Feast';
  } else {
    cta.textContent = `Continue — Year ${state.year}: ${YEARS[state.year - 1].name}`;
  }

  // Dumbledore's Challenge (endgame, unlocked once the journey is complete)
  const challengeBtn = document.getElementById('dumbledore-challenge-btn');
  if (challengeBtn) {
    challengeBtn.classList.toggle('hidden', !state.complete);
    challengeBtn.textContent = state.challenge ? "🦉 Dumbledore's Challenge ✓" : "🦉 Dumbledore's Challenge";
  }
}

function mapCTAClick() {
  AudioEngine.playClick();
  if (state.complete) {
    renderCeremony();
    switchScreen('screen-journey', 'screen-ceremony');
  } else {
    openYear(state.year, 'screen-journey');
  }
}

// two-tap reset
let resetArmed = false;
let resetTimer = null;
function resetClick() {
  const btn = document.getElementById('journey-reset');
  if (!resetArmed) {
    resetArmed = true;
    btn.textContent = 'Tap again to erase all progress';
    btn.classList.add('armed');
    clearTimeout(resetTimer);
    resetTimer = setTimeout(() => {
      resetArmed = false;
      btn.textContent = 'Reset journey';
      btn.classList.remove('armed');
    }, 3500);
    return;
  }
  clearTimeout(resetTimer);
  resetArmed = false;
  btn.textContent = 'Reset journey';
  btn.classList.remove('armed');
  resetProgress();
  switchScreen('screen-journey', 'screen-welcome', updateWelcomeScreen);
}

// Full fresh start: wipe journey progress, identity, the walkthrough-seen
// flags, and journey-earned spells. KEEP the Frog Card collection, Daily
// streak, and sound prefs (and the quick-play Expert unlock). Clears both
// storage and the modules' in-memory caches so it takes effect immediately.
// Exported so the settings panel can reuse it rather than duplicating the list.
export function resetProgress() {
  ['hp_journey', 'hp_name', 'hp_house', 'hp_seen', 'hp_arsenal'].forEach(k => localStorage.removeItem(k));
  state = freshState();
  usedSet.clear(); usedYear = 0;
  setJourneyHouse(null); // clears data-house + accent (via applyJourneyHouse)
  Guide.resetSeen();    // Hagrid's walkthrough replays this session
  Arsenal.reset();      // starter kit re-grants on the next journey entry
  refreshCTA();
}

// name edit (inline swap)
function editName() {
  const wrap = document.getElementById('journey-header');
  if (wrap.querySelector('.name-edit-input')) return;
  const line = document.getElementById('journey-header-line');
  const editBtn = document.getElementById('journey-name-edit');
  line.classList.add('hidden');
  editBtn.classList.add('hidden');
  const input = document.createElement('input');
  input.className = 'name-edit-input';
  input.maxLength = 20;
  input.value = Dialogue.getName() === 'young wizard' ? '' : Dialogue.getName();
  input.placeholder = 'Your name…';
  const saveBtn = document.createElement('button');
  saveBtn.className = 'link-btn';
  saveBtn.textContent = 'Save';
  const done = () => {
    Dialogue.setName(input.value);
    input.remove(); saveBtn.remove();
    line.classList.remove('hidden');
    editBtn.classList.remove('hidden');
    renderMap();
    refreshCTA();
  };
  saveBtn.addEventListener('click', done);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(); });
  wrap.appendChild(input);
  wrap.appendChild(saveBtn);
  input.focus();
}

// ─── YEAR (CURRICULUM) SCREEN ────────────────────────────────────────────────
let viewYear = 1; // year currently open in #screen-year

function openYear(yearNum, fromId) {
  viewYear = yearNum;
  ensureUsedYear(yearNum);
  renderYear();
  switchScreen(fromId, 'screen-year');
}

function yearLessonBests(yearNum) {
  return state.lessons['y' + yearNum] || [];
}

function allLessonsPassed(yearNum) {
  return yearLessonBests(yearNum).every(b => b >= LESSON_PASS);
}

function examLabel(yearNum) {
  return YEARS[yearNum - 1].examLabel || `Year ${yearNum} Final Exam`;
}

function renderYear() {
  const y = YEARS[viewYear - 1];
  const bests = yearLessonBests(viewYear);
  document.getElementById('year-title').innerHTML =
    `<span class="year-title-numeral">Year ${y.numeral}</span><span class="year-title-name">${y.name}</span>`;
  document.getElementById('year-flavor').textContent = y.flavor;

  const passedCount = bests.filter(b => b >= LESSON_PASS).length;
  document.getElementById('year-progress').textContent =
    `${passedCount} of ${y.lessons.length} lessons complete`;

  const list = document.getElementById('lesson-list');
  list.innerHTML = '';
  y.lessons.forEach((lesson, i) => {
    const best = bests[i] || 0;
    const passed = best >= LESSON_PASS;
    const btn = document.createElement('button');
    btn.className = 'lesson-item' + (passed ? ' lesson-passed' : '');
    btn.innerHTML = `
      <span class="lesson-icon">${lesson.icon}</span>
      <span class="lesson-name">${lesson.name}</span>
      <span class="lesson-chips">
        ${best > 0 ? `<span class="lesson-best">Best ${best}/10</span>` : '<span class="lesson-best lesson-best-empty">—</span>'}
        ${passed ? '<span class="lesson-check">✓</span>' : ''}
      </span>`;
    btn.addEventListener('click', () => { AudioEngine.playClick(); showIntro('lesson', viewYear, i); });
    list.appendChild(btn);
  });

  // exam node — wax-sealed scroll, locked until all lessons passed
  // (Year 7's is the duel: HP-based, so its icon/sub-text/chip differ)
  const unlocked = allLessonsPassed(viewYear);
  const examBest = state.examBest[viewYear - 1] || 0;
  const examPassed = examBest >= EXAM_PASS;
  const isY7 = viewYear === 7;
  const exam = document.createElement('button');
  exam.className = 'lesson-item exam-item' + (unlocked ? '' : ' exam-locked') + (examPassed ? ' lesson-passed' : '');
  const examSub = !unlocked
    ? 'Complete every lesson to break the seal'
    : (isY7 ? 'Five lives each · a duel to the death' : '20 questions · pass 14');
  exam.innerHTML = `
    <span class="lesson-icon">${!unlocked ? '🔏' : (isY7 ? '⚔️' : '📜')}</span>
    <span class="lesson-name">${examLabel(viewYear)}<span class="exam-sub">${examSub}</span></span>
    <span class="lesson-chips">
      ${!isY7 && examBest > 0 ? `<span class="lesson-best">Best ${examBest}/20</span>` : ''}
      ${examPassed ? '<span class="lesson-check">✓</span>' : ''}
    </span>`;
  if (unlocked) {
    exam.addEventListener('click', () => { AudioEngine.playClick(); showIntro('exam', viewYear, -1); });
  } else {
    exam.disabled = true;
  }
  list.appendChild(exam);
}

// ─── YEAR INTRO SCREEN (before each lesson/exam) ─────────────────────────────
let pending = null; // { kind:'lesson'|'exam', year, lesson }

function showIntro(kind, yearNum, lessonIdx, fromId = 'screen-year') {
  pending = { kind, year: yearNum, lesson: lessonIdx };
  const y = YEARS[yearNum - 1];
  const isDuel = kind === 'exam' && yearNum === 7;
  document.getElementById('screen-year-intro').classList.toggle('intro-duel', isDuel);
  document.getElementById('intro-numeral').textContent = y.numeral;
  document.getElementById('intro-year-name').textContent = `Year ${yearNum} — ${y.name}`;
  document.getElementById('intro-lesson-name').textContent =
    kind === 'exam' ? examLabel(yearNum) : `${y.lessons[lessonIdx].icon} ${y.lessons[lessonIdx].name}`;
  document.getElementById('intro-flavor').textContent = isDuel
    ? 'Five lives each. Answer true, and your spell strikes home — answer false, and his curse finds you.'
    : y.flavor;
  document.getElementById('intro-chips').innerHTML = y.lessons
    .map((l, i) => {
      const passed = (yearLessonBests(yearNum)[i] || 0) >= LESSON_PASS;
      const isCurrent = kind === 'lesson' && i === lessonIdx;
      return `<span class="intro-chip${passed ? ' chip-passed' : ''}${isCurrent ? ' chip-current' : ''}">${l.icon} ${l.name}</span>`;
    }).join('');
  document.getElementById('intro-begin').textContent =
    kind === 'exam' ? (isDuel ? 'Face Him' : 'Break the Seal') : 'Begin the Lesson';
  switchScreen(fromId, 'screen-year-intro', () => {
    // First time the player reaches an exam, McGonagall explains the gate.
    if (kind === 'exam' && !isDuel) Guide.playBeatOnce('first-exam');
  });
}

function introBack() {
  AudioEngine.playClick();
  viewYear = pending ? pending.year : viewYear;
  renderYear();
  switchScreen('screen-year-intro', 'screen-year');
}

// ─── JOURNEY ROUNDS ──────────────────────────────────────────────────────────
let jStreak = 0;
let firstWrongSaid = false;
let activeConfig = null;

function beginPending(ev) {
  if (!pending) return;
  AudioEngine.playClick();
  const { kind, year, lesson } = pending;

  if (kind === 'exam' && year === 7) {
    // Year 7's "exam" is the Voldemort duel — a wholly different mode
    // (HP-based, not score/total), so it runs through duel.js's own
    // startRound() config instead of the drawQuestions()/exam path below.
    // duel.js hands control back via this callback once the fight ends.
    ensureUsedYear(year);
    Duel.start((result) => duelComplete(result), ev);
    return;
  }

  AudioEngine.playCast();
  const y = YEARS[year - 1];
  ensureUsedYear(year);

  let questions, tagLabel;
  if (kind === 'exam') {
    questions = drawQuestions(y.blend, null, 2); // 20 q at the year's blend
    tagLabel = `Year ${year} · ${examLabel(year)}`;
  } else {
    const l = y.lessons[lesson];
    questions = drawQuestions(y.blend, l.kw, 1);
    tagLabel = `Year ${year} · ${l.name}`;
  }
  const reserve = drawReserve(y.blend);

  // composeRoundHooks (freeObliviate:false) layers the arsenal spell bar and
  // the chosen house's passive onto the round; journey rounds spend from the
  // persistent inventory only (no free Obliviate — that's quick play's).
  activeConfig = composeRoundHooks({
    questions,
    reserveQuestions: reserve,
    tagHTML: `<span class="quiz-diff-tag journey-tag">${tagLabel}</span>`,
    color: '#c9a84c',
    lifelines: 0,
    fromScreen: 'screen-year-intro',
    onRoundStart: () => {
      Dialogue.resetRound();
      jStreak = 0;
      firstWrongSaid = false;
      if (kind === 'exam' && year === 5) Dialogue.say('owl-intro');
    },
    onQuestionShown: () => Dialogue.noteQuestionShown(),
    onAnswer: (correct) => {
      if (correct) {
        jStreak++;
        if (jStreak === 3) Dialogue.quip('streak-3');
        else if (jStreak === 5) Dialogue.quip('streak-5');
        else if (jStreak === 8) Dialogue.quip('streak-8');
      } else {
        jStreak = 0;
        if (!firstWrongSaid) {
          firstWrongSaid = true;
          Dialogue.quip('first-wrong');
        }
      }
    },
    // Spell-casting challenge: once per year per session, at the Q5→Q6 boundary
    // of a lesson (not exams). Trace the wand movement; success grants a Lumos
    // charge; skip is free, no penalty.
    getInterstitial: (nextIndex) => {
      if (kind !== 'lesson' || nextIndex !== 5) return null;
      if (typingDoneThisSession.has(year)) return null;
      typingDoneThisSession.add(year);
      const incantation = YEAR_INCANT[year] || 'Lumos';
      return (done) => Gesture.run({
        incantation,
        onDone: ({ success }) => {
          if (success) {
            const g = Arsenal.grant('lu', 1);
            showToast(g > 0 ? '🕯️ A Lumos charge for a spell well cast!' : '🕯️ Beautifully cast — but your Lumos charges are full.');
            Arsenal.render();
          }
          done();
        },
      });
    },
    onAbandon: () => {
      Dialogue.cancelSpeech();
      Dialogue.dismissCard();
    },
    onRoundEnd: (score, total) => journeyRoundEnd(kind, year, lesson, score, total),
    // labels/actions are finalized in journeyRoundEnd once pass/fail is known
    primaryLabel: 'Continue',
    secondaryLabel: 'Back to the Year',
  }, { freeObliviate: false, house: getJourneyHouse() });
  startRound(activeConfig, ev);
}

function setResultButtons(primaryLabel, primaryAction, secondaryLabel, secondaryAction) {
  const btns = document.querySelectorAll('.result-btns .play-again-btn');
  if (btns[0]) btns[0].textContent = primaryLabel;
  if (btns[1]) btns[1].textContent = secondaryLabel;
  activeConfig.primaryAction = primaryAction;
  activeConfig.secondaryAction = secondaryAction;
}

// Spell-charge rewards for finishing a lesson/exam. Fixed year-pass grants and
// exam grade bonuses fire only on the FIRST pass (prevBest below the threshold);
// a strong replay of an already-passed lesson (8+/10) yields a single Lumos, the
// capped grind path. All grants respect the per-spell cap inside Arsenal.
function grantRoundRewards(kind, year, score, total, pass, prevBest) {
  if (kind === 'exam') {
    if (pass && prevBest < EXAM_PASS) {
      (YEAR_PASS_GRANT[year] || []).forEach(id => Arsenal.grant(id, 1));
      const pctO = score >= total;              // Outstanding — a perfect exam
      const pctE = score >= Math.ceil(total * 0.8); // Exceeds Expectations
      if (pctO) { Arsenal.grantRandom(); Arsenal.grantRandom(); Cards.awardRoll('rare'); }
      else if (pctE) { Arsenal.grantRandom(); }
      showToast('🎁 Your studies are rewarded — new spell charges earned!');
    }
  } else {
    // Perfect lesson (10/10) → a Chocolate Frog card (rare floor).
    if (pass && score === total) Cards.awardRoll('rare');
    if (pass && prevBest >= LESSON_PASS && score >= 8) {
      const g = Arsenal.grant('lu', 1);
      if (g > 0) showToast('🕯️ Diligent revision earns a Lumos charge.');
    }
  }
  Arsenal.render();
}

function journeyRoundEnd(kind, year, lesson, score, total) {
  Dialogue.dismissCard();
  const passNeeded = kind === 'exam' ? EXAM_PASS : LESSON_PASS;
  const pass = score >= passNeeded;

  // record best (capture the prior best first so rewards fire only on the
  // FIRST time a lesson/exam is passed, not on every replay — no farming)
  let prevBest;
  if (kind === 'exam') {
    prevBest = state.examBest[year - 1] || 0;
    state.examBest[year - 1] = Math.max(prevBest, score);
  } else {
    const arr = state.lessons['y' + year];
    prevBest = arr[lesson] || 0;
    arr[lesson] = Math.max(prevBest, score);
  }

  // bank points
  const pts = getPoints();
  bankCup(pts);
  state.xp += pts;

  // ── spell rewards ──
  grantRoundRewards(kind, year, score, total, pass, prevBest);

  // exam pass side effects
  let completedJourney = false;
  if (kind === 'exam' && pass) {
    if (year < 7) {
      state.year = Math.max(state.year, year + 1);
    } else if (!state.complete) {
      state.complete = true;
      completedJourney = true;
      const rows = cupStandings();
      state.cupWon = rows.length > 0 && rows[0].isPlayer;
      unlockExpert();
    }
  }
  save();

  // result presentation: shared shell, then journey-specific grade seal + banner
  const player = getJourneyHouse();
  renderResultShell(score, total, player);
  Dialogue.renderGradeSeal(score, total);
  document.getElementById('expert-unlocked-banner').classList.add('hidden');

  const houseName = player ? HOUSES[player].name : 'your tally';
  const banner = document.getElementById('journey-result-banner');
  const headline = pass
    ? (kind === 'exam' ? (year === 7 ? '⚔️ The battle is won!' : `📜 ${examLabel(year)} — passed!`) : '✨ Lesson passed!')
    : (kind === 'exam' ? `The examiners shake their heads — ${passNeeded}/${total} needed.` : `Not this time — ${passNeeded}/${total} needed to pass.`);
  banner.innerHTML = `
    <div class="journey-banner-headline${pass ? ' pass' : ' fail'}">${headline}</div>
    <div class="journey-banner-points">+${pts} point${pts === 1 ? '' : 's'} to ${houseName}</div>`;
  banner.classList.remove('hidden');

  if (kind === 'exam') Dialogue.say(pass ? 'year-pass' : 'year-fail');

  // buttons
  if (completedJourney) {
    setResultButtons(
      '🏆 To the Great Feast', () => {
        AudioEngine.playClick();
        renderCeremony();
        switchScreen('screen-result', 'screen-ceremony');
      },
      'Back to the Map', () => backToMap('screen-result'),
    );
  } else if (pass) {
    setResultButtons(
      kind === 'exam' ? '→ To the Map' : 'Continue',
      () => {
        AudioEngine.playClick();
        Dialogue.cancelSpeech();
        if (kind === 'exam') backToMap('screen-result');
        else { viewYear = year; renderYear(); switchScreen('screen-result', 'screen-year'); }
      },
      'Back to the Map', () => backToMap('screen-result'),
    );
  } else {
    setResultButtons(
      '↩ Try Again', () => {
        Dialogue.cancelSpeech();
        pending = { kind, year, lesson };
        showIntro(kind, year, lesson, 'screen-result');
      },
      'Back to the Year', () => {
        AudioEngine.playClick();
        Dialogue.cancelSpeech();
        viewYear = year; renderYear();
        switchScreen('screen-result', 'screen-year');
      },
    );
  }
}

// duel.js's onComplete callback: { victory, points, action }. duel.js has
// already presented its own victory/defeat result screen (dissolve/confetti
// or the red vignette) — this just persists the Year 7 completion side
// effects (cup/xp/expert-unlock), mirroring journeyRoundEnd's kind==='exam'
// branch, and routes to the ceremony or back to the map.
function duelComplete({ victory, points, action }) {
  bankCup(points);
  state.xp += points;
  if (victory) {
    state.examBest[6] = Math.max(state.examBest[6] || 0, EXAM_PASS);
    Cards.award('elder-wand'); // spoils of defeating the Dark Lord
    if (!state.complete) {
      state.complete = true;
      const rows = cupStandings();
      state.cupWon = rows.length > 0 && rows[0].isPlayer;
      if (state.cupWon) Cards.award('harry'); // House Cup won on completion
      unlockExpert();
    }
  }
  save();
  if (victory && action === 'continue') {
    renderCeremony();
    switchScreen('screen-result', 'screen-ceremony');
  } else {
    renderMap();
    switchScreen('screen-result', 'screen-journey');
  }
}

// ─── Dumbledore's Challenge (endgame) ────────────────────────────────────
// Unlocked once the journey is complete: 15 expert questions, no lifelines,
// pass >=13 -> Grand Sorcerer title (welcome CTA + hp_journey.challenge).
function startChallenge(ev) {
  AudioEngine.playClick();
  AudioEngine.playCast();
  const pool = shuffle(allQuestions.filter(q => q.diff === 'expert'));
  const cfg = {
    questions: pool.slice(0, 15),
    tagHTML: `<span class="quiz-diff-tag journey-tag">🦉 Dumbledore's Challenge</span>`,
    color: '#c9a84c',
    lifelines: 0,
    fromScreen: 'screen-journey',
    primaryLabel: '↩ Retry',
    secondaryLabel: '🗺 Back to the Map',
  };
  cfg.onRoundEnd = (score, total) => challengeRoundEnd(score, total);
  cfg.primaryAction = () => startChallenge();
  cfg.secondaryAction = () => backToMap('screen-result');
  startRound(cfg, ev);
}

function challengeRoundEnd(score) {
  renderResultShell(score, 15, getJourneyHouse());
  document.getElementById('journey-result-banner')?.classList.add('hidden');
  document.getElementById('expert-unlocked-banner')?.classList.add('hidden');
  if (score >= 13 && !state.challenge) {
    state.challenge = true;
    save();
    showToast("🦉 Grand Sorcerer! Dumbledore's Challenge complete.");
    refreshCTA();
  }
}

function backToMap(fromId) {
  AudioEngine.playClick();
  Dialogue.cancelSpeech();
  renderMap();
  switchScreen(fromId, 'screen-journey');
}

// ─── CEREMONY ────────────────────────────────────────────────────────────────
function renderCeremony() {
  Dialogue.cancelSpeech();
  const rows = cupStandings();
  const max = Math.max(1, ...rows.map(r => r.pts));
  document.getElementById('ceremony-standings').innerHTML = rows.map((r, i) => `
    <div class="cup-row${r.isPlayer ? ' cup-row-player' : ''}">
      <span class="cup-rank">${i + 1}</span>
      <span class="cup-label">${r.label}</span>
      <span class="cup-track"><span class="cup-fill" style="width:${Math.round((r.pts / max) * 100)}%;background:${r.color}"></span></span>
      <span class="cup-pts">${r.pts}</span>
    </div>`).join('');

  const won = state.cupWon;
  document.getElementById('ceremony-verdict').innerHTML = won
    ? `<span class="verdict-win">The House Cup goes to ${rows[0].label}! The Great Hall erupts.</span>`
    : `<span class="verdict-lose">${rows[0].label} takes the Cup this year — but seven years of magic are yours forever.</span>`;

  document.getElementById('ceremony-master-name').textContent = Dialogue.getName();
  if (won) FX.confetti({ colors: [rows[0].color, '#f0d080', '#ffffff', '#c9a84c'], count: 90 });
  AudioEngine.playFanfare();
  // Dumbledore's farewell caps the journey (once).
  Guide.playBeatOnce('journey-complete');
}

// ─── SORTING CEREMONY ────────────────────────────────────────────────────────
const SORTING_QS = [
  {
    q: 'What would you most hate people to call you?',
    options: [
      { t: 'Cowardly', h: 'gryffindor' },
      { t: 'Ordinary', h: 'slytherin' },
      { t: 'Ignorant', h: 'ravenclaw' },
      { t: 'Selfish', h: 'hufflepuff' },
    ],
  },
  {
    q: 'A troll is loose in the dungeons! You…',
    options: [
      { t: 'Grab your wand and charge in', h: 'gryffindor' },
      { t: 'Slip away and plan your advantage', h: 'slytherin' },
      { t: 'Work out what attracts trolls', h: 'ravenclaw' },
      { t: 'Make sure your friends get out first', h: 'hufflepuff' },
    ],
  },
];

const MUTTER_LINES = [
  'Hmm… difficult. VERY difficult…',
  'Plenty of courage, I see. Not a bad mind, either…',
  'There\'s talent, oh yes… but where to put you?',
];

let sortTally = null;
let hatstallUsed = false;
let mutterTimer = null;

function needsSorting() {
  return !hasSavedJourney() || !Dialogue.hasName();
}

// Hand-drawn Sorting Hat — the films' weathered, droopy, patched pointed hat
// (not a top hat). The .hat-mouth crease animates while the Hat deliberates.
const SORTING_HAT_SVG = `
<svg class="sorting-hat-svg" viewBox="0 0 120 122" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path d="M8 94 Q60 74 112 94 Q96 108 60 108 Q24 108 8 94 Z" fill="#6b4f2c"/>
  <path d="M31 96 Q28 62 42 40 Q52 23 70 16 Q86 11 90 25 Q92 37 79 45 Q88 53 83 68 Q78 87 89 96 Q60 88 31 96 Z"
        fill="#8a6a3e" stroke="#5a4020" stroke-width="1.6" stroke-linejoin="round"/>
  <path d="M45 51 Q60 58 75 49" stroke="#5a4020" stroke-width="1.4" fill="none"/>
  <path d="M38 72 Q60 81 82 69" stroke="#5a4020" stroke-width="1.4" fill="none"/>
  <path d="M60 40 Q66 30 76 27" stroke="#a3855a" stroke-width="1.4" fill="none" opacity="0.7"/>
  <rect x="50" y="59" width="11" height="9" rx="1.6" fill="#7a5a34" stroke="#5a4020" stroke-width="0.8" transform="rotate(-9 55 63)"/>
  <path d="M43 63 Q48 58 54 63" stroke="#33240f" stroke-width="2.2" fill="none" stroke-linecap="round"/>
  <path d="M66 61 Q71 56 77 61" stroke="#33240f" stroke-width="2.2" fill="none" stroke-linecap="round"/>
  <path class="hat-mouth" d="M41 81 Q60 91 82 78" stroke="#33240f" stroke-width="2.6" fill="none" stroke-linecap="round"/>
</svg>`;

function sortingEl() {
  return document.getElementById('sorting-content');
}

function startSorting() {
  hatstallUsed = false;
  renderNameStep();
}

function renderNameStep(prefill) {
  sortingEl().innerHTML = `
    <div class="sorting-hat-emoji">${SORTING_HAT_SVG}</div>
    <div class="sorting-hat-line">"The Sorting Hat asks your name…"</div>
    <input class="sorting-name-input" id="sorting-name-input" maxlength="20" placeholder="Your name" autocomplete="off" autocorrect="off">
    <button class="next-btn sorting-btn" id="sorting-name-next">That's me</button>`;
  const input = document.getElementById('sorting-name-input');
  if (prefill) input.value = prefill;
  const next = () => {
    const name = Dialogue.setName(input.value);
    renderConfirmStep(name);
  };
  document.getElementById('sorting-name-next').addEventListener('click', next);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') next(); });
  input.focus();
}

function renderConfirmStep(name) {
  sortingEl().innerHTML = `
    <div class="sorting-hat-emoji">${SORTING_HAT_SVG}</div>
    <div class="sorting-hat-line">"<em>${name}</em>, is it? Hmm…"</div>
    <div class="sorting-btn-row">
      <button class="play-again-btn" id="sorting-edit">Edit</button>
      <button class="play-again-btn" id="sorting-confirm">Confirm</button>
    </div>`;
  document.getElementById('sorting-edit').addEventListener('click', () => {
    AudioEngine.playClick();
    renderNameStep(name === 'young wizard' ? '' : name);
  });
  document.getElementById('sorting-confirm').addEventListener('click', () => {
    AudioEngine.playClick();
    Dialogue.say('sorting-greet'); // now speaks on its own (pre-recorded clip or fallback)
    startHatQuestions();
  });
}

function startHatQuestions() {
  sortTally = { gryffindor: 0, slytherin: 0, ravenclaw: 0, hufflepuff: 0 };
  renderHatQ(0);
}

function renderHatQ(i) {
  const q = SORTING_QS[i];
  sortingEl().innerHTML = `
    <div class="sorting-hat-emoji">${SORTING_HAT_SVG}</div>
    <div class="sorting-hat-line">"${q.q}"</div>
    <div class="sorting-options">
      ${q.options.map((o, j) => `<button class="option sorting-option" data-idx="${j}"><span class="option-letter">${'ABCD'[j]}</span><span>${o.t}</span></button>`).join('')}
    </div>`;
  sortingEl().querySelectorAll('.sorting-option').forEach(btn => {
    btn.addEventListener('click', () => {
      AudioEngine.playClick();
      const opt = q.options[+btn.dataset.idx];
      sortTally[opt.h]++;
      const rect = btn.getBoundingClientRect();
      FX.burst(rect.left + rect.width / 2, rect.top + rect.height / 2, { color: HOUSE_COLOR[opt.h], count: 18 });
      if (i + 1 < SORTING_QS.length) renderHatQ(i + 1);
      else deliberate();
    });
  });
}

function tallyHouse() {
  const max = Math.max(...Object.values(sortTally));
  const tied = Object.keys(sortTally).filter(h => sortTally[h] === max);
  return tied[Math.floor(Math.random() * tied.length)];
}

function deliberate() {
  sortingEl().innerHTML = `
    <div class="sorting-hat-emoji sorting-hat-thinking">${SORTING_HAT_SVG}</div>
    <div class="sorting-hat-line" id="sorting-mutter">${MUTTER_LINES[0]}</div>`;
  AudioEngine.playDrumroll();
  let mi = 0;
  clearInterval(mutterTimer);
  mutterTimer = setInterval(() => {
    mi = (mi + 1) % MUTTER_LINES.length;
    const el = document.getElementById('sorting-mutter');
    if (el) el.textContent = MUTTER_LINES[mi];
  }, 750);
  setTimeout(() => {
    clearInterval(mutterTimer);
    revealHouse(tallyHouse());
  }, 2100);
}

function revealHouse(house) {
  setJourneyHouse(house); // applies accent theming live (also plays click)
  const overlay = document.getElementById('house-reveal');
  overlay.style.setProperty('--reveal-color', HOUSE_COLOR[house]);
  overlay.innerHTML = `
    <div class="reveal-emoji">${HOUSE_EMOJI[house]}</div>
    <div class="reveal-name">${HOUSES[house].name.toUpperCase()}!</div>
    <div class="reveal-btns">
      ${hatstallUsed ? '' : '<button class="play-again-btn" id="reveal-again">Ask again</button>'}
      <button class="play-again-btn reveal-continue" id="reveal-continue">Continue</button>
    </div>`;
  overlay.classList.remove('hidden');
  AudioEngine.playFanfare();
  const cx = window.innerWidth / 2, cy = window.innerHeight / 2.6;
  FX.burst(cx, cy, { color: HOUSE_COLOR[house], count: 60 });
  FX.ringPulse(cx, cy, HOUSE_COLOR[house]);

  const again = document.getElementById('reveal-again');
  if (again) {
    again.addEventListener('click', () => {
      AudioEngine.playClick();
      hatstallUsed = true;
      overlay.classList.add('hidden');
      startHatQuestions(); // re-run the two questions once
    });
  }
  document.getElementById('reveal-continue').addEventListener('click', () => {
    AudioEngine.playClick();
    overlay.classList.add('hidden');
    if (!hasSavedJourney()) { state = freshState(); }
    save(); // marks the journey as begun — the ceremony won't re-run
    refreshCTA();
    ensureUsedYear(1);
    // Hagrid's walkthrough plays once, right after Sorting, then into Year 1.
    Guide.playBeatOnce('journey-intro', () => {
      showIntro('lesson', 1, 0, 'screen-sorting');
      if (onSortedCallback) onSortedCallback();
    });
  });
}

// ─── WELCOME CTA ─────────────────────────────────────────────────────────────
export function refreshCTA() {
  const label = document.getElementById('journey-btn-label');
  const sub = document.getElementById('journey-btn-sub');
  if (!label) return;
  if (state.challenge) {
    label.textContent = 'Grand Sorcerer ✦';
    sub.textContent = `The realm bows to you, ${Dialogue.getName()}`;
  } else if (state.complete) {
    label.textContent = 'Master of Magic ★';
    sub.textContent = `The journey is complete, ${Dialogue.getName()} — revisit the feast`;
  } else if (hasSavedJourney()) {
    label.textContent = `Continue, ${Dialogue.getName()} — Year ${state.year}`;
    sub.textContent = YEARS[state.year - 1].name;
  } else {
    label.textContent = 'Begin Your Journey';
    sub.textContent = 'Seven years of Hogwarts await';
  }
}

// ─── PUBLIC API ──────────────────────────────────────────────────────────────
export const Journey = {
  init() {
    load();
    refreshCTA();
    Duel.init();

    document.getElementById('journey-cta').addEventListener('click', mapCTAClick);
    document.getElementById('dumbledore-challenge-btn')?.addEventListener('click', (e) => startChallenge(e));
    document.getElementById('journey-back').addEventListener('click', () => {
      AudioEngine.playClick();
      goWelcome('screen-journey');
    });
    document.getElementById('journey-reset').addEventListener('click', resetClick);
    document.getElementById('journey-name-edit').addEventListener('click', editName);
    document.getElementById('year-back').addEventListener('click', () => {
      AudioEngine.playClick();
      backToMap('screen-year');
    });
    document.getElementById('intro-back').addEventListener('click', introBack);
    document.getElementById('intro-begin').addEventListener('click', (e) => beginPending(e));
    document.getElementById('ceremony-map-btn').addEventListener('click', () => backToMap('screen-ceremony'));
    document.getElementById('ceremony-home-btn').addEventListener('click', () => {
      AudioEngine.playClick();
      goWelcome('screen-ceremony');
    });
  },

  enter(ev) {
    AudioEngine.playClick();
    AudioEngine.playCast();
    if (ev) {
      const btn = ev.currentTarget || ev.target;
      if (btn && btn.getBoundingClientRect) {
        const r = btn.getBoundingClientRect();
        FX.burst(r.left + r.width / 2, r.top + r.height / 2, { color: '#c9a84c' });
      }
    }
    // First-ever journey entry: hand out the starter spell kit (self-guards,
    // so this only ever grants once, and the toast shows a single time).
    Arsenal.grantStarterKit();
    if (needsSorting()) {
      switchScreen('screen-welcome', 'screen-sorting', startSorting);
    } else {
      renderMap();
      applyJourneyHouse(); // returning already-sorted player — splash was neutral, repaint their house now
      switchScreen('screen-welcome', 'screen-journey');
    }
  },

  refreshCTA,

  setSortedCallback(fn) { onSortedCallback = fn; },

  // Daily Prophet banks its score into the House Cup only when a journey is in
  // progress; a no-op otherwise (quick-play-only or pre-journey players).
  bankDailyPoints(pts) {
    if (!state || state.complete) return;
    bankCup(pts);
    state.xp += pts;
    save();
  },
};
