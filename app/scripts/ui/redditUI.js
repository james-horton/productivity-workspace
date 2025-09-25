/**
 * Reddit UI rendering helpers
 */
import { UI_CONFIG } from '../state.js';

function $(sel) { return document.querySelector(sel); }

// Mobile helpers
function isMobileView() {
  try {
    return window.matchMedia && window.matchMedia(`(max-width: ${UI_CONFIG.mobileMaxWidthPx}px)`).matches;
  } catch {
    return window.innerWidth <= UI_CONFIG.mobileMaxWidthPx;
  }
}

function truncateText(str, max) {
  const s = String(str || '').trim();
  if (!Number.isFinite(max) || max <= 0) return s;
  return s.length > max ? s.slice(0, max).replace(/\s+$/,'') + '…' : s;
}

// Public API
export function setRedditBusy(on) {
  const box = $('#redditItems');
  if (box) box.setAttribute('aria-busy', on ? 'true' : 'false');
}

export function renderRedditItems(items) {
  const box = $('#redditItems');
  if (!box) return;

  box.innerHTML = '';
  if (!Array.isArray(items) || items.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'news-item';
    empty.textContent = 'No posts found right now. Try refreshing.';
    box.appendChild(empty);
    return;
  }

  items.forEach((item) => {
    const wrap = document.createElement('article');
    wrap.className = 'news-item';

    const h3 = document.createElement('h3');
    h3.className = 'title';

    const a = document.createElement('a');
    a.href = item.url || '#';
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = item.title || 'Untitled';

    h3.appendChild(a);

    const p = document.createElement('p');
    p.className = 'summary';
    const fullText = String(item.body || '').trim();
    let bodyText = fullText;
    if (isMobileView()) {
      bodyText = truncateText(fullText, UI_CONFIG.redditBodyCharCap);
    }
    p.setAttribute('data-full-text', fullText);
    p.textContent = bodyText;

    wrap.appendChild(h3);
    if (p.textContent) wrap.appendChild(p);
    box.appendChild(wrap);
  });
}

export function renderRedditLoading() {
  const box = document.querySelector('#redditItems');
  if (!box) return;

  box.innerHTML = '';
  const count = 5;
  for (let i = 0; i < count; i++) {
    const wrap = document.createElement('article');
    wrap.className = 'news-item loading';

    const title = document.createElement('div');
    title.className = 'skeleton-title skeleton';

    const line1 = document.createElement('div');
    line1.className = 'skeleton-line skeleton';

    const line2 = document.createElement('div');
    line2.className = 'skeleton-line skeleton';

    wrap.appendChild(title);
    wrap.appendChild(line1);
    wrap.appendChild(line2);

    box.appendChild(wrap);
  }
}

/**
 * Re-apply Reddit body truncation responsively on viewport changes.
 * - On mobile: truncate to UI_CONFIG.redditBodyCharCap with ellipsis.
 * - On desktop: restore the original full text.
 */
export function updateRedditSummariesForViewport() {
  const max = UI_CONFIG.redditBodyCharCap;
  const mobile = isMobileView();
  const nodes = document.querySelectorAll('#redditItems .summary');
  nodes.forEach((p) => {
    const full = (p.getAttribute('data-full-text') || '').trim();
    if (!full) return;
    if (mobile) {
      p.textContent = truncateText(full, max);
    } else {
      p.textContent = full;
    }
  });
}