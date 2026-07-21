// ─── settings.js: ⚙️ settings panel ─────────────────────────────────────────
// Follows the nav.js pattern: builds its own DOM, imports only downward
// (settings -> audio/dialogue/fx/quiz/journey), and is init'd once by main.js.
//
// Why a panel and not a first-run gate: every preference here already persists
// and already defaults sensibly, so there is nothing a player needs to
// "confirm" before playing. What was missing was somewhere to *find* them —
// the corner cluster was four unlabelled emoji with no tooltips, and three of
// the four music tracks were unreachable because the track button was hidden
// while sound was off. This surfaces all of it without taxing time-to-play.

import { AudioEngine, TRACK_LABELS, SELECTABLE } from './audio.js';
import { isVoiceOn, setVoiceOn, onVoiceChange } from './dialogue.js';
import { FX, getMotionPref, setMotionPref } from './fx.js';
import { showToast } from './quiz.js';
import { resetProgress } from './journey.js';
import { NUDGE_KEY, PREF_KEYS, LOCAL_ONLY_KEYS } from './prefs-keys.js';

// Re-exported so existing importers keep working now the definition lives in a
// leaf shared with sync.js (see prefs-keys.js for why it has to be shared).
export { PREF_KEYS };
const MOTION_OPTS = [
  ['auto', 'Auto'],
  ['full', 'Full'],
  ['reduced', 'Reduced'],
];

let gearBtn = null;
let overlay = null;
let lastFocus = null;

function h(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
}

function row(labelText, controlEl, hintText) {
  const r = h('div', 'settings-row');
  const left = h('div', 'settings-row-label');
  left.appendChild(h('span', 'settings-label', labelText));
  if (hintText) left.appendChild(h('span', 'settings-hint', hintText));
  r.appendChild(left);
  r.appendChild(controlEl);
  return r;
}

// A labelled on/off control. role=switch so it announces its state rather than
// relying on the opacity change the old emoji buttons used.
function makeSwitch(id, label, getState, onToggle) {
  const btn = h('button', 'settings-switch');
  btn.id = id;
  btn.type = 'button';
  btn.setAttribute('role', 'switch');
  const paint = () => {
    const on = getState();
    btn.setAttribute('aria-checked', String(on));
    btn.textContent = on ? 'On' : 'Off';
    btn.title = `${label}: ${on ? 'on' : 'off'}`;
  };
  btn.addEventListener('click', () => { onToggle(!getState()); paint(); });
  paint();
  btn._paint = paint;
  return btn;
}

function makeChoices(groupLabel, options, getValue, onPick) {
  const wrap = h('div', 'settings-choices');
  wrap.setAttribute('role', 'radiogroup');
  wrap.setAttribute('aria-label', groupLabel);
  const buttons = options.map(([value, label]) => {
    const b = h('button', 'settings-choice', label);
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.dataset.value = value;
    b.title = label;
    b.addEventListener('click', () => { onPick(value); paint(); });
    wrap.appendChild(b);
    return b;
  });
  const paint = () => {
    const cur = getValue();
    buttons.forEach(b => b.setAttribute('aria-checked', String(b.dataset.value === cur)));
  };
  paint();
  wrap._paint = paint;
  return wrap;
}

