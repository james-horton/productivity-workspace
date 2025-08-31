const express = require('express');
const router = express.Router();

const { openaiChat } = require('../lib/providers/openai');
const { deepseekChat } = require('../lib/providers/deepseek');

function themeSystemPrompt(theme) {
  if (theme === 'matrix') {
    return [
      'You generate a single short inspirational quote in a Matrix-like vibe: neon-cyberpunk, code, rebellion, waking up, agency, clarity.',
      'Audience: Gen Z. Avoid cringe, clichés, and boomer energy. Keep it sharp, modern, and grounded.',
      'Length: one sentence or a very short paragraph (max ~45 words).',
      'No attribution, no emojis, no hashtags.'
    ].join(' ');
  }
  // Dark and Aurora (general inspirational)
  return [
    'You generate a single short inspirational quote tailored for Gen Z: concise, modern, authentic, not cheesy.',
    'Tone: encouraging and practical; no clichés, no hustle-porn.',
    'Length: one sentence or a very short paragraph (max ~45 words).',
    'No attribution, no emojis, no hashtags.'
  ].join(' ');
}

async function callLLMWithFallback(messages, reasoningLevel = 'medium') {
  // Prefer OpenAI, then DeepSeek, but gracefully fall back if key missing
  try {
    const res = await openaiChat({ messages, reasoningLevel, temperature: 0.8, maxTokens: 120 });
    return { ...res, provider: 'openai' };
  } catch (err) {
    if (err && err.status === 400 && /key missing/i.test(err.message)) {
      const res = await deepseekChat({ messages, reasoningLevel, temperature: 0.8, maxTokens: 120 });
      return { ...res, provider: 'deepseek' };
    }
    throw err;
  }
}

router.post('/', async (req, res, next) => {
  try {
    const { theme = 'aurora' } = req.body || {};

    // Randomizer: inject a small seed to encourage variation
    const seed = Math.floor(Math.random() * 10_000);
    const sys = themeSystemPrompt((theme || '').toLowerCase());

    const messages = [
      { role: 'system', content: sys },
      { role: 'system', content: `Creative-variation-seed: ${seed}` },
      { role: 'user', content: 'Generate the quote now.' }
    ];

    const out = await callLLMWithFallback(messages, theme === 'matrix' ? 'high' : 'medium');

    res.json({
      quote: out.text,
      providerUsed: out.provider,
      modelUsed: out.modelUsed
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;