const express = require('express');
const axios = require('axios');

const router = express.Router();

function normalizeSubreddit(name) {
  return String(name || '').replace(/^\/?r\//i, '').trim();
}

function coerceLimit(v) {
  const n = parseInt(String(v || ''), 10);
  const def = 6;
  if (!Number.isFinite(n) || n < 1) return def;
  // Reasonable upper bound to avoid huge payloads
  return Math.min(n, 25);
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

    // Preserve Reddit ordering by taking results as-is from /hot.json
    const url = `https://www.reddit.com/r/${encodeURIComponent(subreddit)}/hot.json?limit=${limit}&raw_json=1`;

    const { data } = await axios.get(url, {
      headers: {
        'User-Agent': 'WorkspaceAI/0.1 (+http://localhost)'
      },
      timeout: 10000
    });

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
    next(err);
  }
});

module.exports = router;