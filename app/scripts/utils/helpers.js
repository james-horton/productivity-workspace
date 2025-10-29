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