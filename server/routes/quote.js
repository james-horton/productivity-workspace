const express = require('express');
const router = express.Router();

const { openaiChat } = require('../lib/providers/openai');

function themeSystemPrompt(theme) {
  return [
    'You share a random, authentic, and short inspirational quote.',
    'Include the name of the author at the end of the quote.'
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
      model: 'gpt-5',
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