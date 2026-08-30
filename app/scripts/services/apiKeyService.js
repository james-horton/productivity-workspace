/**
 * API key settings client wrapper.
 * API keys are stored server-side in their existing secrets.json sections.
 */

import { ENDPOINTS, JSON_HEADERS } from '../config.js';

export async function fetchApiKeys() {
  const res = await fetch(ENDPOINTS.apiKeys, { method: 'GET' });
  if (!res.ok) {
    let info = '';
    try { info = (await res.json()).error?.message || ''; } catch {}
    throw new Error(`API key load failed (${res.status}): ${info}`);
  }
  return res.json();
}

export async function saveApiKeys(apiKeys) {
  const res = await fetch(ENDPOINTS.apiKeys, {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify({
      openaiApiKey: String(apiKeys?.openaiApiKey || ''),
      tavilyApiKey: String(apiKeys?.tavilyApiKey || ''),
      openrouterApiKey: String(apiKeys?.openrouterApiKey || '')
    })
  });
  if (!res.ok) {
    let info = '';
    try { info = (await res.json()).error?.message || ''; } catch {}
    throw new Error(`API key save failed (${res.status}): ${info}`);
  }
  return res.json();
}
