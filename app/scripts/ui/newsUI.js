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