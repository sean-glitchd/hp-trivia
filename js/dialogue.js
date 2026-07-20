// ─── dialogue.js: character voice, hp_name, speech cards, grade seals, TTS ──
// Owns hp_name + hp_voice. Only imports audio.js (for sfxReady-style gating
// of speech synthesis) — journey.js is the only module that imports this one,
// so there is no cycle: journey.js -> dialogue.js -> audio.js.

import { AudioEngine } from './audio.js';

// A hand-drawn portrait bust — the 🗝️/🧑‍🌾 emoji used before didn't read as
// Hagrid at all. Same low-detail bezier-path style as the Sorting Hat SVG
// (js/journey.js), sized to sit centered in a small circular/square avatar
// slot: big dark bushy hair + beard framing a ruddy face, small peeking eyes.
export const HAGRID_SVG = `
<svg class="hagrid-svg" width="1em" height="1em" viewBox="0 0 88 88" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path d="M6 88 Q12 64 44 62 Q76 64 82 88 Z" fill="#4a3824"/>
  <ellipse cx="44" cy="40" rx="21" ry="25" fill="#d99c6b"/>
  <path d="M12 46 Q6 14 44 8 Q82 14 76 46 Q74 28 63 23 Q67 34 60 40 Q59 21 44 17 Q29 21 28 40 Q21 34 25 23 Q14 28 12 46 Z" fill="#2e2015"/>
  <path d="M18 42 Q14 66 30 80 Q44 88 58 80 Q74 66 70 42 Q60 52 44 52 Q28 52 18 42 Z" fill="#362415" stroke="#241708" stroke-width="1"/>
  <path d="M30 60 Q34 66 30 72" stroke="#241708" stroke-width="1.2" fill="none" opacity="0.5"/>
  <path d="M58 60 Q54 66 58 72" stroke="#241708" stroke-width="1.2" fill="none" opacity="0.5"/>
  <path d="M30 34 Q35 30 40 33" stroke="#241708" stroke-width="3" fill="none" stroke-linecap="round"/>
  <path d="M48 33 Q53 30 58 34" stroke="#241708" stroke-width="3" fill="none" stroke-linecap="round"/>
  <circle cx="35" cy="39" r="2.6" fill="#1a1108"/>
  <circle cx="53" cy="39" r="2.6" fill="#1a1108"/>
  <ellipse cx="26" cy="46" rx="5" ry="3.4" fill="#e8836a" opacity="0.35"/>
  <ellipse cx="62" cy="46" rx="5" ry="3.4" fill="#e8836a" opacity="0.35"/>
  <path d="M44 38 Q42 45 44 48 Q46 46 45 44" stroke="#b87a4f" stroke-width="1.6" fill="none" stroke-linecap="round"/>
</svg>`;

// ─── CHARACTERS ──────────────────────────────────────────────────────────────
export const CHARACTERS = {
  mcgonagall: { name: 'Professor McGonagall', emoji: '🎩', color: '#d3a625' },
  snape:      { name: 'Professor Snape',      emoji: '🧪', color: '#2ea86e' },
  hagrid:     { name: 'Hagrid',                emoji: '🗝️', svg: HAGRID_SVG, color: '#c98a4b' },
  dumbledore: { name: 'Albus Dumbledore',      emoji: '🧙‍♂️', color: '#9b7fd4' },
  nick:       { name: 'Nearly Headless Nick',  emoji: '👻', color: '#9ec3f0' },
  friar:      { name: 'The Fat Friar',         emoji: '🍩', color: '#e3b53d' },
  hat:        { name: 'The Sorting Hat',       emoji: '🎩', color: '#8a5a2e' },
  voldemort:  { name: 'Lord Voldemort',        emoji: '🐍', color: '#7a1f1f' },
};

