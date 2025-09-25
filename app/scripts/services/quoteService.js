/**
 * quoteService: client wrapper for POST /api/quote
 */

import { ENDPOINTS, TIMEOUTS, JSON_HEADERS } from '../config.js';

function withTimeout(ms = TIMEOUTS.defaultMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return {
    exec: (input, init) =>
      fetch(input, { ...(init || {}), signal: ctrl.signal })
        .finally(() => clearTimeout(t))
  };
}

/**
 * Fetch a themed quote from backend
 * @param {'matrix'|'dark'|'aurora'} theme
 * @returns {Promise<{ quote:string, providerUsed:string, modelUsed:string }>}
 */
export async function fetchQuote(theme) {
  const body = JSON.stringify({ theme });

  const { exec } = withTimeout(TIMEOUTS.quoteMs);
  const res = await exec(ENDPOINTS.quote, {
    method: 'POST',
    headers: JSON_HEADERS,
    body
  });

  if (!res.ok) {
    let info = '';
    try { info = (await res.json()).error?.message || ''; } catch {}
    throw new Error(`Quote failed (${res.status}): ${info}`);
  }
  return res.json();
}