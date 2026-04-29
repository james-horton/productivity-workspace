/**
 * Shared client-side helpers
 */

import { UI_CONFIG } from '../state.js';

export function $(sel) {
  return document.querySelector(sel);
}

export function isMobileView() {
  try {
    return window.matchMedia && window.matchMedia(`(max-width: ${UI_CONFIG.mobileMaxWidthPx}px)`).matches;
  } catch {
    return window.innerWidth <= UI_CONFIG.mobileMaxWidthPx;
  }
}

export function truncateText(str, max) {
  const s = String(str || '').trim();
  if (!Number.isFinite(max) || max <= 0) return s;
  return s.length > max ? s.slice(0, max).replace(/\s+$/,'') + '…' : s;
}

export function hostFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * Render plain text to a DocumentFragment with clickable links:
 * - Markdown links: [label](https://url)
 * - Bare URLs: https://example.com
 * Safe from HTML injection by using text nodes.
 */
export function renderContentWithLinks(input) {
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

const CHAT_CODE_LANGUAGE_ALIASES = {
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  ts: 'typescript',
  py: 'python',
  csharp: 'csharp',
  'c#': 'csharp',
  cs: 'csharp',
  'c++': 'cpp',
  cpp: 'cpp',
  html: 'xml',
  svg: 'xml',
  md: 'markdown',
  sh: 'bash',
  shell: 'bash',
  yml: 'yaml',
  kt: 'kotlin',
  rs: 'rust',
  golang: 'go'
};

function safeChatLink(parent, href, label) {
  const text = label || href;
  try {
    const u = new URL(href);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('bad protocol');
  } catch {
    parent.appendChild(document.createTextNode(text));
    return;
  }

  const a = document.createElement('a');
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.textContent = text;
  parent.appendChild(a);
}

function appendPreservedText(parent, text) {
  const parts = String(text || '').split(/( {2,})/);
  parts.forEach(part => {
    if (!part) return;
    if (/^ {2,}$/.test(part)) {
      for (let i = 0; i < part.length; i += 1) {
        parent.appendChild(document.createTextNode('\u00a0'));
      }
    } else {
      parent.appendChild(document.createTextNode(part));
    }
  });
}

function normalizeChatCodeLanguage(lang) {
  const first = String(lang || '').trim().split(/\s+/)[0].toLowerCase();
  if (!first) return '';
  const normalized = CHAT_CODE_LANGUAGE_ALIASES[first] || first;
  return normalized.replace(/[^a-z0-9_+-]/g, '');
}

function appendInlineChatMarkup(parent, input) {
  const text = String(input || '');
  let i = 0;
  let buffer = '';

  const flush = () => {
    if (!buffer) return;
    appendPreservedText(parent, buffer);
    buffer = '';
  };

  const hasOpeningBoundary = (idx) => idx === 0 || /[\s([{"']/.test(text[idx - 1]);
  const hasClosingBoundary = (idx) => idx === text.length - 1 || /[\s).,;:!?\]}"']/.test(text[idx + 1]);

  while (i < text.length) {
    if (text[i] === '`') {
      const end = text.indexOf('`', i + 1);
      if (end > i + 1) {
        flush();
        const code = document.createElement('code');
        code.textContent = text.slice(i + 1, end);
        parent.appendChild(code);
        i = end + 1;
        continue;
      }
    }

    if (text[i] === '[') {
      const md = text.slice(i).match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/);
      if (md) {
        flush();
        safeChatLink(parent, md[2], md[1]);
        i += md[0].length;
        continue;
      }
    }

    if (text.startsWith('http://', i) || text.startsWith('https://', i)) {
      const url = text.slice(i).match(/^(https?:\/\/[^\s<>"')\]]+)([),.;:!?]+)?/);
      if (url) {
        flush();
        safeChatLink(parent, url[1], url[1]);
        if (url[2]) parent.appendChild(document.createTextNode(url[2]));
        i += url[0].length;
        continue;
      }
    }

    if (text.startsWith('**', i)) {
      const end = text.indexOf('**', i + 2);
      const inner = end === -1 ? '' : text.slice(i + 2, end);
      if (inner.trim()) {
        flush();
        const strong = document.createElement('strong');
        appendInlineChatMarkup(strong, inner);
        parent.appendChild(strong);
        i = end + 2;
        continue;
      }
    }

    if (text[i] === '*' && text[i + 1] !== '*' && text[i + 1] && !/\s/.test(text[i + 1]) && hasOpeningBoundary(i)) {
      let end = -1;
      for (let j = i + 2; j < text.length; j += 1) {
        if (text[j] === '*' && text[j + 1] !== '*' && !/\s/.test(text[j - 1]) && hasClosingBoundary(j)) {
          end = j;
          break;
        }
      }
      if (end !== -1) {
        flush();
        const em = document.createElement('em');
        appendInlineChatMarkup(em, text.slice(i + 1, end));
        parent.appendChild(em);
        i = end + 1;
        continue;
      }
    }

    buffer += text[i];
    i += 1;
  }

  flush();
}

function appendChatInlineLines(parent, lines) {
  lines.forEach((line, idx) => {
    if (idx > 0) parent.appendChild(document.createElement('br'));
    appendInlineChatMarkup(parent, line);
  });
}

function chatFenceStart(line) {
  const m = String(line || '').match(/^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)?.*$/);
  if (!m) return null;
  return { char: m[1][0], length: m[1].length, language: m[2] || '' };
}

function chatFenceEnd(line, fence) {
  const trimmed = String(line || '').trim();
  if (trimmed.length < fence.length) return false;
  for (let i = 0; i < trimmed.length; i += 1) {
    if (trimmed[i] !== fence.char) return false;
  }
  return true;
}

function chatHeading(line) {
  return String(line || '').match(/^ {0,3}(#{1,3})\s+(.+?)\s*#*\s*$/);
}

function chatListItem(line) {
  const unordered = String(line || '').match(/^ {0,3}[-*+]\s+(.*)$/);
  if (unordered) return { type: 'ul', text: unordered[1] };
  const ordered = String(line || '').match(/^ {0,3}(\d+)[.)]\s+(.*)$/);
  if (ordered) return { type: 'ol', text: ordered[2], start: Number(ordered[1]) };
  return null;
}

function startsChatBlock(line) {
  return !!(chatFenceStart(line) || chatHeading(line) || String(line || '').match(/^ {0,3}>\s?/) || chatListItem(line));
}

function appendChatParagraph(parent, lines) {
  const p = document.createElement('p');
  appendChatInlineLines(p, lines);
  parent.appendChild(p);
}

function appendChatBlockquote(parent, lines) {
  const quote = document.createElement('blockquote');
  let pending = [];

  const flush = () => {
    if (!pending.length) return;
    appendChatParagraph(quote, pending);
    pending = [];
  };

  lines.forEach(line => {
    if (String(line || '').trim() === '') {
      flush();
    } else {
      pending.push(line);
    }
  });
  flush();

  parent.appendChild(quote);
}

/**
 * Render a conservative, chat-scoped Markdown-like subset safely.
 * All user/model-provided text is inserted via DOM APIs, never as raw HTML.
 */
export function renderChatMarkup(input) {
  const frag = document.createDocumentFragment();
  const text = typeof input === 'string' ? input : String(input || '');
  if (!text) return frag;

  const wrap = document.createElement('div');
  wrap.className = 'chat-markup';
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === '') {
      i += 1;
      continue;
    }

    const fence = chatFenceStart(line);
    if (fence) {
      const codeLines = [];
      i += 1;
      while (i < lines.length && !chatFenceEnd(lines[i], fence)) {
        codeLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1;

      const pre = document.createElement('pre');
      const code = document.createElement('code');
      const language = normalizeChatCodeLanguage(fence.language);
      code.className = 'hljs' + (language ? ' language-' + language : '');
      code.textContent = codeLines.join('\n');
      pre.appendChild(code);
      wrap.appendChild(pre);
      continue;
    }

    const heading = chatHeading(line);
    if (heading) {
      const h = document.createElement(`h${heading[1].length}`);
      appendInlineChatMarkup(h, heading[2]);
      wrap.appendChild(h);
      i += 1;
      continue;
    }

    if (String(line || '').match(/^ {0,3}>\s?/)) {
      const quoteLines = [];
      while (i < lines.length) {
        const quote = String(lines[i] || '').match(/^ {0,3}>\s?(.*)$/);
        if (!quote) break;
        quoteLines.push(quote[1]);
        i += 1;
      }
      appendChatBlockquote(wrap, quoteLines);
      continue;
    }

    const item = chatListItem(line);
    if (item) {
      const list = document.createElement(item.type);
      if (item.type === 'ol' && Number.isFinite(item.start) && item.start > 1) {
        list.start = item.start;
      }
      const type = item.type;
      while (i < lines.length) {
        const next = chatListItem(lines[i]);
        if (!next || next.type !== type) break;
        const li = document.createElement('li');
        appendInlineChatMarkup(li, next.text);
        list.appendChild(li);
        i += 1;
      }
      wrap.appendChild(list);
      continue;
    }

    const paragraphLines = [line];
    i += 1;
    while (i < lines.length && lines[i].trim() !== '' && !startsChatBlock(lines[i])) {
      paragraphLines.push(lines[i]);
      i += 1;
    }
    appendChatParagraph(wrap, paragraphLines);
  }

  frag.appendChild(wrap);
  return frag;
}
// Simple reusable collapsible initializer for lists (News/Web Search)
// Usage: initCollapsible(buttonEl, contentEl, { defaultCollapsed: true })
export function initCollapsible(toggleBtn, contentEl, { defaultCollapsed = true, expandedLabel = 'Hide links', collapsedLabel = 'Show links' } = {}) {
  try {
    if (!toggleBtn || !contentEl) return () => {};
    let collapsed = !!defaultCollapsed;

    function apply() {
      contentEl.setAttribute('data-collapsible', 'true');
      contentEl.setAttribute('aria-hidden', collapsed ? 'true' : 'false');
      toggleBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      const label = collapsed ? collapsedLabel : expandedLabel;
      toggleBtn.setAttribute('aria-label', label);
      toggleBtn.title = label;

      // Associate control with collapsible region for a11y
      if (contentEl && contentEl.id) {
        toggleBtn.setAttribute('aria-controls', contentEl.id);
      }

      // Rotate chevron icon if present (match calculator)
      const poly = toggleBtn.querySelector('svg polyline');
      if (poly) {
        // Down chevron when collapsed; up chevron when expanded
        poly.setAttribute('points', collapsed ? '6 9 12 15 18 9' : '6 15 12 9 18 15');
      }

      // If the button has no element children (no icon), reflect state in visible text
      if (!toggleBtn.firstElementChild) {
        toggleBtn.textContent = label;
      }
    }

    function setCollapsed(next) {
      collapsed = !!next;
      apply();
    }

    function toggle() {
      setCollapsed(!collapsed);
    }

    toggleBtn.addEventListener('click', toggle);
    // Initialize
    apply();

    // Return API in case caller wants to programmatically control it
    return { toggle, setCollapsed, isCollapsed: () => collapsed };
  } catch {
    // no-op if init fails
    return () => {};
  }
}