// ─── LINES ───────────────────────────────────────────────────────────────────
// {name} is interpolated at display time. Multiple lines may share a trigger —
// one is picked at random each time. `id` maps to a pre-recorded voice clip at
// audio/voices/<id>.m4a (see scripts/generate-voices.mjs); speakLine() plays
// that clip and falls back to tuned Web Speech (with the real {name}) if it's
// missing or fails to load.
export const LINES = [
  // grade O — perfect/near-perfect (100%)
  { id: 'grade-o-mcgonagall', trigger: 'grade-o', char: 'mcgonagall', text: 'Outstanding, {name}. I see no reason whatsoever to hide my delight.' },
  { id: 'grade-o-dumbledore', trigger: 'grade-o', char: 'dumbledore', text: 'I have rarely seen such a performance, {name}. Curious. Very well done indeed.' },
  // grade E — 80-99%
  { id: 'grade-e-mcgonagall', trigger: 'grade-e', char: 'mcgonagall', text: 'Exceeds Expectations. Keep this up, {name}, and your house will be very proud.' },
  { id: 'grade-e-hagrid', trigger: 'grade-e', char: 'hagrid', text: 'Knew yeh had it in yeh, {name}! Great one, that was!' },
  // grade A — 60-79%
  { id: 'grade-a-mcgonagall', trigger: 'grade-a', char: 'mcgonagall', text: 'Acceptable, {name}. Which, at Hogwarts, is no small thing. More library, less Quidditch.' },
  { id: 'grade-a-nick', trigger: 'grade-a', char: 'nick', text: 'Perfectly respectable, {name}. Not everyone can be top of the class — or keep their head.' },
  // grade P — 40-59%
  { id: 'grade-p-snape', trigger: 'grade-p', char: 'snape', text: 'Poor. I confess myself… entirely unsurprised, {name}.' },
  { id: 'grade-p-mcgonagall', trigger: 'grade-p', char: 'mcgonagall', text: 'Poor, {name}. I expect better — because I know you are capable of better.' },
  // grade D — 20-39%
  { id: 'grade-d-snape', trigger: 'grade-d', char: 'snape', text: 'Dreadful. Tell me, {name} — did you open the book at all, or merely admire the cover?' },
  // grade T — below 20%
  { id: 'grade-t-snape', trigger: 'grade-t', char: 'snape', text: 'Troll. Astonishing, {name}. I did not think it could be done.' },
  { id: 'grade-t-hagrid', trigger: 'grade-t', char: 'hagrid', text: "Don' worry, {name}. Firs' tries never count. Have a rock cake an' go again." },

  // streaks
  { id: 'streak-3-hagrid', trigger: 'streak-3', char: 'hagrid', text: 'Three in a row! Yer a natural, {name}, no mistake!' },
  { id: 'streak-5-mcgonagall', trigger: 'streak-5', char: 'mcgonagall', text: 'Five consecutive correct answers. I am rarely impressed, {name}. Consider me impressed.' },
  { id: 'streak-8-dumbledore', trigger: 'streak-8', char: 'dumbledore', text: 'Remarkable, {name}. Simply remarkable.' },

  // first wrong answer of a round
  { id: 'first-wrong-nick', trigger: 'first-wrong', char: 'nick', text: "Don't lose your head over one mistake, {name} — I speak from experience." },
  { id: 'first-wrong-snape', trigger: 'first-wrong', char: 'snape', text: 'Wrong. Do concentrate, {name}.' },

  // year pass / fail
  { id: 'year-pass-mcgonagall', trigger: 'year-pass', char: 'mcgonagall', text: 'You have passed the year, {name}. Report to the feast — and do try not to look smug.' },
  { id: 'year-fail-mcgonagall', trigger: 'year-fail', char: 'mcgonagall', text: 'You shall repeat the year, {name}. There is no shame in that — only in giving up.' },

  // O.W.L.s intro
  { id: 'owl-intro-mcgonagall', trigger: 'owl-intro', char: 'mcgonagall', text: 'These are your O.W.L.s, {name}. I expect nothing less than your very best.' },

  // perfect round (10/10)
  { id: 'perfect-round-dumbledore', trigger: 'perfect-round', char: 'dumbledore', text: 'Ten out of ten, {name}. I award you the rarest thing I have — my full attention.' },

  // sorting
  { id: 'sorting-greet-hat', trigger: 'sorting-greet', char: 'hat', text: 'Ah — {name}. Plenty in this head, I see. Let us look closer…' },

  // the duel (Year 7)
  { id: 'duel-start-voldemort', trigger: 'duel-start', char: 'voldemort', text: 'So… {name}. They send a child to face Lord Voldemort.' },
  { id: 'duel-win-dumbledore', trigger: 'duel-win', char: 'dumbledore', text: 'It is our choices, {name}, that show what we truly are. You chose well.' },
  { id: 'duel-loss-voldemort', trigger: 'duel-loss', char: 'voldemort', text: 'Crawl back to your castle, {name}. We shall finish this another day.' },
  { id: 'duel-hit-voldemort-1', trigger: 'duel-hit', char: 'voldemort', text: 'You DARE?!' },
  { id: 'duel-hit-voldemort-2', trigger: 'duel-hit', char: 'voldemort', text: 'A lucky strike, {name}. Nothing more.' },

  // legendary Chocolate Frog card reveal (cards.js)
  { id: 'card-legendary-dumbledore', trigger: 'card-legendary', char: 'dumbledore', text: 'A legendary card, {name}? How extraordinary. Chocolate Frogs never cease to surprise even me.' },
  { id: 'card-legendary-hagrid', trigger: 'card-legendary', char: 'hagrid', text: 'Blimey, {name} — I haven\'t seen a card like that since I was a boy!' },
];

