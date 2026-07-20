import { allQuestions, diffConfig, HOUSES } from './questions.js';
import { AudioEngine } from './audio.js';
import { FX } from './fx.js';
import { Snitch } from './snitch.js';
import { Hedwig } from './hedwig.js';
import { spawnOwlFlyby, setHouseTint } from './sky.js';

// ─── STATE ───────────────────────────────────────────────────────────────────
let currentQuestions = [];
let reserveQuestions = [];  // next unused questions from the shuffled pool, for rerollCurrentQuestion()
let currentIndex = 0;
let score = 0;
let points = 0;            // ledger alongside score — boosted by armDoublePoints(); quick play: points === score
let currentDifficulty = '';
let answered = false;
let correctBtn = null;
let streak = 0; // consecutive correct answers, for streak-boosted bursts

// mode-config abstraction: the active round's hook set. quiz.js never imports
// feature modules — everything attaches via this config object, set by
// startRound(). Empty object until the first round starts.
let mode = {};
let roundActive = false;
let retryUsedThisQuestion = false; // adjudicate 'retry' is consulted at most once per question
let doublePointsArmed = false;     // armDoublePoints(): next correct adds 2 to points
let streakShieldArmed = false;     // armStreakShield(): next wrong doesn't reset streak

// batch 4: quick-play's mode config is decorated by main.js (via
// setQuickConfigDecorator) so arsenal.js/abilities.js can compose their
// hooks into it without quiz.js importing either module — quiz.js stays a
// leaf w.r.t. feature modules. Snitch's reward callback is now wired by
// main.js too (Arsenal.onSnitchCaught), not here.
let quickConfigDecorator = null;
export function setQuickConfigDecorator(fn) {
  quickConfigDecorator = fn;
}

// ─── EXPERT UNLOCK ───────────────────────────────────────────────────────────
function isExpertUnlocked() {
  return localStorage.getItem('hp_expert_unlocked') === 'true';
}

function unlockExpert() {
  localStorage.setItem('hp_expert_unlocked', 'true');
}

// Expert lock/unlock state — lives on the Quick Quiz screen now, but the
// elements always exist in the DOM, so this is safe to call on any "home"
// transition too.
export function updateQuickScreen() {
  const unlocked = isExpertUnlocked();
  const btn = document.getElementById('expert-btn');
  const icon = document.getElementById('expert-icon');
  const hint = document.getElementById('expert-hint');
  const banner = document.getElementById('unlock-banner');
  if (!btn) return;
  if (unlocked) {
    btn.classList.remove('locked');
    icon.textContent = '⚡';
    hint.classList.add('hidden');
    banner.classList.remove('hidden');
  } else {
    btn.classList.add('locked');
    icon.textContent = '🔒';
    hint.classList.remove('hidden');
    banner.classList.add('hidden');
  }
}

// The splash ("home") callback used across every backToMenu / home transition.
// Kept as the canonical home refresh; delegates the expert state so returning
// home keeps the Quick screen current even though it's a sub-screen now.
export function updateWelcomeScreen() {
  updateQuickScreen();
}

// ─── HOUSES ──────────────────────────────────────────────────────────────────
// Exported read-only: abilities.js/main.js need the current house to compose
// house-ability hooks into a round config without duplicating this lookup.
export function getHouse() {
  const h = localStorage.getItem('hp_house');
  return HOUSES[h] ? h : null;
}

export function setHouse(house) {
  AudioEngine.playClick();
  if (house) localStorage.setItem('hp_house', house);
  else localStorage.removeItem('hp_house');
  applyHouse();
}

export function applyHouse() {
  const house = getHouse();
  if (house) document.body.dataset.house = house;
  else delete document.body.dataset.house;
  document.querySelectorAll('.house-btn').forEach(b => {
    b.classList.toggle('selected', (b.dataset.house || null) === (house || null));
  });
  FX.refreshAccent();
  const accent = getComputedStyle(document.body).getPropertyValue('--accent').trim();
  if (accent) setHouseTint(accent);
}

