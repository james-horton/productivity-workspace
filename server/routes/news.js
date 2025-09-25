const express = require('express');
const router = express.Router();

const { fetchNews } = require('../lib/search/tavily');
const { openaiChat } = require('../lib/providers/openai');
const { hostFromUrl } = require('../lib/util/url');
const { config } = require('../config');

function coerceCategory(cat) {
  const c = String(cat || '').toLowerCase();
  if (c === 'national' || c === 'world' || c === 'local') return c;
  return 'national';
}

function compactItemsForPrompt(items) {
  // Reduce to minimal context for the LLM
  return items.slice(0, config.news.maxItems).map((r, i) => {
    const host = hostFromUrl(r.url);
    const content = (r.content || '').replace(/\s+/g, ' ').trim().slice(0, config.news.excerptLen);
    return {
      idx: i + 1,
      title: r.title || host || 'Untitled',
      url: r.url,
      source: host,
      excerpt: content
    };
  });
}

async function summarizeWithLLM(items, category) {
  const list = compactItemsForPrompt(items);

  const sys = [
    'You summarize current news items in neutral, concise language.',
    'Do not begin the summary saying something like "<news source> reports that...", go straight to content.',
    'Return a strict JSON array, where each item has: title, summary, url, source.',
    'summary should be 1-2 sentences or up to a short paragraph long, unbiased, with key facts only. No emojis, no hashtags.',
    'If content is too thin, use the title + source to infer a generic but accurate summary, or say "Brief: headline only."',
    'Keep summaries safe and avoid speculation.'
  ].join(' ');

  const user = [
    `Category: ${category}. Summarize these items:`,
    JSON.stringify(list, null, 2)
  ].join('\n');

  try {
    const out = await openaiChat({
      model: config.news.summarizerModel,
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: user }
      ],
      maxTokens: config.openai.defaultMaxTokens,
      reasoningLevel: config.news.summarizerReasoning
    });
    return safeParseArray(out.text, items);
  } catch (err) {
    // If OpenAI key is missing, fall back to naive summaries
    if (err && err.status === 400 && /key missing/i.test(err.message)) {
      // Trigger naive fallback path
      return safeParseArray('not-json', items);
    }
    throw err;
  }
}

function safeParseArray(text, fallbackItems) {
  // Try to locate a JSON array in the text
  try {
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : text);
    if (Array.isArray(parsed)) {
      return parsed.slice(0, config.news.maxItems).map((it, i) => ({
        title: String(it.title || (fallbackItems[i] ? fallbackItems[i].title : '') || 'Untitled'),
        summary: String(it.summary || '').trim() || 'Brief: headline only.',
        url: String(it.url || (fallbackItems[i] ? fallbackItems[i].url : '') || ''),
        source: String(it.source || ((fallbackItems[i] && fallbackItems[i].url) ? hostFromUrl(fallbackItems[i].url) : '') || '')
      }));
    }
  } catch (_) {
    // fallthrough to naive fallback
  }
  // Fallback: naive summaries from content excerpts
  return fallbackItems.slice(0, config.news.maxItems).map(r => ({
    title: r.title || 'Untitled',
    summary: (r.content || '').replace(/\s+/g, ' ').trim().slice(0, config.news.naiveSummaryLen) || 'Brief: headline only.',
    url: r.url || '',
    source: hostFromUrl(r.url)
  }));
}

router.get('/', async (req, res, next) => {
  try {
    const category = coerceCategory(req.query.category);
    const city = typeof req.query.city === 'string' ? String(req.query.city).trim() : undefined;
    const state = typeof req.query.state === 'string' ? String(req.query.state).trim() : undefined;

    const { results } = await fetchNews(category, { city, state });
    const summarized = await summarizeWithLLM(results, category);

    // Attach raw (unsummarized) content from search results to each summarized item
    const byUrl = new Map();
    results.forEach(r => { if (r && r.url) byUrl.set(r.url, r.content || ''); });

    const items = summarized.map((it, i) => ({
      ...it,
      content: (it.url && byUrl.get(it.url)) || (results[i] ? results[i].content || '' : '')
    }));

    res.json({
      category,
      items
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;