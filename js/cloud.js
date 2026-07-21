// ─── cloud.js: Supabase auth + REST transport ───────────────────────────────
// Deliberately hand-written against the REST API rather than loading the
// supabase-js bundle from a CDN. index.html has no CSP and no SRI, so a CDN
// <script> would be fully trusted — in an app whose job here is handling
// children's passwords, a CDN compromise would mean silent credential theft.
// It also keeps the repo's zero-dependency property intact.
//
// Knows nothing about the game: it moves an opaque blob and manages a session.
// sync.js owns everything game-shaped. Every call rejects rather than throwing
// into gameplay, and every caller is expected to treat failure as "stay local".

import { SUPABASE_URL, SUPABASE_ANON_KEY, EMAIL_DOMAIN } from './supabase-config.js';

const SESSION_KEY = 'hp_cloud_session';
const TIMEOUT_MS = 8000;      // a paused free-tier project hangs rather than 404s
const REFRESH_SKEW_MS = 60000; // refresh a minute early rather than eating a 401

// Errors callers branch on. Anything else is a generic failure.
export const ERR = {
  OFFLINE: 'offline',
  TIMEOUT: 'timeout',
  SESSION_EXPIRED: 'session_expired',
  TAKEN: 'taken',
  BAD_LOGIN: 'bad_login',
  WEAK_PASSWORD: 'weak_password',
  BAD_USERNAME: 'bad_username',
  TOO_BIG: 'too_big',
  RATE_LIMITED: 'rate_limited',
};

// ─── username rules ──────────────────────────────────────────────────────────
const RESERVED = new Set([
  'admin', 'root', 'test', 'supabase', 'support', 'system', 'moderator', 'mod',
  'null', 'undefined', 'anonymous', 'guest', 'owner', 'staff',
  'hagrid', 'dumbledore', 'harry', 'hermione', 'ron', 'voldemort', 'mcgonagall',
]);

// Normalise before anything touches it: iOS will happily auto-capitalise a
// username field, and a child typing "Hedwig99" then "hedwig99" must reach the
// same account rather than being told their magic word is wrong.
export function normaliseUsername(raw) {
  return String(raw == null ? '' : raw).normalize('NFKC').trim().toLowerCase();
}

// Returns null when valid, or a child-readable reason.
export function validateUsername(raw) {
  const u = normaliseUsername(raw);
  if (u.length < 3) return 'Names need at least 3 letters.';
  if (u.length > 16) return "That's a bit long — 16 letters or fewer.";
  if (!/^[a-z]/.test(u)) return 'Names have to start with a letter.';
  if (!/^[a-z][a-z0-9_]*$/.test(u)) return 'Letters, numbers and _ only — no spaces or emoji.';
  if (RESERVED.has(u)) return 'That name is saved for someone else. Pick another!';
  return null;
}

const emailFor = (username) => `${normaliseUsername(username)}@${EMAIL_DOMAIN}`;
const usernameFrom = (email) => String(email || '').split('@')[0];

// ─── session storage ─────────────────────────────────────────────────────────
let session = null;

function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    const s = raw ? JSON.parse(raw) : null;
    session = (s && s.access_token && s.refresh_token) ? s : null;
  } catch (e) { session = null; }
}
loadSession();

function saveSession(json, username) {
  session = {
    access_token: json.access_token,
    refresh_token: json.refresh_token,
    // expires_in is seconds from now; store an absolute deadline instead so a
    // reload doesn't think a stale token is fresh.
    expires_at: Date.now() + (Number(json.expires_in) || 3600) * 1000,
    username: username || usernameFrom(json.user && json.user.email),
  };
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch (e) { /* ignore */ }
}

function clearSession() {
  session = null;
  try { localStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ }
}

