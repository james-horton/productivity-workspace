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
 * @param {number} [params.temperature]
 * @param {number} [params.maxTokens]
 * @param {Array<string>} [params.stop]
 * @param {boolean} [params.webSearch] Enable OpenAI built-in web search tool
 * @returns {Promise<{ text: string, raw: any, modelUsed: string }>}
 */
async function openaiChat({ messages, model, reasoningLevel, temperature = 1, maxTokens = 80000, stop, webSearch = false }) {
  const apiKey = config.openai.apiKey;
  if (!apiKey) {
    const err = new Error('OpenAI API key missing');
    err.status = 400;
    throw err;
  }

  const modelToUse = resolveOpenAIModel(model, reasoningLevel);

  try {
    const payload = {
      model: modelToUse,
      messages,
      temperature,
      max_completion_tokens: maxTokens,
      stop
    };

    // Enable built-in web search per OpenAI API:
    // docs: pass tools: [{ type: 'web_search' }] and tool_choice: 'auto'
    if (webSearch) {
      payload.tools = [{ type: 'web_search' }];
      payload.tool_choice = 'auto';
    }

    const res = await axios.post(
      OPENAI_API_URL,
      payload,
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
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