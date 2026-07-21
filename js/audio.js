// TRACK_ORDER holds only real, playable tracks. SELECTABLE adds the 'shuffle'
// pseudo-track, which is a *selection* the player can persist but never a
// track that actually plays — _resolveTrack() maps it to a real one.
const TRACK_ORDER = ['theme', 'ambient', 'common', 'hall'];
export const SELECTABLE = [...TRACK_ORDER, 'shuffle'];
export const TRACK_LABELS = { theme: '🎵 Theme', ambient: '✨ Ambient', common: '🛋️ Common Room', hall: '🕯️ Great Hall', shuffle: '🔀 Shuffle' };
// How far music ducks under a spoken line (shared by duckMusic and the
// shuffle handoff, which has to match it when swapping tracks mid-duck).
const DUCK_FACTOR = 0.28;
// Shuffle rotation window for the endless synth tracks, in ms.
const SHUFFLE_MIN_MS = 90000, SHUFFLE_MAX_MS = 150000;

export const AudioEngine = {
  ctx: null, masterGain: null, musicGain: null, sfxGain: null,
  enabled: localStorage.getItem('hp_sound') === 'on',
  track: SELECTABLE.includes(localStorage.getItem('hp_track')) ? localStorage.getItem('hp_track') : 'theme',
  // The track actually playing right now. Differs from `track` only in shuffle
  // mode; every playback path reads this, never `track`.
  activeTrack: null,
  _shuffleTimer: null,
  // True only once audio is genuinely audible. `enabled` is the *setting*;
  // autoplay policy means music can't start until the first user gesture, so
  // the two diverge on a reload and the mute button reflects that.
  musicPlaying: false,
  _listeners: [],
  themeAudio: null, themeFailed: false,
  musicTimer: null, nextNoteTime: 0, step: 0,
  _pattern: null, _stepDur: 0.42, _droneFreq: 164.81, _droneEvery: 16, // scheduler override slot — duel uses this too
  duelActive: false, _preDuel: null,
  // Master volume 0–1 (persisted). Scales the synth graph via masterGain, the
  // Hedwig's Theme <audio> (outside the graph), and speech (read by dialogue.js).
  _volume: (() => { const v = parseFloat(localStorage.getItem('hp_volume')); return isNaN(v) ? 1 : Math.max(0, Math.min(1, v)); })(),

  init() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = this._volume;
    this.masterGain.connect(this.ctx.destination);
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.055;
    this.musicGain.connect(this.masterGain);
    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = 0.25;
    this.sfxGain.connect(this.masterGain);
  },

  getVolume() { return this._volume; },
  setVolume(v) {
    this._volume = Math.max(0, Math.min(1, v));
    try { localStorage.setItem('hp_volume', String(this._volume)); } catch (e) { /* ignore */ }
    if (this.masterGain) this.masterGain.gain.value = this._volume;
    if (this.themeAudio) this.themeAudio.volume = this._volume * 0.5;
  },

  ensureRunning() {
    this.init();
    if (this.ctx.state === 'suspended') this.ctx.resume();
  },

  // Backgrounding a tab (or a device sleeping, or an iOS call/notification)
  // suspends the AudioContext. Its clock then freezes, so scheduleAmbient()'s
  // `nextNoteTime < ctx.currentTime` test never passes again and the synth goes
  // permanently silent — while musicTimer keeps ticking, so nothing looks wrong.
  // Browsers also pause the theme <audio> without firing 'ended'. Nothing used
  // to bring either back, so music just stopped for good. Called on tab focus.
  _recoverPlayback() {
    if (!this.enabled || !this.ctx) return;
    const afterResume = () => {
      // Re-anchor the scheduler: the clock may have jumped while we were away,
      // and a stale nextNoteTime would fire a burst of catch-up notes at once.
      this.nextNoteTime = this.ctx.currentTime + 0.1;
      if (this.duelActive) return;
      if (this.activeTrack === 'theme' && this.themeAudio && this.themeAudio.paused) {
        this.themeAudio.play().catch(() => { /* needs a fresh gesture — the unlock listener covers it */ });
      } else if (this.activeTrack && this.activeTrack !== 'theme' && !this.musicTimer) {
        this.startAmbient(); // scheduler died with the context — restart it
      }
    };
    if (this.ctx.state === 'running') { afterResume(); return; }
    this.ctx.resume().then(afterResume).catch(() => { /* blocked until a gesture */ });
  },

  // ─── ducking: dialogue.js quiets the music while a voice line speaks ──────
  // Depth-counted so overlapping duck/restore calls (e.g. a clip erroring and
  // immediately falling back to Web Speech) never leave music stuck low —
  // only the outermost duck/restore pair actually changes the volume.
  _duckDepth: 0,
  _duckSavedMusicGain: null,
  _duckSavedThemeVol: null,
  _themeTweenId: null,

  _tweenThemeVolume(target, ms) {
    if (this._themeTweenId) { clearInterval(this._themeTweenId); this._themeTweenId = null; }
    const audio = this.themeAudio;
    if (!audio) return;
    const start = audio.volume;
    const startTime = performance.now();
    this._themeTweenId = setInterval(() => {
      const t = Math.min(1, (performance.now() - startTime) / ms);
      audio.volume = start + (target - start) * t;
      if (t >= 1) { clearInterval(this._themeTweenId); this._themeTweenId = null; }
    }, 40);
  },

  duckMusic() {
    this._duckDepth++;
    if (this._duckDepth > 1) return; // already ducked — don't restack
    const factor = DUCK_FACTOR;
    if (this.musicGain && this.ctx) {
      this._duckSavedMusicGain = this.musicGain.gain.value;
      this.musicGain.gain.setTargetAtTime(this._duckSavedMusicGain * factor, this.ctx.currentTime, 0.15);
    }
    if (this.themeAudio) {
      this._duckSavedThemeVol = this.themeAudio.volume;
      this._tweenThemeVolume(this._duckSavedThemeVol * factor, 250);
    }
  },

  restoreMusic() {
    if (this._duckDepth === 0) return;
    this._duckDepth--;
    if (this._duckDepth > 0) return; // still ducked by an overlapping call
    if (this.musicGain && this.ctx && this._duckSavedMusicGain != null) {
      this.musicGain.gain.setTargetAtTime(this._duckSavedMusicGain, this.ctx.currentTime, 0.3);
    }
    if (this.themeAudio && this._duckSavedThemeVol != null) {
      this._tweenThemeVolume(this._duckSavedThemeVol, 400);
    }
    this._duckSavedMusicGain = null;
    this._duckSavedThemeVol = null;
  },

  // ─── shuffle ───────────────────────────────────────────────────────────────
  // 'shuffle' is a selection, not a playable track. Resolve it to a real one,
  // avoiding an immediate repeat (and theme when its MP3 has failed to load).
  _resolveTrack() {
    if (this.track !== 'shuffle') return this.track;
    let pool = TRACK_ORDER.filter(t => t !== this.activeTrack);
    if (this.themeFailed) pool = pool.filter(t => t !== 'theme');
    if (!pool.length) pool = this.themeFailed ? TRACK_ORDER.filter(t => t !== 'theme') : TRACK_ORDER;
    return pool[Math.floor(Math.random() * pool.length)];
  },

  _clearShuffleTimer() {
    if (this._shuffleTimer) { clearTimeout(this._shuffleTimer); this._shuffleTimer = null; }
  },

  // Only the endless synth tracks need a timer — the theme MP3 rotates off its
  // own 'ended' event instead, so its natural length is the rotation boundary.
  // Always clears first, so this can never double-arm.
  _armShuffleTimer() {
    this._clearShuffleTimer();
    if (this.track !== 'shuffle' || !this.enabled || this.duelActive) return;
    if (this.activeTrack === 'theme') return;
    const ms = SHUFFLE_MIN_MS + Math.random() * (SHUFFLE_MAX_MS - SHUFFLE_MIN_MS);
    this._shuffleTimer = setTimeout(() => this._advanceShuffle(), ms);
  },

  _advanceShuffle() {
    if (this.track !== 'shuffle' || !this.enabled || this.duelActive) return;
    const from = this.activeTrack;
    const next = this._resolveTrack();
    this.activeTrack = next;
    if (from === 'theme' && next !== 'theme') {
      if (this.themeAudio) this.themeAudio.pause();
      this.startAmbient();
    } else if (next === 'theme') {
      this.stopAmbient();
      this.startTheme();
    } else {
      // synth → synth: the scheduler reads _pattern fresh each tick and every
      // pattern is the same length, so swapping in place is seamless — no
      // stop/start, no step reset.
      this._applyTrackPattern(next);
    }
    this._armShuffleTimer();
  },

  onChange(fn) { this._listeners.push(fn); },
  _notify() { this._listeners.forEach(f => { try { f(); } catch (e) { /* a bad listener shouldn't break audio */ } }); },

  toggle() {
    this.enabled = !this.enabled;
    localStorage.setItem('hp_sound', this.enabled ? 'on' : 'off');
    if (this.enabled) {
      this.ensureRunning();
      // mid-duel sound toggling should resume the duel loop, not the theme —
      // duelActive persists across a toggle-off/on even though the scheduler
      // itself was paused (stopAmbient() below, not stopDuelMusic()).
      if (this.duelActive) this._applyDuelPattern();
      else this.startMusic();
    } else {
      this._clearShuffleTimer();
      if (this.duelActive) this.stopAmbient();
      else this.stopMusic();
    }
    this.updateButtons();
  },

  switchTrack() {
    const i = SELECTABLE.indexOf(this.track);
    let next = this.track;
    // skip the theme entry entirely once its MP3 is known to be broken
    for (let n = 1; n <= SELECTABLE.length; n++) {
      const cand = SELECTABLE[(i + n) % SELECTABLE.length];
      if (this.themeFailed && cand === 'theme') continue;
      next = cand; break;
    }
    this.setTrack(next);
  },

  setTrack(next) {
    if (!SELECTABLE.includes(next)) return;
    this.track = next;
    localStorage.setItem('hp_track', this.track);
    this._clearShuffleTimer();
    // don't let a track switch stomp an in-progress duel loop — the new
    // track choice simply takes effect once stopDuelMusic() restores normal playback.
    if (this.enabled && !this.duelActive) { this.stopMusic(); this.startMusic(); }
    this.updateButtons();
  },

  updateButtons() {
    const mBtn = document.getElementById('music-toggle');
    if (mBtn) {
      mBtn.textContent = this.enabled ? '🔊' : '🔇';
      mBtn.setAttribute('aria-pressed', String(this.enabled));
      // Sound can be ON as a setting while nothing is audible yet, because
      // autoplay policy holds playback until the first gesture. Say so rather
      // than showing a 🔊 that's lying.
      const pending = this.enabled && !this.musicPlaying;
      mBtn.classList.toggle('pending', pending);
      mBtn.title = !this.enabled ? 'Sound is off'
        : pending ? 'Sound on — tap anywhere to start the music'
        : 'Sound is on';
    }
    // #track-toggle was retired in favour of the settings panel's named list;
    // guard so this keeps working whether or not the element exists.
    const tBtn = document.getElementById('track-toggle');
    if (tBtn) {
      tBtn.classList.toggle('hidden', !this.enabled || (this.themeFailed && this.track === 'theme'));
      tBtn.textContent = TRACK_LABELS[this.track] || '🎵 Theme';
    }
    this._notify();
  },

  // ── music ──
  startMusic() {
    if (!this.enabled) return;
    this.activeTrack = this._resolveTrack();
    if (this.activeTrack === 'theme' && !this.themeFailed) this.startTheme();
    else this.startAmbient();
    this._armShuffleTimer();
  },

  stopMusic() {
    this._clearShuffleTimer();
    this.stopAmbient();
    if (this.themeAudio) this.themeAudio.pause();
    this.musicPlaying = false;
  },

  startTheme() {
    if (!this.themeAudio) {
      this.themeAudio = new Audio('audio/hedwigs-theme.mp3');
      this.themeAudio.volume = this._volume * 0.5;
      // Failure marks the track dead and falls back to the synth. It sets
      // activeTrack, NOT track — clobbering `track` would silently discard the
      // player's stored selection.
      const onFail = () => {
        this.themeFailed = true;
        this.activeTrack = 'ambient';
        this.musicPlaying = false;
        if (this.enabled) this.startAmbient();
        this.updateButtons();
      };
      this.themeAudio.addEventListener('error', onFail);
      this.themeAudio._onFail = onFail;
      // In shuffle mode the MP3 doesn't loop; its end is the rotation cue.
      this.themeAudio.addEventListener('ended', () => {
        if (this.track === 'shuffle' && this.enabled && !this.duelActive) this._advanceShuffle();
      });
    }
    const shuffling = this.track === 'shuffle';
    this.themeAudio.loop = !shuffling;
    if (shuffling) this.themeAudio.currentTime = 0; // stopMusic() only pauses, so rewind
    // match the current duck level, or a track swap mid-speech blares
    this.themeAudio.volume = this._volume * 0.5 * (this._duckDepth > 0 ? DUCK_FACTOR : 1);
    this.themeAudio.play().then(() => {
      this.musicPlaying = true;
      this.updateButtons();
    }).catch(() => this.themeAudio._onFail());
  },

  // Pattern/step-duration for a real track. Split out of startAmbient() so
  // shuffle can swap synth patterns in place without restarting the scheduler.
  _applyTrackPattern(track) {
    const trackPatterns = { theme: AMBIENT_PATTERN, ambient: AMBIENT_PATTERN, common: COMMON_ROOM_PATTERN, hall: GREAT_HALL_PATTERN };
    const trackStepDur = { common: 0.5, hall: 0.36 };
    this._pattern = trackPatterns[track] || AMBIENT_PATTERN;
    this._stepDur = trackStepDur[track] || 0.42;
    this._droneFreq = 164.81;
    this._droneEvery = 16;
  },

  startAmbient() {
    this.ensureRunning();
    // Always resets pattern/step/drone, so a prior duel override never leaks
    // into a normal track pick (stopDuelMusic() calls startMusic()/this, in order).
    this._applyTrackPattern(this.activeTrack || this.track);
    this._startScheduler();
  },

  // duel.js's startDuelMusic() calls this directly (bypassing the track-based
  // reset above) so the tense override sticks; also used by toggle() to
  // resume the duel loop after a mid-duel sound off/on.
  _applyDuelPattern() {
    this.ensureRunning();
    this._pattern = DUEL_PATTERN;
    this._stepDur = 0.30;
    this._droneFreq = 82.41;
    this._droneEvery = 8;
    this._startScheduler();
  },

  _startScheduler() {
    if (this.musicTimer) return;
    this.step = 0;
    this.nextNoteTime = this.ctx.currentTime + 0.1;
    this.musicTimer = setInterval(() => this.scheduleAmbient(), 25);
    this.musicPlaying = true;
    this.updateButtons();
  },

  stopAmbient() {
    if (this.musicTimer) { clearInterval(this.musicTimer); this.musicTimer = null; }
    if (!this.themeAudio || this.themeAudio.paused) this.musicPlaying = false;
  },

  scheduleAmbient() {
    const pattern = this._pattern || AMBIENT_PATTERN;
    const stepDur = this._stepDur || 0.42;
    while (this.nextNoteTime < this.ctx.currentTime + 0.12) {
      this.playAmbientStep(pattern, this.step, this.nextNoteTime);
      this.step = (this.step + 1) % pattern.length;
      this.nextNoteTime += stepDur;
    }
  },

  playAmbientStep(pattern, step, t) {
    const freq = pattern[step];
    if (freq) this.celesta(freq, t);
    if (step % (this._droneEvery || 16) === 0) this.celesta(this._droneFreq || 164.81, t, 2.4, 0.5); // low drone
  },

  // ── duel music override ──
  // Pauses whatever's currently playing, remembers it, and runs the tense
  // DUEL_PATTERN through the same scheduler at a slightly higher music gain.
  // stopDuelMusic() restores exactly what was playing before.
  startDuelMusic() {
    if (!this.enabled) return;
    this.duelActive = true;
    this._clearShuffleTimer(); // the duel owns the music until it's over
    const themeWasPlaying = !!(this.themeAudio && !this.themeAudio.paused);
    if (themeWasPlaying) this.themeAudio.pause();
    this.stopAmbient();
    this._preDuel = { themeWasPlaying, musicGain: this.musicGain.gain.value };
    this.musicGain.gain.value = Math.min(0.09, this._preDuel.musicGain * 1.5);
    this._applyDuelPattern();
  },

  stopDuelMusic() {
    this.duelActive = false;
    this.stopAmbient();
    const prev = this._preDuel;
    this._preDuel = null;
    if (this.musicGain) this.musicGain.gain.value = prev?.musicGain ?? 0.055;
    if (!this.enabled) return;
    if (prev?.themeWasPlaying) {
      this.activeTrack = 'theme';
      this.startTheme();
      this._armShuffleTimer(); // this branch skips startMusic(), so re-arm here
    } else {
      this.startMusic();
    }
  },

  // music-box voice: sine + quiet octave partial, instant attack, long decay
  celesta(freq, t, decay = 1.2, vol = 1) {
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(vol, t + 0.002);
    env.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    env.connect(this.musicGain);
    [[freq, 1], [freq * 2, 0.3]].forEach(([f, g]) => {
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f;
      const og = this.ctx.createGain();
      og.gain.value = g;
      osc.connect(og); og.connect(env);
      osc.start(t); osc.stop(t + decay + 0.1);
    });
  },

  // ── sfx ──
  tone(freq, { time = 0, dur = 0.15, type = 'sine', gain = 1, slideTo = null } = {}) {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime + time;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.linearRampToValueAtTime(slideTo, t + dur);
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(gain, t + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(env); env.connect(this.sfxGain);
    osc.start(t); osc.stop(t + dur + 0.1);
  },

  sfxReady() {
    if (!this.enabled) return false;
    this.ensureRunning();
    return true;
  },

  playClick() {
    if (!this.sfxReady()) return;
    this.tone(880, { dur: 0.06, type: 'triangle', gain: 0.5 });
  },

  playCorrect() {
    if (!this.sfxReady()) return;
    this.tone(1046.5, { dur: 0.25, gain: 0.8 });
    this.tone(1318.5, { time: 0.11, dur: 0.3, gain: 0.8 });
    this.tone(1568,   { time: 0.22, dur: 0.45, gain: 0.8 });
  },

  playWrong() {
    if (!this.sfxReady()) return;
    this.tone(146.8, { dur: 0.5, type: 'triangle', gain: 0.9, slideTo: 110 });
  },

  playCast() {
    if (!this.sfxReady()) return;
    const t = this.ctx.currentTime;
    const dur = 0.28;
    const bufferSize = Math.floor(this.ctx.sampleRate * dur);
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(2200, t);
    filter.frequency.exponentialRampToValueAtTime(400, t + dur);
    filter.Q.value = 0.8;

    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(0.6, t + 0.03);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    noise.connect(filter); filter.connect(env); env.connect(this.sfxGain);
    noise.start(t); noise.stop(t + dur + 0.05);
  },

  playFanfare() {
    if (!this.sfxReady()) return;
    [523.25, 659.26, 783.99, 1046.5].forEach((f, i) =>
      this.tone(f, { time: i * 0.14, dur: 0.35, gain: 0.7 }));
    [523.25, 659.26, 783.99].forEach(f =>
      this.tone(f, { time: 0.6, dur: 1.4, gain: 0.5 }));
  },

  // Quiet fast tremolo — snitch wing-flap flutter, played on dash.
  playFlutter() {
    if (!this.sfxReady()) return;
    for (let i = 0; i < 6; i++) {
      this.tone(700 + Math.random() * 300, { time: i * 0.02, dur: 0.03, type: 'triangle', gain: 0.12 });
    }
  },

  // Bright ascending shimmer — snitch caught.
  playSnitchCaught() {
    if (!this.sfxReady()) return;
    [880, 1108.7, 1318.5, 1568, 1864.7, 2093].forEach((f, i) =>
      this.tone(f, { time: i * 0.045, dur: 0.18, gain: 0.35 }));
  },

  // Very short quiet blip — score count-up tick.
  playTick() {
    if (!this.sfxReady()) return;
    this.tone(1200, { dur: 0.03, type: 'triangle', gain: 0.18 });
  },

  // Soft chime — lumos/nox easter egg.
  playChime() {
    if (!this.sfxReady()) return;
    this.tone(1568, { dur: 0.4, gain: 0.4 });
    this.tone(2093, { time: 0.06, dur: 0.5, gain: 0.3 });
  },

  // Low percussive taps building tension — Sorting Hat deliberation.
  playDrumroll() {
    if (!this.sfxReady()) return;
    for (let i = 0; i < 14; i++) {
      this.tone(85 + Math.random() * 25, { time: i * 0.09, dur: 0.07, type: 'triangle', gain: 0.3 });
    }
  },

  // ── duel SFX ──
  noiseBurst(t, dur, { filterType = 'bandpass', freqFrom = 2000, freqTo = 400, q = 1, peakGain = 0.5 } = {}) {
    const bufferSize = Math.floor(this.ctx.sampleRate * dur);
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.setValueAtTime(freqFrom, t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(20, freqTo), t + dur);
    filter.Q.value = q;
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(peakGain, t + 0.02);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    noise.connect(filter); filter.connect(env); env.connect(this.sfxGain);
    noise.start(t); noise.stop(t + dur + 0.05);
  },

  // Sawtooth slide + a dull noise burst underneath — the wrong-answer curse.
  playAvada() {
    if (!this.sfxReady()) return;
    this.tone(98, { dur: 0.6, type: 'sawtooth', gain: 0.65, slideTo: 62 });
    this.noiseBurst(this.ctx.currentTime, 0.35, { filterType: 'bandpass', freqFrom: 900, freqTo: 180, q: 1.2, peakGain: 0.45 });
  },

  // Filtered thud + a short tone — a correct answer's spell striking the wraith.
  playSpellHit() {
    if (!this.sfxReady()) return;
    this.tone(220, { dur: 0.18, type: 'triangle', gain: 0.55 });
    this.noiseBurst(this.ctx.currentTime, 0.15, { filterType: 'lowpass', freqFrom: 500, freqTo: 500, q: 0.7, peakGain: 0.5 });
  },

  // Low gong + a dissonant shimmer — the duel's opening beat.
  playDuelStart() {
    if (!this.sfxReady()) return;
    this.tone(82.41, { dur: 2.2, type: 'sine', gain: 0.7 });
    this.tone(41.2, { dur: 2.4, type: 'triangle', gain: 0.35 });
    [116.54, 138.59].forEach((f, i) =>
      this.tone(f, { time: 0.15 + i * 0.08, dur: 1.6, type: 'sine', gain: 0.16 }));
  },

  // Somber descending minor phrase — defeat.
  playDefeat() {
    if (!this.sfxReady()) return;
    [440, 415.3, 349.23, 293.66].forEach((f, i) =>
      this.tone(f, { time: i * 0.32, dur: 0.55, type: 'sine', gain: 0.45 }));
  },
};

