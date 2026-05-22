// Static USA flag banner sharing the same canvas viewport as Matrix / Nyan Cat.
// Draws a full-bleed American flag (13 stripes, canton with 50 stars)
// once on init, theme activation, and resize - no animation loop.
//
// API mirrors matrixRain.js / nyanCat.js:
//   usaFlag.initUsaFlag()
//   usaFlag.setUsaFlagEnabled(true|false)

let canvas = null;
let ctx = null;
let container = null;
let ro = null;

let enabled = false;
let width = 0, height = 0, dpr = 1;

// Official US flag colors (per US Flag Code / "Old Glory")
const RED = '#BF0A30';
const WHITE = '#FFFFFF';
const BLUE = '#002868';

export function initUsaFlag() {
  canvas = document.getElementById('themeCanvas');
  if (!canvas) return;
  container = canvas.parentElement;
  ctx = canvas.getContext('2d', { alpha: true });

  if ('ResizeObserver' in window) {
    ro = new ResizeObserver(() => { if (enabled) draw(); });
    ro.observe(container);
  } else {
    window.addEventListener('resize', () => { if (enabled) draw(); });
  }
}

export function setUsaFlagEnabled(on) {
  if (!canvas) return;
  enabled = !!on;
  if (enabled) {
    draw();
    requestAnimationFrame(() => { if (enabled) draw(); });
  } else {
    ctx && ctx.clearRect(0, 0, width, height);
  }
}

function resizeCanvas() {
  const d = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  dpr = d;

  const cw = Math.max(1, container.clientWidth);
  const ch = Math.max(1, container.clientHeight);
  width = cw;
  height = ch;

  canvas.width = Math.floor(cw * dpr);
  canvas.height = Math.floor(ch * dpr);
  canvas.style.width = cw + 'px';
  canvas.style.height = ch + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function draw() {
  if (!canvas || !container || !ctx) return;
  resizeCanvas();
  ctx.clearRect(0, 0, width, height);

  const flagW = width;
  const flagH = height;
  const offX = 0;
  const offY = 0;

  // === Stripes (13 total, top is red) ===
  const stripeH = flagH / 13;
  for (let i = 0; i < 13; i++) {
    ctx.fillStyle = (i % 2 === 0) ? RED : WHITE;
    ctx.fillRect(offX, offY + i * stripeH, flagW, stripeH + 0.5); // +0.5 to avoid sub-pixel gaps
  }

  // === Canton (union) ===
  // Per spec: canton covers top 7 stripes in height and 0.76 hoist in width.
  // hoist = flagH, so canton width = 0.76 * flagH; canton height = 7/13 * flagH.
  const cantonW = 0.76 * flagH;
  const cantonH = (7 / 13) * flagH;
  ctx.fillStyle = BLUE;
  ctx.fillRect(offX, offY, cantonW, cantonH);

  // === 50 stars: 9 rows x 11 cols, alternating 6/5 stars ===
  // Per spec: rows are evenly spaced over the canton vertically with margins,
  // columns evenly spaced horizontally. Star diameter = 4/5 of a stripe height.
  const starDiameter = 0.0616 * flagH;     // standard spec (~4/5 of stripe height)
  const starOuterR = starDiameter / 2;
  const starInnerR = starOuterR * 0.382;   // golden-ratio inner radius for 5-point star

  // Spacing per spec
  const colSpacing = cantonW / 12;   // 12 horizontal units, columns at 1..11
  const rowSpacing = cantonH / 10;   // 10 vertical units, rows at 1..9

  ctx.fillStyle = WHITE;
  for (let row = 0; row < 9; row++) {
    const isLongRow = (row % 2 === 0); // rows 0,2,4,6,8 -> 6 stars; 1,3,5,7 -> 5 stars
    const starsInRow = isLongRow ? 6 : 5;
    const cy = offY + (row + 1) * rowSpacing;
    for (let col = 0; col < starsInRow; col++) {
      // Long rows start at col index 1 step 2 (1,3,5,7,9,11)
      // Short rows start at col index 2 step 2 (2,4,6,8,10)
      const colIndex = isLongRow ? (1 + col * 2) : (2 + col * 2);
      const cx = offX + colIndex * colSpacing;
      drawStar(ctx, cx, cy, 5, starOuterR, starInnerR);
    }
  }
}

function drawStar(c, cx, cy, points, outerR, innerR) {
  c.beginPath();
  // Start at the top point (rotate -90deg so a tip points up)
  for (let i = 0; i < points * 2; i++) {
    const r = (i % 2 === 0) ? outerR : innerR;
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
  }
  c.closePath();
  c.fill();
}
