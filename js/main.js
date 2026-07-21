import { FX } from './fx.js';
import { initSky, setBrightness } from './sky.js';
import { initCursor, initTilt } from './cursor.js';
import { AudioEngine, initAudioListeners } from './audio.js';
import { Snitch } from './snitch.js';
import {
  updateWelcomeScreen,
  updateQuickScreen,
  applyQuickHouse,
  setQuickHouse,
  getQuickHouse,
  startQuiz,
  nextQuestion,
  resultPrimary,
  resultSecondary,
  setQuickConfigDecorator,
  switchScreen,
} from './quiz.js';
import { Journey } from './journey.js';
import { Nav } from './nav.js';
import { cancelSpeech, dismissCard } from './dialogue.js';
import { Arsenal } from './arsenal.js';
import { composeRoundHooks } from './abilities.js';
import { Cards } from './cards.js';
import { Daily } from './daily.js';
import { Hedwig } from './hedwig.js';
import { SPELLS } from './arsenal.js';
import { Guide } from './guide.js';
import { Settings } from './settings.js';
import { Sync, setConflictHandler } from './sync.js';
import { buildPanel, repaint as repaintCloud, showConflict } from './sync-ui.js';

// ─── FX / sky / cursor init (must run before other listeners use FX) ────────
FX.init();
initSky();
initCursor();
initTilt();
Snitch.init();
Hedwig.init();
Cards.init();
Daily.init();
Guide.init();

// ─── House picker ────────────────────────────────────────────────────────────
document.querySelectorAll('.house-btn').forEach(btn => {
  const house = btn.dataset.house || null;
  btn.addEventListener('click', () => setQuickHouse(house));
});

// ─── Splash portals ──────────────────────────────────────────────────────────
document.getElementById('journey-btn').addEventListener('click', (e) => Journey.enter(e));
document.getElementById('quick-btn').addEventListener('click', () => {
  AudioEngine.playClick();
  updateQuickScreen();
  applyQuickHouse(); // repaints any previously-declared house — splash itself stays neutral
  switchScreen('screen-welcome', 'screen-quick');
  Guide.playBeatOnce('quick-intro');
});
document.getElementById('quick-back').addEventListener('click', () => {
  AudioEngine.playClick();
  switchScreen('screen-quick', 'screen-welcome', updateWelcomeScreen);
});

// ─── Difficulty buttons ──────────────────────────────────────────────────────
document.querySelector('.diff-easy').addEventListener('click', (e) => startQuiz('easy', e));
document.querySelector('.diff-medium').addEventListener('click', (e) => startQuiz('medium', e));
document.querySelector('.diff-hard').addEventListener('click', (e) => startQuiz('hard', e));
document.querySelector('.diff-mixed').addEventListener('click', (e) => startQuiz('mixed', e));
document.getElementById('expert-btn').addEventListener('click', (e) => startQuiz('expert', e));

// ─── Next question ───────────────────────────────────────────────────────────
document.getElementById('next-btn').addEventListener('click', () => nextQuestion());

// ─── Arsenal + house abilities (quick play) ──────────────────────────────────
// Quick-play rounds get a round-scoped free Obliviate (the legacy 50/50), plus
// any persistent charges and the chosen house's passive. The snitch's reward
// now flows through the arsenal (round-scoped Obliviate top-up, cap 2 — same as
// the old 50/50 restore).
setQuickConfigDecorator((base) => composeRoundHooks(base, { freeObliviate: true, house: getQuickHouse() }));
Snitch.setRewardCallback(() => Arsenal.onSnitchCaught());

// Hedwig's letter: 70% a random spell charge, 30% a Chocolate Frog card.
// The callback performs the reward and returns the line shown in the letter.
Hedwig.setLetterCallback(() => {
  if (Math.random() < 0.7) {
    const id = Arsenal.grantRandom();
    return `A spell charge flutters out: ${SPELLS[id] ? SPELLS[id].glyph + ' ' + SPELLS[id].name : 'a charge'}!`;
  }
  const card = Cards.awardRoll('common');
  return `Tucked inside: a Chocolate Frog card — ${card ? card.emoji + ' ' + card.name : 'a new card'}!`;
});

// ─── Daily Prophet + Gallery entry buttons ───────────────────────────────────
document.getElementById('daily-btn')?.addEventListener('click', (e) => Daily.open(e));
document.getElementById('gallery-btn')?.addEventListener('click', () => Cards.openGallery());

// ─── Result screen buttons ───────────────────────────────────────────────────
const resultBtns = document.querySelectorAll('.result-btns .play-again-btn');
resultBtns[0].addEventListener('click', () => resultPrimary());
resultBtns[1].addEventListener('click', () => resultSecondary());

// ─── Sound controls ──────────────────────────────────────────────────────────
// Only quick-mute stays in the corner; track/voice/volume live in the settings
// panel, which adopts these elements at Settings.init().
document.getElementById('music-toggle').addEventListener('click', () => AudioEngine.toggle());
const volumeSlider = document.getElementById('volume-slider');
volumeSlider.value = String(AudioEngine.getVolume());
volumeSlider.addEventListener('input', (e) => AudioEngine.setVolume(parseFloat(e.target.value)));

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
updateWelcomeScreen(); // boots on the splash screen — stays neutral regardless of any stored house
AudioEngine.updateButtons();
Journey.init();
Nav.init();
Nav.setHomeCallback(() => {
  cancelSpeech();
  dismissCard();
  updateWelcomeScreen();
  Journey.refreshCTA();
});
Settings.init(); // owns the voice, track, volume and motion controls

// ─── Cloud save ──────────────────────────────────────────────────────────────
// Wired here so settings.js never imports sync/cloud and gameplay never awaits
// the network: if any of this fails, the game is exactly what it was before.
Settings.setCloudPanel(buildPanel(), repaintCloud, () => Sync.forcePushLocal());
setConflictHandler(showConflict);
Sync.onChange(repaintCloud);
Sync.init();