// ─── SCREEN TRANSITIONS ──────────────────────────────────────────────────────
export function switchScreen(fromId, toId, callback) {
  const from = document.getElementById(fromId);
  const to   = document.getElementById(toId);
  from.classList.add('fading-out');
  setTimeout(() => {
    from.classList.add('hidden');
    from.classList.remove('fading-out');
    to.classList.remove('hidden');
    to.classList.add('fading-in');
    setTimeout(() => to.classList.remove('fading-in'), 500);
    if (callback) callback();
  }, 380);
}

// ─── QUIZ LOGIC ──────────────────────────────────────────────────────────────
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Pure pool builder: shuffles the difficulty pool and slices off the round's
// questions plus a small reserve (used by rerollCurrentQuestion()). Does NOT
// touch round state — startRound() owns all state resets.
function buildRound(difficulty) {
  const pool = difficulty === 'mixed'
    ? allQuestions.filter(q => ['easy','medium','hard'].includes(q.diff))
    : allQuestions.filter(q => q.diff === difficulty);
  const shuffled = shuffle(pool);
  return {
    questions: shuffled.slice(0, 10),
    reserve: shuffled.slice(10, 13),
  };
}

function buildQuickConfig(difficulty, fromScreen) {
  const { questions, reserve } = buildRound(difficulty);
  const cfg = diffConfig[difficulty];
  const base = {
    questions,
    reserveQuestions: reserve,
    tagHTML: `<span class="quiz-diff-tag" style="background:rgba(0,0,0,0.3);border:1px solid ${cfg.color}55;color:${cfg.color}">${cfg.label}</span>`,
    color: cfg.color,
    fromScreen,
    onRoundEnd: quickRoundEnd,
    primaryLabel: '↩ Play Again',
    primaryAction: replayDifficulty,
    secondaryLabel: '⚡ Change Level',
    secondaryAction: backToMenu,
  };
  // main.js's decorator (registered via setQuickConfigDecorator) layers in
  // arsenal + house-ability hooks. With no decorator registered, or with an
  // empty inventory, this is the plain quick-play config, unchanged.
  return quickConfigDecorator ? quickConfigDecorator(base) : base;
}

// ─── MODE ABSTRACTION ─────────────────────────────────────────────────────────
export function startRound(config, ev) {
  mode = config || {};

  score = 0;
  points = 0;
  currentIndex = 0;
  streak = 0;
  answered = false;
  retryUsedThisQuestion = false;
  doublePointsArmed = false;
  streakShieldArmed = false;
  currentQuestions = mode.questions || [];
  reserveQuestions = mode.reserveQuestions ? [...mode.reserveQuestions] : [];
  roundActive = true;

  const tagEl = document.getElementById('quiz-diff-tag');
  if (tagEl) tagEl.innerHTML = mode.tagHTML || '';

  const btn = ev && (ev.currentTarget || ev.target);
  if (btn && btn.getBoundingClientRect) {
    const rect = btn.getBoundingClientRect();
    FX.burst(rect.left + rect.width / 2, rect.top + rect.height / 2, { color: mode.color });
  }

  // duel.js sets suppressSnitch / suppressHedwig — a flyer flitting around
  // mid-duel undercuts the stakes, and quiz.js hardwires both flyers (not
  // import-optional), so these are the opt-out levers a mode config gets.
  if (!mode.suppressSnitch) Snitch.onQuizStart();
  if (!mode.suppressHedwig) Hedwig.onQuizStart();
  mode.onRoundStart?.();
  switchScreen(mode.fromScreen ?? 'screen-welcome', 'screen-quiz', showQuestion);
}

export function startQuiz(difficulty, ev) {
  if (difficulty === 'expert' && !isExpertUnlocked()) return;

  AudioEngine.playClick();
  AudioEngine.playCast();
  currentDifficulty = difficulty;

  startRound(buildQuickConfig(difficulty, 'screen-welcome'), ev);
}