const SEAL_COLOR = { O: '#c9a84c', E: '#4caf7a', A: '#6c9fd8', P: '#f0a060', D: '#e0703c', T: '#dc3c3c' };

// ─── name (hp_name) ──────────────────────────────────────────────────────────
function sanitize(raw) {
  return (raw || '').replace(/[<>&]/g, '').trim().slice(0, 20);
}

export function hasName() {
  return !!localStorage.getItem('hp_name');
}

export function getName() {
  const n = sanitize(localStorage.getItem('hp_name') || '');
  return n || 'young wizard';
}

export function setName(raw) {
  const n = sanitize(raw) || 'young wizard';
  localStorage.setItem('hp_name', n);
  return n;
}

// ─── line lookup + interpolation ─────────────────────────────────────────────
function interpolate(text, ctx) {
  const name = (ctx && ctx.name) || getName();
  return text.replace(/\{name\}/g, name);
}

function pickLine(trigger) {
  const candidates = LINES.filter(l => l.trigger === trigger);
  if (!candidates.length) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

// ─── speech card presentation ────────────────────────────────────────────────
let cardEl = null;
let dismissTimer = null;

function ensureCard() {
  if (cardEl) return cardEl;
  cardEl = document.createElement('div');
  cardEl.id = 'speech-card';
  cardEl.className = 'speech-card';
  cardEl.setAttribute('aria-live', 'polite');
  cardEl.innerHTML = `
    <div class="speech-avatar"></div>
    <div class="speech-body">
      <div class="speech-name"></div>
      <div class="speech-text"></div>
    </div>`;
  document.body.appendChild(cardEl);
  return cardEl;
}

function showCard(line) {
  const el = ensureCard();
  const char = CHARACTERS[line.char] || CHARACTERS.hat;
  el.style.setProperty('--char-color', char.color);
  const avatar = el.querySelector('.speech-avatar');
  if (char.svg) avatar.innerHTML = char.svg; else avatar.textContent = char.emoji;
  el.querySelector('.speech-name').textContent = char.name;
  el.querySelector('.speech-text').textContent = line.text;
  el.classList.add('speech-show');
  clearTimeout(dismissTimer);
  dismissTimer = setTimeout(() => el.classList.remove('speech-show'), 4000);
}

export function dismissCard() {
  if (cardEl) cardEl.classList.remove('speech-show');
  clearTimeout(dismissTimer);
}

// ─── say / quip ──────────────────────────────────────────────────────────────
let quipsThisRound = 0;
let questionsSinceLastQuip = 99;

export function resetRound() {
  quipsThisRound = 0;
  questionsSinceLastQuip = 99;
}

export function noteQuestionShown() {
  questionsSinceLastQuip++;
}

export function say(trigger, ctx) {
  const line = pickLine(trigger);
  if (!line) return null;
  const resolved = { ...line, text: interpolate(line.text, ctx) };
  showCard(resolved);
  speakLine(resolved);
  return resolved;
}

// Throttled: at most 2 per round, at least 3 questions apart, plus a 50%
// suppression roll on top of that gate (so even an eligible quip often stays
// quiet — the aim is "occasional flavor", not commentary on every question).
export function quip(trigger, ctx) {
  if (quipsThisRound >= 2) return null;
  if (questionsSinceLastQuip < 3) return null;
  if (Math.random() < 0.5) return null;
  const line = pickLine(trigger);
  if (!line) return null;
  const resolved = { ...line, text: interpolate(line.text, ctx) };
  showCard(resolved);
  speakLine(resolved);
  quipsThisRound++;
  questionsSinceLastQuip = 0;
  return resolved;
}

// ─── grading ─────────────────────────────────────────────────────────────────
export function grade(score, total) {
  const pct = total > 0 ? (score / total) * 100 : 0;
  if (pct >= 100) return 'O';
  if (pct >= 80) return 'E';
  if (pct >= 60) return 'A';
  if (pct >= 40) return 'P';
  if (pct >= 20) return 'D';
  return 'T';
}

// Replaces the quick-play rating/comment with a Cinzel grade-seal + the
// character's line. Journey-only — quick mode keeps its own rating/comment
// from quiz.js's renderResultShell(), called just before this by the caller.
export function renderGradeSeal(score, total) {
  const letter = grade(score, total);
  const perfect = score === total && total === 10;
  const line = (perfect && pickLine('perfect-round')) || pickLine(`grade-${letter.toLowerCase()}`);

  const ratingEl = document.getElementById('result-rating');
  const commentEl = document.getElementById('result-comment');
  if (ratingEl) {
    ratingEl.innerHTML = `<div class="grade-seal" style="--seal-color:${SEAL_COLOR[letter]}"><span>${letter}</span></div>`;
  }
  if (line && commentEl) {
    const char = CHARACTERS[line.char] || CHARACTERS.hat;
    const text = interpolate(line.text, {});
    commentEl.innerHTML = `<span class="grade-line-char" style="color:${char.color}">${char.emoji} ${char.name}</span><span class="grade-line-text">"${text}"</span>`;
    speakLine({ id: line.id, char: line.char, text });
  } else if (commentEl) {
    commentEl.textContent = '';
  }
  return letter;
}

// ─── speech synthesis (voice) ────────────────────────────────────────────────
export function isVoiceOn() {
  return localStorage.getItem('hp_voice') === 'on';
}

// Per-character voice character: pitch (lower = deeper) + rate (lower = slower),
// with a gender hint used when the device offers both. Browser TTS is still
// synthetic, but distinct pitch/rate + a good system voice reads far less flat.
const VOICE_PROFILES = {
  hagrid:     { pitch: 0.6,  rate: 0.85, gender: 'male' },   // big, warm, slow
  mcgonagall: { pitch: 1.1,  rate: 1.0,  gender: 'female' }, // crisp, precise
  dumbledore: { pitch: 0.9,  rate: 0.82, gender: 'male' },   // measured, gentle
  snape:      { pitch: 0.7,  rate: 0.9,  gender: 'male' },   // low, deliberate
  hat:        { pitch: 0.85, rate: 0.9 },
  voldemort:  { pitch: 0.5,  rate: 0.9,  gender: 'male' },   // cold, deep
  nick:       { pitch: 1.05, rate: 0.95, gender: 'male' },
  friar:      { pitch: 0.95, rate: 0.9,  gender: 'male' },
  default:    { pitch: 1.0,  rate: 0.95 },
};

// getVoices() is async on first load — cache and refresh on 'voiceschanged'
// so the first utterance isn't stuck with an empty list.
let cachedVoices = [];
function loadVoices() {
  if (!('speechSynthesis' in window)) return;
  cachedVoices = window.speechSynthesis.getVoices() || [];
}
if ('speechSynthesis' in window) {
  loadVoices();
  try { window.speechSynthesis.addEventListener('voiceschanged', loadVoices); } catch (e) { /* ignore */ }
}

const GB_PRIORITY = ['Daniel', 'Arthur', 'Serena', 'Kate', 'Oliver', 'Google UK English Male', 'Google UK English Female'];
const MALE_HINTS = /daniel|arthur|oliver|james|george|fred|male|man/i;
const FEMALE_HINTS = /serena|kate|fiona|moira|karen|tessa|martha|female|woman/i;

function pickVoice(profile) {
  if (!cachedVoices.length) return null;
  const gb = cachedVoices.filter(v => /en-GB/i.test(v.lang));
  const pool = gb.length ? gb : cachedVoices.filter(v => /^en/i.test(v.lang));
  if (!pool.length) return null;
  if (profile.gender === 'male') { const m = pool.find(v => MALE_HINTS.test(v.name)); if (m) return m; }
  if (profile.gender === 'female') { const f = pool.find(v => FEMALE_HINTS.test(v.name)); if (f) return f; }
  for (const name of GB_PRIORITY) { const hit = pool.find(v => v.name.includes(name)); if (hit) return hit; }
  return pool[0];
}

// `onDone` (optional) fires once speech ends/errors/is unsupported — speakLine()
// uses it to restore ducked music exactly once regardless of which path speaks.
export function speak(text, characterKey = 'default', onDone) {
  const done = () => { if (onDone) onDone(); };
  if (!('speechSynthesis' in window)) { done(); return; }
  if (!isVoiceOn()) { done(); return; }
  if (!AudioEngine.enabled) { done(); return; } // "only fires when sound is enabled"
  try {
    window.speechSynthesis.cancel();
    const profile = VOICE_PROFILES[characterKey] || VOICE_PROFILES.default;
    const utt = new SpeechSynthesisUtterance(text);
    const v = pickVoice(profile);
    if (v) utt.voice = v;
    utt.pitch = profile.pitch;
    utt.rate = profile.rate;
    utt.volume = AudioEngine.getVolume ? AudioEngine.getVolume() : 1;
    utt.onend = done;
    utt.onerror = done;
    window.speechSynthesis.speak(utt);
  } catch (e) { done(); /* unsupported or blocked */ }
}

// ─── pre-recorded voice clips (audio/voices/<id>.m4a) ───────────────────────
// Real character audio, generated offline via scripts/generate-voices.mjs
// (macOS `say` + afconvert — no API keys, no network at runtime). speakLine()
// tries the clip first and falls back to tuned Web Speech (with the player's
// actual name, since the clips are recorded name-free) if it's missing, still
// generating, or fails to load — so every line stays sayable even before its
// clip exists.
let currentVoiceAudio = null;
// Fires (once) whenever the in-flight line's speech ends, errors, or gets cut
// off by an interruption — guarantees ducked music is never left stuck low.
let currentVoiceRestore = null;

function stopVoiceAudio() {
  if (currentVoiceAudio) {
    try { currentVoiceAudio.pause(); } catch (e) { /* ignore */ }
    currentVoiceAudio = null;
  }
  if (currentVoiceRestore) {
    const restore = currentVoiceRestore;
    currentVoiceRestore = null;
    restore();
  }
}

export function speakLine(line) {
  if (!line || !line.text) return;
  if (!isVoiceOn()) return;
  if (!AudioEngine.enabled) return;
  stopVoiceAudio();
  AudioEngine.duckMusic();
  let restored = false;
  const restoreOnce = () => {
    if (restored) return;
    restored = true;
    if (currentVoiceRestore === restoreOnce) currentVoiceRestore = null;
    AudioEngine.restoreMusic();
  };
  currentVoiceRestore = restoreOnce;
  if (!line.id) { speak(line.text, line.char, restoreOnce); return; }
  try {
    const audio = new Audio(`audio/voices/${line.id}.m4a`);
    audio.volume = AudioEngine.getVolume ? AudioEngine.getVolume() : 1;
    let fellBack = false;
    const fallback = () => {
      if (fellBack) return;
      fellBack = true;
      if (currentVoiceAudio === audio) currentVoiceAudio = null;
      speak(line.text, line.char, restoreOnce);
    };
    audio.addEventListener('ended', restoreOnce);
    audio.addEventListener('error', fallback);
    currentVoiceAudio = audio;
    audio.play().catch(fallback);
  } catch (e) { speak(line.text, line.char, restoreOnce); }
}

export function cancelSpeech() {
  stopVoiceAudio();
  if (!('speechSynthesis' in window)) return;
  try { window.speechSynthesis.cancel(); } catch (e) { /* no-op */ }
}

// ─── 🗣️ voice toggle button (lives in .sound-controls) ──────────────────────
export function initVoiceToggle() {
  const btn = document.getElementById('voice-toggle');
  if (!btn) return;
  const refresh = () => {
    const on = isVoiceOn();
    btn.setAttribute('aria-pressed', String(on));
    btn.classList.toggle('active', on);
  };
  btn.addEventListener('click', () => {
    localStorage.setItem('hp_voice', isVoiceOn() ? 'off' : 'on');
    if (!isVoiceOn()) cancelSpeech();
    refresh();
  });
  refresh();
}