function buildDOM() {
  // Live inside the existing cluster so it inherits the fixed position and the
  // mobile row layout for free, and can't collide with nav's top-left button.
  gearBtn = h('button', 'sound-btn settings-btn', '⚙️');
  gearBtn.id = 'settings-btn';
  gearBtn.type = 'button';
  gearBtn.setAttribute('aria-label', 'Settings');
  gearBtn.setAttribute('aria-expanded', 'false');
  gearBtn.title = 'Settings';
  gearBtn.addEventListener('click', open);
  const cluster = document.querySelector('.sound-controls');
  (cluster || document.body).appendChild(gearBtn);

  overlay = h('div', 'settings-overlay hidden');
  overlay.id = 'settings-overlay';
  const card = h('div', 'settings-card');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-labelledby', 'settings-title');
  card.tabIndex = -1; // focus target on open — announces the title and keeps the card scrolled to the top

  const title = h('h2', 'settings-title', 'Settings');
  title.id = 'settings-title';
  card.appendChild(title);

  // ── sound ──
  const soundSwitch = makeSwitch('set-sound', 'Sound', () => AudioEngine.enabled, () => AudioEngine.toggle());
  card.appendChild(row('Sound', soundSwitch));

  // ── music track (the fix for tracks being undiscoverable) ──
  const trackChoices = makeChoices(
    'Music track',
    SELECTABLE.map(t => [t, TRACK_LABELS[t]]),
    () => AudioEngine.track,
    (v) => AudioEngine.setTrack(v),
  );
  const trackRow = row('Music', trackChoices, 'Shuffle rotates between them');
  trackRow.classList.add('settings-row-stack');
  card.appendChild(trackRow);

  // ── volume: adopt the real element so main.js's existing wiring holds ──
  const slots = document.getElementById('settings-slots');
  const volume = document.getElementById('volume-slider');
  if (volume) card.appendChild(row('Volume', volume));
  if (slots) slots.remove(); // now empty

  // ── voice ── same switch vocabulary as Sound, rather than a bare emoji
  const voiceSwitch = makeSwitch('set-voice', 'Character voices', isVoiceOn, setVoiceOn);
  card.appendChild(row('Character voices', voiceSwitch, 'Spoken lines from Hagrid & co.'));

  // ── motion ──
  const motionChoices = makeChoices(
    'Motion',
    MOTION_OPTS,
    () => getMotionPref(),
    (v) => setMotionPref(v),
  );
  const motionRow = row('Motion', motionChoices, 'Reduced trims animations and effects');
  motionRow.classList.add('settings-row-stack');
  card.appendChild(motionRow);

  // ── destructive ──
  const danger = h('div', 'settings-danger');
  const resetJourneyBtn = h('button', 'link-btn settings-danger-btn', 'Reset journey');
  resetJourneyBtn.type = 'button';
  resetJourneyBtn.title = 'Clear journey progress, name and house';
  armTwoTap(resetJourneyBtn, 'Reset journey', 'Tap again to reset your journey', () => {
    resetProgress();
    showToast('Journey reset.');
  });
  const eraseBtn = h('button', 'link-btn settings-danger-btn', 'Erase everything');
  eraseBtn.type = 'button';
  eraseBtn.title = 'Delete all progress and collections';
  eraseBtn.addEventListener('click', showEraseConfirm);
  danger.appendChild(resetJourneyBtn);
  danger.appendChild(eraseBtn);
  card.appendChild(danger);

  const done = h('button', 'play-again-btn settings-done', 'Done');
  done.id = 'set-close';
  done.type = 'button';
  done.addEventListener('click', close);
  card.appendChild(done);

  overlay.appendChild(card);
  document.body.appendChild(overlay);

  // scrim click closes; clicks inside the card don't bubble out to here
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  overlay._paints = [soundSwitch._paint, trackChoices._paint, motionChoices._paint];
}

// The milder reset keeps the two-tap pattern already used in Journey.
function armTwoTap(btn, idleLabel, armedLabel, onConfirm) {
  let armed = false, timer = null;
  btn.addEventListener('click', () => {
    if (!armed) {
      armed = true;
      btn.textContent = armedLabel;
      btn.classList.add('armed');
      clearTimeout(timer);
      timer = setTimeout(() => {
        armed = false; btn.textContent = idleLabel; btn.classList.remove('armed');
      }, 3500);
      return;
    }
    clearTimeout(timer);
    armed = false; btn.textContent = idleLabel; btn.classList.remove('armed');
    onConfirm();
  });
}

