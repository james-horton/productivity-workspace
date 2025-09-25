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