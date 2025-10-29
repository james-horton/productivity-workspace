/**
 * News UI rendering helpers + News Modal (unsummarized article)
 */

import { $, hostFromUrl, initCollapsible } from '../utils/helpers.js';
import { UI_DEFAULTS } from '../config.js';

// Modal refs
let _newsModal = null;
let _newsModalBody = null;

function ensureNewsModalRefs() {
  if (!_newsModal) _newsModal = document.getElementById('newsModal');
  if (!_newsModalBody) _newsModalBody = document.getElementById('newsModalBody');
}

function isNewsModalOpen() {
  ensureNewsModalRefs();
  return _newsModal && _newsModal.getAttribute('aria-hidden') === 'false';
}

function openNewsModalShell() {
  ensureNewsModalRefs();
  if (!_newsModal) return;
  _newsModal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');
}

function closeNewsModal() {
  ensureNewsModalRefs();
  if (!_newsModal) return;
  _newsModal.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('modal-open');
}



// Marked removed; modal now shows plain text content only.

// Public API
export function setNewsBusy(on) {
  const box = $('#newsItems');
  if (box) box.setAttribute('aria-busy', on ? 'true' : 'false');
}

export function setActiveTab(cat) {
  const tabs = document.querySelectorAll('#newsTabs .tab');
  tabs.forEach(btn => {
    if (btn.dataset.cat === cat) btn.classList.add('active');
    else btn.classList.remove('active');
  });
}

export function renderNewsItems(items, { answer } = {}) {
  const box = $('#newsItems');
  if (!box) return;

  box.innerHTML = '';

  // Overall summary from Tavily "answer" at the top
  const summary = typeof answer === 'string' ? answer.trim() : '';
  if (summary) {
    const sum = document.createElement('div');
    sum.className = 'news-summary';
    const p = document.createElement('p');
    p.textContent = summary;
    sum.appendChild(p);
    box.appendChild(sum);
  }

  if (!Array.isArray(items) || items.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'news-item';
    empty.textContent = 'No news found right now. Try refreshing.';
    box.appendChild(empty);
    // Remove header toggle if present since there's nothing to collapse
    try {
      const head = document.querySelector('#news .card-head');
      const left = head && head.querySelector('.card-head-left');
      const btn = left && left.querySelector('#newsSourcesToggle');
      if (btn) btn.remove();
    } catch {}
    return;
  }

  // Ensure chevron toggle appears in header next to "News" when links exist
  const head = document.querySelector('#news .card-head');
  const titleEl = document.getElementById('newsTitle');
  if (head && titleEl) {
    // Create/ensure left group container (title + adjacent controls)
    let left = head.querySelector('.card-head-left');
    if (!left) {
      left = document.createElement('div');
      left.className = 'card-head-left';
      head.insertBefore(left, head.firstChild);
    }
    // Move title into left group if not already there
    if (titleEl.parentElement !== left) {
      left.insertBefore(titleEl, left.firstChild);
    }
    // Remove any existing toggle to avoid duplicates
    const existing = left.querySelector('#newsSourcesToggle');
    if (existing) existing.remove();
    // Create toggle button
    const sourcesToggle = document.createElement('button');
    sourcesToggle.id = 'newsSourcesToggle';
    sourcesToggle.type = 'button';
    sourcesToggle.className = 'btn icon-only chevron-toggle';
    sourcesToggle.setAttribute('aria-label', 'show sources');
    sourcesToggle.title = 'show sources';
    sourcesToggle.setAttribute('aria-expanded', 'false');
    sourcesToggle.innerHTML = `
      <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="6 9 12 15 18 9"></polyline>
      </svg>
    `;
    left.appendChild(sourcesToggle);
    // Initialize collapsible behavior on the whole results box (hides link items only)
    initCollapsible(sourcesToggle, box, { defaultCollapsed: true, expandedLabel: 'hide sources', collapsedLabel: 'show sources' });
  }
  items.forEach((item) => {
    const wrap = document.createElement('article');
    wrap.className = 'news-item';

    const h3 = document.createElement('h3');
    h3.className = 'title';

    const a = document.createElement('a');
    a.href = item.url || '#';
    a.textContent = item.title || 'Untitled';
    if (item.url) {
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
    }

    h3.appendChild(a);

    const meta = document.createElement('div');
    meta.className = 'meta';
    const host = (item.source || hostFromUrl(item.url || '') || '').trim();
    if (host) {
      // Favicon (show if available; add graceful fallbacks if initial fails)
      if (item.favicon || item.url) {
        const img = document.createElement('img');
        img.alt = '';
        img.width = 16;
        img.height = 16;
        img.loading = 'lazy';
        img.referrerPolicy = 'no-referrer';
        img.style.verticalAlign = 'text-bottom';
        img.style.margin = '0 6px 0 6px';

        let triedDomainIco = false;
        let triedDDG = false;
        img.onerror = () => {
          if (!triedDomainIco && item && item.url) {
            triedDomainIco = true;
            try {
              const u = new URL(item.url);
              img.src = `${u.origin}/favicon.ico`;
              return;
            } catch {}
          }
          if (!triedDDG && item && item.url) {
            triedDDG = true;
            try {
              const u = new URL(item.url);
              img.src = `https://icons.duckduckgo.com/ip3/${u.hostname}.ico`;
              return;
            } catch {}
          }
          // If all attempts fail, remove the broken image
          img.remove();
        };

        if (item.favicon) {
          img.src = item.favicon;
        } else if (item && item.url) {
          try {
            const u = new URL(item.url);
            img.src = `${u.origin}/favicon.ico`;
          } catch {}
        }

        meta.appendChild(img);
      }

      // Plain text host (non-clickable)
      const span = document.createElement('span');
      span.textContent = host;
      meta.appendChild(span);
    }

    wrap.appendChild(h3);
    wrap.appendChild(meta);
    box.appendChild(wrap);
  });
}

