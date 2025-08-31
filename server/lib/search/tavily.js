const axios = require('axios');
const { config } = require('../../config');

const TAVILY_URL = 'https://api.tavily.com/search';

// Basic client for Tavily Search API
async function tavilySearch(query, { maxResults = 6, includeAnswer = false, searchDepth = 'advanced' } = {}) {
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
      { timeout: 30000 }
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

// Reverse geocode lat/lon to "City, State" (best-effort) using OpenStreetMap Nominatim
async function reverseGeocode(lat, lon) {
  try {
    const res = await axios.get('https://nominatim.openstreetmap.org/reverse', {
      params: { format: 'jsonv2', lat, lon },
      headers: {
        'User-Agent': 'productivity-workspace/1.0 (+https://localhost)',
        'Accept-Language': 'en-US,en;q=0.8'
      },
      timeout: 15000
    });
    const addr = res.data && res.data.address ? res.data.address : {};
    const city = addr.city || addr.town || addr.village || addr.hamlet || '';
    const state = addr.state || addr.region || '';
    const country = addr.country || '';
    return {
      city,
      state,
      country,
      display: [city, state].filter(Boolean).join(', ') || country || 'your area'
    };
  } catch {
    return { city: '', state: '', country: '', display: 'your area' };
  }
}

// Helpers to craft category queries
function buildNewsQuery(category, locality) {
  const base = {
    national: 'Top trending U.S. news today',
    world: 'Top global news today',
    local: `Local news near ${locality || 'your area'} today`
  }[category] || 'Top news today';
  return `${base} site:news`;
}

async function fetchNews(category, { lat, lon } = {}) {
  let locality;
  if (category === 'local' && typeof lat === 'number' && typeof lon === 'number') {
    const loc = await reverseGeocode(lat, lon);
    locality = loc.display;
  }
  const query = buildNewsQuery(category, locality);
  return tavilySearch(query, { maxResults: 6, includeAnswer: false, searchDepth: 'advanced' });
}

module.exports = {
  tavilySearch,
  fetchNews,
  reverseGeocode
};