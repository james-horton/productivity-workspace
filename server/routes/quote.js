const express = require('express');
const router = express.Router();

const { openaiChat } = require('../lib/providers/openai');

function themeSystemPrompt(theme) {
  const groups = [
    'activists',
    'actors',
    'artists',
    'athletes',
    'authors',
    'books',
    'celebrities',
    'comedians',
    'cooks',
    'designers',
    'engineers',
    'entrepreneurs',
    'explorers',
    'gamers',
    'intellectuals',
    'inventors',
    'leaders',
    'musicians',
    'philosophers',
    'poets',
    'presidents',
    'scientists',
    'teachers',
    'tv',
    'youtubers'
  ];

  const adjectives = [
    'brilliant',
    'creative',
    'eloquent',
    'empowering',
    'encouraging',
    'funny',
    'humorous',
    'inspirational',
    'insightful',
    'meaningful',
    'motivational',
    'profound',
    'thought-provoking',
    'uplifting',
    'visionary',
    'wise'
  ];

  const randomGroup = groups[Math.floor(Math.random() * groups.length)];
  const randomAdjective = adjectives[Math.floor(Math.random() * adjectives.length)];

  return [
    `You share a random, authentic, and short ${randomAdjective} quote from ${randomGroup}.`,
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