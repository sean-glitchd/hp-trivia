import { allQuestions, diffConfig, HOUSES } from './questions.js';
import { AudioEngine } from './audio.js';
import { FX } from './fx.js';
import { Snitch } from './snitch.js';
import { spawnOwlFlyby } from './sky.js';

// ─── STATE ───────────────────────────────────────────────────────────────────
let currentQuestions = [];
let currentIndex = 0;
let score = 0;
let lifelineCharges = 0;   // remaining 50/50 uses this round (cap 2, snitch catch +1)
let usedOnQuestion = false; // lifeline already applied to the current question
let currentDifficulty = '';
let answered = false;
let correctBtn = null;
let streak = 0; // consecutive correct answers, for streak-boosted bursts

// snitch reward is delivered via callback injection (not an import cycle —
// snitch.js never imports quiz.js) so it can call back into round state.
Snitch.setRewardCallback(snitchReward);

// ─── EXPERT UNLOCK ───────────────────────────────────────────────────────────
function isExpertUnlocked() {
  return localStorage.getItem('hp_expert_unlocked') === 'true';
}

function unlockExpert() {
  localStorage.setItem('hp_expert_unlocked', 'true');
}

export function updateWelcomeScreen() {
  const unlocked = isExpertUnlocked();
  const btn = document.getElementById('expert-btn');
  const icon = document.getElementById('expert-icon');
  const hint = document.getElementById('expert-hint');
  const banner = document.getElementById('unlock-banner');
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

// ─── HOUSES ──────────────────────────────────────────────────────────────────
function getHouse() {
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
}

// ─── SCREEN TRANSITIONS ──────────────────────────────────────────────────────
function switchScreen(fromId, toId, callback) {
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

function updateLifelineButton() {
  document.getElementById('ll-btn').disabled = lifelineCharges <= 0 || usedOnQuestion;
}

function buildRound(difficulty) {
  score = 0;
  currentIndex = 0;
  lifelineCharges = 1;
  usedOnQuestion = false;
  answered = false;
  streak = 0;
  const pool = difficulty === 'mixed'
    ? allQuestions.filter(q => ['easy','medium','hard'].includes(q.diff))
    : allQuestions.filter(q => q.diff === difficulty);
  currentQuestions = shuffle(pool).slice(0, 10);
  updateLifelineButton();
}

export function startQuiz(difficulty, ev) {
  if (difficulty === 'expert' && !isExpertUnlocked()) return;

  AudioEngine.playClick();
  AudioEngine.playCast();
  currentDifficulty = difficulty;
  buildRound(difficulty);

  const cfg = diffConfig[difficulty];
  document.getElementById('quiz-diff-tag').innerHTML =
    `<span class="quiz-diff-tag" style="background:rgba(0,0,0,0.3);border:1px solid ${cfg.color}55;color:${cfg.color}">${cfg.label}</span>`;

  const btn = ev && (ev.currentTarget || ev.target);
  if (btn && btn.getBoundingClientRect) {
    const rect = btn.getBoundingClientRect();
    FX.burst(rect.left + rect.width / 2, rect.top + rect.height / 2, { color: cfg.color });
  }

  Snitch.onQuizStart();
  switchScreen('screen-welcome', 'screen-quiz', showQuestion);
}

function showQuestion() {
  answered = false;
  usedOnQuestion = false;
  updateLifelineButton();
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
}

function selectAnswer(btn, isCorrect, fact) {
  if (answered) return;
  answered = true;

  document.querySelectorAll('.option').forEach(b => {
    b.classList.add('disabled');
    b.onclick = null;
    if (b === correctBtn) b.classList.add('correct');
  });

  const rect = btn.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;

  if (isCorrect) {
    score++;
    streak++;
    btn.classList.add('correct');
    AudioEngine.playCorrect();
    // streak sparks: from a 3+ streak, boost the burst size (+8/level, cap 60)
    const count = streak >= 3 ? Math.min(60, 26 + (streak - 2) * 8) : 26;
    FX.burst(cx, cy, { color: '#4caf7a', count });
    FX.ringPulse(cx, cy, '#4caf7a');
  } else {
    streak = 0;
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

  document.getElementById('next-btn').classList.remove('hidden');
}

export function useFiftyFifty() {
  if (lifelineCharges <= 0 || answered || usedOnQuestion) return;
  AudioEngine.playClick();
  lifelineCharges--;
  usedOnQuestion = true;
  updateLifelineButton();

  const wrongOnes = Array.from(document.querySelectorAll('.option'))
    .filter(b => b !== correctBtn && !b.classList.contains('eliminated'));
  shuffle(wrongOnes).slice(0, 2).forEach(b => {
    b.classList.add('eliminated');
    const rect = b.getBoundingClientRect();
    FX.fizzle(rect.left + rect.width / 2, rect.top + rect.height / 2);
  });
}

// ─── SNITCH REWARD + TOAST ────────────────────────────────────────────────────
function showToast(message) {
  const toast = document.getElementById('snitch-toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('toast-show');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => toast.classList.remove('toast-show'), 3000);
}

function snitchReward() {
  lifelineCharges = Math.min(2, lifelineCharges + 1);
  usedOnQuestion = false;
  updateLifelineButton();
  showToast('You caught the Golden Snitch! ⚡ 50/50 restored.');
}

export function nextQuestion() {
  AudioEngine.playClick();
  currentIndex++;
  if (currentIndex < currentQuestions.length) {
    showQuestion();
  } else {
    switchScreen('screen-quiz', 'screen-result', showResult);
  }
}

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

function showResult() {
  Snitch.onQuizEnd();
  animateScoreCountUp(score, currentQuestions.length);
  renderStars(score);
  if (score >= 6) AudioEngine.playFanfare();

  const ratings = [
    { min:10, rating:'Perfect Score!',   comment:'"Outstanding! You could teach at Hogwarts yourself. Dumbledore would be speechless."' },
    { min:8,  rating:'Excellent!',        comment:'"Exceeds Expectations — truly. You know the wizarding world almost as well as Hermione herself."' },
    { min:6,  rating:'Well Done',         comment:'"Acceptable — O.W.L. standard at least. A few more hours in the library and you\'ll be there."' },
    { min:4,  rating:'Not Bad',           comment:'"Poor, but not a Troll. Read your textbooks more carefully and try again, young wizard."' },
    { min:0,  rating:'Keep Studying',     comment:'"Dreadful. Have you been paying any attention at all? Back to Hogwarts with you."' },
  ];

  const r = ratings.find(r => score >= r.min);
  document.getElementById('result-rating').textContent = r.rating;
  document.getElementById('result-comment').textContent = r.comment;

  const house = getHouse();
  const houseLineEl = document.getElementById('result-house-line');
  if (house) {
    const h = HOUSES[house];
    houseLineEl.textContent = score >= 6 ? h.high : h.low;
    houseLineEl.classList.remove('hidden');
  } else {
    houseLineEl.classList.add('hidden');
  }

  const expertBanner = document.getElementById('expert-unlocked-banner');
  if (currentDifficulty === 'hard' && score >= 7 && !isExpertUnlocked()) {
    unlockExpert();
    expertBanner.classList.remove('hidden');
    launchConfetti('#f09090');
  } else {
    expertBanner.classList.add('hidden');
    if (score >= 9) launchConfetti('#c9a84c');
  }
}

export function replayDifficulty() {
  AudioEngine.playClick();
  switchScreen('screen-result', 'screen-quiz', () => {
    buildRound(currentDifficulty);
    showQuestion();
    Snitch.onQuizStart();
  });
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
