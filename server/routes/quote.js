const express = require('express');
const router = express.Router();

const { openaiChat } = require('../lib/providers/openai');

function themeSystemPrompt(theme) {
  return [
    'You generate a single short inspirational quote that is concise, modern, authentic, not cheesy.',
    'Tone: encouraging and practical; no clichés, no hustle-porn.',
    'Length: one sentence or a very short paragraph (max ~45 words).',
    'No attribution, no emojis, no hashtags.'
  ].join(' ');
}

router.post('/', async (req, res, next) => {
  try {
    const { theme = 'aurora' } = req.body || {};
    const sys = themeSystemPrompt(theme.toLowerCase());

    const messages = [
      { role: 'system', content: sys },
      { role: 'user', content: 'Generate the quote now.' }
    ];

    const out = await openaiChat({ 
      model: 'gpt-5-mini',
      messages, 
      maxTokens: 2000,
      reasoningLevel: 'minimal' 
    });

    res.json({
      quote: out.text,
      providerUsed: 'openai',
      modelUsed: out.modelUsed
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;