const express = require('express');
const router = express.Router();

const { openaiChat } = require('../lib/providers/openai');

function themeSystemPrompt(theme) {
  const groups = [
    'activists',
    'actors',
    'architects',
    'artists',
    'athletes',
    'authors',
    'biologists',
    'bloggers',
    'books',
    'celebrities',
    'chemists',
    'comedians',
    'composers',
    'cooks',
    'dancers',
    'designers',
    'directors',
    'doctors',
    'economists',
    'engineers',
    'entrepreneurs',
    'environmentalists',
    'explorers',
    'filmmakers',
    'gamers',
    'historians',
    'intellectuals',
    'inventors',
    'journalists',
    'lawyers',
    'leaders',
    'mathematicians',
    'musicians',
    'novelists',
    'philosophers',
    'photographers',
    'physicists',
    'podcasters',
    'poets',
    'presidents',
    'programmers',
    'scientists',
    'teachers',
    'tv',
    'youtubers'
  ];

  const adjectives = [
    'astute',
    'brilliant',
    'candid',
    'captivating',
    'clever',
    'compelling',
    'concise',
    'creative',
    'deep',
    'eloquent',
    'empowering',
    'encouraging',
    'evocative',
    'funny',
    'heartfelt',
    'humorous',
    'impactful',
    'incisive',
    'insightful',
    'inspirational',
    'lucid',
    'lyrical',
    'meaningful',
    'memorable',
    'motivational',
    'poignant',
    'profound',
    'reflective',
    'resonant',
    'sagacious',
    'thought-provoking',
    'timeless',
    'uplifting',
    'visionary',
    'wise',
    'witty'
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