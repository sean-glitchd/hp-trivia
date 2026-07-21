// ─── sync-ui.js: cloud save controls ────────────────────────────────────────
// Kept out of settings.js so settings.js never imports sync/cloud — the repo's
// acyclic rule. main.js hands the built panel to Settings.setCloudPanel(), the
// same outward-callback shape as Nav.setHomeCallback.
//
// Copy is written for a 9-year-old: "magic word" not "password", numbers not
// timestamps, and no error that reads like the app is broken when it isn't.

import { Sync } from './sync.js';
import { ERR, validateUsername } from './cloud.js';
import { showToast } from './quiz.js';
import { CLOUD_NUDGE_KEY } from './prefs-keys.js';

let statusEl = null, actionBtn = null, panelEl = null;

// One-time, non-blocking pointer to cloud save — fired by journey.js right
// after a first-time Sorting, once the player has a house worth keeping and
// nothing (the reveal overlay, Hagrid's dialogue box) is covering the screen.
// Not a gate: the game already saves locally regardless, so there's nothing to
// decide here, just something to notice. Skipped entirely if already signed
// in — nudging someone who already has an account is just noise.
export function maybeNudgeCloudSave() {
  if (Sync.getState() !== 'signed-out') return;
  if (localStorage.getItem(CLOUD_NUDGE_KEY)) return;
  try { localStorage.setItem(CLOUD_NUDGE_KEY, '1'); } catch (e) { /* ignore */ }
  showToast('Want to keep this on other devices too? Look for ☁️ in Settings.');
}

function h(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
}

// ─── status row ──────────────────────────────────────────────────────────────
const STATUS = {
  'signed-out': () => ['Not signed in', 'Sign in'],
  idle:      (u) => [`✓ Saved — ${u}`, 'Sign out'],
  saving:    ()  => ['Saving…', 'Sign out'],
  offline:   ()  => ["Will save when you're back online", 'Sign out'],
  expired:   ()  => ['Tap to sign in again', 'Sign in'],
};

export function repaint() {
  if (!statusEl) return;
  const s = Sync.getState();
  const [text, action] = (STATUS[s] || STATUS['signed-out'])(Sync.getUsername());
  statusEl.textContent = text;
  actionBtn.textContent = action;
  actionBtn.title = action === 'Sign in' ? 'Save your adventure to the cloud' : 'Stop saving on this device';
}

export function buildPanel() {
  panelEl = h('div', 'cloud-row');
  statusEl = h('span', 'cloud-status');
  actionBtn = h('button', 'settings-switch cloud-action');
  actionBtn.type = 'button';
  actionBtn.addEventListener('click', () => {
    if (Sync.getState() === 'signed-out' || Sync.getState() === 'expired') showAuth();
    else { Sync.signOut(); repaint(); showToast('Signed out. Your adventure is still on this device.'); }
  });
  panelEl.appendChild(statusEl);
  panelEl.appendChild(actionBtn);
  repaint();
  return panelEl;
}

// ─── auth dialog ─────────────────────────────────────────────────────────────
function field(labelText, type, hint) {
  const wrap = h('div', 'cloud-field');
  wrap.appendChild(h('label', 'cloud-label', labelText));
  const inputWrap = h('div', 'cloud-input-wrap');
  const input = h('input', 'typing-input cloud-input');
  input.type = type;
  // iOS capitalises usernames by default, which then silently mismatches a
  // lowercase-normalised account. Normalising covers it; these stop the child
  // seeing something different from what they typed.
  input.autocapitalize = 'none';
  input.autocorrect = 'off';
  input.spellcheck = false;
  if (type === 'password') {
    const eye = h('button', 'cloud-eye', '👁');
    eye.type = 'button';
    eye.title = 'Show or hide';
    eye.setAttribute('aria-label', 'Show or hide the magic word');
    eye.addEventListener('click', () => {
      input.type = input.type === 'password' ? 'text' : 'password';
      eye.classList.toggle('on', input.type === 'text');
    });
    inputWrap.appendChild(input);
    inputWrap.appendChild(eye);
  } else {
    inputWrap.appendChild(input);
  }
  wrap.appendChild(inputWrap);
  if (hint) wrap.appendChild(h('span', 'cloud-hint', hint));
  return { wrap, input };
}

function messageFor(code, username) {
  switch (code) {
    case ERR.TAKEN:        return `Someone already picked ${username}. Try adding a number — like ${username}7.`;
    case ERR.BAD_LOGIN:    return `That's not the right magic word for ${username}. Have another go!`;
    case ERR.WEAK_PASSWORD:return 'Magic words need at least 6 letters.';
    case ERR.RATE_LIMITED: return 'Too many tries. Wait a few minutes and try again.';
    case ERR.OFFLINE:      return "Can't reach the cloud. Check the internet and try again.";
    case ERR.TIMEOUT:      return 'The cloud is being slow. Try again in a moment.';
    default:               return 'That did not work. Try again in a moment.';
  }
}

