/**
 * Basic themed calculator UI
 * - Supports: +, -, ×, ÷, decimals
 * - Chaining operations before equals
 * - Editable display with input sanitization
 * - Prevents invalid sequences (e.g., multiple operators)
 * - Keyboard: Enter (=), Escape (clear), Backspace (native), digits/operators
 */

export function initCalculatorUI() {
  const root = document.getElementById('calculatorRoot');
  const display = document.getElementById('calcDisplay');
  const keys = document.getElementById('calcKeys');
  const quickEquals = document.getElementById('calcEqualsQuick');

  if (!root || !display || !keys) return;

  // Initialize display
  sanitizeDisplayInPlace();

  // Button clicks
  keys.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-key]');
    if (!btn) return;
    const key = String(btn.dataset.key || '');
    handleKey(key);
  });

  // Quick equals button (visible in collapsed mode)
  if (quickEquals) {
    quickEquals.addEventListener('click', (e) => {
      e.preventDefault();
      compute();
    });
  }

  // Keyboard support on display
  display.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === '=') {
      e.preventDefault();
      compute();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      clearAll();
    } else {
      // Allow navigation and editing keys; sanitize later on input
      // We'll map common operator keys on input
    }
  });

  // Sanitize user edits while typing/pasting
  display.addEventListener('input', () => {
    sanitizeDisplayInPlace();
  });

  display.addEventListener('paste', () => {
    setTimeout(() => sanitizeDisplayInPlace(), 0);
  });

  // Collapse/expand toggle & behavior
  const section = document.getElementById('calculator');
  const toggleBtn = document.getElementById('calcToggle');

  if (toggleBtn && section) {
    // Ensure animated panel properties even without CSS update
    if (!keys.style.overflow) keys.style.overflow = 'hidden';
    if (!keys.style.transition) keys.style.transition = 'max-height 240ms ease';

    const isCollapsed = () => section.classList.contains('collapsed');

    const setToggleVisual = (expanded) => {
      toggleBtn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      const label = expanded ? 'Hide buttons' : 'Show buttons';
      toggleBtn.title = label;
      toggleBtn.setAttribute('aria-label', label);
      const svg = toggleBtn.querySelector('svg');
      const poly = svg && svg.querySelector('polyline');
      if (poly) {
        // Up chevron when expanded, down chevron when collapsed
        poly.setAttribute('points', expanded ? '6 15 12 9 18 15' : '6 9 12 15 18 9');
      }
    };

    // Manage a11y/interaction for the quick equals button
    const setQuickEqualsA11y = (visible) => {
      if (!quickEquals) return;
      if (visible) {
        quickEquals.removeAttribute('aria-hidden');
        quickEquals.removeAttribute('inert');
        quickEquals.disabled = false;
        quickEquals.tabIndex = 0;
      } else {
        quickEquals.setAttribute('aria-hidden', 'true');
        quickEquals.setAttribute('inert', '');
        quickEquals.disabled = true;
        quickEquals.tabIndex = -1;
      }
    };

    const syncCardHeightForCollapsed = () => {
      // Match Quote/Clock initial desktop height when collapsed using CSS variable
      const desktop = window.matchMedia('(min-width: 900px)').matches;
      if (desktop && isCollapsed()) {
        const startH = (getComputedStyle(document.documentElement).getPropertyValue('--mini-card-start-height') || '220px').trim() || '220px';
        section.style.blockSize = startH;
        section.style.alignSelf = 'start';
        section.style.display = 'flex';
        section.style.flexDirection = 'column';
      } else {
        section.style.blockSize = '';
        section.style.alignSelf = '';
        section.style.display = '';
        section.style.flexDirection = '';
      }
    };

    const expand = (animate = true) => {
      // Complementary slide-out for quick equals when expanding
      if (quickEquals) {
        const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (section.classList.contains('collapsed') && animate && !prefersReduced) {
          quickEquals.classList.add('animating-out');
          let fallback;
          const onAnimEnd = (ev) => {
            if (ev && ev.animationName && ev.animationName !== 'calcQuickOut') return;
            if (fallback) clearTimeout(fallback);
            quickEquals.classList.remove('animating-out');
            quickEquals.removeEventListener('animationend', onAnimEnd);
          };
          fallback = setTimeout(() => {
            quickEquals.classList.remove('animating-out');
            quickEquals.removeEventListener('animationend', onAnimEnd);
          }, 500);
          quickEquals.addEventListener('animationend', onAnimEnd);
        } else {
          quickEquals.classList.remove('animating-out');
        }
      }

      section.classList.remove('collapsed');
      // prepare and show panel
      keys.removeAttribute('aria-hidden');
      keys.removeAttribute('inert');
      const target = keys.scrollHeight;
      if (animate) {
        keys.style.maxHeight = '0px';
        // force reflow
        void keys.offsetHeight;
        keys.style.maxHeight = target + 'px';
      } else {
        keys.style.maxHeight = target + 'px';
      }
      setToggleVisual(true);
      setQuickEqualsA11y(false);
      syncCardHeightForCollapsed();
    };

    const collapse = (animate = true) => {
      section.classList.add('collapsed');
      if (quickEquals) quickEquals.classList.remove('animating-out');
      const start = keys.scrollHeight;
      if (animate) {
        keys.style.maxHeight = start + 'px';
        // force reflow
        void keys.offsetHeight;
        keys.style.maxHeight = '0px';
      } else {
        keys.style.maxHeight = '0px';
      }
      // After the slide-up ends, make buttons inert/non-focusable
      const onEnd = (ev) => {
        if (ev && ev.propertyName !== 'max-height') return;
        keys.setAttribute('aria-hidden', 'true');
        keys.setAttribute('inert', '');
        keys.removeEventListener('transitionend', onEnd);
      };
      keys.addEventListener('transitionend', onEnd);
      setToggleVisual(false);
      setQuickEqualsA11y(true);
      syncCardHeightForCollapsed();
    };

    // Initialize from current DOM state
    if (isCollapsed()) {
      keys.setAttribute('aria-hidden', 'true');
      keys.setAttribute('inert', '');
      keys.style.maxHeight = '0px';
      setToggleVisual(false);
      setQuickEqualsA11y(true);
    } else {
      keys.removeAttribute('aria-hidden');
      keys.removeAttribute('inert');
      keys.style.maxHeight = keys.scrollHeight + 'px';
      setToggleVisual(true);
      setQuickEqualsA11y(false);
    }
    syncCardHeightForCollapsed();

    toggleBtn.addEventListener('click', () => {
      if (isCollapsed()) expand(true);
      else collapse(true);
    });

    // Recalculate on resize (layout can change key grid height)
    window.addEventListener('resize', () => {
      if (!isCollapsed()) {
        keys.style.maxHeight = keys.scrollHeight + 'px';
      }
      syncCardHeightForCollapsed();
    });
  }

  // Helpers

  function handleKey(key) {
    switch (key) {
      case 'C': clearAll(); break;
      case '⌫': backspace(); break;
      case '=': compute(); break;
      case '.': appendDot(); break;
      case '+':
      case '-':
      case '×':
      case '÷':
        appendOperator(key);
        break;
      default:
        if (/^\d$/.test(key)) {
          appendNumber(key);
        }
        break;
    }
  }

  function getDisplay() {
    return String(display.value || '').trim();
  }

  function setDisplay(val) {
    display.value = String(val || '');
  }

  function clearAll() {
    setDisplay('');
    removeInvalidState();
  }

  function backspace() {
    const val = getDisplay();
    if (!val) return;
    setDisplay(val.slice(0, -1));
    sanitizeDisplayInPlace();
    removeInvalidState();
  }

  function appendNumber(n) {
    const cur = getDisplay();
    const next = sanitizeForDisplay(cur + String(n));
    setDisplay(next);
  }

  function appendDot() {
    let s = unifyOps(getDisplay()).replace(/\s+/g, '');
    // Determine current number segment (since last operator)
    const lastOpIdx = Math.max(s.lastIndexOf('+'), s.lastIndexOf('-'), s.lastIndexOf('×'), s.lastIndexOf('÷'));
    const segment = s.slice(lastOpIdx + 1);
    if (segment.includes('.')) {
      // ignore extra decimal in current segment
      return;
    }
    if (!segment) {
      // Start number with 0.
      s += '0.';
    } else if (/^-?$/.test(segment)) {
      // Segment is just a unary -, treat as -0.
      s += '0.';
    } else {
      s += '.';
    }
    setDisplay(s);
    sanitizeDisplayInPlace();
  }

  function appendOperator(op) {
    let s = unifyOps(getDisplay()).replace(/\s+/g, '');
    if (!s) {
      if (op === '-') {
        setDisplay('-');
      }
      return;
    }
    const last = s.slice(-1);
    if (isOperator(last)) {
      // Allow constructing e.g., "×-" to support negative numbers after an operator
      if (op === '-' && last !== '-') {
        setDisplay(s + '-');
      } else {
        // Replace last operator with the new one
        setDisplay(s.slice(0, -1) + op);
      }
    } else if (last === '.') {
      // Complete decimal then add operator
      setDisplay(s + '0' + op);
    } else {
      setDisplay(s + op);
    }
    sanitizeDisplayInPlace();
  }

  function compute() {
    removeInvalidState();
    let expr = unifyOps(getDisplay()).replace(/\s+/g, '');
    expr = dropTrailingOperators(expr);
    if (!expr) return;

    const tokens = tokenize(expr);
    if (!tokens) {
      markInvalid();
      return;
    }
    try {
      const result = evaluateTokens(tokens);
      if (!Number.isFinite(result)) {
        markInvalid();
        return;
      }
      setDisplay(formatResult(result));
    } catch {
      markInvalid();
    }
  }

  function markInvalid() {
    display.classList.add('calc-invalid');
    // Keep the value; user can correct it
  }

  function removeInvalidState() {
    display.classList.remove('calc-invalid');
  }

  function sanitizeDisplayInPlace() {
    const raw = String(display.value || '');
    const cleaned = sanitizeForDisplay(raw);
    if (cleaned !== raw) {
      display.value = cleaned;
    }
  }
}

