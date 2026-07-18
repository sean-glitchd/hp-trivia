// ─── FX: particle engine + canvas layer registry ────────────────────────────
// Two fixed full-viewport canvases: #sky-canvas (z-0, background layers like
// sky.js) and #fx-canvas (z-200, foreground particles: sparks/confetti/etc).
// One requestAnimationFrame loop drives everything. No other module may be
// imported here — fx.js is a leaf dependency (quiz/main/cursor/sky import it).

const POOL_SIZE = 600;
const MAX_DPR = 2;

function makeParticle() {
  return {
    active: false,
    x: 0, y: 0,
    vx: 0, vy: 0,
    gravity: 0, drag: 1,
    life: 0, maxLife: 1,
    size: 1,
    r: 201, g: 168, b: 76,
    alpha: 1,
    kind: 'spark',
    spin: 0,
    phase: 0,
  };
}

const pool = new Array(POOL_SIZE);
for (let i = 0; i < POOL_SIZE; i++) pool[i] = makeParticle();
let allocCursor = 0;
let activeCount = 0;

const fireflies = [];
const FIREFLY_COUNT = 24;

function alloc() {
  for (let i = 0; i < POOL_SIZE; i++) {
    const idx = (allocCursor + i) % POOL_SIZE;
    if (!pool[idx].active) {
      allocCursor = (idx + 1) % POOL_SIZE;
      pool[idx].active = true;
      activeCount++;
      return pool[idx];
    }
  }
  return null; // pool exhausted — drop this spawn
}

function free(p) {
  p.active = false;
  activeCount--;
}

// ─── color helpers ───────────────────────────────────────────────────────────
function parseColor(str, fallback) {
  if (!str) return fallback;
  str = str.trim();
  let m = /^#([0-9a-f]{3})$/i.exec(str);
  if (m) {
    const h = m[1];
    return {
      r: parseInt(h[0] + h[0], 16),
      g: parseInt(h[1] + h[1], 16),
      b: parseInt(h[2] + h[2], 16),
    };
  }
  m = /^#([0-9a-f]{6})$/i.exec(str);
  if (m) {
    const h = m[1];
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
    };
  }
  m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(str);
  if (m) return { r: +m[1], g: +m[2], b: +m[3] };
  return fallback;
}

const GOLD_FALLBACK = { r: 201, g: 168, b: 76 };
let accentColor = { ...GOLD_FALLBACK };

function readAccent() {
  try {
    const raw = getComputedStyle(document.body).getPropertyValue('--accent');
    accentColor = parseColor(raw, GOLD_FALLBACK) || GOLD_FALLBACK;
  } catch (e) {
    accentColor = { ...GOLD_FALLBACK };
  }
}

function setColor(p, rgb) {
  p.r = rgb.r; p.g = rgb.g; p.b = rgb.b;
}

