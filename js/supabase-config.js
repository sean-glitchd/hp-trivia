// ─── supabase-config.js: project endpoint + public key ──────────────────────
//
// THIS FILE IS COMMITTED ON PURPOSE.
//
// There is no build step here — Vercel serves these files verbatim — so there
// is no `process.env` to hide anything in, and anything the browser needs is
// public by definition. The `anon` key below is designed for exactly that: it
// is a *routing* credential that says "this request is for this project", not
// an authorisation one. On its own it can do nothing. Verified against the live
// project: an anon-key-only read of `saves` returns HTTP 401 permission denied.
//
// All actual authorisation comes from row level security + the signed-in user's
// JWT. Those policies are the security boundary, not this key.
//
// ⚠️  The `service_role` key must NEVER appear in this repo — not in this file,
// not in a comment, not in a commit you later revert (git history is public).
// It bypasses every RLS policy. If it is ever pasted here, rotating it in the
// Supabase dashboard is mandatory, not optional.

export const SUPABASE_URL = 'https://dxymcvbyzmxosdpdtdge.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR4eW1jdmJ5em14b3NkcGR0ZGdlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ2MTgzODAsImV4cCI6MjEwMDE5NDM4MH0.D-4KIhkBeR2qd5xUeSd2Vftb7No68X3v10Xn_LwgMRg';

// Usernames map to synthetic addresses on a domain reserved by RFC 2606, which
// is guaranteed never to resolve — no mail can ever be sent to a player, by
// design. Email confirmation must stay OFF in the dashboard or these accounts
// could never be confirmed.
export const EMAIL_DOMAIN = 'hptrivia.invalid';
