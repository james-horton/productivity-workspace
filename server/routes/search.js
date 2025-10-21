const express = require('express');
const router = express.Router();

const { tavilySearch } = require('../lib/search/tavily');
const { hostFromUrl } = require('../lib/util/url');
const { config } = require('../config');

/**
 * Tavily Web Search API
 * POST /api/websearch { query: string }
 * GET  /api/websearch?q=...
 * Returns: { answer: string, items: Array<{title,url,source,favicon?}> }
 */

function coerceQuery(input) {
  if (typeof input !== 'string') return '';
  return input.trim();
}

router.post('/', async (req, res, next) => {
  try {
    const query = coerceQuery(req.body?.query ?? req.body?.q ?? '');
    if (!query) {
      const err = new Error('Missing query');
      err.status = 400;
      throw err;
    }

    const { answer, results } = await tavilySearch(query, {
      includeAnswer: true,
      searchDepth: 'advanced',
      maxResults: config.tavily.maxResults
    });

    const items = (results || []).map(r => ({
      title: r.title || hostFromUrl(r.url) || 'Untitled',
      url: r.url || '',
      source: hostFromUrl(r.url),
      favicon: r.favicon
    }));

    res.json({ answer: answer || '', items });
  } catch (err) {
    next(err);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const query = coerceQuery(req.query?.q ?? '');
    if (!query) {
      const err = new Error('Missing query');
      err.status = 400;
      throw err;
    }

    const { answer, results } = await tavilySearch(query, {
      includeAnswer: true,
      searchDepth: 'advanced',
      maxResults: config.tavily.maxResults
    });

    const items = (results || []).map(r => ({
      title: r.title || hostFromUrl(r.url) || 'Untitled',
      url: r.url || '',
      source: hostFromUrl(r.url),
      favicon: r.favicon
    }));

    res.json({ answer: answer || '', items });
  } catch (err) {
    next(err);
  }
});

module.exports = router;