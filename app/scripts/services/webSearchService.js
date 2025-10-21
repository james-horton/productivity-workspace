/**
 * webSearchService: client wrapper for GET /api/websearch
 */

import { ENDPOINTS } from '../config.js';

/**
 * Perform a Tavily-powered web search
 * @param {string} query
 * @returns {Promise<{ answer: string, items: Array<{title:string,url:string,source:string,favicon?:string}> }>}
 */
export async function webSearch(query) {
    
  const q = String(query || '').trim();
  if (!q) throw new Error('Query is required');
  const params = new URLSearchParams({ q });
  const url = `${ENDPOINTS.websearch}?${params.toString()}`;
  const res = await fetch(url, { method: 'GET' });

  if (!res.ok) {
    let info = '';
    try { info = (await res.json()).error?.message || ''; } catch {}
    throw new Error(`Web search failed (${res.status}): ${info}`);
  }

  return res.json();
}