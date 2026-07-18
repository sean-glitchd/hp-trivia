export const AudioEngine = {
  ctx: null, masterGain: null, musicGain: null, sfxGain: null,
  enabled: localStorage.getItem('hp_sound') === 'on',
  track: localStorage.getItem('hp_track') === 'ambient' ? 'ambient' : 'theme',
  themeAudio: null, themeFailed: false,
  musicTimer: null, nextNoteTime: 0, step: 0,

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
      this.startMusic();
    } else {
      this.stopMusic();
    }
    this.updateButtons();
  },

  switchTrack() {
    this.track = this.track === 'theme' ? 'ambient' : 'theme';
    localStorage.setItem('hp_track', this.track);
    if (this.enabled) { this.stopMusic(); this.startMusic(); }
    this.updateButtons();
  },

  updateButtons() {
    const mBtn = document.getElementById('music-toggle');
    mBtn.textContent = this.enabled ? '🔊' : '🔇';
    mBtn.setAttribute('aria-pressed', String(this.enabled));
    const tBtn = document.getElementById('track-toggle');
    tBtn.classList.toggle('hidden', !this.enabled || this.themeFailed);
    tBtn.textContent = this.track === 'theme' ? '🎵 Theme' : '✨ Ambient';
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
    if (this.musicTimer) return;
    this.step = 0;
    this.nextNoteTime = this.ctx.currentTime + 0.1;
    this.musicTimer = setInterval(() => this.scheduleAmbient(), 25);
  },

  stopAmbient() {
    if (this.musicTimer) { clearInterval(this.musicTimer); this.musicTimer = null; }
  },

  scheduleAmbient() {
    while (this.nextNoteTime < this.ctx.currentTime + 0.12) {
      this.playAmbientStep(this.step, this.nextNoteTime);
      this.step = (this.step + 1) % AMBIENT_PATTERN.length;
      this.nextNoteTime += 0.42;
    }
  },

  playAmbientStep(step, t) {
    const freq = AMBIENT_PATTERN[step];
    if (freq) this.celesta(freq, t);
    if (step % 16 === 0) this.celesta(164.81, t, 2.4, 0.5); // low E drone
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
};

// Original arpeggiated pattern over E natural minor — deliberately not Hedwig's Theme.
// null = rest. 32 steps at ~72 BPM eighths.
export const AMBIENT_PATTERN = [
  329.63, null, 493.88, 659.26, null, 587.33, 493.88, null,
  440.00, null, 659.26, null, 783.99, null, 659.26, null,
  392.00, null, 587.33, 783.99, null, 659.26, 493.88, null,
  440.00, null, 493.88, null, 329.63, null, null, null,
];

export function initAudioListeners() {
  // If sound was left on, start it on the first user interaction (autoplay policy).
  document.addEventListener('click', () => {
    if (AudioEngine.enabled) { AudioEngine.ensureRunning(); AudioEngine.startMusic(); }
  }, { once: true });
}
