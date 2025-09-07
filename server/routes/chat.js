const express = require('express');
const router = express.Router();

const { openaiChat } = require('../lib/providers/openai');

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
        'Ask relevant clarifying questions if needed. Provide possible considerations and next steps.',
        'Be concise and clear. Avoid alarmist language.'
      ].join(' ');
    case 'therapist':
      return [
        'You are a supportive, empathetic, non-judgmental counselor.',
        'Reflect feelings, ask gentle questions, and offer practical next steps.',
        'Emphasize self-care and resources.'
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
      return 'Generate a believable excuse tailored to the problem.';
    default:
      return 'You are a helpful assistant.';
  }
}

// External Tavily digest path removed; provider web search only.

async function callPreferredModels({ reasoning, messages, prefer, model, webSearch }) {
  // prefer is an array of provider ids in order; default to OpenAI only
  const attempts = Array.isArray(prefer) && prefer.length ? prefer : ['openai'];

  const params = {
    messages,
    reasoningLevel: reasoning,
    temperature: 1,
    maxTokens: 80000,
    model,
    webSearch
  };

  let lastErr;
  for (const provider of attempts) {
    try {
      if (provider === 'openai') {
        const out = await openaiChat(params);
        return { ...out, provider: 'openai' };
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
      provider, // 'openai' (preferred)
      model, // optional specific model id for provider
      webSearch // boolean: if true, use provider web search (GPT-5 tools); if false, disable provider web search
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

    // Decide how to handle web search:
    // If explicit webSearch provided, honor it; otherwise fall back to mode default.
    const effectiveWebSearch = (typeof webSearch === 'boolean') ? webSearch : !!(MODE_SPECS[mode] && MODE_SPECS[mode].defaultSearch);

    // Compose final message list (no external search digest; provider tools handle browsing)
    const finalMessages = [systemMsg, ...userMessages];

    // Provider preference: force OpenAI
    const prefer = ['openai'];

    // Call provider with optional model override and provider web search toggle
    const response = await callPreferredModels({
      reasoning: spec.reasoning,
      messages: finalMessages,
      prefer,
      model,
      webSearch: effectiveWebSearch
    });

    const payload = {
      message: { role: 'assistant', content: response.text },
      modelUsed: response.modelUsed,
      providerUsed: response.provider,
      disclaimer: spec.disclaimer || null,
      sources: []
    };

    res.json(payload);
  } catch (err) {
    next(err);
  }
});

module.exports = router;