/**
 * Tavily Web Search UI rendering (summary + list of links)
 */

import { $, hostFromUrl, initCollapsible } from '../utils/helpers.js';
import { UI_DEFAULTS } from '../config.js';

export function setWebSearchBusy(on) {
  const box = $('#webSearchItems');
  if (box) box.setAttribute('aria-busy', on ? 'true' : 'false');
}

export function renderWebSearchResults(items, { answer } = {}) {
  const box = $('#webSearchItems');
  if (!box) return;

  box.innerHTML = '';

  // Overall summary at the top (advanced "answer" from Tavily)
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
    empty.textContent = 'No results found. Try another search.';
    box.appendChild(empty);
    // Remove header toggle if present since there's nothing to collapse
    try {
      const head = document.querySelector('#websearch .card-head');
      const left = head && head.querySelector('.card-head-left');
      const btn = left && left.querySelector('#webSearchSourcesToggle');
      if (btn) btn.remove();
    } catch {}
    return;
  }

  // Ensure chevron toggle appears in header next to "Web Search" when links exist
  const head = document.querySelector('#websearch .card-head');
  const titleEl = document.getElementById('webSearchTitle');
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
    const existing = left.querySelector('#webSearchSourcesToggle');
    if (existing) existing.remove();
    // Preserve previously expanded/collapsed state across rerenders (session-only)
    const wasExpanded = box.getAttribute('aria-hidden') === 'false';
    // Create toggle button
    const sourcesToggle = document.createElement('button');
    sourcesToggle.id = 'webSearchSourcesToggle';
    sourcesToggle.type = 'button';
    sourcesToggle.className = 'btn icon-only chevron-toggle';
    sourcesToggle.setAttribute('aria-label', wasExpanded ? 'hide sources' : 'show sources');
    sourcesToggle.title = wasExpanded ? 'hide sources' : 'show sources';
    sourcesToggle.setAttribute('aria-expanded', wasExpanded ? 'true' : 'false');
    sourcesToggle.innerHTML = `
      <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="6 9 12 15 18 9"></polyline>
      </svg>
    `;
    left.appendChild(sourcesToggle);
    // Initialize collapsible behavior on the whole results box (hides link items only)
    // If the user already expanded previously, keep it expanded; otherwise default collapsed (fresh page load).
    initCollapsible(sourcesToggle, box, { defaultCollapsed: !wasExpanded, expandedLabel: 'hide sources', collapsedLabel: 'show sources' });
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
      // Favicon with graceful fallbacks
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
          // Remove broken image after all attempts
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

      const span = document.createElement('span');
      span.textContent = host;
      meta.appendChild(span);
    }

    wrap.appendChild(h3);
    wrap.appendChild(meta);
    box.appendChild(wrap);
  });
}

export function renderWebSearchLoading() {
  const box = document.querySelector('#webSearchItems');
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