// ─── fetch plumbing ──────────────────────────────────────────────────────────
// Every request is bounded: a paused project can hang open indefinitely, and an
// unbounded fetch would leave the UI claiming "Saving…" forever.
async function request(path, { method = 'GET', body, token, prefer } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const headers = { apikey: SUPABASE_ANON_KEY };
    if (body) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    if (prefer) headers.Prefer = prefer;
    const res = await fetch(SUPABASE_URL + path, {
      method, headers, signal: ctrl.signal,
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (e) { /* non-JSON body */ }
    return { ok: res.ok, status: res.status, json, text };
  } catch (e) {
    // AbortError means our timeout fired; anything else is a dead network.
    throw new Error(e && e.name === 'AbortError' ? ERR.TIMEOUT : ERR.OFFLINE);
  } finally {
    clearTimeout(timer);
  }
}

// GoTrue's error field varies by endpoint and version — check all the shapes
// rather than assuming one, and always fall through to something sayable.
function errorTextOf(json, text) {
  if (!json) return text || '';
  return String(json.error_description || json.msg || json.message || json.error || text || '');
}

function authErrorCode(status, json, text) {
  const m = errorTextOf(json, text).toLowerCase();
  if (status === 429 || m.includes('rate limit')) return ERR.RATE_LIMITED;
  if (m.includes('already registered') || m.includes('already been registered')) return ERR.TAKEN;
  if (m.includes('invalid login') || m.includes('invalid_grant')) return ERR.BAD_LOGIN;
  if (m.includes('password') && (m.includes('short') || m.includes('least'))) return ERR.WEAK_PASSWORD;
  if (m.includes('email')) return ERR.BAD_USERNAME; // malformed synthetic address
  return '';
}

// ─── token refresh (single-flight) ───────────────────────────────────────────
// Supabase rotates refresh tokens, so two concurrent refreshes would spend the
// same token twice and log the child out. One shared promise prevents that.
let refreshing = null;

function refreshSession() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    if (!session || !session.refresh_token) return false;
    try {
      const r = await request('/auth/v1/token?grant_type=refresh_token', {
        method: 'POST', body: { refresh_token: session.refresh_token },
      });
      if (!r.ok || !r.json || !r.json.access_token) { clearSession(); return false; }
      saveSession(r.json, session.username);
      return true;
    } catch (e) {
      // Network failure is NOT an expired session — keep it and retry later.
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

// Authenticated request with proactive refresh, then one reactive retry on 401.
async function authed(path, opts = {}) {
  if (!session) throw new Error(ERR.SESSION_EXPIRED);
  if (session.expires_at && Date.now() > session.expires_at - REFRESH_SKEW_MS) {
    await refreshSession();
    if (!session) throw new Error(ERR.SESSION_EXPIRED);
  }
  let r = await request(path, { ...opts, token: session.access_token });
  if (r.status !== 401) return r;
  const ok = await refreshSession();
  if (!ok || !session) { clearSession(); throw new Error(ERR.SESSION_EXPIRED); }
  return request(path, { ...opts, token: session.access_token });
}

// ─── public API ──────────────────────────────────────────────────────────────
export const Cloud = {
  isSignedIn() { return !!session; },
  getUsername() { return session ? session.username : null; },

  async signUp(username, password) {
    const bad = validateUsername(username);
    if (bad) throw new Error(ERR.BAD_USERNAME);
    const r = await request('/auth/v1/signup', {
      method: 'POST', body: { email: emailFor(username), password },
    });
    if (!r.ok) throw new Error(authErrorCode(r.status, r.json, r.text) || 'signup_failed');
    // With autoconfirm on, signup returns a session directly. If a future
    // dashboard change turns confirmation back on there'd be no token here —
    // sign in explicitly rather than silently appearing to succeed.
    if (r.json && r.json.access_token) saveSession(r.json, normaliseUsername(username));
    else return this.signIn(username, password);
    return { username: this.getUsername() };
  },

  async signIn(username, password) {
    const r = await request('/auth/v1/token?grant_type=password', {
      method: 'POST', body: { email: emailFor(username), password },
    });
    if (!r.ok || !r.json || !r.json.access_token) {
      throw new Error(authErrorCode(r.status, r.json, r.text) || ERR.BAD_LOGIN);
    }
    saveSession(r.json, normaliseUsername(username));
    return { username: this.getUsername() };
  },

  signOut() { clearSession(); },

  // Returns { data, updated_at } or null when this account has no save yet.
  async getSave() {
    const r = await authed('/rest/v1/saves?select=data,updated_at');
    if (!r.ok) throw new Error('read_failed');
    const rows = Array.isArray(r.json) ? r.json : [];
    return rows.length ? rows[0] : null;
  },

  // Upsert. The DB trigger overrides user_id and stamps updated_at, so a client
  // cannot write to another row or choose its own timestamp — conflict
  // resolution is only trustworthy because the server owns that clock.
  async putSave(data) {
    const r = await authed('/rest/v1/saves', {
      method: 'POST',
      body: { username: this.getUsername() || '', data },
      prefer: 'resolution=merge-duplicates,return=representation',
    });
    if (!r.ok) {
      const m = errorTextOf(r.json, r.text).toLowerCase();
      throw new Error(m.includes('too large') ? ERR.TOO_BIG : 'write_failed');
    }
    const rows = Array.isArray(r.json) ? r.json : [];
    return rows.length ? rows[0].updated_at : null;
  },
};
