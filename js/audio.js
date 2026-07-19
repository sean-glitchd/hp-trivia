const TRACK_ORDER = ['theme', 'ambient', 'common', 'hall'];
const TRACK_LABELS = { theme: '🎵 Theme', ambient: '✨ Ambient', common: '🛋️ Common Room', hall: '🕯️ Great Hall' };

export const AudioEngine = {
  ctx: null, masterGain: null, musicGain: null, sfxGain: null,
  enabled: localStorage.getItem('hp_sound') === 'on',
  track: TRACK_ORDER.includes(localStorage.getItem('hp_track')) ? localStorage.getItem('hp_track') : 'theme',
  themeAudio: null, themeFailed: false,
  musicTimer: null, nextNoteTime: 0, step: 0,
  _pattern: null, _stepDur: 0.42, _droneFreq: 164.81, _droneEvery: 16, // scheduler override slot — duel uses this too
  duelActive: false, _preDuel: null,

  init() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.masterGain = this.ctx.createGain();
    this.masterGain.connect(this.ctx.destination);
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.055;
    this.musicGain.connect(this.masterGain);
    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = 0.25;
    this.sfxGain.connect(this.masterGain);
  },

  ensureRunning() {
    this.init();
    if (this.ctx.state === 'suspended') this.ctx.resume();
  },

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
      if (this.duelActive) this.stopAmbient();
      else this.stopMusic();
    }
    this.updateButtons();
  },

  switchTrack() {
    const i = TRACK_ORDER.indexOf(this.track);
    this.track = TRACK_ORDER[(i + 1) % TRACK_ORDER.length];
    localStorage.setItem('hp_track', this.track);
    // don't let a track switch stomp an in-progress duel loop — the new
    // track choice simply takes effect once stopDuelMusic() restores normal playback.
    if (this.enabled && !this.duelActive) { this.stopMusic(); this.startMusic(); }
    this.updateButtons();
  },

  updateButtons() {
    const mBtn = document.getElementById('music-toggle');
    mBtn.textContent = this.enabled ? '🔊' : '🔇';
    mBtn.setAttribute('aria-pressed', String(this.enabled));
    const tBtn = document.getElementById('track-toggle');
    tBtn.classList.toggle('hidden', !this.enabled || (this.themeFailed && this.track === 'theme'));
    tBtn.textContent = TRACK_LABELS[this.track] || '🎵 Theme';
  },

  // ── music ──
  startMusic() {
    if (!this.enabled) return;
    if (this.track === 'theme' && !this.themeFailed) this.startTheme();
    else this.startAmbient();
  },

  stopMusic() {
    this.stopAmbient();
    if (this.themeAudio) this.themeAudio.pause();
  },

  startTheme() {
    if (!this.themeAudio) {
      this.themeAudio = new Audio('audio/hedwigs-theme.mp3');
      this.themeAudio.loop = true;
      this.themeAudio.volume = 0.35;
      this.themeAudio.addEventListener('error', () => {
        this.themeFailed = true;
        this.track = 'ambient';
        if (this.enabled) this.startAmbient();
        this.updateButtons();
      });
    }
    this.themeAudio.play().catch(() => {
      this.themeFailed = true;
      this.track = 'ambient';
      if (this.enabled) this.startAmbient();
      this.updateButtons();
    });
  },

  startAmbient() {
    this.ensureRunning();
    // Pattern/step-duration/drone are keyed off the current track selection —
    // this always resets them, so a prior duel override never leaks into a
    // normal track pick (stopDuelMusic() calls startMusic()/this, in order).
    const trackPatterns = { theme: AMBIENT_PATTERN, ambient: AMBIENT_PATTERN, common: COMMON_ROOM_PATTERN, hall: GREAT_HALL_PATTERN };
    const trackStepDur = { common: 0.5, hall: 0.36 };
    this._pattern = trackPatterns[this.track] || AMBIENT_PATTERN;
    this._stepDur = trackStepDur[this.track] || 0.42;
    this._droneFreq = 164.81;
    this._droneEvery = 16;
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
  },

  stopAmbient() {
    if (this.musicTimer) { clearInterval(this.musicTimer); this.musicTimer = null; }
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
    if (prev?.themeWasPlaying) this.startTheme();
    else this.startMusic();
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
  // If sound was left on, start it on the first user interaction (autoplay policy).
  document.addEventListener('click', () => {
    if (AudioEngine.enabled) { AudioEngine.ensureRunning(); AudioEngine.startMusic(); }
  }, { once: true });
}
