/**
 * Chat UI rendering helpers
 */

import { $, renderContentWithLinks } from '../utils/helpers.js';

// Coder mode rendering and highlighting helpers
function hljsAvailable() {
  return typeof window !== 'undefined' && window.hljs && (typeof window.hljs.highlightElement === 'function' || typeof window.hljs.highlightAuto === 'function');
}

// Canonicalize language names to what highlight.js expects
const HLJS_LANGUAGE_ALIASES = {
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  ts: 'typescript',
  tsx: 'tsx',
  py: 'python',
  csharp: 'csharp',
  'c#': 'csharp',
  cs: 'csharp',
  'c++': 'cpp',
  cpp: 'cpp',
  c: 'c',
  html: 'xml',
  svg: 'xml',
  md: 'markdown',
  sh: 'bash',
  shell: 'bash',
  rb: 'ruby',
  yml: 'yaml',
  kt: 'kotlin',
  rs: 'rust',
  go: 'go',
  golang: 'go'
};

function normalizeLanguage(lang) {
  const key = String(lang || '').toLowerCase().trim();
  return HLJS_LANGUAGE_ALIASES[key] || key;
}

function sanitizeFilename(name) {
  const s = String(name || '').trim();
  if (!s) return '';
  // Remove directory separators and illegal characters on Windows/Unix
  return s.replace(/[/\\?%*:|"<>]/g, '').replace(/\s+/g, ' ').slice(0, 180);
}

// Match Chat Download naming when no filename provided (mode name + timestamp)
function defaultExportFilename() {
  const modeSlug = 'coder';
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const ts = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  return `${modeSlug}_${ts}.txt`;
}

function triggerDownload(text, filename) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 0);
}

async function copyTextToClipboard(text, btn) {
  const t = String(text || '');
  const button = btn;
  const originalTitle = button ? button.title : '';
  const originalAria = button ? (button.getAttribute('aria-label') || originalTitle || 'Copy') : '';
  const reset = () => {
    if (button) {
      button.title = originalTitle;
      button.setAttribute('aria-label', originalAria);
      button.classList.remove('copied');
    }
  };
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(t);
    } else {
      const ta = document.createElement('textarea');
      ta.value = t;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      if (!ok) throw new Error('execCommand copy failed');
    }
    if (button) {
      button.title = 'Copied!';
      button.setAttribute('aria-label', 'Copied!');
      button.classList.add('copied');
      setTimeout(() => { reset(); }, 1200);
    }
  } catch {
    if (button) {
      button.title = 'Copy failed';
      button.setAttribute('aria-label', 'Copy failed');
      setTimeout(() => { reset(); }, 1500);
    }
  }
}

/**
 * Render Coder blocks from JSON (coder_blocks_v1).
 * Fallback to plain text rendering when parsing fails or schema invalid.
 * @param {string} raw
 * @returns {DocumentFragment}
 */
