const axios = require('axios');
const { config } = require('../../config');


const OPENAI_RESPONSES_API_URL = config.openai.responsesUrl || 'https://api.openai.com/v1/responses';

function resolveOpenAIModel(requestedModel, reasoningLevel) {
  if (requestedModel) return requestedModel;
  // Default to GPT-5 for high reasoning and general usage per spec
  if (reasoningLevel === 'high') return 'gpt-5';
  if (reasoningLevel === 'medium') return 'gpt-5';
  return 'gpt-5';
}

/**
 * openaiChat: wrapper around the OpenAI Responses API
 * @param {Object} params
 * @param {Array<{role: 'system'|'user'|'assistant', content: string}>} params.messages
 * @param {string} [params.model]
 * @param {'high'|'medium'|'low'} [params.reasoningLevel] Legacy simple effort level
 * @param {{effort:'low'|'medium'|'high'}} [params.reasoning] Preferred Responses API shape
 * @param {number} [params.temperature]
 * @param {number} [params.maxTokens] Mapped to max_output_tokens
 * @param {Array<string>} [params.stop]
 * @param {boolean} [params.webSearch] Enable built-in web search tool via Responses API
 * @returns {Promise<{ text: string, raw: any, modelUsed: string }>}
 */
async function openaiChat({
  messages,
  model,
  reasoningLevel,
  temperature = (config.openai?.defaultTemperature ?? 1),
  maxTokens = (config.openai?.defaultMaxTokens ?? 80000),
  stop,
  webSearch = false
}) {
  const apiKey = config.openai.apiKey;

  if (!apiKey) {
    const err = new Error('OpenAI API key missing');
    err.status = 400;
    throw err;
  }

  const modelToUse = resolveOpenAIModel(model, reasoningLevel);

  // Convert chat messages into a single transcript for Responses API input
  function toTranscript(msgs) {
    const arr = Array.isArray(msgs) ? msgs : [];
    return arr.map(m => {
      const role = (m && m.role) || 'user';
      const label = role === 'system' ? 'System' : (role === 'assistant' ? 'Assistant' : 'User');
      const content = (m && typeof m.content === 'string') ? m.content : '';
      return `${label}: ${content}`.trim();
    }).filter(Boolean).join('\n\n');
  }

  try {
    // Always use the Responses API (no more Chat Completions)
    const transcript = toTranscript(messages);
    const reasoningPayload = { effort: reasoningLevel };

    const payload = {
      model: modelToUse,
      input: transcript,
      temperature,
      max_output_tokens: maxTokens,
      reasoning: reasoningPayload
    };

    if (stop && Array.isArray(stop) && stop.length) {
      payload.stop = stop;
    }

    if (webSearch) {
      payload.tools = [{ type: 'web_search' }];
      payload.tool_choice = 'auto';
    }

    console.log(
      `[openaiChat] POST ${OPENAI_RESPONSES_API_URL} model=${modelToUse} webSearch=${!!webSearch} ` +
      `reasoning= ${reasoningLevel} ` +
      `keys=${Object.keys(payload).join(',')}${webSearch && payload.tools ? ' tools=' + payload.tools.map(t => t.type).join(',') : ''}`
    );
    const startedResp = Date.now();

    const res = await axios.post(
      OPENAI_RESPONSES_API_URL,
      payload,
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: (config.openai?.timeoutMs || 300000)
      }
    );

    console.log(`[openaiChat] Responses API completed in ${Date.now() - startedResp}ms`);

    const data = res.data || {};
    let text = '';

    if (typeof data.output_text === 'string' && data.output_text.trim()) {
      text = data.output_text.trim();
    } else if (Array.isArray(data.output)) {
      try {
        text = data.output.map(item => {
          if (!item || !Array.isArray(item.content)) return '';
          return item.content.map(part => {
            if (!part) return '';
            if (typeof part.text === 'string') return part.text;
            if (typeof part.output_text === 'string') return part.output_text;
            if (typeof part.content === 'string') return part.content;
            return '';
          }).join('');
        }).join('\n').trim();
      } catch {}
    }

    // Fallback to chat-like shape if present (defensive)
    if (!text && data.choices && data.choices[0] && data.choices[0].message && typeof data.choices[0].message.content === 'string') {
      text = data.choices[0].message.content.trim();
    }

    return { text, raw: data, modelUsed: modelToUse };

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