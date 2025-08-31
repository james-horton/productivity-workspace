/**
 * chatService: client wrapper for POST /api/chat
 */

function withTimeout(promise, ms = 45000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return {
    exec: (input, init) =>
      fetch(input, { ...(init || {}), signal: ctrl.signal })
        .finally(() => clearTimeout(t))
  };
}

/**
 * Send chat request to backend
 * @param {Object} opts
 * @param {'doctor'|'therapist'|'web'|'basic'|'excuse'} opts.mode
 * @param {Array<{role:'user'|'assistant', content:string}>} opts.messages
 * @param {boolean} opts.webSearch
 * @param {'openai'|'deepseek'} [opts.provider]
 * @param {string} [opts.model]
 * @returns {Promise<{ message:{role:'assistant',content:string}, modelUsed:string, providerUsed:string, disclaimer:string|null, sources:Array<{title:string,url:string,source:string}> }>}
 */
export async function sendChat({ mode, messages, webSearch, provider, model }) {
  const body = JSON.stringify({
    mode,
    messages,
    webSearch: !!webSearch,
    provider,
    model
  });

  const { exec } = withTimeout(null, 45000);
  const res = await exec('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body
  });

  if (!res.ok) {
    let info = '';
    try { info = (await res.json()).error?.message || ''; } catch {}
    throw new Error(`Chat failed (${res.status}): ${info}`);
  }
  return res.json();
}