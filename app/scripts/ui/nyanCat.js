// Nyan Cat style header animation sharing the same canvas viewport as Matrix
// Renders stars, a rainbow trail, and a simple Nyan Cat sprite.
// Uses the existing <canvas id="matrixCanvas"> inside .matrix-viewport.
//
// API mirrors matrixRain.js:
//   nyanCat.initNyanCat()
//   nyanCat.setNyanCatEnabled(true|false)

let canvas = null;
let ctx = null;
let container = null;
let ro = null;

let running = false;
let rafId = 0;
let width = 0, height = 0, dpr = 1;
let lastTime = 0;

// Star field
let stars = [];
const STAR_DENSITY = 0.00012; // per px^2
const STAR_SPEED_MIN = 20;    // px/s
const STAR_SPEED_MAX = 90;    // px/s

// Trail
let trail = [];
const MAX_TRAIL_POINTS = 90;  // length of polyline
const STRIPE_COLORS = ['#ff003c', '#ff7a00', '#ffd400', '#00e05a', '#00a3ff', '#7a00ff']; // ROYGBV-ish
const STRIPE_WIDTH = 3;       // px (before DPR scaling)
const STRIPE_GAP = 2.2;       // px between stripes

// Cat
const CAT = {
  x: 0,
  y: 0,
  vx: 160,           // px/s (base, scaled a bit by viewport width)
  t: 0,              // ms accumulator for wobble
  wobbleAmp: 7,      // px
  wobbleFreq: 0.004  // wobble wave frequency
};

export function initNyanCat() {
  canvas = document.getElementById('matrixCanvas');
  if (!canvas) return;
  container = canvas.parentElement;
  ctx = canvas.getContext('2d', { alpha: true });

  // Resize observer to keep canvas in sync with container (only when Nyan is active)
  if ('ResizeObserver' in window) {
    ro = new ResizeObserver(() => reset());
    ro.observe(container);
  } else {
    window.addEventListener('resize', reset);
  }

  reset();
}

export function setNyanCatEnabled(enabled) {
  if (!canvas) return;
  if (enabled && !running) {
    running = true;
    lastTime = performance.now();
    rafId = requestAnimationFrame(tick);
  } else if (!enabled && running) {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    // Clear quickly when disabled
    ctx && ctx.clearRect(0, 0, width, height);
  }
}

function reset() {
  if (!canvas || !container) return;

  const d = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  dpr = d;

  const cw = Math.max(1, container.clientWidth);
  const ch = Math.max(1, container.clientHeight);
  width = cw;
  height = ch;

  // Physical pixels
  canvas.width = Math.floor(cw * dpr);
  canvas.height = Math.floor(ch * dpr);
  // CSS pixels
  canvas.style.width = cw + 'px';
  canvas.style.height = ch + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Rebuild star field based on area
  const targetStars = Math.max(24, Math.floor(width * height * STAR_DENSITY));
  stars = Array.from({ length: targetStars }, () => ({
    x: Math.random() * width,
    y: Math.random() * height,
    z: Math.random() * 0.7 + 0.3, // depth factor (0.3..1.0)
    speed: randRange(STAR_SPEED_MIN, STAR_SPEED_MAX)
  }));

  // Reset cat
  CAT.x = -40;
  CAT.y = height * 0.58;
  CAT.vx = Math.max(120, Math.min(320, width * 0.22));
  CAT.t = 0;

  // Trail fresh
  trail = [];

  ctx.clearRect(0, 0, width, height);
}

function tick(now) {
  if (!running) return;
  const dtMs = Math.min(50, now - lastTime); // ms clamp
  lastTime = now;
  const dt = dtMs / 1000;

  // Clear full frame
  ctx.clearRect(0, 0, width, height);

  // Background stars (behind trail/cat)
  drawStars(dt);

  // Update cat motion
  CAT.t += dtMs;
  CAT.x += CAT.vx * dt;
  const wobble = Math.sin(CAT.t * CAT.wobbleFreq) * CAT.wobbleAmp;
  CAT.y = height * 0.58 + wobble;

  // Push new trail point
  trail.push({ x: CAT.x - 8, y: CAT.y });
  if (trail.length > MAX_TRAIL_POINTS) trail.shift();

  // Draw rainbow trail
  drawTrail();

  // Draw cat sprite
  drawCat(CAT.x, CAT.y);

  // Respawn when off-screen
  if (CAT.x > width + 80) {
    CAT.x = -80;
    trail.length = 0;
  }

  rafId = requestAnimationFrame(tick);
}

