/**
 * Chat UI rendering helpers
 */

import { $, renderContentWithLinks } from '../utils/helpers.js';


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
  // - If the last message is from the assistant AND we're currently "receiving" (aria-busy = true),
  //   snap the viewport so the TOP of that assistant message is visible.
  // - If the last message is from the user, keep that message in view without jumping the entire page.
  // - Otherwise (initial render, no messages, or assistant while not busy): do nothing.
  const lastMessage = (messages && messages.length) ? messages[messages.length - 1] : null;
  const isBusy = box.getAttribute('aria-busy') === 'true';

  if (lastMessage && lastMessage.role === 'assistant' && lastAssistantRow) {
    if (isBusy) {
      // Use scrollIntoView on the row itself so we scroll the page, not just the container.
      lastAssistantRow.scrollIntoView({ block: 'start', inline: 'nearest', behavior: 'auto' });
    }
  } else if (lastMessage && lastMessage.role === 'user') {
    // Keep the user's latest message visible, but avoid jumping to the bottom of the entire page.
    const lastRow = box.lastElementChild;
    if (lastRow) lastRow.scrollIntoView({ block: 'end', inline: 'nearest', behavior: 'auto' });
    // If #chatMessages is a scroll container, also pin it to its bottom.
    if (box.scrollHeight > box.clientHeight) {
      box.scrollTop = box.scrollHeight;
    }
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

  // Ensure the loading row is visible even when #chatMessages isn't scrollable.
  row.scrollIntoView({ block: 'end', inline: 'nearest', behavior: 'auto' });
}

export function hideAssistantTyping() {
  const box = document.querySelector('#chatMessages');
  if (!box) return;
  const row = box.querySelector('.msg.assistant.loading');
  if (row) row.remove();
}