function showQuestion() {
  answered = false;
  retryUsedThisQuestion = false;
  const q = currentQuestions[currentIndex];
  const total = currentQuestions.length;

  document.getElementById('progress-text').textContent = `Question ${currentIndex + 1} of ${total}`;
  document.getElementById('progress-fill').style.width = `${((currentIndex + 1) / total) * 100}%`;
  document.getElementById('question-number').textContent = `Question ${currentIndex + 1}`;
  document.getElementById('question-text').textContent = q.q;
  document.getElementById('fact-container').innerHTML = '';

  const nextBtn = document.getElementById('next-btn');
  nextBtn.classList.add('hidden');
  nextBtn.textContent = currentIndex < total - 1 ? 'Next Question →' : 'See My Results →';

  const container = document.getElementById('options-container');
  container.innerHTML = '';
  const letters = ['A','B','C','D'];

  const indexed = q.options.map((text, i) => ({ text, isCorrect: i === q.answer }));
  const shuffled = shuffle(indexed);

  correctBtn = null;
  shuffled.forEach((opt, i) => {
    const btn = document.createElement('button');
    btn.className = 'option';
    if (opt.isCorrect) correctBtn = btn;
    btn.innerHTML = `<span class="option-letter">${letters[i]}</span><span>${opt.text}</span>`;
    btn.onclick = () => selectAnswer(btn, opt.isCorrect, q.fact);
    container.appendChild(btn);
  });

  const card = document.getElementById('question-card');
  card.style.animation = 'none';
  card.offsetHeight;
  card.style.animation = 'slide-up 0.4s ease forwards';
  // Pin the inline animation to 'none' once it finishes — leaving the
  // fill-forward keyframe "in effect" would keep winning over the plain
  // `transform` rule and block the pointer-tilt custom-property transform.
  card.addEventListener('animationend', () => { card.style.animation = 'none'; }, { once: true });

  mode.onQuestionShown?.(currentIndex);
}

function selectAnswer(btn, isCorrect, fact) {
  if (answered) return;

  let verdict = isCorrect ? 'correct' : 'wrong';
  if (!retryUsedThisQuestion && mode.adjudicate) {
    const v = mode.adjudicate(isCorrect, { btn, index: currentIndex });
    if (v) verdict = v;
  }

  if (verdict === 'retry') {
    // Wrong pick is eliminated; every other option (never disabled to begin
    // with) stays clickable. Next pick is final — adjudicate isn't consulted
    // again this question, and re-eliminated buttons are simply unclickable
    // via the .eliminated CSS rule (pointer-events: none).
    retryUsedThisQuestion = true;
    btn.classList.add('eliminated');
    btn.onclick = null;
    return;
  }

  answered = true;
  const isScoreCorrect = verdict === 'correct' || verdict === 'forgiven';

  document.querySelectorAll('.option').forEach(b => {
    b.classList.add('disabled');
    b.onclick = null;
    if (b === correctBtn) b.classList.add('correct');
  });

  const rect = btn.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;

  if (isScoreCorrect) {
    score++;
    points += doublePointsArmed ? 2 : 1;
    doublePointsArmed = false;
    streak++;
    if (verdict === 'forgiven') btn.classList.add('forgiven');
    else btn.classList.add('correct');
    AudioEngine.playCorrect();
    // streak sparks: from a 3+ streak, boost the burst size (+8/level, cap 60)
    const count = streak >= 3 ? Math.min(60, 26 + (streak - 2) * 8) : 26;
    FX.burst(cx, cy, { color: '#4caf7a', count });
    FX.ringPulse(cx, cy, '#4caf7a');
  } else {
    if (streakShieldArmed) {
      streakShieldArmed = false;
    } else {
      streak = 0;
    }
    btn.classList.add('wrong');
    AudioEngine.playWrong();
    FX.fizzle(cx, cy);
    if (!FX.reduced) {
      const card = document.getElementById('question-card');
      card.classList.remove('shake');
      void card.offsetWidth;
      card.classList.add('shake');
      setTimeout(() => card.classList.remove('shake'), 200);
    }
  }

  const factEl = document.createElement('div');
  factEl.className = 'fact-box';
  factEl.innerHTML = `<div class="fact-label">Did you know?</div><div class="fact-text">${fact}</div>`;
  document.getElementById('fact-container').appendChild(factEl);

  mode.onAnswer?.(isScoreCorrect, { btnRect: rect, index: currentIndex, verdict });

  const reveal = () => document.getElementById('next-btn').classList.remove('hidden');
  const delay = mode.nextDelay || 0;
  if (delay > 0) setTimeout(reveal, delay);
  else reveal();
}

