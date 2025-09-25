/**
 * redditService: client wrapper for GET /api/reddit
 */

import { ENDPOINTS } from '../config.js';

/**
 * Fetch subreddit hot posts (ordered as Reddit displays)
 * @param {string} subreddit - e.g., "news" or "/r/news"
 * @param {{limit?:number}} [opts]
 * @returns {Promise<{ subreddit:string, items:Array<{title:string,url:string,body:string}> }>}
 */
export async function fetchReddit(subreddit, opts = {}) {
  const sub = String(subreddit || '').replace(/^\/?r\//i, '').trim();
  const limit = Number.isFinite(opts.limit) ? String(opts.limit) : undefined;

  const params = new URLSearchParams();
  if (sub) params.set('subreddit', sub);
  if (limit) params.set('limit', limit);

  const url = `${ENDPOINTS.reddit}?${params.toString()}`;

  const res = await fetch(url, { method: 'GET' });
  if (!res.ok) {
    let info = '';
    try { info = (await res.json()).error?.message || ''; } catch {}
    throw new Error(`Reddit failed (${res.status}): ${info}`);
  }
  return res.json();
}