// "Erase everything" is destructive enough that a two-tap link is too easy to
// fire twice by accident — it takes a real dialog naming what goes and what stays.
function showEraseConfirm() {
  const confirmEl = h('div', 'settings-confirm');
  confirmEl.innerHTML = `
    <div class="settings-confirm-card">
      <p class="settings-confirm-title">Erase everything?</p>
      <p class="settings-confirm-text">
        This deletes your journey, house, name, spell charges, Frog Card collection,
        Daily Prophet streak and Expert unlock. Sound and display preferences are kept.
        This cannot be undone.
      </p>
      <div class="settings-confirm-btns">
        <button class="play-again-btn settings-cancel" type="button">Cancel</button>
        <button class="play-again-btn settings-erase" type="button">Erase everything</button>
      </div>
    </div>`;
  overlay.appendChild(confirmEl);
  const cancel = confirmEl.querySelector('.settings-cancel');
  cancel.addEventListener('click', () => confirmEl.remove());
  confirmEl.querySelector('.settings-erase').addEventListener('click', eraseEverything);
  cancel.focus(); // safe option holds focus
}

function eraseEverything() {
  // LOCAL_ONLY_KEYS, not just PREF_KEYS: the cloud session has to survive the
  // clear() below, or the child is signed out mid-erase and the matching wipe
  // never reaches the cloud — leaving a full save online that "erase
  // everything" claimed to delete.
  const keep = {};
  LOCAL_ONLY_KEYS.forEach(k => { const v = localStorage.getItem(k); if (v !== null) keep[k] = v; });
  try { localStorage.clear(); } catch (e) { /* ignore */ }
  Object.entries(keep).forEach(([k, v]) => { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } });
  // Cards and Daily hold in-memory caches with no reset API, so a reload is the
  // honest way to make a full wipe actually show everywhere.
  location.reload();
}

function refresh() {
  if (!overlay) return;
  overlay._paints.forEach(p => p());
}

// ─── open/close + focus handling ─────────────────────────────────────────────
function focusables() {
  return [...overlay.querySelectorAll('button, input, [tabindex]:not([tabindex="-1"])')]
    .filter(el => !el.disabled && el.offsetParent !== null);
}

function onKeydown(e) {
  if (e.key === 'Escape') { e.preventDefault(); close(); return; }
  if (e.key !== 'Tab') return;
  const items = focusables();
  if (!items.length) return;
  const first = items[0], last = items[items.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

function open() {
  if (!overlay) return;
  // The gear is the only opener, so return focus there on close rather than to
  // whatever happened to be focused — a mouse click may not focus the button at
  // all, which would otherwise strand focus on <body>.
  lastFocus = gearBtn;
  refresh();
  overlay.classList.remove('hidden');
  gearBtn.setAttribute('aria-expanded', 'true');
  document.addEventListener('keydown', onKeydown, true);
  const card = overlay.querySelector('.settings-card');
  if (card) { card.scrollTop = 0; card.focus(); }
}

function close() {
  if (!overlay) return;
  overlay.querySelectorAll('.settings-confirm').forEach(el => el.remove());
  overlay.classList.add('hidden');
  gearBtn.setAttribute('aria-expanded', 'false');
  document.removeEventListener('keydown', onKeydown, true);
  if (lastFocus && lastFocus.focus) lastFocus.focus();
  lastFocus = null;
}

// One-off pointer for brand-new players, so the corner chrome isn't the only
// signal that sound and voices exist. Non-blocking: the toast is
// pointer-events:none and auto-dismisses.
function maybeNudge() {
  const fresh = localStorage.getItem('hp_sound') === null;
  if (!fresh || localStorage.getItem(NUDGE_KEY)) return;
  try { localStorage.setItem(NUDGE_KEY, '1'); } catch (e) { /* ignore */ }
  setTimeout(() => showToast('Music, voices & settings live behind the ⚙️ up top.'), 1400);
}

export const Settings = {
  init() {
    if (gearBtn) return;
    buildDOM();
    AudioEngine.onChange(refresh); // corner mute and panel stay in lockstep
    onVoiceChange(refresh);
    maybeNudge();
  },
  open,
  close,
};
