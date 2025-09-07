/**
 * Chat UI rendering helpers
 */

function $(sel) { return document.querySelector(sel); }

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

  messages.forEach(msg => {
    const row = document.createElement('div');
    row.className = `msg ${msg.role === 'user' ? 'user' : 'assistant'}`;

    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = String(msg.content || '');

    row.appendChild(bubble);
    box.appendChild(row);
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

  // Scroll to bottom
  box.scrollTop = box.scrollHeight;
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