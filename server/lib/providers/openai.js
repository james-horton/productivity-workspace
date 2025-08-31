const axios = require('axios');
const { config } = require('../../config');

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

function resolveOpenAIModel(requestedModel, reasoningLevel) {
  if (requestedModel) return requestedModel;
  // Default to GPT-5 for high reasoning and general usage per spec
  if (reasoningLevel === 'high') return 'gpt-5';
  if (reasoningLevel === 'medium') return 'gpt-5';
  return 'gpt-5';
}

/**
 * openaiChat: minimal wrapper around OpenAI Chat Completions
 * @param {Object} params
 * @param {Array<{role: 'system'|'user'|'assistant', content: string}>} params.messages
 * @param {string} [params.model]
 * @param {'high'|'medium'|'low'} [params.reasoningLevel]
 * @param {number} [params.temperature]
 * @param {number} [params.maxTokens]
 * @param {Array<string>} [params.stop]
 * @returns {Promise<{ text: string, raw: any, modelUsed: string }>}
 */
async function openaiChat({ messages, model, reasoningLevel, temperature = 0.7, maxTokens = 800, stop }) {
  const apiKey = config.openai.apiKey;
  if (!apiKey) {
    const err = new Error('OpenAI API key missing');
    err.status = 400;
    throw err;
  }

  const modelToUse = resolveOpenAIModel(model, reasoningLevel);

  try {
    const res = await axios.post(
      OPENAI_API_URL,
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
    // Normalize error
    const status = error.response ? error.response.status : 500;
    const msg = error.response && error.response.data ? JSON.stringify(error.response.data) : error.message;
    const err = new Error(`OpenAI request failed: ${msg}`);
    err.status = status;
    throw err;
  }
}

module.exports = {
  openaiChat,
  resolveOpenAIModel
};