const axios = require('axios');
const { config } = require('../../config');

const TAVILY_URL = config.tavily.url || 'https://api.tavily.com/search';

// Allowed news domains (configurable)
const NEWS_SOURCES = config.news.allowedSources;

// Build a boolean site: filter clause for the query
function buildSiteFilterClause(domains) {
  if (!Array.isArray(domains) || domains.length === 0) return '';
  return `(${domains.map(d => `site:${d}`).join(' OR ')})`;
}

// Host helpers
function normalizeHost(host) {
  return String(host || '').replace(/^www\./i, '').toLowerCase();
}
function urlHost(url) {
  try { return normalizeHost(new URL(url).hostname); } catch { return ''; }
}
function hostAllowed(url, allowlist) {
  if (!Array.isArray(allowlist) || allowlist.length === 0) return true;
  const host = urlHost(url);
  return allowlist.some(d => {
    d = String(d).toLowerCase();
    return host === d || host.endsWith('.' + d);
  });
}

// Basic client for Tavily Search API
async function tavilySearch(query, { maxResults = config.tavily.maxResults, includeAnswer = config.tavily.includeAnswer, searchDepth = config.tavily.searchDepth } = {}) {
  if (!config.tavily.apiKey) {
    const err = new Error('Tavily API key missing');
    err.status = 400;
    throw err;
  }

  try {
    const res = await axios.post(
      TAVILY_URL,
      {
        api_key: config.tavily.apiKey,
        query,
        search_depth: searchDepth, // 'basic' | 'advanced'
        include_answer: includeAnswer,
        max_results: maxResults
      },
      { timeout: config.tavily.timeoutMs || 30000 }
    );

    // Normalize
    const data = res.data || {};
    const results = Array.isArray(data.results) ? data.results : [];
    return {
      answer: data.answer || null,
      results: results.map(r => ({
        title: r.title || '',
        url: r.url || '',
        content: r.content || '',
        score: typeof r.score === 'number' ? r.score : undefined,
        published_date: r.published_date || undefined
      }))
    };
  } catch (error) {
    const status = error.response ? error.response.status : 500;
    const msg = error.response && error.response.data ? JSON.stringify(error.response.data) : error.message;
    const err = new Error(`Tavily search failed: ${msg}`);
    err.status = status;
    throw err;
  }
}

// Helpers to craft category queries
function buildNewsQuery(category, { city, state } = {}) {
  if (category === 'local') {
    const parts = ['local news', city, state].filter(Boolean);
    return parts.join(' ').trim();
  }
  const base = category === 'national'
    ? 'Top trending U.S. news today'
    : category === 'world'
      ? 'Top global news today'
      : 'Top news today';
  if (category === 'national' || category === 'world') {
    const siteClause = buildSiteFilterClause(NEWS_SOURCES);
    return `${base} ${siteClause}`.trim();
  }
  return base;
}

async function fetchNews(category, { city, state } = {}) {
  const query = buildNewsQuery(category, { city, state });
  return tavilySearch(
    query,
    {
      maxResults: config.tavily.maxResults,
      includeAnswer: config.tavily.includeAnswer,
      searchDepth: config.tavily.searchDepth
    }
  );
}

module.exports = {
  tavilySearch,
  fetchNews,
  NEWS_SOURCES
};