// Original arpeggiated pattern over E natural minor — deliberately not Hedwig's Theme.
// null = rest. 32 steps at ~72 BPM eighths.
export const AMBIENT_PATTERN = [
  329.63, null, 493.88, 659.26, null, 587.33, 493.88, null,
  440.00, null, 659.26, null, 783.99, null, 659.26, null,
  392.00, null, 587.33, 783.99, null, 659.26, 493.88, null,
  440.00, null, 493.88, null, 329.63, null, null, null,
];

// Common Room: warm, slow, low register (E3–B3) — a fireside-quiet loop.
export const COMMON_ROOM_PATTERN = [
  164.81, null, null, 196.00, null, 220.00, null, null,
  246.94, null, 220.00, null, 196.00, null, null, null,
  164.81, null, 185.00, null, 220.00, null, 246.94, null,
  220.00, null, null, 196.00, null, 164.81, null, null,
];

// Great Hall: bright, festive, G-major pentatonic — a feast-day loop.
export const GREAT_HALL_PATTERN = [
  392.00, null, 493.88, 587.33, null, 659.26, 587.33, null,
  440.00, null, 587.33, null, 783.99, null, 659.26, null,
  392.00, 493.88, null, 587.33, 659.26, null, 587.33, 440.00,
  392.00, null, 440.00, 493.88, null, 587.33, null, null,
];

