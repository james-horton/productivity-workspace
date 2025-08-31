const express = require('express');
const router = express.Router();

const { openaiChat } = require('../lib/providers/openai');
const { deepseekChat } = require('../lib/providers/deepseek');
const { tavilySearch } = require('../lib/search/tavily');

// Mode specifications: reasoning + default search + disclaimers
const MODE_SPECS = {
  doctor: {
    reasoning: 'high',
    defaultSearch: false,
    disclaimer: 'This is not medical advice. For urgent or serious symptoms, contact a licensed clinician or emergency services.'
  },
  therapist: {
    reasoning: 'high',
    defaultSearch: false,
    disclaimer: 'This is supportive conversation, not a substitute for professional mental health care. If in crisis, contact local emergency services or a crisis hotline.'
  },
  web: {
    reasoning: 'medium',
    defaultSearch: true,
    disclaimer: null
  },
  basic: {
    reasoning: 'low',
    defaultSearch: false,
    disclaimer: null
  },
  excuse: {
    reasoning: 'medium',
    defaultSearch: false,
    disclaimer: null
  }
};

function coerceArray(val) {
  return Array.isArray(val) ? val : [];
}

function sanitizeMessages(messages) {
  // Keep only role/content and trim strings
  return coerceArray(messages)
    .map(m => ({
      role: m.role === 'system' || m.role === 'assistant' ? m.role : 'user',
      content: typeof m.content === 'string' ? m.content.slice(0, 8000) : ''
    }))
    .filter(m => m.content);
}

function buildSystemPrompt(mode) {
  switch (mode) {
    case 'doctor':
      return [
        'You are a careful, evidence-informed medical assistant.',
        'Ask relevant clarifying questions if needed. Do not diagnose; provide possible considerations and next steps.',
        'Be concise and clear. Avoid alarmist language.',
        'Always include a brief safety disclaimer.'
      ].join(' ');
    case 'therapist':
      return [
        'You are a supportive, empathetic, non-judgmental counselor.',
        'Reflect feelings, ask gentle questions, and offer practical next steps.',
        'Avoid clinical diagnoses; emphasize self-care and resources.',
        'Always include a brief support disclaimer.'
      ].join(' ');
    case 'web':
      return [
        'You can use provided web results to answer.',
        'Cite specific sources by domain (e.g., source: example.com) when referencing facts.',
        'Be concise and avoid speculation.'
      ].join(' ');
    case 'basic':
      return 'You are a fast, helpful assistant. Keep answers short and practical.';
    case 'excuse':
      return 'Generate a tactful, believable excuse tailored to context without encouraging harm or dishonesty with serious consequences.';
    default:
      return 'You are a helpful assistant.';
  }
}

// Prepare a compact digest of web results as context for the LLM
function buildWebResultsDigest(results) {
  if (!Array.isArray(results)) return null;
  const lines = results.slice(0, 5).map((r, i) => {
    const host = (function() {
      try { return new URL(r.url).hostname.replace(/^www\./, ''); } catch (e) { return ''; }
    })();
    const content = (r.content || '').replace(/\s+/g, ' ').trim().slice(0, 300);
    return `- (${i + 1}) ${r.title || host} — ${content}${host ? ` [${host}]` : ''}\n  ${r.url}`;
  });
  return lines.length ? `Web results digest:\n${lines.join('\n')}` : null;
}

async function performWebSearchIfNeeded(mode, userQuery) {
  const spec = MODE_SPECS[mode] || MODE_SPECS.basic;
  // Never use web search in basic mode; web mode uses it by default.
  const shouldSearch = mode === 'basic' ? false : spec.defaultSearch;
  if (!shouldSearch || !userQuery) return { digest: null, sources: [] };

  const { results } = await tavilySearch(userQuery, { maxResults: 6, includeAnswer: false, searchDepth: 'advanced' });
  const digest = buildWebResultsDigest(results);
  const sources = results.slice(0, 6).map(r => ({
    title: r.title || '',
    url: r.url || '',
    source: (function() { try { return new URL(r.url).hostname.replace(/^www\./, ''); } catch (e) { return ''; } })()
  }));
  return { digest, sources };
}

async function callPreferredModels({ reasoning, messages, prefer }) {
  // prefer is an array of provider ids in order: ['openai','deepseek']
  const attempts = Array.isArray(prefer) && prefer.length ? prefer : ['openai', 'deepseek'];

  const params = {
    messages,
    reasoningLevel: reasoning,
    temperature: reasoning === 'high' ? 0.6 : reasoning === 'medium' ? 0.7 : 0.5,
    maxTokens: 900
  };

  let lastErr;
  for (const provider of attempts) {
    try {
      if (provider === 'openai') {
        const out = await openaiChat(params);
        return { ...out, provider: 'openai' };
      }
      if (provider === 'deepseek') {
        const out = await deepseekChat(params);
        return { ...out, provider: 'deepseek' };
      }
    } catch (err) {
      // If key missing (we throw 400 with message), try next provider; otherwise rethrow
      if (err && (err.status === 400) && /key missing/i.test(err.message)) {
        lastErr = err;
        continue;
      }
      throw err;
    }
  }
  if (lastErr) throw lastErr;
  throw new Error('No provider available');
}

router.post('/', async (req, res, next) => {
  try {
    const {
      mode = 'basic',
      messages: rawMessages,
      provider, // 'openai' | 'deepseek' (preferred)
      model // optional specific model id for provider
    } = req.body || {};

    const spec = MODE_SPECS[mode] || MODE_SPECS.basic;

    // Build conversation
    const userMessages = sanitizeMessages(rawMessages);
    let latestUserContent = '';
    for (let i = userMessages.length - 1; i >= 0; i--) {
      const um = userMessages[i];
      if (um && um.role === 'user' && typeof um.content === 'string') { latestUserContent = um.content; break; }
    }

    const sys = buildSystemPrompt(mode);
    const systemMsg = { role: 'system', content: sys };

    // Optional web search
    const { digest, sources } = await performWebSearchIfNeeded(mode, latestUserContent);
    const webMsg = digest ? [{ role: 'system', content: digest }] : [];

    // Compose final message list
    const finalMessages = [systemMsg, ...webMsg, ...userMessages];

    // Provider preference
    const prefer = provider === 'deepseek' ? ['deepseek', 'openai'] :
                   provider === 'openai' ? ['openai', 'deepseek'] :
                   (spec.reasoning === 'high' ? ['openai', 'deepseek'] : ['deepseek', 'openai']);

    // Allow explicit model override by pinning model on top (wrapper resolves when provided)
    const response = await callPreferredModels({
      reasoning: spec.reasoning,
      messages: model ? [{ ...finalMessages[0], content: `${finalMessages[0].content} Use model=${model} if applicable.` }, ...finalMessages.slice(1)] : finalMessages,
      prefer
    });

    const payload = {
      message: { role: 'assistant', content: response.text },
      modelUsed: response.modelUsed,
      providerUsed: response.provider,
      disclaimer: spec.disclaimer || null,
      sources: sources || []
    };

    res.json(payload);
  } catch (err) {
    next(err);
  }
});

module.exports = router;