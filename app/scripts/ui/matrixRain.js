// Matrix rain animation for header canvas in Productivity Workspace

let canvas = null;
let ctx = null;
let container = null;
let ro = null;
let running = false;
let rafId = 0;
let cols = [];
let fontSize = 16;
let width = 0, height = 0;
let lastTime = 0;

const CHARSET = 'アカサタナハマヤラワ0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyzアイウエオカキクケコｱｲｳｴｵﾊﾍﾎﾑﾒﾓ';

// Tunable parameters for matrix rain behavior
// Density and layout
const DENSITY = 1.0;              // 0.6 = sparse, 1.0 = default, 1.6 = dense
const MIN_COLS = 8;               // minimum number of columns to render
const COL_SPACING_FACTOR = 1.1;   // smaller => tighter columns (more chars)
// Speed distribution (probabilities and ranges)
const FAST_PROB_INIT = 0.16;      // on first spawn
const FAST_PROB_RESET = 0.18;     // when a column respawns
const MED_PROB_INIT = 0.22;       // medium speed fraction (init)
const MED_PROB_RESET = 0.24;      // medium speed fraction (respawn)
const SPEED_SLOW = [0.06, 0.12];  // slow range
const SPEED_MED  = [0.14, 0.26];  // medium range
const SPEED_FAST = [0.34, 0.62];  // fast range
const T_SCALE = 0.20;             // overall motion scale (0.18–0.24 recommended)
const RESPAWN_ABOVE_VIEW = 0.8;   // start up to 80% viewport height above

// Glyph behavior
const CHAR_SWAP_MIN = 140;        // ms
const CHAR_SWAP_MAX = 620;        // ms

// Trail/visuals
const TAIL_DUP_PROB = 0.14;
const HEAD_ALPHA = 0.9;
const TAIL_ALPHA = 0.55;
const HEAD_SHADOW_BLUR = 6;
const TRAIL_FADE_ALPHA = 0.18;

export function initMatrixRain() {
  canvas = document.getElementById('matrixCanvas');
  if (!canvas) return;
  container = canvas.parentElement;
  ctx = canvas.getContext('2d', { alpha: true });

  // Resize observer to keep canvas in sync with container
  if ('ResizeObserver' in window) {
    ro = new ResizeObserver(() => reset());
    ro.observe(container);
  } else {
    window.addEventListener('resize', reset);
  }

  reset();
}

export function setMatrixRainEnabled(enabled) {
  if (!canvas) return;
  if (enabled && !running) {
    running = true;
    lastTime = performance.now();
    rafId = requestAnimationFrame(tick);
  } else if (!enabled && running) {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    // Fade out quickly
    ctx && ctx.clearRect(0, 0, width, height);
  }
}

function reset() {
  if (!canvas || !container) return;
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
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

  // Font size relative to height
  fontSize = Math.max(16, Math.min(26, Math.floor(ch / 5.2)));
  ctx.font = `${fontSize}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Courier New", monospace`;
  ctx.textBaseline = 'top';

  // Evenly distribute columns across full width (density-tunable)
  const baseCols = width / Math.max(10, fontSize * COL_SPACING_FACTOR);
  const colCount = Math.max(MIN_COLS, Math.ceil(baseCols * DENSITY));
  cols = Array.from({ length: colCount }, () => ({
    y: -Math.random() * ch * RESPAWN_ABOVE_VIEW,
    speed: pickStreamSpeed('init'),
    char: pickChar(),
    nextCharAt: performance.now() + randRange(CHAR_SWAP_MIN, CHAR_SWAP_MAX)
  }));

  // Clear on reset
  ctx.clearRect(0, 0, width, height);
}

function pickChar() {
  const i = (Math.random() * CHARSET.length) | 0;
  return CHARSET[i];
}

function randRange(min, max) {
  return min + Math.random() * (max - min);
}

function pickStreamSpeed(phase) {
  const r = Math.random();
  const fastProb = phase === 'reset' ? FAST_PROB_RESET : FAST_PROB_INIT;
  const medProb = phase === 'reset' ? MED_PROB_RESET : MED_PROB_INIT;
  if (r < fastProb) return randRange(SPEED_FAST[0], SPEED_FAST[1]);
  if (r < fastProb + medProb) return randRange(SPEED_MED[0], SPEED_MED[1]);
  return randRange(SPEED_SLOW[0], SPEED_SLOW[1]);
}

function tick(now) {
  if (!running) return;
  const dt = Math.min(50, now - lastTime); // ms
  lastTime = now;
  const tScale = T_SCALE; // overall motion scale

  // Trail fade to transparency (keeps canvas background transparent while fading trails)
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = `rgba(0, 0, 0, ${TRAIL_FADE_ALPHA})`;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();

  const styles = getComputedStyle(document.body);
  const headColor = styles.getPropertyValue('--primary').trim() || '#39ff14';
  const tailColor = styles.getPropertyValue('--accent').trim() || 'rgba(57,255,20,0.6)';
  const stepX = (cols.length > 1)
    ? ((width - Math.max(fontSize, 1)) / (cols.length - 1))
    : (width - Math.max(fontSize, 1));

  for (let x = 0; x < cols.length; x++) {
    const col = cols[x];
    const colX = Math.min(width - fontSize, Math.round(x * stepX));

    // Occasionally change glyph to reduce flicker/noise
    if (!col.char || now >= (col.nextCharAt || 0)) {
      col.char = pickChar();
      col.nextCharAt = now + randRange(CHAR_SWAP_MIN, CHAR_SWAP_MAX);
    }

    // Draw head
    ctx.globalAlpha = HEAD_ALPHA;
    ctx.shadowColor = headColor;
    ctx.shadowBlur = HEAD_SHADOW_BLUR;
    ctx.fillStyle = headColor;
    ctx.fillText(col.char, colX, col.y);

    // Subtle tail
    ctx.globalAlpha = TAIL_ALPHA;
    ctx.shadowBlur = 0;
    ctx.fillStyle = tailColor;
    if (Math.random() < TAIL_DUP_PROB) {
      ctx.fillText(col.char, colX, col.y - fontSize);
    }
    ctx.globalAlpha = 1;

    // Advance
    col.y += (fontSize + 2) * col.speed * (dt / 16.67) * tScale;
    if (col.y > height + fontSize * 2) {
      col.y = -Math.random() * height * RESPAWN_ABOVE_VIEW;
      col.speed = pickStreamSpeed('reset');
      col.char = pickChar();
      col.nextCharAt = now + randRange(CHAR_SWAP_MIN, CHAR_SWAP_MAX);
    }
  }

  rafId = requestAnimationFrame(tick);
}