function showAuth() {
  const overlay = document.getElementById('settings-overlay');
  if (!overlay) return;
  let mode = 'in'; // 'in' | 'up'

  const scrim = h('div', 'settings-confirm');
  const card = h('div', 'settings-confirm-card cloud-auth-card');
  const title = h('p', 'settings-confirm-title');
  const blurb = h('p', 'cloud-blurb');
  const form = h('div', 'cloud-auth-form');
  const user = field('Your name', 'text', 'Letters, numbers and _');
  const pw = field('Your magic word', 'password', "Make one up just for this game — don't use a password you use anywhere else.");
  const err = h('p', 'cloud-error');
  err.setAttribute('role', 'alert');
  const btns = h('div', 'settings-confirm-btns');
  const goBtn = h('button', 'play-again-btn', '');
  goBtn.type = 'button';
  const cancel = h('button', 'play-again-btn settings-cancel', 'Cancel');
  cancel.type = 'button';
  const swap = h('button', 'link-btn cloud-swap', '');
  swap.type = 'button';

  form.appendChild(user.wrap);
  form.appendChild(pw.wrap);
  btns.appendChild(cancel);
  btns.appendChild(goBtn);
  [title, blurb, form, err, btns, swap].forEach(el => card.appendChild(el));
  scrim.appendChild(card);
  overlay.appendChild(scrim);

  const paint = () => {
    const up = mode === 'up';
    title.textContent = up ? 'Make an account' : 'Sign in';
    blurb.textContent = up
      ? 'Pick a name and a magic word so your adventure follows you to other devices.'
      : 'Welcome back! Type your name and magic word.';
    goBtn.textContent = up ? 'Make it' : 'Sign in';
    swap.textContent = up ? 'I already have an account' : "I'm new — make an account";
    pw.input.autocomplete = up ? 'new-password' : 'current-password';
    err.textContent = '';
  };

  const close = () => scrim.remove();
  const fail = (msg) => {
    err.textContent = msg;
    pw.input.classList.add('typing-wrong', 'typing-shake');
    setTimeout(() => pw.input.classList.remove('typing-shake'), 500);
  };

  let submitting = false;
  const submit = async () => {
    if (submitting) return;
    err.textContent = '';
    pw.input.classList.remove('typing-wrong');
    const username = user.input.value;
    const password = pw.input.value;

    const bad = validateUsername(username);
    if (bad) { err.textContent = bad; return; }
    if (!password || password.length < 6) { fail('Magic words need at least 6 letters.'); return; }

    submitting = true;
    goBtn.disabled = true;
    goBtn.textContent = mode === 'up' ? 'Making…' : 'Signing in…';
    try {
      if (mode === 'up') await Sync.signUp(username, password);
      else await Sync.signIn(username, password);
      close();
      repaint();
      showToast(`Signed in as ${Sync.getUsername()}!`);
    } catch (e) {
      fail(messageFor(e && e.message, String(username).trim().toLowerCase()));
    } finally {
      submitting = false;
      goBtn.disabled = false;
      paint();
    }
  };

  goBtn.addEventListener('click', submit);
  cancel.addEventListener('click', close);
  swap.addEventListener('click', () => { mode = mode === 'up' ? 'in' : 'up'; paint(); user.input.focus(); });
  // A child presses Enter; they don't hunt for the button.
  [user.input, pw.input].forEach(i => i.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); submit(); }
  }));

  paint();
  user.input.focus();
}

// ─── conflict dialog ─────────────────────────────────────────────────────────
// Numbers, not timestamps — "Year 3 · 14 cards" is decidable by a 9-year-old
// in a way that "updated 14:32" is not.
function summarise(keys) {
  let year = '?', cards = 0, streak = 0;
  try { year = (JSON.parse(keys.hp_journey || '{}').year) || 1; } catch (e) { /* ignore */ }
  try { cards = Object.keys(JSON.parse(keys.hp_cards || '{}').owned || {}).length; } catch (e) { /* ignore */ }
  try { streak = JSON.parse(keys.hp_daily || '{}').streak || 0; } catch (e) { /* ignore */ }
  return `Year ${year} · ${cards} card${cards === 1 ? '' : 's'} · ${streak}-day streak`;
}

export function showConflict({ local, cloud, cloudTs }) {
  const overlay = document.getElementById('settings-overlay');
  if (!overlay) { Sync.keepLocal(cloudTs); return; } // panel closed — don't lose the newer local
  const scrim = h('div', 'settings-confirm');
  const card = h('div', 'settings-confirm-card');
  card.appendChild(h('p', 'settings-confirm-title', 'Two different adventures!'));
  card.appendChild(h('p', 'settings-confirm-text',
    'This device and the cloud both have progress. Which one do you want to keep?'));
  const a = h('div', 'cloud-choice');
  a.appendChild(h('strong', null, 'On this device'));
  a.appendChild(h('span', null, summarise(local)));
  const b = h('div', 'cloud-choice');
  b.appendChild(h('strong', null, 'Saved in the cloud'));
  b.appendChild(h('span', null, summarise(cloud)));
  card.appendChild(a);
  card.appendChild(b);

  const btns = h('div', 'settings-confirm-btns');
  const keepLocal = h('button', 'play-again-btn', 'Keep this device');
  keepLocal.type = 'button';
  const keepCloud = h('button', 'play-again-btn', 'Keep the cloud one');
  keepCloud.type = 'button';
  keepLocal.addEventListener('click', () => { scrim.remove(); Sync.keepLocal(cloudTs); repaint(); });
  keepCloud.addEventListener('click', () => { scrim.remove(); Sync.keepCloud(cloud, cloudTs); });
  btns.appendChild(keepLocal);
  btns.appendChild(keepCloud);
  card.appendChild(btns);
  scrim.appendChild(card);
  overlay.appendChild(scrim);
  // Focus the CLOUD option deliberately — it's the side whose loss is
  // unrecoverable, since the local copy survives either choice. This inverts
  // the "focus the safe option" convention used elsewhere, on purpose.
  keepCloud.focus();
}
