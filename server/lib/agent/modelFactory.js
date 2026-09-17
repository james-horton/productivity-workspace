'use strict';

const SUPPORTED_PROVIDERS = new Set(['openai', 'openrouter']);
const AGENT_REASONING_LEVELS = new Set(['low', 'medium', 'high']);
const DEFAULT_AGENT_REASONING_LEVEL = 'high';

function normalizeAgentReasoningLevel(value) {
  const normalized = String(value == null ? '' : value).trim().toLowerCase();
  return AGENT_REASONING_LEVELS.has(normalized)
    ? normalized
    : DEFAULT_AGENT_REASONING_LEVEL;
}

class ModelFactoryError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'ModelFactoryError';
    this.code = code;
    this.status = 400;
  }
}

function isSupportedProvider(provider) {
  return typeof provider === 'string' && SUPPORTED_PROVIDERS.has(provider);
}

function validateProviderAndModel(provider, model) {
  if (!isSupportedProvider(provider)) {
    throw new ModelFactoryError(
      `Unsupported Agent model provider: ${String(provider || '(missing)')}`,
      'UNSUPPORTED_PROVIDER'
    );
  }

  if (typeof model !== 'string' || !model.trim()) {
    throw new ModelFactoryError('Agent model is required', 'INVALID_MODEL');
  }

  return { provider, model: model.trim() };
}

function assertToolCapability(supportsToolCalling, provider, model) {
  if (supportsToolCalling !== true) {
    throw new ModelFactoryError(
      `The selected model ${provider}:${model} is not known to support tool calling. Refresh the model list or choose a tool-capable model.`,
      'UNSUPPORTED_TOOL_CAPABILITY'
    );
  }
}

function validateModelSelection(selection) {
  if (!selection || typeof selection !== 'object' || Array.isArray(selection)) {
    throw new ModelFactoryError('Agent model selection is required', 'INVALID_MODEL_SELECTION');
  }

  const validated = validateProviderAndModel(selection.provider, selection.model);
  assertToolCapability(selection.supportsToolCalling, validated.provider, validated.model);
  return validated;
}

function validateProviderKey(provider, appConfig) {
  if (!isSupportedProvider(provider)) {
    throw new ModelFactoryError(
      `Unsupported Agent model provider: ${String(provider || '(missing)')}`,
      'UNSUPPORTED_PROVIDER'
    );
  }

  const providerConfig = appConfig && appConfig[provider];
  const apiKey = providerConfig && providerConfig.apiKey;
  if (typeof apiKey !== 'string' || !apiKey.trim()) {
    const providerName = provider === 'openai' ? 'OpenAI' : 'OpenRouter';
    throw new ModelFactoryError(`${providerName} API key missing`, 'MISSING_PROVIDER_KEY');
  }

  return providerConfig;
}

function normalizeEndpointToBaseURL(endpoint, operationPath, label) {
  if (typeof endpoint !== 'string' || !endpoint.trim()) {
    throw new ModelFactoryError(`${label} endpoint is required`, 'INVALID_PROVIDER_ENDPOINT');
  }

  let parsed;
  try {
    parsed = new URL(endpoint.trim());
  } catch {
    throw new ModelFactoryError(`${label} endpoint must be an absolute URL`, 'INVALID_PROVIDER_ENDPOINT');
  }

  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new ModelFactoryError(`${label} endpoint must be an HTTP(S) URL without credentials`, 'INVALID_PROVIDER_ENDPOINT');
  }

  if (parsed.search || parsed.hash) {
    throw new ModelFactoryError(`${label} endpoint cannot include a query string or fragment`, 'INVALID_PROVIDER_ENDPOINT');
  }

  const pathname = parsed.pathname.replace(/\/+$/, '') || '/';
  if (!pathname.endsWith(operationPath)) {
    throw new ModelFactoryError(
      `${label} endpoint must end with ${operationPath}`,
      'INCOMPATIBLE_PROVIDER_ENDPOINT'
    );
  }

  const basePath = pathname.slice(0, -operationPath.length).replace(/\/+$/, '');
  return `${parsed.origin}${basePath}`;
}

