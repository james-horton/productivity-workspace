/**
 * News UI rendering helpers + News Modal (unsummarized article)
 */

import { $, hostFromUrl } from '../utils/helpers.js';

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

export function renderNewsItems(items) {
  const box = $('#newsItems');
  if (!box) return;

  box.innerHTML = '';
  if (!Array.isArray(items) || items.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'news-item';
    empty.textContent = 'No news found right now. Try refreshing.';
    box.appendChild(empty);
    return;
  }

  items.forEach((item) => {
    const wrap = document.createElement('article');
    wrap.className = 'news-item';

    const h3 = document.createElement('h3');
    h3.className = 'title';

    const a = document.createElement('a');
    a.href = '#';
    a.textContent = item.title || 'Untitled';
    a.addEventListener('click', (e) => {
      e.preventDefault();
      void openNewsModal(item);
    });

    h3.appendChild(a);

    const p = document.createElement('p');
    p.className = 'summary';
    p.textContent = item.summary || '';

    const meta = document.createElement('div');
    meta.className = 'meta';
    const host = (item.source || hostFromUrl(item.url || '') || '').trim();
    if (host) {
      meta.textContent = 'source: ';
      if (item.url) {
        const link = document.createElement('a');
        link.href = item.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = host;
        meta.appendChild(link);
      } else {
        const span = document.createElement('span');
        span.textContent = host;
        meta.appendChild(span);
      }
    }

    wrap.appendChild(h3);
    wrap.appendChild(p);
    wrap.appendChild(meta);
    box.appendChild(wrap);
  });
}

export function renderNewsLoading() {
  const box = document.querySelector('#newsItems');
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

    const meta = document.createElement('div');
    meta.className = 'skeleton-meta skeleton';

    wrap.appendChild(title);
    wrap.appendChild(line1);
    wrap.appendChild(line2);
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