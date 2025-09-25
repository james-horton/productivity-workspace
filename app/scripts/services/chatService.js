/**
 * chatService: client wrapper for POST /api/chat
 */

import { ENDPOINTS, TIMEOUTS, JSON_HEADERS } from '../config.js';

function withTimeout(promise, ms = TIMEOUTS.defaultMs) {
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
 * @param {'doctor'|'therapist'|'web'|'basic'|'excuse'|'grammar'|'eli5'|'debate_lord'} opts.mode
 * @param {Array<{role:'user'|'assistant', content:string}>} opts.messages
 * @param {'openai'} [opts.provider]
 * @param {string} [opts.model]
 * @param {boolean} [opts.webSearch] When true, enables provider-side web search (OpenAI GPT-5 tools). When false, disables provider web search. If omitted, the server uses the mode default.
 * @returns {Promise<{ message:{role:'assistant',content:string}, modelUsed:string, providerUsed:string, disclaimer:string|null, sources:Array<{title:string,url:string,source:string}> }>}
 */
export async function sendChat({ mode, messages, provider, model, webSearch }) {
  const body = JSON.stringify({
    mode,
    messages,
    provider,
    model,
    webSearch
  });

  const { exec } = withTimeout(null, TIMEOUTS.chatMs);
  const res = await exec(ENDPOINTS.chat, {
    method: 'POST',
    headers: JSON_HEADERS,
    body
  });

  if (!res.ok) {
    let info = '';
    try { info = (await res.json()).error?.message || ''; } catch {}
    throw new Error(`Chat failed (${res.status}): ${info}`);
  }
  return res.json();
}