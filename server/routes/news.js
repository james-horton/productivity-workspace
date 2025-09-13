const express = require('express');
const router = express.Router();

const { tavilySearch, fetchNews } = require('../lib/search/tavily');
const { openaiChat } = require('../lib/providers/openai');

function coerceCategory(cat) {
  const c = String(cat || '').toLowerCase();
  if (c === 'national' || c === 'world' || c === 'local') return c;
  return 'national';
}

function compactItemsForPrompt(items) {
  // Reduce to minimal context for the LLM
  return items.slice(0, 6).map((r, i) => {
    const host = (function() { try { return new URL(r.url).hostname.replace(/^www\./, ''); } catch (e) { return ''; } })();
    const content = (r.content || '').replace(/\s+/g, ' ').trim().slice(0, 400);
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
      model: 'gpt-5-mini',
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: user }
      ],
      maxTokens: 80000,
      reasoningLevel: 'medium'
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
      return parsed.slice(0, 6).map((it, i) => ({
        title: String(it.title || (fallbackItems[i] ? fallbackItems[i].title : '') || 'Untitled'),
        summary: String(it.summary || '').trim() || 'Brief: headline only.',
        url: String(it.url || (fallbackItems[i] ? fallbackItems[i].url : '') || ''),
        source: String(it.source || ((fallbackItems[i] && fallbackItems[i].url) ? new URL(fallbackItems[i].url).hostname.replace(/^www\./, '') : '') || '')
      }));
    }
  } catch (_) {
    // fallthrough to naive fallback
  }
  // Fallback: naive summaries from content excerpts
  return fallbackItems.slice(0, 6).map(r => ({
    title: r.title || 'Untitled',
    summary: (r.content || '').replace(/\s+/g, ' ').trim().slice(0, 220) || 'Brief: headline only.',
    url: r.url || '',
    source: (function() { try { return new URL(r.url).hostname.replace(/^www\./, ''); } catch (e) { return ''; } })()
  }));
}

router.get('/', async (req, res, next) => {
  try {
    const category = coerceCategory(req.query.category);
    const lat = req.query.lat != null ? parseFloat(req.query.lat) : undefined;
    const lon = req.query.lon != null ? parseFloat(req.query.lon) : undefined;

    const { results } = await fetchNews(category, { lat, lon });
    const summarized = await summarizeWithLLM(results, category);

    res.json({
      category,
      items: summarized
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;