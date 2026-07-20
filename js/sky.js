// ─── sky.js: layered night-sky background (nebula + parallax stars) ─────────
// Registers two layers onto FX's sky canvas: a prerendered nebula and a
// 3-layer parallax starfield with twinkle + occasional shooting stars.

import { FX } from './fx.js';

const FINE_POINTER = window.matchMedia && window.matchMedia('(pointer: fine)').matches;

// ── Nebula: prerendered to an offscreen canvas, redrawn only on resize ──────
const nebula = {
  canvas: document.createElement('canvas'),
  ctx: null,
  w: 0, h: 0,

  render(w, h, dpr, tint) {
    this.w = w; this.h = h;
    this.dpr = dpr;
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    if (!this.ctx) this.ctx = this.canvas.getContext('2d');
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = '#1a0a2e';
    ctx.fillRect(0, 0, w, h);

    const blobs = [
      { x: w * 0.2, y: h * 0.25, r: Math.max(w, h) * 0.55, c: 'rgba(36,17,69,0.9)' },
      { x: w * 0.85, y: h * 0.15, r: Math.max(w, h) * 0.45, c: 'rgba(40,60,90,0.10)' }, // faint teal
      { x: w * 0.6, y: h * 0.75, r: Math.max(w, h) * 0.5, c: 'rgba(201,168,76,0.06)' }, // gold dust
      { x: w * 0.1, y: h * 0.85, r: Math.max(w, h) * 0.4, c: 'rgba(60,20,80,0.5)' },
    ];
    for (const b of blobs) {
      const grad = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r);
      grad.addColorStop(0, b.c);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
    }

    // house-tint wash — blends the whole sky toward the selected house color
    if (tint) {
      const { r, g, b } = tint;
      const grad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.8);
      grad.addColorStop(0, `rgba(${r},${g},${b},0.22)`);
      grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
    }

    // vignette
    const vg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, w, h);
  },
};

// brightness multiplier for the lumos/nox easter egg — 1.0 is neutral.
let brightness = 1;

export function setBrightness(mult) {
  brightness = mult;
}

// ── House tint: nebula blends toward the selected house's accent color ──────
// (lumos/brightness template above, but a lerped RGB target instead of a
// scalar) so declaring a house crossfades the whole sky, not just the UI chrome.
const TINT_DURATION = 0.6; // seconds, matches the CSS crossfade below
let currentTint = null;
let tintFrom = null, tintTo = null, tintT = 1; // tintT===1 means settled, no active lerp

function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : null;
}

export function setHouseTint(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return;
  if (FX.reduced) {
    currentTint = tintFrom = tintTo = rgb;
    tintT = 1;
    if (nebula.w) nebula.render(nebula.w, nebula.h, nebula.dpr || 1, currentTint);
    return;
  }
  tintFrom = currentTint || rgb;
  tintTo = rgb;
  tintT = 0;
}

const nebulaLayer = {
  resize(w, h, dpr) { nebula.render(w, h, dpr, currentTint); },
  update(dt) {
    if (tintT >= 1) return;
    tintT = Math.min(1, tintT + dt / TINT_DURATION);
    currentTint = {
      r: tintFrom.r + (tintTo.r - tintFrom.r) * tintT,
      g: tintFrom.g + (tintTo.g - tintFrom.g) * tintT,
      b: tintFrom.b + (tintTo.b - tintFrom.b) * tintT,
    };
    if (nebula.w) nebula.render(nebula.w, nebula.h, nebula.dpr || 1, currentTint);
  },
  draw(ctx) {
    if (nebula.w && nebula.h) {
      ctx.drawImage(nebula.canvas, 0, 0, nebula.canvas.width, nebula.canvas.height, 0, 0, nebula.w, nebula.h);
      if (brightness !== 1) {
        const amt = (brightness - 1) * 0.3;
        ctx.fillStyle = amt >= 0
          ? `rgba(255,246,214,${Math.min(0.35, amt).toFixed(3)})`
          : `rgba(0,0,0,${Math.min(0.35, -amt).toFixed(3)})`;
        ctx.fillRect(0, 0, nebula.w, nebula.h);
      }
    }
  },
};

// ── Stars: 3 parallax layers ─────────────────────────────────────────────────
function makeStars(count, depth) {
  const arr = [];
  for (let i = 0; i < count; i++) {
    arr.push({
      x: Math.random(),
      y: Math.random(),
      r: 0.5 + Math.random() * (depth === 'near' ? 1.6 : 1.1),
      phase: Math.random() * Math.PI * 2,
      speed: 0.5 + Math.random() * 1.2,
      driftX: (Math.random() - 0.5) * 0.002,
      driftY: (Math.random() - 0.5) * 0.001,
      bright: depth === 'near' && Math.random() < 0.35,
    });
  }
  return arr;
}

const starLayers = {
  far: { stars: makeStars(60, 'far'), parallax: 4 },
  mid: { stars: makeStars(40, 'mid'), parallax: 10 },
  near: { stars: makeStars(25, 'near'), parallax: 22 },
};

let vw = window.innerWidth, vh = window.innerHeight;
let pointerX = vw / 2, pointerY = vh / 2;
let parallaxX = 0, parallaxY = 0;

