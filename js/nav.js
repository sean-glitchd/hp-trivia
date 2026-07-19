// ─── nav.js: 🏰 home button + abandon-confirm ───────────────────────────────
// Only imports quiz.js (acyclic-imports constraint: nav -> quiz). Builds its
// own DOM (mirrors the .sound-controls pattern FX/audio already use) and
// tracks the visible screen via a MutationObserver rather than having
// quiz.js call back into it — quiz.js takes no new imports in this batch.

import { isRoundActive, abandonRound, switchScreen, updateWelcomeScreen } from './quiz.js';

let currentScreenId = 'screen-welcome';
let homeBtn = null;
let overlay = null;
let homeCallback = null; // optional override set by main.js (composition root)

function buildDOM() {
  homeBtn = document.createElement('button');
  homeBtn.id = 'home-btn';
  homeBtn.className = 'sound-btn nav-home-btn hidden';
  homeBtn.setAttribute('aria-label', 'Return to the main menu');
  homeBtn.textContent = '🏰';
  homeBtn.addEventListener('click', onHomeClick);
  document.body.appendChild(homeBtn);

  overlay = document.createElement('div');
  overlay.id = 'nav-confirm-overlay';
  overlay.className = 'nav-confirm-overlay hidden';
  overlay.innerHTML = `
    <div class="nav-confirm-card">
      <p class="nav-confirm-text">Leave this lesson? Progress this round is lost.</p>
      <div class="nav-confirm-btns">
        <button class="play-again-btn nav-stay-btn">Stay</button>
        <button class="play-again-btn nav-leave-btn">Leave</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('.nav-stay-btn').addEventListener('click', hideConfirm);
  overlay.querySelector('.nav-leave-btn').addEventListener('click', onLeaveConfirmed);
}

function showConfirm() {
  overlay.classList.remove('hidden');
}
function hideConfirm() {
  overlay.classList.add('hidden');
}

function onHomeClick() {
  if (isRoundActive()) {
    showConfirm();
  } else {
    goHome();
  }
}

function goHome() {
  const from = currentScreenId;
  if (from === 'screen-welcome') return;
  switchScreen(from, 'screen-welcome', () => {
    if (homeCallback) homeCallback();
    else updateWelcomeScreen();
  });
}

function onLeaveConfirmed() {
  hideConfirm();
  abandonRound(); // itself does switchScreen('screen-quiz','screen-welcome', updateWelcomeScreen)
  if (homeCallback) homeCallback();
}

function observeScreens() {
  document.querySelectorAll('.screen').forEach(el => {
    if (!el.classList.contains('hidden')) currentScreenId = el.id;
    const obs = new MutationObserver(() => {
      if (!el.classList.contains('hidden')) {
        currentScreenId = el.id;
        homeBtn.classList.toggle('hidden', currentScreenId === 'screen-welcome');
      }
    });
    obs.observe(el, { attributes: true, attributeFilter: ['class'] });
  });
  homeBtn.classList.toggle('hidden', currentScreenId === 'screen-welcome');
}

export const Nav = {
  init() {
    if (homeBtn) return;
    buildDOM();
    observeScreens();
  },
  setHomeCallback(fn) {
    homeCallback = fn;
  },
};