// ─── PRIMITIVES ────────────────────────────────────────────────────────────────
export function eliminateWrongOptions(n) {
  const wrongOnes = Array.from(document.querySelectorAll('.option'))
    .filter(b => b !== correctBtn && !b.classList.contains('eliminated'));
  const toEliminate = shuffle(wrongOnes).slice(0, n);
  toEliminate.forEach(b => {
    b.classList.add('eliminated');
    const rect = b.getBoundingClientRect();
    FX.fizzle(rect.left + rect.width / 2, rect.top + rect.height / 2);
  });
  return toEliminate.length;
}

export function rerollCurrentQuestion() {
  if (answered) return false;
  if (!reserveQuestions.length) return false;
  const next = reserveQuestions.shift();
  currentQuestions[currentIndex] = next;
  showQuestion();
  return true;
}

export function armDoublePoints() {
  doublePointsArmed = true;
}

export function armStreakShield() {
  streakShieldArmed = true;
}

// Slytherin's streak-bonus ability (abilities.js) banks extra cup points
// without going through a scored "answer" — a minimal ledger primitive so
// abilities.js never needs write access to the score/points internals.
export function addPoints(n) {
  points += n;
}

export function getPoints() {
  return points;
}

export function isRoundActive() {
  return roundActive;
}

export function abandonRound() {
  mode.onAbandon?.();
  Snitch.onQuizEnd();
  Hedwig.onQuizEnd();
  roundActive = false;
  switchScreen('screen-quiz', 'screen-welcome', updateWelcomeScreen);
}

// Batch 4: the old 50/50 lifeline (lifelineCharges/usedOnQuestion/
// useFiftyFifty/snitchReward) has moved out to arsenal.js, which spends
// round-scoped + persistent charges through eliminateWrongOptions() above.
// Snitch's reward callback is now wired by main.js to Arsenal.onSnitchCaught.

