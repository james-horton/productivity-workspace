/**
 * redditService: client wrapper for GET /api/reddit
 */

import { ENDPOINTS, REDDIT } from '../config.js';

const REDDIT_CACHE_STORAGE_KEY = 'productivity-workspace:reddit-cache:v1';

function getLocalStorage() {
  try {
    return typeof globalThis !== 'undefined' ? globalThis.localStorage : null;
  } catch {
    // Storage can be unavailable in private browsing or when access is blocked.
    return null;
  }
}

function getCacheKey(subreddit, limit) {
  return `${subreddit.toLowerCase()}:${limit || ''}`;
}

function readCachedReddit(subreddit, limit) {
  const storage = getLocalStorage();
  if (!storage) return null;

  try {
    const cache = JSON.parse(storage.getItem(REDDIT_CACHE_STORAGE_KEY) || '{}');
    const entry = cache[getCacheKey(subreddit, limit)];
    if (!entry || !Number.isFinite(entry.storedAt) || !entry.data) return null;

    if (Date.now() - entry.storedAt >= REDDIT.cacheTtlMs) {
      delete cache[getCacheKey(subreddit, limit)];
      storage.setItem(REDDIT_CACHE_STORAGE_KEY, JSON.stringify(cache));
      return null;
    }

    return entry.data;
  } catch {
    return null;
  }
}

function writeCachedReddit(subreddit, limit, data) {
  const storage = getLocalStorage();
  if (!storage) return;

  try {
    const cache = JSON.parse(storage.getItem(REDDIT_CACHE_STORAGE_KEY) || '{}');
    cache[getCacheKey(subreddit, limit)] = {
      storedAt: Date.now(),
      data
    };
    storage.setItem(REDDIT_CACHE_STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // A storage failure should not prevent Reddit results from rendering.
  }
}

/**
 * Fetch subreddit hot posts (ordered as Reddit displays)
 * @param {string} subreddit - e.g., "news" or "/r/news"
 * @param {{limit?:number, forceRefresh?:boolean}} [opts]
 * @returns {Promise<{ subreddit:string, items:Array<{title:string,url:string,body:string}> }>}
 */
export async function fetchReddit(subreddit, opts = {}) {
  const sub = String(subreddit || '').replace(/^\/?r\//i, '').trim();
  const limit = Number.isFinite(opts.limit) ? String(opts.limit) : undefined;
  const forceRefresh = opts.forceRefresh === true;

  if (!forceRefresh) {
    const cached = readCachedReddit(sub, limit);
    if (cached) return cached;
  }

  const params = new URLSearchParams();
  if (sub) params.set('subreddit', sub);
  if (limit) params.set('limit', limit);

  const url = `${ENDPOINTS.reddit}?${params.toString()}`;

  const res = await fetch(url, {
    method: 'GET',
    ...(forceRefresh ? { cache: 'no-store' } : {})
  });
  if (!res.ok) {
    let info = '';
    try { info = (await res.json()).error?.message || ''; } catch {}
    throw new Error(`Reddit failed (${res.status}): ${info}`);
  }
  const data = await res.json();
  writeCachedReddit(sub, limit, data);
  return data;
}
