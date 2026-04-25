const axios = require('axios');
const { config } = require('../../config');

function resolveOpenRouterModel(requestedModel) {
  if (requestedModel) return requestedModel;
  return config.openrouter.defaultModel || 'openai/gpt-5.5';
}

/**
 * openrouterChat: wrapper around OpenRouter's OpenAI-compatible Chat Completions API.
 * @param {Object} params
 * @param {Array<{role: 'system'|'user'|'assistant', content: string}>} params.messages
 * @param {string} [params.model]
 * @param {number} [params.temperature]
 * @param {number} [params.maxTokens]
 * @param {Array<string>} [params.stop]
 * @returns {Promise<{ text: string, raw: any, modelUsed: string }>}
 */
async function openrouterChat({
  messages,
  model,
  temperature = (config.openrouter && config.openrouter.defaultTemperature != null ? config.openrouter.defaultTemperature : 0.7),
  maxTokens = (config.openrouter && config.openrouter.defaultMaxTokens ? config.openrouter.defaultMaxTokens : 4000),
  stop
}) {
  const apiKey = config.openrouter && config.openrouter.apiKey;

  if (!apiKey) {
    const err = new Error('OpenRouter API key missing');
    err.status = 400;
    throw err;
  }

  const modelToUse = resolveOpenRouterModel(model);
  const payload = {
    model: modelToUse,
    messages: Array.isArray(messages) ? messages : []
  };

  if (Number.isFinite(temperature)) payload.temperature = temperature;
  if (Number.isFinite(maxTokens)) payload.max_tokens = maxTokens;
  if (stop && Array.isArray(stop) && stop.length) payload.stop = stop;

  try {
    console.log(`[openrouterChat] POST ${config.openrouter.chatCompletionsUrl} model=${modelToUse}`);
    const startedResp = Date.now();
    const res = await axios.post(
      config.openrouter.chatCompletionsUrl,
      payload,
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: (config.openrouter && config.openrouter.timeoutMs) || 120000
      }
    );

    console.log(`[openrouterChat] Chat completions completed in ${Date.now() - startedResp}ms`);

    const data = res.data || {};
    const choice = data.choices && data.choices[0];
    const message = choice && choice.message;
    let content = message && message.content;

    if (Array.isArray(content)) {
      content = content.map(part => {
        if (!part) return '';
        if (typeof part === 'string') return part;
        if (typeof part.text === 'string') return part.text;
        if (typeof part.content === 'string') return part.content;
        return '';
      }).join('');
    }

    const text = typeof content === 'string' ? content.trim() : '';
    return { text, raw: data, modelUsed: data.model || modelToUse };
  } catch (error) {
    const status = error.response ? error.response.status : 500;
    const msg = error.response && error.response.data ? JSON.stringify(error.response.data) : error.message;
    const err = new Error(`OpenRouter request failed: ${msg}`);
    err.status = status;
    throw err;
  }
}

module.exports = {
  openrouterChat,
  resolveOpenRouterModel
};