/* ============== Expression/Validation Utilities ============== */

function isOperator(c) {
  return c === '+' || c === '-' || c === '×' || c === '÷';
}

function unifyOps(s) {
  return String(s || '')
    .replace(/[xX*]/g, '×')
    .replace(/\//g, '÷')
    .replace(/−/g, '-');
}

// Remove invalid chars and normalize expression for display while typing
function sanitizeForDisplay(input) {
  let s = unifyOps(input).replace(/\s+/g, '');
  // Keep only digits, dot, operators
  s = s.replace(/[^0-9.+\-×÷]/g, '');

  let out = '';
  let last = '';
  let inDecimal = false;

  const push = (ch) => {
    out += ch;
    last = ch;
  };

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];

    if (/\d/.test(ch)) {
      push(ch);
      continue;
    }

    if (ch === '.') {
      if (inDecimal) {
        // skip duplicate decimals in current number segment
        continue;
      }
      if (!out || isOperator(last)) {
        // Start number with 0.
        out += '0.';
        last = '.';
      } else if (last === '.') {
        // ignore repeating dots
      } else {
        push('.');
      }
      inDecimal = true;
      continue;
    }

    if (isOperator(ch)) {
      if (!out) {
        // Allow starting with unary minus
        if (ch === '-') {
          push('-');
        }
        continue;
      }
      if (isOperator(last)) {
        // Allow sequence like "×-" to form negative number next
        if (ch === '-' && last !== '-') {
          push('-');
        } else {
          // Replace last operator with current
          out = out.slice(0, -1) + ch;
          last = ch;
        }
      } else if (last === '.') {
        // finalize decimal as 0 if lone dot then add operator
        out += '0' + ch;
        last = ch;
      } else {
        push(ch);
      }
      inDecimal = false;
      continue;
    }

    // Any other char ignored
  }

  return out;
}

