const express = require('express');
const axios = require('axios');

const router = express.Router();
const { config } = require('../config');

function normalizeSubreddit(name) {
  return String(name || '').replace(/^\/?r\//i, '').trim();
}

function coerceLimit(v) {
  const n = parseInt(String(v || ''), 10);
  const def = config.reddit.defaultLimit;
  if (!Number.isFinite(n) || n < 1) return def;
  // Reasonable upper bound to avoid huge payloads
  return Math.min(n, config.reddit.maxLimit);
}

function previewBody(data) {
  try {
    const text = typeof data === 'string' ? data : JSON.stringify(data);
    return String(text || '').replace(/\s+/g, ' ').trim().slice(0, 500);
  } catch {
    return '';
  }
}

function decodeEntities(value) {
  return String(value || '').replace(/&#(\d+);|&#x([0-9a-f]+);|&(amp|lt|gt|quot|apos);/gi, (match, dec, hex, named) => {
    if (dec) return String.fromCharCode(parseInt(dec, 10));
    if (hex) return String.fromCharCode(parseInt(hex, 16));
    const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    return entities[String(named || '').toLowerCase()] || match;
  });
}

function stripHtml(value) {
  return decodeEntities(String(value || '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim());
}

function getFirstTagValue(xml, tag) {
  const match = String(xml || '').match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match ? decodeEntities(match[1]).trim() : '';
}

function getAttrValue(tag, attr) {
  const match = String(tag || '').match(new RegExp(`${attr}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'));
  return match ? decodeEntities(match[1] || match[2] || '').trim() : '';
}

function extractEntryUrl(entry) {
  const alternateLink = String(entry || '').match(/<link\b(?=[^>]*\brel=["']alternate["'])[^>]*>/i);
  const anyLink = String(entry || '').match(/<link\b[^>]*>/i);
  const linkTag = alternateLink ? alternateLink[0] : (anyLink && anyLink[0]);
  return linkTag ? getAttrValue(linkTag, 'href') : getFirstTagValue(entry, 'id');
}

function parseRedditAtom(xml, limit) {
  return Array.from(String(xml || '').matchAll(/<entry\b[\s\S]*?<\/entry>/gi))
    .slice(0, limit)
    .map((match) => {
      const entry = match[0];
      const title = getFirstTagValue(entry, 'title') || 'Untitled';
      const url = extractEntryUrl(entry);
      const content = decodeEntities(getFirstTagValue(entry, 'content'));
      const body = stripHtml(content);
      return { title, url, body };
    });
}

function redditHeaders(accept) {
  return {
    'User-Agent': config.reddit.userAgent,
    Accept: accept
  };
}

function redditBaseUrl() {
  return (config.reddit.baseUrl || 'https://www.reddit.com').replace(/\/+$/, '');
}

async function fetchRedditJson(subreddit, limit) {
  const url = `${redditBaseUrl()}/r/${encodeURIComponent(subreddit)}/hot.json?limit=${limit}&raw_json=1`;
  const { data } = await axios.get(url, {
    headers: redditHeaders('application/json'),
    timeout: config.reddit.timeoutMs
  });
  return data;
}

async function fetchRedditRssItems(subreddit, limit) {
  const url = `${redditBaseUrl()}/r/${encodeURIComponent(subreddit)}/.rss?limit=${limit}`;
  const { data } = await axios.get(url, {
    headers: redditHeaders('application/atom+xml, application/rss+xml, application/xml;q=0.9, */*;q=0.8'),
    timeout: config.reddit.timeoutMs
  });
  return parseRedditAtom(data, limit);
}

function shouldFallbackToRss(err) {
  return Boolean(err && err.isAxiosError && err.response && err.response.status === 403);
}

function logRedditUpstreamError(err, subreddit, label = '[reddit] upstream request failed', logger = console.error) {
  if (!err || !err.isAxiosError || err.redditLogged) return;

  const response = err.response || {};
  const headers = response.headers || {};
  const diagnostic = {
    subreddit,
    url: err.config && err.config.url,
    userAgent: config.reddit.userAgent,
    status: response.status,
    statusText: response.statusText,
    contentType: headers['content-type'],
    server: headers.server,
    rateLimitRemaining: headers['x-ratelimit-remaining'],
    rateLimitReset: headers['x-ratelimit-reset'],
    axiosCode: err.code,
    message: err.message,
    bodyPreview: previewBody(response.data)
  };

  err.redditLogged = true;
  logger(label, JSON.stringify(diagnostic));
}

/**
 * GET /api/reddit
 * Query:
 *  - subreddit: string (required) e.g., "news" or "/r/news"
 *  - limit: number (optional, default 6, max 25)
 *
 * Returns:
 *  {
 *    subreddit: string,
 *    items: Array<{ title: string, url: string, body: string }>
 *  }
 */
router.get('/', async (req, res, next) => {
  try {
    const subreddit = normalizeSubreddit(req.query.subreddit);
    const limit = coerceLimit(req.query.limit);

    if (!subreddit) {
      const err = new Error('Subreddit required');
      err.status = 400;
      throw err;
    }

    let data;
    try {
      // Preserve Reddit ordering by taking results as-is from /hot.json when Reddit allows it.
      data = await fetchRedditJson(subreddit, limit);
    } catch (err) {
      logRedditUpstreamError(
        err,
        subreddit,
        '[reddit] JSON endpoint blocked; attempting RSS fallback',
        console.warn
      );

      if (!shouldFallbackToRss(err)) throw err;

      const items = await fetchRedditRssItems(subreddit, limit);
      return res.json({
        subreddit,
        items
      });
    }

    const children = data && data.data && Array.isArray(data.data.children)
      ? data.data.children
      : [];

    const items = children
      .map((c) => c && c.data)
      .filter(Boolean)
      .slice(0, limit)
      .map((d) => {
        const permalink = d.permalink ? `https://www.reddit.com${d.permalink}` : (d.url_overridden_by_dest || d.url || '');
        const body = String(d.selftext || '').trim();
        return {
          title: String(d.title || 'Untitled'),
          url: permalink,
          body
        };
      });

    res.json({
      subreddit,
      items
    });
  } catch (err) {
    logRedditUpstreamError(err, req.query && req.query.subreddit);
    next(err);
  }
});

module.exports = router;