export function renderNewsLoading() {
  const box = document.querySelector('#newsItems');
  if (!box) return;

  box.innerHTML = '';

  // Summary skeleton (shimmer enabled)
  const sum = document.createElement('div');
  sum.className = 'news-summary is-loading';
  const l1 = document.createElement('div');
  l1.className = 'skeleton-line skeleton';
  const l2 = document.createElement('div');
  l2.className = 'skeleton-line skeleton';
  const l3 = document.createElement('div');
  l3.className = 'skeleton-line skeleton';
  sum.appendChild(l1);
  sum.appendChild(l2);
  sum.appendChild(l3);
  box.appendChild(sum);

  const count = UI_DEFAULTS.skeletonItemCount;
  for (let i = 0; i < count; i++) {
    const wrap = document.createElement('article');
    wrap.className = 'news-item loading';

    const title = document.createElement('div');
    title.className = 'skeleton-title skeleton';

    const meta = document.createElement('div');
    meta.className = 'skeleton-meta skeleton';

    wrap.appendChild(title);
    wrap.appendChild(meta);

    box.appendChild(wrap);
  }
}

// Initialize modal open/close interactions
export function initNewsModalUI() {
  ensureNewsModalRefs();
  const modal = _newsModal;
  if (!modal) return;

  // Close on backdrop click or any [data-close="true"] control
  modal.addEventListener('click', (e) => {
    const t = e.target;
    if (!t) return;
    const isBackdrop = t.classList && t.classList.contains('modal-backdrop');
    const wantsClose = (t.dataset && t.dataset.close === 'true') || (t.closest && t.closest('[data-close="true"]'));
    if (isBackdrop || wantsClose) {
      closeNewsModal();
    }
  });

  // Close on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isNewsModalOpen()) {
      closeNewsModal();
    }
  });
}

// Compose + open the modal with unsummarized Tavily content (plain text only)
async function openNewsModal(item) {
  ensureNewsModalRefs();
  if (!_newsModal || !_newsModalBody) return;

  const raw = String(item?.content || '').trim();
  _newsModalBody.textContent = raw || 'No raw content available.';

  openNewsModalShell();
}