// ─── FX object ────────────────────────────────────────────────────────────────
export const FX = {
  reduced: window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  skyCanvas: null,
  fxCanvas: null,
  skyCtx: null,
  fxCtx: null,
  layers: [], // { layer, ctx }
  _running: false,
  _rafId: null,
  _lastT: 0,
  _dpr: 1,

  init() {
    if (this.skyCanvas) return; // already initialized

    this.skyCanvas = document.createElement('canvas');
    this.skyCanvas.id = 'sky-canvas';
    Object.assign(this.skyCanvas.style, {
      position: 'fixed', inset: '0', zIndex: '0', pointerEvents: 'none',
    });
    this.fxCanvas = document.createElement('canvas');
    this.fxCanvas.id = 'fx-canvas';
    Object.assign(this.fxCanvas.style, {
      position: 'fixed', inset: '0', zIndex: '200', pointerEvents: 'none',
    });

    document.body.appendChild(this.skyCanvas);
    document.body.appendChild(this.fxCanvas);

    this.skyCtx = this.skyCanvas.getContext('2d');
    this.fxCtx = this.fxCanvas.getContext('2d');

    readAccent();
    this._resize();
    window.addEventListener('resize', () => this._resize());

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this._stopLoop();
      else this._startLoop();
    });

    this._initFireflies();
    this._startLoop();
  },

  refreshAccent() {
    readAccent();
  },

  addLayer(layer, canvas) {
    const ctx = canvas === this.skyCanvas ? this.skyCtx : this.fxCtx;
    this.layers.push({ layer, ctx, canvas });
  },

  _resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    this._dpr = dpr;
    const w = window.innerWidth;
    const h = window.innerHeight;
    for (const canvas of [this.skyCanvas, this.fxCanvas]) {
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    for (const { layer } of this.layers) {
      if (layer.resize) layer.resize(w, h, dpr);
    }
  },

  _initFireflies() {
    const w = window.innerWidth, h = window.innerHeight;
    for (let i = 0; i < FIREFLY_COUNT; i++) {
      fireflies.push({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 8,
        vy: (Math.random() - 0.5) * 8,
        phase: Math.random() * Math.PI * 2,
        speed: 0.4 + Math.random() * 0.6,
        size: 1 + Math.random() * 1.6,
      });
    }
  },

  _startLoop() {
    if (this._running) return;
    this._running = true;
    this._lastT = performance.now();
    this._rafId = requestAnimationFrame((t) => this._tick(t));
  },

  _stopLoop() {
    this._running = false;
    if (this._rafId) cancelAnimationFrame(this._rafId);
    this._rafId = null;
  },

  _tick(now) {
    if (!this._running) return;
    let dt = (now - this._lastT) / 1000;
    if (dt > 0.05) dt = 0.05; // clamp
    this._lastT = now;
    const t = now / 1000;

    this._update(dt, t);
    this._draw(t);

    this._rafId = requestAnimationFrame((n) => this._tick(n));
  },

  _update(dt, t) {
    for (const { layer } of this.layers) {
      if (layer.update) layer.update(dt, t);
    }

    // particle pool physics
    for (let i = 0; i < POOL_SIZE; i++) {
      const p = pool[i];
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) { free(p); continue; }

      p.vy += p.gravity * dt;
      if (p.drag !== 1) {
        const f = Math.pow(p.drag, dt * 60);
        p.vx *= f; p.vy *= f;
      }
      if (p.spin !== 0 && (p.kind === 'confetti-rect' || p.kind === 'confetti-circle')) {
        const age = p.maxLife - p.life;
        p.vx += Math.sin(age * 3 + p.phase) * 4 * dt * 10;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }

    // fireflies (permanent, wandering)
    if (!this.reduced) {
      const w = window.innerWidth, h = window.innerHeight;
      for (const f of fireflies) {
        f.vx += (Math.random() - 0.5) * 4 * dt;
        f.vy += (Math.random() - 0.5) * 4 * dt;
        const spd = Math.hypot(f.vx, f.vy);
        const maxSpd = 14;
        if (spd > maxSpd) { f.vx = f.vx / spd * maxSpd; f.vy = f.vy / spd * maxSpd; }
        f.x += f.vx * dt;
        f.y += f.vy * dt;
        if (f.x < -10) f.x = w + 10;
        if (f.x > w + 10) f.x = -10;
        if (f.y < -10) f.y = h + 10;
        if (f.y > h + 10) f.y = -10;
      }
    }
  },

  _draw(t) {
    // ── sky canvas: layers registered on it (always redraw — twinkle/drift) ──
    const skyLayers = this.layers.filter(l => l.ctx === this.skyCtx);
    if (skyLayers.length) {
      this.skyCtx.save();
      this.skyCtx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
      this.skyCtx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      for (const { layer } of skyLayers) {
        if (layer.draw) layer.draw(this.skyCtx);
      }
      this.skyCtx.restore();
    }

    // ── fx canvas: particle pool + fireflies + any fx-registered layers ──
    const fxLayers = this.layers.filter(l => l.ctx === this.fxCtx);
    const hasFireflies = !this.reduced && fireflies.length > 0;
    if (activeCount === 0 && !hasFireflies && fxLayers.length === 0) {
      return; // nothing to draw — skip clear entirely
    }

    const ctx = this.fxCtx;
    ctx.save();
    ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

    for (const { layer } of fxLayers) {
      if (layer.draw) layer.draw(ctx);
    }

    // source-over pass: smoke
    ctx.globalCompositeOperation = 'source-over';
    for (let i = 0; i < POOL_SIZE; i++) {
      const p = pool[i];
      if (!p.active || p.kind !== 'smoke') continue;
      this._drawParticle(ctx, p);
    }

    // additive pass: sparks / glow / glint / confetti / ring / firefly
    ctx.globalCompositeOperation = 'lighter';
    if (hasFireflies) {
      for (const f of fireflies) {
        const flicker = 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(t * f.speed * 2 + f.phase));
        ctx.beginPath();
        ctx.fillStyle = `rgba(240,208,128,${flicker.toFixed(3)})`;
        ctx.arc(f.x, f.y, f.size, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    for (let i = 0; i < POOL_SIZE; i++) {
      const p = pool[i];
      if (!p.active || p.kind === 'smoke') continue;
      this._drawParticle(ctx, p);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();
  },

  _drawParticle(ctx, p) {
    const progress = 1 - p.life / p.maxLife;
    let alpha = p.alpha;
    let radius = p.size;

    switch (p.kind) {
      case 'ring': {
        alpha = p.alpha * (1 - progress);
        radius = p.size * progress;
        if (alpha <= 0 || radius <= 0) return;
        ctx.beginPath();
        ctx.strokeStyle = `rgba(${p.r},${p.g},${p.b},${alpha.toFixed(3)})`;
        ctx.lineWidth = 3 * (1 - progress) + 0.5;
        ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
        ctx.stroke();
        return;
      }
      case 'smoke': {
        alpha = 0.35 * (1 - progress);
        radius = p.size * (0.4 + 0.6 * progress);
        if (alpha <= 0) return;
        ctx.beginPath();
        ctx.fillStyle = `rgba(${p.r},${p.g},${p.b},${alpha.toFixed(3)})`;
        ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
        ctx.fill();
        return;
      }
      case 'glint': {
        alpha = progress < 0.7 ? p.alpha : p.alpha * (1 - (progress - 0.7) / 0.3);
        if (alpha <= 0) return;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.strokeStyle = `rgba(${p.r},${p.g},${p.b},${alpha.toFixed(3)})`;
        ctx.lineWidth = 1.2;
        const s = p.size;
        ctx.beginPath();
        ctx.moveTo(-s, 0); ctx.lineTo(s, 0);
        ctx.moveTo(0, -s); ctx.lineTo(0, s);
        ctx.stroke();
        ctx.beginPath();
        ctx.fillStyle = `rgba(${p.r},${p.g},${p.b},${alpha.toFixed(3)})`;
        ctx.arc(0, 0, s * 0.35, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        return;
      }
      case 'confetti-rect': {
        alpha = progress < 0.7 ? p.alpha : p.alpha * (1 - (progress - 0.7) / 0.3);
        if (alpha <= 0) return;
        const age = p.maxLife - p.life;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.spin * age);
        ctx.fillStyle = `rgba(${p.r},${p.g},${p.b},${alpha.toFixed(3)})`;
        ctx.fillRect(-p.size / 2, -p.size * 0.3, p.size, p.size * 0.6);
        ctx.restore();
        return;
      }
      case 'confetti-circle': {
        alpha = progress < 0.7 ? p.alpha : p.alpha * (1 - (progress - 0.7) / 0.3);
        if (alpha <= 0) return;
        ctx.beginPath();
        ctx.fillStyle = `rgba(${p.r},${p.g},${p.b},${alpha.toFixed(3)})`;
        ctx.arc(p.x, p.y, p.size / 2, 0, Math.PI * 2);
        ctx.fill();
        return;
      }
      case 'glow': {
        alpha = p.alpha * (1 - progress);
        if (alpha <= 0) return;
        const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);
        grad.addColorStop(0, `rgba(${p.r},${p.g},${p.b},${alpha.toFixed(3)})`);
        grad.addColorStop(1, `rgba(${p.r},${p.g},${p.b},0)`);
        ctx.beginPath();
        ctx.fillStyle = grad;
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        return;
      }
      default: { // spark
        alpha = progress < 0.6 ? p.alpha : p.alpha * (1 - (progress - 0.6) / 0.4);
        if (alpha <= 0) return;
        ctx.beginPath();
        ctx.fillStyle = `rgba(${p.r},${p.g},${p.b},${alpha.toFixed(3)})`;
        ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  },

  // ─── emitters ────────────────────────────────────────────────────────────

  trail(x, y, vx = 0, vy = 0) {
    if (this.reduced) return;
    const count = Math.random() < 0.5 ? 1 : 2;
    for (let i = 0; i < count; i++) {
      const p = alloc();
      if (!p) return;
      p.x = x; p.y = y;
      const ang = Math.random() * Math.PI * 2;
      const spd = 10 + Math.random() * 30;
      p.vx = vx * 0.2 + Math.cos(ang) * spd * 0.15;
      p.vy = vy * 0.2 + Math.sin(ang) * spd * 0.15 - 15;
      p.gravity = 60;
      p.drag = 0.94;
      p.maxLife = p.life = 0.35 + Math.random() * 0.3;
      p.size = 1.3 + Math.random() * 1.4;
      p.alpha = 1;
      p.kind = 'spark';
      p.spin = 0;
      setColor(p, accentColor);
    }
  },

  burst(x, y, { count = 26, color } = {}) {
    const rgb = parseColor(color, accentColor) || accentColor;

    if (this.reduced) {
      const p = alloc();
      if (!p) return;
      p.x = x; p.y = y;
      p.vx = 0; p.vy = 0; p.gravity = 0; p.drag = 1;
      p.maxLife = p.life = 0.3;
      p.size = 22;
      p.alpha = 0.8;
      p.kind = 'glow';
      p.spin = 0;
      setColor(p, rgb);
      return;
    }

    for (let i = 0; i < count; i++) {
      const p = alloc();
      if (!p) break;
      const ang = Math.random() * Math.PI * 2;
      const spd = 60 + Math.random() * 160;
      p.x = x; p.y = y;
      p.vx = Math.cos(ang) * spd;
      p.vy = Math.sin(ang) * spd;
      p.gravity = 90;
      p.drag = 0.92;
      p.maxLife = p.life = 0.4 + Math.random() * 0.5;
      p.size = 1.5 + Math.random() * 2;
      p.alpha = 1;
      p.kind = 'spark';
      p.spin = 0;
      setColor(p, rgb);
    }

    const glints = Math.max(3, Math.round(count / 8));
    for (let i = 0; i < glints; i++) {
      const p = alloc();
      if (!p) break;
      const ang = Math.random() * Math.PI * 2;
      const spd = 30 + Math.random() * 60;
      p.x = x; p.y = y;
      p.vx = Math.cos(ang) * spd;
      p.vy = Math.sin(ang) * spd;
      p.gravity = 60;
      p.drag = 0.9;
      p.maxLife = p.life = 0.5 + Math.random() * 0.3;
      p.size = 3 + Math.random() * 2.5;
      p.alpha = 1;
      p.kind = 'glint';
      p.spin = 0;
      setColor(p, rgb);
    }
  },

  fizzle(x, y) {
    const n = 6 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) {
      const p = alloc();
      if (!p) break;
      p.x = x + (Math.random() - 0.5) * 10;
      p.y = y + (Math.random() - 0.5) * 10;
      p.vx = (Math.random() - 0.5) * 20;
      p.vy = -20 - Math.random() * 20;
      p.gravity = -10; // slight buoyancy
      p.drag = 0.97;
      p.maxLife = p.life = 0.8 + Math.random() * 0.6;
      p.size = 8 + Math.random() * 10;
      p.alpha = 0.35;
      p.kind = 'smoke';
      p.spin = 0;
      p.r = 110; p.g = 130; p.b = 100;
    }
  },

  ringPulse(x, y, color) {
    const rgb = parseColor(color, accentColor) || accentColor;
    const p = alloc();
    if (!p) return;
    p.x = x; p.y = y;
    p.vx = 0; p.vy = 0; p.gravity = 0; p.drag = 1;
    p.maxLife = p.life = this.reduced ? 0.3 : 0.5;
    p.size = 46;
    p.alpha = 0.9;
    p.kind = 'ring';
    p.spin = 0;
    setColor(p, rgb);
  },

  tapBurst(x, y) {
    const p = alloc();
    if (p) {
      p.x = x; p.y = y;
      p.vx = 0; p.vy = 0; p.gravity = 0; p.drag = 1;
      p.maxLife = p.life = this.reduced ? 0.3 : 0.4;
      p.size = 28;
      p.alpha = 0.85;
      p.kind = 'ring';
      p.spin = 0;
      setColor(p, accentColor);
    }
    this.burst(x, y, { count: this.reduced ? 0 : 6 });
  },

  confetti({ colors, count = 80 } = {}) {
    const palette = (colors && colors.length ? colors : ['#c9a84c', '#f0d080', '#ffffff']);
    const n = this.reduced ? Math.round(count / 2) : count;
    const w = window.innerWidth;
    for (let i = 0; i < n; i++) {
      const p = alloc();
      if (!p) break;
      const rgb = parseColor(palette[Math.floor(Math.random() * palette.length)], accentColor) || accentColor;
      p.x = Math.random() * w;
      p.y = -10 - Math.random() * 200;
      p.vx = this.reduced ? 0 : (Math.random() - 0.5) * 40;
      p.vy = 90 + Math.random() * 70;
      p.gravity = 30;
      p.drag = 1;
      p.maxLife = p.life = 2.4 + Math.random() * 1.6;
      p.size = 4 + Math.random() * 6;
      p.spin = this.reduced ? 0 : (Math.random() - 0.5) * 6;
      p.phase = Math.random() * Math.PI * 2;
      p.alpha = 1;
      p.kind = Math.random() > 0.5 ? 'confetti-rect' : 'confetti-circle';
      setColor(p, rgb);
    }
  },
};