function renderCoderBlocks(raw) {
  try {
    const obj = JSON.parse(String(raw || ''));
    if (!obj || obj.format !== 'coder_blocks_v1' || !Array.isArray(obj.blocks)) {
      return renderContentWithLinks(String(raw || ''));
    }
    const frag = document.createDocumentFragment();
    obj.blocks.forEach(b => {
      if (!b || typeof b !== 'object') return;
      if (b.type === 'paragraph') {
        const p = document.createElement('p');
        p.className = 'coder-paragraph';
        p.appendChild(renderContentWithLinks(String(b.text || '')));
        frag.appendChild(p);
      } else if (b.type === 'code') {
        const wrap = document.createElement('div');
        wrap.className = 'coder-block';

        // Always render a header so we can provide the export button consistently
        const header = document.createElement('div');
        header.className = 'coder-filename';

        const left = document.createElement('div');
        left.className = 'left';
        const fileSpan = document.createElement('span');
        const safeName = sanitizeFilename(b.filename);
        if (safeName) fileSpan.textContent = safeName;
        left.appendChild(fileSpan);

        const right = document.createElement('div');
        right.className = 'right';

        const langText = String(b.language || '').trim();
        if (langText) {
          const lg = document.createElement('span');
          lg.className = 'coder-lang';
          lg.textContent = langText;
          right.appendChild(lg);
        }

        const copyBtn = document.createElement('button');
        copyBtn.className = 'btn icon-only coder-copy';
        copyBtn.type = 'button';
        copyBtn.title = 'Copy';
        copyBtn.setAttribute('aria-label', 'Copy code');
        copyBtn.innerHTML = `
          <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect width="8" height="4" x="8" y="2" rx="1" ry="1"></rect>
            <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path>
          </svg>
        `;
        copyBtn.addEventListener('click', async () => {
          await copyTextToClipboard(String(b.code || ''), copyBtn);
        });
        right.appendChild(copyBtn);

        const exportBtn = document.createElement('button');
        exportBtn.className = 'btn icon-only coder-export';
        exportBtn.type = 'button';
        exportBtn.title = 'Download';
        exportBtn.setAttribute('aria-label', 'Download code');
        exportBtn.innerHTML = `
          <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>
        `;
        exportBtn.addEventListener('click', () => {
          const filename = sanitizeFilename(b.filename) || defaultExportFilename();
          triggerDownload(String(b.code || ''), filename);
        });
        right.appendChild(exportBtn);

        header.appendChild(left);
        header.appendChild(right);
        wrap.appendChild(header);

        const pre = document.createElement('pre');
        const code = document.createElement('code');
        const lang = normalizeLanguage(b.language);
        code.className = 'hljs' + (lang ? ' language-' + lang : '');
        code.textContent = String(b.code || '');
        pre.appendChild(code);
        wrap.appendChild(pre);
        frag.appendChild(wrap);
      }
    });
    return frag;
  } catch {
    return renderContentWithLinks(String(raw || ''));
  }
}

function applyHighlight(root) {
  try {
    if (!hljsAvailable()) return;
    root.querySelectorAll('pre code').forEach(el => {
      const classes = Array.from(el.classList);
      const langClass = classes.find(c => c.startsWith('language-'));
      const lang = langClass ? langClass.slice('language-'.length) : '';
      // If specified language isn't registered, fall back to auto
      if (lang && typeof window.hljs.getLanguage === 'function' && !window.hljs.getLanguage(lang)) {
        const res = window.hljs.highlightAuto(el.textContent || '');
        el.innerHTML = res.value;
        el.classList.add('hljs');
      } else if (typeof window.hljs.highlightElement === 'function') {
        window.hljs.highlightElement(el);
      } else if (typeof window.hljs.highlightAuto === 'function') {
        const res = window.hljs.highlightAuto(el.textContent || '');
        el.innerHTML = res.value;
        el.classList.add('hljs');
      }
    });
  } catch {}
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

export function renderChat(messages, { sources, mode } = {}) {
  const box = $('#chatMessages');
  if (!box) return;
  box.innerHTML = '';
  const isCoder = mode === 'coder';
  if (isCoder) box.classList.add('coder-mode'); else box.classList.remove('coder-mode');
  let lastAssistantRow = null;

  (messages || []).forEach(msg => {
    const row = document.createElement('div');
    row.className = `msg ${msg.role === 'user' ? 'user' : 'assistant'}`;

    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    let frag;
    if (isCoder && msg.role !== 'user') {
      frag = renderCoderBlocks(String(msg.content || ''));
    } else {
      frag = renderContentWithLinks(String(msg.content || ''));
    }
    bubble.appendChild(frag);

    row.appendChild(bubble);
    box.appendChild(row);

    if (msg.role !== 'user') {
      lastAssistantRow = row;
    }
  });

  // Mark the last assistant message for anchoring (used to pin at top)
  if (lastAssistantRow) {
    lastAssistantRow.setAttribute('data-last-assistant', 'true');
  }

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

  if (isCoder) {
    applyHighlight(box);
  }

  // Intentionally do not auto-scroll during render.
  // Scrolling is handled by the chat submit handler after user-initiated sends.
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

  // Do not auto-scroll here; scrolling is handled by the submit handler.
}

export function hideAssistantTyping() {
  const box = document.querySelector('#chatMessages');
  if (!box) return;
  const row = box.querySelector('.msg.assistant.loading');
  if (row) row.remove();
}