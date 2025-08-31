/**
 * quoteService: client wrapper for POST /api/quote
 */

function withTimeout(ms = 20000) {
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

  const { exec } = withTimeout(20000);
  const res = await exec('/api/quote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body
  });

  if (!res.ok) {
    let info = '';
    try { info = (await res.json()).error?.message || ''; } catch {}
    throw new Error(`Quote failed (${res.status}): ${info}`);
  }
  return res.json();
}