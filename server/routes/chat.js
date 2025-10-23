const express = require('express');
const router = express.Router();

const { openaiChat } = require('../lib/providers/openai');
const { config } = require('../config');
// Mode specifications: reasoning + default search + disclaimers
const MODE_SPECS = {
  doctor: {
    model: 'gpt-5',
    reasoning: 'high',
    defaultSearch: false,
    disclaimer: 'This is not medical advice. For urgent or serious symptoms, contact a licensed clinician or emergency services.'
  },
  therapist: {
    model: 'gpt-5',
    reasoning: 'high',
    defaultSearch: false,
    disclaimer: 'This is supportive conversation, not a substitute for professional mental health care. If in crisis, contact local emergency services or a crisis hotline.'
  },
  web: {
    model: 'gpt-5-mini',
    reasoning: 'low',
    defaultSearch: true,
    disclaimer: null
  },
  basic: {
    model: 'gpt-5',
    reasoning: 'low',
    defaultSearch: false,
    disclaimer: null
  },
  excuse: {
    model: 'gpt-5',
    reasoning: 'medium',
    defaultSearch: false,
    disclaimer: null
  },
  grammar: {
    model: 'gpt-5-nano',
    reasoning: 'minimal',
    defaultSearch: false,
    disclaimer: null
  },
  eli5: {
    model: 'gpt-5',
    reasoning: 'low',
    defaultSearch: false,
    disclaimer: null
  },
  debate_lord: {
    model: 'gpt-5',
    reasoning: 'medium',
    defaultSearch: false,
    disclaimer: null
  },
  big_brain: {
    model: 'gpt-5-pro',
    reasoning: 'high',
    defaultSearch: false,
    disclaimer: 'High-reasoning mode. No web search and no code interpreter is available.',
    maxInputTokens: 4000,
    maxOutputTokens: 4000
  },
  coder: {
    model: 'gpt-5',
    reasoning: 'high',
    defaultSearch: false,
    disclaimer: ''
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
    case 'grammar':
      return [
        'You are a grammar, spelling, capitalization, and punctuation corrector.',
        'Return only the corrected text. Do not add explanations, notes, or extra content.',
        'Preserve the original meaning, tone, formatting, markdown, and line breaks.',
        'If the input is already correct, output it unchanged.'
      ].join(' ');
    case 'eli5':
      return [
        'Explain the user input like I am five years old.',
        'Use simple words and short sentences. Avoid jargon; if you must use it, define it simply.',
        'Prefer concrete examples or analogies.',
        'Keep it brief: one or two short paragraphs.',
        'End with a single-sentence summary that begins with "In short:".'
      ].join(' ');
    case 'debate_lord':
      return [
        'You are Debate Lord — a concise, strategic debate coach and sparring partner.',
        'Before anything else, ensure you know all three: mode ("train" or "debate"), side ("for" or "against"), and the topic.',
        'If any are missing, ask only for what is missing in a single, crisp question. Do not provide arguments until all three are known.',
        'TRAINING MODE: teach in bite-size steps. For each step: 1–2 supporting arguments with brief justification or evidence; 1–2 likely counters; and crisp rebuttals. Optionally add a tactic or phrasing.',
        'Keep it short (about 120–180 words). End with a one-line prompt to continue (e.g., "Want another tactic?").',
        'DEBATE MODE: short-form sparring. Reply in 2–5 sentences max; be direct and confident. Attack weaknesses and defend your side; occasionally ask a sharp probing question.',
        'General: be factual and avoid fabricating sources; do not browse unless explicitly asked.'
      ].join(' ');
    case 'big_brain':
      return [
        'You are a meticulous, high-reasoning assistant.',
        'Reason carefully internally. Provide a concise, well-structured final answer.'
      ].join(' ');
    case 'coder':
      return [
        'You are a senior coding assistant. Return only JSON with the following schema:',
        '{ "format": "coder_blocks_v1", "blocks": [ { "type": "paragraph", "text": "..." }, { "type": "code", "language": "<language>", "filename": "<optional>", "code": "<code-without-backticks>" } ] }',
        'Rules:',
        '- Output strictly valid JSON. No Markdown fences or backticks. No surrounding prose.',
        '- Prefer multiple small code blocks over one huge block.',
        '- Use language keys compatible with highlight.js common languages (e.g., javascript, typescript, python, bash, json, html, css, markdown, java, csharp, go, rust, php, ruby, kotlin, swift, sql, yaml, dockerfile).',
        '- If you include a filename, keep it simple (e.g., "index.html").',
        '- Keep paragraphs brief and technical.',
        'Do not browse the web or include URLs unless asked.'
      ].join(' ');
    default:
      return 'You are a helpful assistant.';
  }
}

async function callPreferredModels({ reasoning, messages, prefer, model, webSearch, maxTokens }) {
  // prefer is an array of provider ids in order; default to OpenAI only
  const attempts = Array.isArray(prefer) && prefer.length ? prefer : ['openai'];

  const params = {
    messages,
    reasoningLevel: reasoning,
    temperature: config.openai.defaultTemperature,
    maxTokens: (Number.isFinite(maxTokens) ? maxTokens : config.openai.defaultMaxTokens),
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
    const effectiveWebSearch = (typeof webSearch === 'boolean') 
      ? webSearch 
      : !!(MODE_SPECS[mode] && MODE_SPECS[mode].defaultSearch);

    // Compose final message list
    const finalMessages = [systemMsg, ...userMessages];

    // Provider preference: force OpenAI
    const prefer = ['openai'];

    // Call provider with optional model override and provider web search toggle
    const response = await callPreferredModels({
        reasoning: spec.reasoning,
        messages: finalMessages,
        prefer,
        model: spec.model,
        webSearch: effectiveWebSearch,
        maxTokens: (spec && spec.maxOutputTokens) ? spec.maxOutputTokens : undefined
      });

    // Ensure Coder mode returns strict JSON for client-side rendering
    let assistantContent = response.text || '';
    if (mode === 'coder') {
      try {
        let t = String(assistantContent || '').trim();
        // Strip common triple-fence wrappers if model ignored instructions
        if (/^```/m.test(t)) {
          t = t.replace(/^```[a-zA-Z0-9_-]*\s*\n?/, '').replace(/```$/, '');
        }
        const parsed = JSON.parse(t);
        // Basic shape guard for our UI renderer
        if (parsed && parsed.format === 'coder_blocks_v1' && Array.isArray(parsed.blocks)) {
          assistantContent = JSON.stringify(parsed);
        } else {
          throw new Error('Invalid coder_blocks_v1 shape');
        }
      } catch {
        // Fallback: wrap raw output into a minimal valid schema
        const fallback = {
          format: 'coder_blocks_v1',
          blocks: [
            { type: 'paragraph', text: 'Output could not be parsed as JSON; showing raw content as text.' },
            { type: 'code', language: 'text', filename: null, code: String(assistantContent || '') }
          ]
        };
        assistantContent = JSON.stringify(fallback);
      }
    }

    const payload = {
      message: { role: 'assistant', content: assistantContent },
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