function normalizeOpenAIResponsesBaseURL(responsesUrl) {
  return normalizeEndpointToBaseURL(responsesUrl, '/responses', 'OpenAI Responses API');
}

function normalizeOpenRouterChatCompletionsBaseURL(chatCompletionsUrl) {
  return normalizeEndpointToBaseURL(
    chatCompletionsUrl,
    '/chat/completions',
    'OpenRouter Chat Completions API'
  );
}

function loadAdapter(packageName, exportName) {
  try {
    const dependency = require(packageName);
    if (typeof dependency[exportName] !== 'function') throw new Error(`${exportName} export is unavailable`);
    return dependency[exportName];
  } catch (cause) {
    const error = new Error(`Unable to load ${exportName} from ${packageName}: ${cause.message}`);
    error.name = 'ModelFactoryDependencyError';
    error.code = 'MODEL_ADAPTER_UNAVAILABLE';
    error.status = 500;
    error.cause = cause;
    throw error;
  }
}

function buildOpenAIModel(model, providerConfig, ChatOpenAI, reasoningLevel = DEFAULT_AGENT_REASONING_LEVEL) {
  const ModelClass = ChatOpenAI || loadAdapter('@langchain/openai', 'ChatOpenAI');
  return new ModelClass({
    model,
    apiKey: providerConfig.apiKey,
    useResponsesApi: true,
    temperature: providerConfig.defaultTemperature,
    maxTokens: providerConfig.defaultMaxTokens,
    timeout: providerConfig.timeoutMs,
    reasoning: { effort: normalizeAgentReasoningLevel(reasoningLevel) },
    configuration: {
      baseURL: normalizeOpenAIResponsesBaseURL(providerConfig.responsesUrl)
    }
  });
}

function buildOpenRouterModel(model, providerConfig, ChatOpenRouter, reasoningLevel = DEFAULT_AGENT_REASONING_LEVEL) {
  const ModelClass = ChatOpenRouter || loadAdapter('@langchain/openrouter', 'ChatOpenRouter');
  const instance = new ModelClass({
    model,
    apiKey: providerConfig.apiKey,
    baseURL: normalizeOpenRouterChatCompletionsBaseURL(providerConfig.chatCompletionsUrl),
    temperature: providerConfig.defaultTemperature,
    maxTokens: providerConfig.defaultMaxTokens,
    modelKwargs: {
      reasoning: {
        effort: normalizeAgentReasoningLevel(reasoningLevel),
        exclude: true
      }
    },
    provider: {
      allow_fallbacks: false,
      // Agent defaults include optional fields such as max_tokens, temperature,
      // and reasoning that are not supported by every OpenRouter endpoint.
      // Let OpenRouter omit unsupported fields instead of filtering out all
      // otherwise usable endpoints.
      require_parameters: false
    }
  });

  return typeof instance.withConfig === 'function'
    ? instance.withConfig({ timeout: providerConfig.timeoutMs })
    : instance;
}

function createAgentModel(selection, options = {}) {
  const validated = validateModelSelection(selection);
  const appConfig = options.config || require('../../config').config;
  const providerConfig = validateProviderKey(validated.provider, appConfig);
  const dependencies = options.dependencies || {};
  const reasoningLevel = normalizeAgentReasoningLevel(
    options.reasoningLevel ?? appConfig.agent?.reasoningLevel
  );

  if (validated.provider === 'openai') {
    return buildOpenAIModel(validated.model, providerConfig, dependencies.ChatOpenAI, reasoningLevel);
  }

  return buildOpenRouterModel(validated.model, providerConfig, dependencies.ChatOpenRouter, reasoningLevel);
}

module.exports = {
  ModelFactoryError,
  AGENT_REASONING_LEVELS,
  DEFAULT_AGENT_REASONING_LEVEL,
  assertToolCapability,
  buildOpenAIModel,
  buildOpenRouterModel,
  createAgentModel,
  isSupportedProvider,
  normalizeOpenAIResponsesBaseURL,
  normalizeOpenRouterChatCompletionsBaseURL,
  normalizeAgentReasoningLevel,
  validateModelSelection,
  validateProviderAndModel,
  validateProviderKey
};
