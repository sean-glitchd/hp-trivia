// ─── dialogue.js: character voice, hp_name, speech cards, grade seals, TTS ──
// Owns hp_name + hp_voice. Only imports audio.js (for sfxReady-style gating
// of speech synthesis) — journey.js is the only module that imports this one,
// so there is no cycle: journey.js -> dialogue.js -> audio.js.

import { AudioEngine } from './audio.js';

// ─── CHARACTERS ──────────────────────────────────────────────────────────────
export const CHARACTERS = {
  mcgonagall: { name: 'Professor McGonagall', emoji: '🎩', color: '#d3a625' },
  snape:      { name: 'Professor Snape',      emoji: '🧪', color: '#2ea86e' },
  hagrid:     { name: 'Hagrid',                emoji: '🗝️', color: '#c98a4b' },
  dumbledore: { name: 'Albus Dumbledore',      emoji: '🧙‍♂️', color: '#9b7fd4' },
  nick:       { name: 'Nearly Headless Nick',  emoji: '👻', color: '#9ec3f0' },
  friar:      { name: 'The Fat Friar',         emoji: '🍩', color: '#e3b53d' },
  hat:        { name: 'The Sorting Hat',       emoji: '🎩', color: '#8a5a2e' },
  voldemort:  { name: 'Lord Voldemort',        emoji: '🐍', color: '#7a1f1f' },
};

// ─── LINES ───────────────────────────────────────────────────────────────────
// {name} is interpolated at display time. Multiple lines may share a trigger —
// one is picked at random each time.
export const LINES = [
  // grade O — perfect/near-perfect (100%)
  { trigger: 'grade-o', char: 'mcgonagall', text: 'Outstanding, {name}. I see no reason whatsoever to hide my delight.' },
  { trigger: 'grade-o', char: 'dumbledore', text: 'I have rarely seen such a performance, {name}. Curious. Very well done indeed.' },
  // grade E — 80-99%
  { trigger: 'grade-e', char: 'mcgonagall', text: 'Exceeds Expectations. Keep this up, {name}, and your house will be very proud.' },
  { trigger: 'grade-e', char: 'hagrid', text: 'Knew yeh had it in yeh, {name}! Great one, that was!' },
  // grade A — 60-79%
  { trigger: 'grade-a', char: 'mcgonagall', text: 'Acceptable, {name}. Which, at Hogwarts, is no small thing. More library, less Quidditch.' },
  { trigger: 'grade-a', char: 'nick', text: 'Perfectly respectable, {name}. Not everyone can be top of the class — or keep their head.' },
  // grade P — 40-59%
  { trigger: 'grade-p', char: 'snape', text: 'Poor. I confess myself… entirely unsurprised, {name}.' },
  { trigger: 'grade-p', char: 'mcgonagall', text: 'Poor, {name}. I expect better — because I know you are capable of better.' },
  // grade D — 20-39%
  { trigger: 'grade-d', char: 'snape', text: 'Dreadful. Tell me, {name} — did you open the book at all, or merely admire the cover?' },
  // grade T — below 20%
  { trigger: 'grade-t', char: 'snape', text: 'Troll. Astonishing, {name}. I did not think it could be done.' },
  { trigger: 'grade-t', char: 'hagrid', text: "Don' worry, {name}. Firs' tries never count. Have a rock cake an' go again." },

  // streaks
  { trigger: 'streak-3', char: 'hagrid', text: 'Three in a row! Yer a natural, {name}, no mistake!' },
  { trigger: 'streak-5', char: 'mcgonagall', text: 'Five consecutive correct answers. I am rarely impressed, {name}. Consider me impressed.' },
  { trigger: 'streak-8', char: 'dumbledore', text: 'Remarkable, {name}. Simply remarkable.' },

  // first wrong answer of a round
  { trigger: 'first-wrong', char: 'nick', text: "Don't lose your head over one mistake, {name} — I speak from experience." },
  { trigger: 'first-wrong', char: 'snape', text: 'Wrong. Do concentrate, {name}.' },

  // year pass / fail
  { trigger: 'year-pass', char: 'mcgonagall', text: 'You have passed the year, {name}. Report to the feast — and do try not to look smug.' },
  { trigger: 'year-fail', char: 'mcgonagall', text: 'You shall repeat the year, {name}. There is no shame in that — only in giving up.' },

  // O.W.L.s intro
  { trigger: 'owl-intro', char: 'mcgonagall', text: 'These are your O.W.L.s, {name}. I expect nothing less than your very best.' },

  // perfect round (10/10)
  { trigger: 'perfect-round', char: 'dumbledore', text: 'Ten out of ten, {name}. I award you the rarest thing I have — my full attention.' },

  // sorting
  { trigger: 'sorting-greet', char: 'hat', text: 'Ah — {name}. Plenty in this head, I see. Let us look closer…' },

  // the duel (Year 7)
  { trigger: 'duel-start', char: 'voldemort', text: 'So… {name}. They send a child to face Lord Voldemort.' },
  { trigger: 'duel-win', char: 'dumbledore', text: 'It is our choices, {name}, that show what we truly are. You chose well.' },
  { trigger: 'duel-loss', char: 'voldemort', text: 'Crawl back to your castle, {name}. We shall finish this another day.' },
  { trigger: 'duel-hit', char: 'voldemort', text: 'You DARE?!' },
  { trigger: 'duel-hit', char: 'voldemort', text: 'A lucky strike, {name}. Nothing more.' },

  // legendary Chocolate Frog card reveal (cards.js)
  { trigger: 'card-legendary', char: 'dumbledore', text: 'A legendary card, {name}? How extraordinary. Chocolate Frogs never cease to surprise even me.' },
  { trigger: 'card-legendary', char: 'hagrid', text: 'Blimey, {name} — I haven\'t seen a card like that since I was a boy!' },
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
  el.querySelector('.speech-avatar').textContent = char.emoji;
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
    speak(text);
  } else if (commentEl) {
    commentEl.textContent = '';
  }
  return letter;
}

// ─── speech synthesis (voice) ────────────────────────────────────────────────
export function isVoiceOn() {
  return localStorage.getItem('hp_voice') === 'on';
}

export function speak(text) {
  if (!('speechSynthesis' in window)) return;
  if (!isVoiceOn()) return;
  if (!AudioEngine.enabled) return; // "only fires when sound is enabled"
  try {
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(text);
    const voices = window.speechSynthesis.getVoices();
    const gb = voices.find(v => /en-GB/i.test(v.lang)) || voices.find(v => /^en/i.test(v.lang));
    if (gb) utt.voice = gb;
    utt.rate = 0.95;
    window.speechSynthesis.speak(utt);
  } catch (e) { /* unsupported or blocked — no-op */ }
}

export function cancelSpeech() {
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