// If expression ends with operator(s), drop them
function dropTrailingOperators(s) {
  let out = String(s || '');
  while (out && isOperator(out.slice(-1))) {
    // Keep trailing '-' only if it's a standalone number like "-"
    // but standalone '-' is not a valid final expression, so drop
    out = out.slice(0, -1);
  }
  return out;
}

// Tokenize as [num, op, num, op, num, ...], allowing unary minus before numbers
function tokenize(expr) {
  const s = String(expr || '');
  const tokens = [];
  let i = 0;
  const len = s.length;

  const readNumber = () => {
    let sign = 1;
    // Optional unary +/-
    if (s[i] === '+') {
      i++;
    } else if (s[i] === '-') {
      sign = -1; i++;
    }
    let start = i;
    let hasInt = false;
    while (i < len && /\d/.test(s[i])) { i++; hasInt = true; }
    let hasDot = false;
    if (i < len && s[i] === '.') {
      hasDot = true;
      i++;
      while (i < len && /\d/.test(s[i])) { i++; }
    }
    if (!hasInt && !hasDot) {
      return null;
    }
    const numStr = s.slice(start, i);
    const val = sign * parseFloat(numStr || '0');
    if (!Number.isFinite(val)) return null;
    return val;
  };

  let expectNumber = true;

  while (i < len) {
    if (expectNumber) {
      const num = readNumber();
      if (num === null) return null;
      tokens.push(num);
      expectNumber = false;
    } else {
      const ch = s[i];
      if (!isOperator(ch)) return null;
      tokens.push(ch);
      i++;
      expectNumber = true;
    }
  }

  if (expectNumber) {
    // expression ended with operator; invalid
    return null;
  }

  return tokens;
}

