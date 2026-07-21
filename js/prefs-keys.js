// ─── prefs-keys.js: the device-preference / progress split ──────────────────
// A leaf module (imports nothing) so both settings.js and sync.js can share one
// definition. That split is load-bearing in two places, and they must not drift:
//   • "Erase everything" wipes progress but keeps these (settings.js) — wiping
//     someone's volume as collateral for deleting a save is a surprise.
//   • Cloud sync uploads progress but NOT these (sync.js) — volume, motion and
//     mute are properties of the device you're on, not of your account. Syncing
//     them would mute the laptop because the iPad was muted at bedtime.
// Everything in localStorage that is NOT in this list is progress, and is
// derived rather than hand-listed, so a new key can't be silently forgotten.

export const NUDGE_KEY = 'hp_sound_nudge';

export const PREF_KEYS = ['hp_sound', 'hp_track', 'hp_volume', 'hp_voice', 'hp_motion', NUDGE_KEY];

// Keys sync.js owns but must never upload (bookkeeping about syncing itself).
export const SYNC_META_KEYS = ['hp_cloud_session', 'hp_cloud_meta'];

// Never uploaded, and never wiped by "erase everything" either — losing the
// session mid-erase would sign the child out before the cloud wipe is sent.
export const LOCAL_ONLY_KEYS = [...PREF_KEYS, ...SYNC_META_KEYS];
