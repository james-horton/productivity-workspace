const express = require('express');
const router = express.Router();

const { fetchNews } = require('../lib/search/tavily');
const { hostFromUrl } = require('../lib/util/url');
const { config } = require('../config');

function coerceCategory(cat) {
  const c = String(cat || '').toLowerCase();
  if (c === 'national' || c === 'world' || c === 'local') return c;
  return 'national';
}

/**
 * Summarization removed. Use Tavily's "answer" as the overall summary.
 */

router.get('/', async (req, res, next) => {
  try {
    const category = coerceCategory(req.query.category);
    const city = typeof req.query.city === 'string' ? String(req.query.city).trim() : undefined;
    const state = typeof req.query.state === 'string' ? String(req.query.state).trim() : undefined;

    const { answer, results } = await fetchNews(category, { city, state });

    const items = (results || []).slice(0, config.news.maxItems).map(r => ({
      title: r.title || hostFromUrl(r.url) || 'Untitled',
      url: r.url || '',
      source: hostFromUrl(r.url),
      favicon: r.favicon
    }));

    res.json({
      category,
      answer: answer || '',
      items
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;