function evaluateTokens(tokens) {
  if (!Array.isArray(tokens) || tokens.length === 0) throw new Error('Invalid');
  // Build arrays of numbers and operators
  const numbers = [tokens[0]];
  const ops = [];
  for (let i = 1; i < tokens.length; i += 2) {
    ops.push(tokens[i]);
    numbers.push(tokens[i + 1]);
  }

  // Pass 1: × and ÷
  const nums1 = [numbers[0]];
  const ops1 = [];
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    const b = numbers[i + 1];
    if (op === '×' || op === '÷') {
      const a = nums1.pop();
      const r = safeOp(a, b, op);
      nums1.push(r);
    } else {
      nums1.push(b);
      ops1.push(op);
    }
  }

  // Pass 2: + and -
  let result = nums1[0];
  for (let i = 0; i < ops1.length; i++) {
    result = safeOp(result, nums1[i + 1], ops1[i]);
  }
  return result;
}

function safeOp(a, b, op) {
  switch (op) {
    case '+': return round(a + b);
    case '-': return round(a - b);
    case '×': return round(a * b);
    case '÷': return b === 0 ? Infinity : round(a / b);
    default: throw new Error('op');
  }
}

function round(n, p = 12) {
  const f = Math.pow(10, p);
  return Math.round((n + Number.EPSILON) * f) / f;
}

function formatResult(n) {
  if (!Number.isFinite(n)) return 'Error';
  // Normalize -0 to 0
  if (Object.is(n, -0)) n = 0;
  let s = n.toFixed(12);
  s = s.replace(/\.?0+$/,''); // trim trailing zeros
  if (s === '') s = '0';
  return s;
}