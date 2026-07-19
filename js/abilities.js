// ─── abilities.js: house passives as hook fragments + crest chip ───────────
// Imports quiz.js primitives + arsenal.js + fx.js. quiz.js never imports this
// module (abilities -> quiz is a safe one-way edge, no cycle), so hooks are
// composed into round configs by main.js/journey.js/duel.js — the same
// composition sites that layer in arsenal.js.

import { showToast, addPoints, getHouse } from './quiz.js';
import { HOUSES } from './questions.js';
import { Arsenal, ArsenalDuel } from './arsenal.js';
import { FX } from './fx.js';

const COARSE = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;

const HOUSE_EMOJI = { gryffindor: '🦁', slytherin: '🐍', ravenclaw: '🦅', hufflepuff: '🦡' };
const HOUSE_DESC = {
  gryffindor: 'Gryffindor: your first wrong answer each round gets a second guess.',
  slytherin: 'Slytherin: every 3rd correct answer in a streak banks a bonus house point.',
  ravenclaw: 'Ravenclaw: begin every round with a free Lumos charge.',
  hufflepuff: 'Hufflepuff: your first wrong answer each round is forgiven.',
};

// ─── round-scoped ability state ──────────────────────────────────────────────
let currentHouse = null;
let gryUsed = false;
let huffUsed = false;
let streakCount = 0;

function resetRoundState(house) {
  currentHouse = house;
  gryUsed = false;
  huffUsed = false;
  streakCount = 0;
  if (house === 'ravenclaw') {
    Arsenal.grantRoundScoped('lu', 1);
    showToast('🦅 A free Lumos charge, courtesy of Ravenclaw.');
  }
  renderChip();
}

function adjudicate(isCorrect) {
  if (isCorrect || !currentHouse) return null;
  if (currentHouse === 'gryffindor' && !gryUsed) {
    gryUsed = true;
    renderChip();
    return 'retry';
  }
  if (currentHouse === 'hufflepuff' && !huffUsed) {
    huffUsed = true;
    renderChip();
    return 'forgiven';
  }
  return null;
}

function onAnswer(isCorrect, ctx) {
  if (currentHouse !== 'slytherin') return;
  if (isCorrect) {
    streakCount++;
    if (streakCount > 0 && streakCount % 3 === 0) {
      addPoints(1);
      const rect = ctx && ctx.btnRect;
      if (rect) FX.burst(rect.left + rect.width / 2, rect.top + rect.height / 2, { color: '#39ff6a', count: 16 });
      showToast('🐍 +1 bonus point for the streak!');
    }
  } else {
    streakCount = 0;
  }
}

function hooks(house) {
  if (!house || !HOUSES[house]) return {};
  return {
    onRoundStart: () => resetRoundState(house),
    adjudicate,
    onAnswer,
  };
}

// ─── #house-chip UI ──────────────────────────────────────────────────────────
function renderChip() {
  const chip = document.getElementById('house-chip');
  if (!chip) return;
  if (!currentHouse || !HOUSES[currentHouse]) {
    chip.classList.add('hidden');
    chip.innerHTML = '';
    chip.onclick = null;
    return;
  }
  chip.classList.remove('hidden');
  // "ready/used" pip only makes sense for Gryffindor/Hufflepuff's one-shot
  // per round; Ravenclaw's grant and Slytherin's repeatable bonus stay lit.
  const lit = currentHouse === 'gryffindor' ? !gryUsed
    : currentHouse === 'hufflepuff' ? !huffUsed
    : true;
  chip.title = HOUSE_DESC[currentHouse];
  chip.innerHTML = `<span class="house-chip-emoji">${HOUSE_EMOJI[currentHouse]}</span><span class="house-chip-pip${lit ? ' lit' : ''}">●</span>`;
  chip.onclick = () => { if (COARSE) showToast(HOUSE_DESC[currentHouse]); };
}

// ─── shared round-hook composer ──────────────────────────────────────────────
// Every mode (quick play via main.js's decorator, journey lessons/exams, the
// duel) layers the SAME arsenal + house-ability machinery onto its base config
// through this one helper, so the wiring lives in exactly one place. It:
//   • runs Arsenal.beginRound + the chosen house's onRoundStart at round start
//   • pumps Arsenal.onQuestionShown / Arsenal.onAnswer each question
//   • composes the adjudicate chain: house verdict (Gryffindor retry /
//     Hufflepuff forgiven) first, then in the duel a Patronus shield on a wrong
//     answer ('shielded'), then any base adjudicate — first truthy wins.
// The house is read fresh at round start so changing houses between rounds
// takes effect immediately. base's other fields (questions, onRoundEnd,
// buttons, getInterstitial, …) pass straight through.
export function composeRoundHooks(base, { freeObliviate = false, duel = false } = {}) {
  const baseStart = base.onRoundStart;
  const baseShown = base.onQuestionShown;
  const baseAnswer = base.onAnswer;
  const baseAdj = base.adjudicate;
  let hh = {};
  return {
    ...base,
    onRoundStart: () => {
      hh = hooks(getHouse());
      Arsenal.beginRound({ freeObliviate, persistentAllowed: true, duel });
      hh.onRoundStart?.();
      baseStart?.();
    },
    onQuestionShown: (i) => {
      Arsenal.onQuestionShown();
      baseShown?.(i);
    },
    onAnswer: (correct, ctx) => {
      Arsenal.onAnswer(correct);
      hh.onAnswer?.(correct, ctx);
      baseAnswer?.(correct, ctx);
    },
    adjudicate: (isCorrect, ctx) => {
      const v = hh.adjudicate?.(isCorrect, ctx);
      if (v) return v;
      if (duel && !isCorrect && ArsenalDuel.isPatronusArmed()) {
        ArsenalDuel.consumePatronus();
        return 'shielded';
      }
      return baseAdj?.(isCorrect, ctx) ?? null;
    },
  };
}

// ─── public API ──────────────────────────────────────────────────────────────
export const Abilities = {
  // quick-play + journey lesson/exam configs.
  hooks,
  // duel.js consults this adjudicate directly (wrapped with a Patronus check
  // on top) — same state machine as hooks(), just exposed under its own name
  // per the duel integration contract.
  duelHooks: hooks,
  composeRoundHooks,
};