// ─── TOAST ─────────────────────────────────────────────────────────────────
export function showToast(message) {
  const toast = document.getElementById('snitch-toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('toast-show');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => toast.classList.remove('toast-show'), 3000);
}

// ─── ROUND ADVANCE ─────────────────────────────────────────────────────────────
export function nextQuestion() {
  AudioEngine.playClick();

  const nextIndex = currentIndex + 1;

  if (mode.isRoundOver && mode.isRoundOver(score, nextIndex)) {
    endRound();
    return;
  }

  if (nextIndex < currentQuestions.length) {
    currentIndex = nextIndex;
    proceedToNextQuestion();
    return;
  }

  const extra = mode.extraQuestion?.();
  if (extra) {
    currentQuestions.push(extra);
    currentIndex = nextIndex;
    proceedToNextQuestion();
  } else {
    endRound();
  }
}

function proceedToNextQuestion() {
  const interstitial = mode.getInterstitial?.(currentIndex);
  if (interstitial) {
    interstitial(() => showQuestion());
  } else {
    showQuestion();
  }
}

function endRound() {
  roundActive = false;
  const finalScore = score;
  const total = currentQuestions.length;
  switchScreen('screen-quiz', 'screen-result', () => {
    applyResultButtons();
    mode.onRoundEnd?.(finalScore, total);
  });
}

// ─── RESULT SCREEN ──────────────────────────────────────────────────────────────
function animateScoreCountUp(finalScore, total) {
  const el = document.getElementById('result-score');
  const pop = () => {
    el.classList.remove('score-pop');
    void el.offsetWidth;
    el.classList.add('score-pop');
  };
  if (FX.reduced) {
    el.textContent = `${finalScore}/${total}`;
    pop();
    return;
  }
  const duration = 1200;
  const start = performance.now();
  let lastShown = -1;
  function tick(now) {
    const progress = Math.min(1, (now - start) / duration);
    const current = Math.round(progress * finalScore);
    if (current !== lastShown) {
      lastShown = current;
      el.textContent = `${current}/${total}`;
      AudioEngine.playTick();
    }
    if (progress < 1) {
      requestAnimationFrame(tick);
    } else {
      el.textContent = `${finalScore}/${total}`;
      pop();
    }
  }
  requestAnimationFrame(tick);
}

function renderStars(finalScore) {
  const row = document.getElementById('result-stars');
  if (!row) return;
  row.innerHTML = '';
  const filled = Math.round(finalScore / 2);
  const starEls = [];
  for (let i = 0; i < 5; i++) {
    const star = document.createElement('span');
    star.className = 'result-star' + (i < filled ? ' filled' : '');
    star.textContent = '★';
    star.style.animationDelay = FX.reduced ? '0s' : `${i * 0.1}s`;
    row.appendChild(star);
    starEls.push(star);
  }
  if (!FX.reduced) {
    starEls.forEach((star, i) => {
      if (i >= filled) return;
      setTimeout(() => {
        const rect = star.getBoundingClientRect();
        FX.burst(rect.left + rect.width / 2, rect.top + rect.height / 2, { count: 14 });
      }, i * 100 + 250);
    });
  }
}

// Extracted shell: Snitch.onQuizEnd + count-up + stars + rating/comment +
// house line. Everything EXCEPT expert-unlock, confetti, and button labels —
// those stay mode-specific (quick mode's tail is quickRoundEnd() below).
export function renderResultShell(finalScore, total) {
  Snitch.onQuizEnd();
  Hedwig.onQuizEnd();
  animateScoreCountUp(finalScore, total);
  renderStars(finalScore);
  if (finalScore >= 6) AudioEngine.playFanfare();

  const ratings = [
    { min:10, rating:'Perfect Score!',   comment:'"Outstanding! You could teach at Hogwarts yourself. Dumbledore would be speechless."' },
    { min:8,  rating:'Excellent!',        comment:'"Exceeds Expectations — truly. You know the wizarding world almost as well as Hermione herself."' },
    { min:6,  rating:'Well Done',         comment:'"Acceptable — O.W.L. standard at least. A few more hours in the library and you\'ll be there."' },
    { min:4,  rating:'Not Bad',           comment:'"Poor, but not a Troll. Read your textbooks more carefully and try again, young wizard."' },
    { min:0,  rating:'Keep Studying',     comment:'"Dreadful. Have you been paying any attention at all? Back to Hogwarts with you."' },
  ];

  const r = ratings.find(r => finalScore >= r.min);
  document.getElementById('result-rating').textContent = r.rating;
  document.getElementById('result-comment').textContent = r.comment;

  const house = getHouse();
  const houseLineEl = document.getElementById('result-house-line');
  if (house) {
    const h = HOUSES[house];
    houseLineEl.textContent = finalScore >= 6 ? h.high : h.low;
    houseLineEl.classList.remove('hidden');
  } else {
    houseLineEl.classList.add('hidden');
  }
}

// Quick mode's onRoundEnd: the current showResult tail (expert-unlock +
// confetti thresholds), on top of the shared shell.
function quickRoundEnd(finalScore, total) {
  renderResultShell(finalScore, total);

  // Journey mode may have left its banner on the shared result screen —
  // quick mode always clears it (no import needed, just the element).
  const journeyBanner = document.getElementById('journey-result-banner');
  if (journeyBanner) journeyBanner.classList.add('hidden');

  const expertBanner = document.getElementById('expert-unlocked-banner');
  if (currentDifficulty === 'hard' && finalScore >= 7 && !isExpertUnlocked()) {
    unlockExpert();
    expertBanner.classList.remove('hidden');
    launchConfetti('#f09090');
  } else {
    expertBanner.classList.add('hidden');
    if (finalScore >= 9) launchConfetti('#c9a84c');
  }
}

// ─── RESULT BUTTONS ─────────────────────────────────────────────────────────────
function applyResultButtons() {
  const btns = document.querySelectorAll('.result-btns .play-again-btn');
  if (btns[0]) btns[0].textContent = mode.primaryLabel ?? '↩ Play Again';
  if (btns[1]) btns[1].textContent = mode.secondaryLabel ?? '⚡ Change Level';
}

export function resultPrimary() {
  mode.primaryAction?.();
}

export function resultSecondary() {
  mode.secondaryAction?.();
}

export function replayDifficulty() {
  AudioEngine.playClick();
  startRound(buildQuickConfig(currentDifficulty, 'screen-result'));
}

export function backToMenu() {
  AudioEngine.playClick();
  if (Math.random() < 1 / 6) spawnOwlFlyby();
  switchScreen('screen-result', 'screen-welcome', updateWelcomeScreen);
}

// ─── CONFETTI ────────────────────────────────────────────────────────────────
function launchConfetti(color) {
  FX.confetti({ colors: [color, '#f0d080', '#ffffff', '#c9a84c'], count: 80 });
}