function drawStars(dt) {
  // Slight parallax via per-star z factor
  for (let i = 0; i < stars.length; i++) {
    const s = stars[i];
    s.x -= s.speed * (0.35 + 0.65 * s.z) * dt;
    if (s.x < -2) {
      s.x = width + Math.random() * 40;
      s.y = Math.random() * height;
      s.z = Math.random() * 0.7 + 0.3;
      s.speed = randRange(STAR_SPEED_MIN, STAR_SPEED_MAX);
    }

    const size = Math.max(1, Math.round(1.2 + 1.6 * s.z));
    const alpha = 0.5 + 0.5 * s.z;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(Math.floor(s.x), Math.floor(s.y), size, size);
    ctx.globalAlpha = 1;
  }
}

function drawTrail() {
  if (trail.length < 2) return;

  // Soft glow
  ctx.save();
  ctx.shadowColor = 'rgba(255,255,255,0.45)';
  ctx.shadowBlur = 6;

  for (let i = 0; i < STRIPE_COLORS.length; i++) {
    const offset = (i - (STRIPE_COLORS.length - 1) / 2) * (STRIPE_WIDTH + STRIPE_GAP);
    ctx.beginPath();
    // Start at the oldest point to the newest
    for (let p = 0; p < trail.length; p++) {
      const tp = trail[p];
      const fade = p / trail.length; // 0..1
      const y = tp.y + offset * 0.9; // slight compression to keep within small viewport
      const x = tp.x - (1 - fade) * 8; // taper slightly
      if (p === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.lineWidth = STRIPE_WIDTH;
    ctx.strokeStyle = STRIPE_COLORS[i];
    ctx.globalAlpha = 0.85;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  ctx.restore();
}

function drawCat(cx, cy) {
  // Scale relative to header height
  const h = Math.min(28, Math.max(16, Math.floor(height * 0.34)));
  const bodyW = Math.floor(h * 1.6);
  const bodyH = h;
  const headSize = Math.floor(h * 0.72);
  const tartW = Math.floor(h * 1.1);
  const tartH = Math.floor(h * 0.84);

  // Pop-tart behind body
  const tartX = cx - bodyW * 0.55 - tartW * 0.7;
  const tartY = cy - tartH * 0.5;
  roundedRect(tartX, tartY, tartW, tartH, 4, '#fce6ef', '#f7adc8');

  // Body
  const bodyX = cx - bodyW * 0.5;
  const bodyY = cy - bodyH * 0.5;
  roundedRect(bodyX, bodyY, bodyW, bodyH, 6, '#5f6778');

  // Head (in front)
  const headX = cx + bodyW * 0.35;
  const headY = cy - headSize * 0.5;
  roundedRect(headX, headY, headSize, headSize, 4, '#6a7284');

  // Ears
  ctx.fillStyle = '#6a7284';
  const earW = Math.max(3, Math.floor(headSize * 0.28));
  const earH = Math.max(3, Math.floor(headSize * 0.35));
  // Left ear
  triangle(headX + earW * 0.2, headY + earH * 0.15, earW, earH);
  // Right ear
  triangle(headX + headSize - earW * 1.2, headY + earH * 0.15, earW, earH);

  // Tail
  const tailW = Math.max(3, Math.floor(bodyW * 0.18));
  const tailH = Math.max(4, Math.floor(bodyH * 0.38));
  roundedRect(bodyX - tailW * 1.1, cy - tailH * 0.5, tailW, tailH, 4, '#5f6778');

  // Face (eyes + nose)
  const eyeR = Math.max(1, Math.floor(headSize * 0.08));
  ctx.fillStyle = '#111';
  ctx.beginPath();
  ctx.arc(headX + headSize * 0.35, headY + headSize * 0.42, eyeR, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(headX + headSize * 0.65, headY + headSize * 0.42, eyeR, 0, Math.PI * 2);
  ctx.fill();

  // Nose
  ctx.fillStyle = '#f48fb1';
  ctx.beginPath();
  ctx.arc(headX + headSize * 0.5, headY + headSize * 0.58, Math.max(1, Math.floor(headSize * 0.06)), 0, Math.PI * 2);
  ctx.fill();
}

function roundedRect(x, y, w, h, r, fill, stroke) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

function triangle(x, y, w, h) {
  ctx.beginPath();
  ctx.moveTo(x + w * 0.5, y);
  ctx.lineTo(x, y + h);
  ctx.lineTo(x + w, y + h);
  ctx.closePath();
  ctx.fill();
}

function randRange(min, max) {
  return min + Math.random() * (max - min);
}