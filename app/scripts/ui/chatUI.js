/**
 * Chat UI rendering helpers
 */

function $(sel) { return document.querySelector(sel); }

/**
 * Render plain text to a DocumentFragment with clickable links:
 * - Markdown links: [label](https://url)
 * - Bare URLs: https://example.com
 * Safe from HTML injection by using text nodes.
 */
function renderContentWithLinks(input) {
  const frag = document.createDocumentFragment();
  const text = typeof input === 'string' ? input : String(input || '');
  if (!text) return frag;

  // Parse Markdown links first
  const md = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let last = 0;
  const parts = [];
  let m;
  while ((m = md.exec(text)) !== null) {
    if (m.index > last) parts.push({ t: 'text', v: text.slice(last, m.index) });
    parts.push({ t: 'link', href: m[2], label: m[1] });
    last = md.lastIndex;
  }
  if (last < text.length) parts.push({ t: 'text', v: text.slice(last) });

  // Autolink bare URLs in remaining text parts
  const urlRe = /(https?:\/\/[^\s<>"')\]]+)([),.;:!?]+)?/g;

  const appendText = (s) => {
    if (!s) return;
    frag.appendChild(document.createTextNode(s));
  };
  const appendLink = (href, label) => {
    try {
      const u = new URL(href);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('bad protocol');
    } catch {
      appendText(label || href);
      return;
    }
    const a = document.createElement('a');
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = label || href;
    frag.appendChild(a);
  };

  for (const p of parts) {
    if (p.t === 'link') {
      appendLink(p.href, p.label);
    } else {
      const s = p.v;
      let idx = 0;
      let mm;
      while ((mm = urlRe.exec(s)) !== null) {
        const [full, href, trailing = ''] = mm;
        if (mm.index > idx) appendText(s.slice(idx, mm.index));
        appendLink(href, href);
        if (trailing) appendText(trailing);
        idx = mm.index + full.length;
      }
      if (idx < s.length) appendText(s.slice(idx));
    }
  }
  return frag;
}

export function setDisclaimer(text) {
  const el = $('#chatDisclaimer');
  if (!el) return;
  el.textContent = text || '';
}

export function setBusy(on) {
  const box = $('#chatMessages');
  if (box) box.setAttribute('aria-busy', on ? 'true' : 'false');
}

export function renderChat(messages, { sources } = {}) {
  const box = $('#chatMessages');
  if (!box) return;
  box.innerHTML = '';
  let lastAssistantRow = null;

  messages.forEach(msg => {
    const row = document.createElement('div');
    row.className = `msg ${msg.role === 'user' ? 'user' : 'assistant'}`;

    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    const frag = renderContentWithLinks(String(msg.content || ''));
    bubble.appendChild(frag);

    row.appendChild(bubble);
    box.appendChild(row);

    if (msg.role !== 'user') {
      lastAssistantRow = row;
    }
  });

  // If we have sources for the last assistant message, render them after the last message
  if (Array.isArray(sources) && sources.length) {
    const wrap = document.createElement('div');
    wrap.className = 'msg assistant';

    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    const title = document.createElement('div');
    title.style.fontSize = '.9rem';
    title.style.fontWeight = '600';
    title.style.marginBottom = '.25rem';
    title.textContent = 'Sources';

    const list = document.createElement('ul');
    list.style.margin = '0';
    list.style.paddingInlineStart = '1.2rem';

    sources.forEach(s => {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = s.url || '#';
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = s.source ? `${s.source}` : (s.title || s.url || 'link');
      li.appendChild(a);
      list.appendChild(li);
    });

    bubble.appendChild(title);
    bubble.appendChild(list);
    wrap.appendChild(bubble);
    box.appendChild(wrap);
  }

  // Scroll behavior:
  // - If the last message is from the assistant, align the viewport so the top of that
  //   assistant message is at the top of the container (not the "Sources" block).
  // - Otherwise (e.g., after user sends a message), keep legacy behavior and scroll to bottom.
  const lastMessage = (messages && messages.length) ? messages[messages.length - 1] : null;
  if (lastMessage && lastMessage.role === 'assistant' && lastAssistantRow) {
    const containerTop = box.getBoundingClientRect().top;
    const lastTop = lastAssistantRow.getBoundingClientRect().top;
    const offset = (lastTop - containerTop) + box.scrollTop;
    box.scrollTop = offset;
  } else {
    // Fallback: scroll to bottom
    box.scrollTop = box.scrollHeight;
  }
}
export function showAssistantTyping() {
  const box = document.querySelector('#chatMessages');
  if (!box) return;
  if (box.querySelector('.msg.assistant.loading')) return;

  const row = document.createElement('div');
  row.className = 'msg assistant loading';

  const bubble = document.createElement('div');
  bubble.className = 'bubble';

  // Only show the animated three dots (no spinner)
  const typing = document.createElement('span');
  typing.className = 'typing';
  typing.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span>';

  const sr = document.createElement('span');
  sr.className = 'sr-only';
  sr.textContent = 'Assistant is responding…';

  bubble.appendChild(typing);
  bubble.appendChild(sr);
  row.appendChild(bubble);
  box.appendChild(row);

  box.scrollTop = box.scrollHeight;
}

export function hideAssistantTyping() {
  const box = document.querySelector('#chatMessages');
  if (!box) return;
  const row = box.querySelector('.msg.assistant.loading');
  if (row) row.remove();
}