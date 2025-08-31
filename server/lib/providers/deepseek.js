const axios = require('axios');
const { config } = require('../../config');

const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions';

function resolveDeepSeekModel(requestedModel, reasoningLevel) {
  if (requestedModel) return requestedModel; // e.g., 'deepseek-reasoner' or 'deepseek-chat'
  if (reasoningLevel === 'high') return 'deepseek-reasoner';
  if (reasoningLevel === 'medium') return 'deepseek-chat';
  return 'deepseek-chat';
}

/**
 * deepseekChat: wrapper around DeepSeek chat completions
 * @param {Object} params
 * @param {Array<{role: 'system'|'user'|'assistant', content: string}>} params.messages
 * @param {string} [params.model]
 * @param {'high'|'medium'|'low'} [params.reasoningLevel]
 * @param {number} [params.temperature]
 * @param {number} [params.maxTokens]
 * @param {Array<string>} [params.stop]
 * @returns {Promise<{ text: string, raw: any, modelUsed: string }>}
 */
async function deepseekChat({ messages, model, reasoningLevel, temperature = 0.7, maxTokens = 800, stop }) {
  const apiKey = config.deepseek.apiKey;
  if (!apiKey) {
    const err = new Error('DeepSeek API key missing');
    err.status = 400;
    throw err;
  }

  const modelToUse = resolveDeepSeekModel(model, reasoningLevel);

  try {
    const res = await axios.post(
      DEEPSEEK_API_URL,
      {
        model: modelToUse,
        messages,
        temperature,
        max_tokens: maxTokens,
        stop
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      }
    );

    const choice = res.data && res.data.choices && res.data.choices[0];
    const text = (choice && choice.message && choice.message.content || '').trim();

    return { text, raw: res.data, modelUsed: modelToUse };
  } catch (error) {
    const status = error.response ? error.response.status : 500;
    const msg = error.response && error.response.data ? JSON.stringify(error.response.data) : error.message;
    const err = new Error(`DeepSeek request failed: ${msg}`);
    err.status = status;
    throw err;
  }
}

module.exports = {
  deepseekChat,
  resolveDeepSeekModel
};