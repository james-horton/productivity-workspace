/**
 * News UI rendering helpers
 */

function $(sel) { return document.querySelector(sel); }

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

  items.forEach(item => {
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
    p.textContent = item.summary || '';

    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = item.source ? `source: ${item.source}` : '';

    wrap.appendChild(h3);
    wrap.appendChild(p);
    wrap.appendChild(meta);
    box.appendChild(wrap);
  });
}