// Duel: tense E-phrygian ostinato, low register, ~0.30s steps. The half-step
// E->F (phrygian's characteristic flat 2nd) and the Bb tritone accent against
// the E2 drone are what read as "tense" rather than merely "minor".
export const DUEL_PATTERN = [
  82.41, null, 87.31, null, 82.41, null, 98.00, null,
  82.41, null, 87.31, null, 116.54, null, 82.41, null,
  82.41, null, 98.00, null, 82.41, null, 87.31, null,
  82.41, null, 116.54, null, 98.00, null, 82.41, null,
];

export function initAudioListeners() {
  // If sound was left on, start it on the first user interaction (autoplay
  // policy). Listens for several gesture types — not just click — so a
  // keyboard-only player gets music too. Whichever fires first removes the rest.
  const EVENTS = ['pointerdown', 'keydown', 'touchstart'];
  const unlock = () => {
    EVENTS.forEach(e => document.removeEventListener(e, unlock));
    if (!AudioEngine.enabled) return;
    AudioEngine.ensureRunning();
    AudioEngine.startMusic();
    AudioEngine.updateButtons(); // clears the "tap to start" pending state
  };
  EVENTS.forEach(e => document.addEventListener(e, unlock));

  // Coming back to the tab is the moment to undo a browser-imposed suspend.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) AudioEngine._recoverPlayback();
  });
  window.addEventListener('focus', () => AudioEngine._recoverPlayback());
}
