const axios = require('axios');
const { config } = require('../../config');

function resolveOpenRouterModel(requestedModel) {
  if (requestedModel) return requestedModel;
  return config.openrouter.defaultModel || 'openai/gpt-5.5';
}

/**
 * Map our internal reasoning levels (minimal/low/medium/high/xhigh) to OpenRouter's
 * unified `reasoning` request object. OpenRouter accepts `effort: 'minimal'|'low'|'medium'|'high'`
 * for OpenAI-style models and forwards an equivalent to other providers' native reasoning controls.
 *
 * - 'minimal' and 'low' / 'medium' / 'high' map straight through.
 * - 'xhigh' is collapsed to 'high' since OpenRouter's effort enum tops out at 'high'.
 * - Anything else (null/undefined/invalid) returns null so the field is omitted from the payload.
 */
function buildOpenRouterReasoningPayload(reasoningLevel) {
  if (!reasoningLevel || typeof reasoningLevel !== 'string') return null;
  switch (reasoningLevel) {
    case 'minimal': return { effort: 'minimal' };
    case 'low':     return { effort: 'low' };
    case 'medium':  return { effort: 'medium' };
    case 'high':    return { effort: 'high' };
    case 'xhigh':   return { effort: 'high' };
    default:        return null;
  }
}

/**
 * openrouterChat: wrapper around OpenRouter's OpenAI-compatible Chat Completions API.
 * @param {Object} params
 * @param {Array<{role: 'system'|'user'|'assistant', content: string}>} params.messages
 * @param {string} [params.model]
 * @param {number} [params.temperature]
 * @param {number} [params.maxTokens]
 * @param {Array<string>} [params.stop]
 * @param {'minimal'|'low'|'medium'|'high'|'xhigh'} [params.reasoningLevel] Forwarded to OpenRouter's unified `reasoning.effort` field. Has no effect for models that do not support reasoning.
 * @returns {Promise<{ text: string, raw: any, modelUsed: string }>}
 */
async function openrouterChat({
  messages,
  model,
  temperature = (config.openrouter && config.openrouter.defaultTemperature != null ? config.openrouter.defaultTemperature : 0.7),
  maxTokens = (config.openrouter && config.openrouter.defaultMaxTokens ? config.openrouter.defaultMaxTokens : 4000),
  stop,
  reasoningLevel
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

  const reasoningPayload = buildOpenRouterReasoningPayload(reasoningLevel);
  if (reasoningPayload) payload.reasoning = reasoningPayload;

  try {
    const reasoningLog = reasoningPayload ? ` reasoning=${reasoningPayload.effort}` : '';
    console.log(`[openrouterChat] POST ${config.openrouter.chatCompletionsUrl} model=${modelToUse}${reasoningLog}`);
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
  resolveOpenRouterModel,
  buildOpenRouterReasoningPayload
};
