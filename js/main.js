import { FX } from './fx.js';
import { initSky, setBrightness } from './sky.js';
import { initCursor, initTilt } from './cursor.js';
import { AudioEngine, initAudioListeners } from './audio.js';
import { Snitch } from './snitch.js';
import {
  updateWelcomeScreen,
  applyHouse,
  setHouse,
  startQuiz,
  useFiftyFifty,
  nextQuestion,
  replayDifficulty,
  backToMenu,
} from './quiz.js';

// ─── FX / sky / cursor init (must run before other listeners use FX) ────────
FX.init();
initSky();
initCursor();
initTilt();
Snitch.init();

// ─── House picker ────────────────────────────────────────────────────────────
document.querySelectorAll('.house-btn').forEach(btn => {
  const house = btn.dataset.house || null;
  btn.addEventListener('click', () => setHouse(house));
});

// ─── Difficulty buttons ──────────────────────────────────────────────────────
document.querySelector('.diff-easy').addEventListener('click', (e) => startQuiz('easy', e));
document.querySelector('.diff-medium').addEventListener('click', (e) => startQuiz('medium', e));
document.querySelector('.diff-hard').addEventListener('click', (e) => startQuiz('hard', e));
document.querySelector('.diff-mixed').addEventListener('click', (e) => startQuiz('mixed', e));
document.getElementById('expert-btn').addEventListener('click', (e) => startQuiz('expert', e));

// ─── Lifeline / next question ────────────────────────────────────────────────
document.getElementById('ll-btn').addEventListener('click', () => useFiftyFifty());
document.getElementById('next-btn').addEventListener('click', () => nextQuestion());

// ─── Result screen buttons ───────────────────────────────────────────────────
const resultBtns = document.querySelectorAll('.result-btns .play-again-btn');
resultBtns[0].addEventListener('click', () => replayDifficulty());
resultBtns[1].addEventListener('click', () => backToMenu());

// ─── Sound controls ──────────────────────────────────────────────────────────
document.getElementById('music-toggle').addEventListener('click', () => AudioEngine.toggle());
document.getElementById('track-toggle').addEventListener('click', () => AudioEngine.switchTrack());

// ─── Autoplay resume on first interaction ────────────────────────────────────
initAudioListeners();

// ─── "lumos" / "nox" typed easter egg ────────────────────────────────────────
let keyBuffer = '';
document.addEventListener('keydown', (e) => {
  const tag = document.activeElement && document.activeElement.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return; // guard, though there are none today
  if (!/^[a-zA-Z]$/.test(e.key)) return;
  keyBuffer = (keyBuffer + e.key.toLowerCase()).slice(-5);
  const cx = window.innerWidth / 2, cy = window.innerHeight / 2;
  if (keyBuffer.endsWith('lumos')) {
    setBrightness(1.35);
    FX.ringPulse(cx, cy, '#fff8e0');
    AudioEngine.playChime();
    keyBuffer = '';
  } else if (keyBuffer.endsWith('nox')) {
    setBrightness(1.0);
    FX.ringPulse(cx, cy, '#3a2a50');
    AudioEngine.playClick();
    keyBuffer = '';
  }
});

// ─── INIT ────────────────────────────────────────────────────────────────────
updateWelcomeScreen();
applyHouse();
AudioEngine.updateButtons();