if (FINE_POINTER) {
  window.addEventListener('pointermove', (e) => {
    pointerX = e.clientX;
    pointerY = e.clientY;
  });
}

let shootingStar = null;
let nextShootAt = performance.now() / 1000 + 20 + Math.random() * 25;

function drawStar(ctx, x, y, r, alpha, bright) {
  ctx.beginPath();
  ctx.fillStyle = `rgba(255,255,255,${alpha.toFixed(3)})`;
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  if (bright) {
    ctx.save();
    ctx.globalAlpha = alpha * 0.7;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 0.6;
    const s = r * 3.5;
    ctx.beginPath();
    ctx.moveTo(x - s, y); ctx.lineTo(x + s, y);
    ctx.moveTo(x, y - s); ctx.lineTo(x, y + s);
    ctx.stroke();
    ctx.restore();
  }
}

const starsLayer = {
  resize(w, h) { vw = w; vh = h; },

  update(dt, t) {
    if (FINE_POINTER && !FX.reduced) {
      const targetX = (pointerX / vw - 0.5) * 2;
      const targetY = (pointerY / vh - 0.5) * 2;
      parallaxX += (targetX - parallaxX) * 0.05;
      parallaxY += (targetY - parallaxY) * 0.05;
    }

    for (const key of ['far', 'mid', 'near']) {
      for (const s of starLayers[key].stars) {
        s.x += s.driftX * dt;
        s.y += s.driftY * dt;
        if (s.x < -0.02) s.x = 1.02;
        if (s.x > 1.02) s.x = -0.02;
        if (s.y < -0.02) s.y = 1.02;
        if (s.y > 1.02) s.y = -0.02;
      }
    }

    if (!FX.reduced) {
      if (shootingStar) {
        shootingStar.life -= dt;
        shootingStar.x += shootingStar.vx * dt;
        shootingStar.y += shootingStar.vy * dt;
        if (shootingStar.life <= 0) shootingStar = null;
      } else if (t >= nextShootAt) {
        const startX = Math.random() * vw * 0.6;
        const startY = Math.random() * vh * 0.25;
        const speed = 700 + Math.random() * 400;
        const ang = (Math.PI / 5) + Math.random() * 0.2;
        shootingStar = {
          x: startX, y: startY,
          vx: Math.cos(ang) * speed,
          vy: Math.sin(ang) * speed,
          life: 0.9, maxLife: 0.9,
        };
        nextShootAt = t + 20 + Math.random() * 25;
      }
    }
  },

  draw(ctx) {
    for (const key of ['far', 'mid', 'near']) {
      const { stars, parallax } = starLayers[key];
      const px = FINE_POINTER ? parallaxX * parallax : 0;
      const py = FINE_POINTER ? parallaxY * parallax : 0;
      for (const s of stars) {
        const tw = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(performance.now() / 1000 * s.speed + s.phase));
        const x = s.x * vw + px;
        const y = s.y * vh + py;
        drawStar(ctx, x, y, s.r, Math.min(1, tw * brightness), s.bright);
      }
    }

    if (shootingStar) {
      const s = shootingStar;
      const alpha = Math.max(0, s.life / s.maxLife);
      const tailLen = 90;
      const norm = Math.hypot(s.vx, s.vy) || 1;
      const tx = s.x - (s.vx / norm) * tailLen;
      const ty = s.y - (s.vy / norm) * tailLen;
      const grad = ctx.createLinearGradient(s.x, s.y, tx, ty);
      grad.addColorStop(0, `rgba(255,255,255,${alpha})`);
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.strokeStyle = grad;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(tx, ty);
      ctx.stroke();
    }
  },
};

// ── Owl flyby: rare easter egg on backToMenu, dark silhouette glides once ────
let owl = null;

const owlLayer = {
  update(dt) {
    if (!owl) return;
    owl.x += owl.vx * dt;
    owl.flap += dt * 9;
    if (owl.x < -70 || owl.x > vw + 70) owl = null;
  },
  draw(ctx) {
    if (!owl) return;
    const wingAngle = Math.sin(owl.flap) * 0.6;
    ctx.save();
    ctx.translate(owl.x, owl.y);
    ctx.scale(owl.dir, 1);
    ctx.fillStyle = 'rgba(8,6,12,0.8)';
    // body
    ctx.beginPath();
    ctx.ellipse(0, 0, 10, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    // wings
    for (const s of [1, -1]) {
      ctx.beginPath();
      ctx.moveTo(0, -2);
      ctx.quadraticCurveTo(s * 18, -14 - wingAngle * 14, s * 30, -2 - wingAngle * 6);
      ctx.quadraticCurveTo(s * 14, 4, 0, -2);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  },
};

export function spawnOwlFlyby() {
  if (FX.reduced || owl) return;
  const dir = Math.random() < 0.5 ? 1 : -1;
  const y = 40 + Math.random() * (vh * 0.3);
  const speed = 90 + Math.random() * 40;
  owl = { x: dir === 1 ? -60 : vw + 60, y, vx: dir * speed, dir, flap: 0 };
}

export function initSky() {
  FX.addLayer(nebulaLayer, FX.skyCanvas);
  nebula.render(vw, vh, Math.min(window.devicePixelRatio || 1, 2));
  FX.addLayer(starsLayer, FX.skyCanvas);
  FX.addLayer(owlLayer, FX.skyCanvas);
}
