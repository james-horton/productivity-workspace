'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  assertToolCapability,
  createAgentModel,
  isSupportedProvider,
  normalizeOpenAIResponsesBaseURL,
  normalizeOpenRouterChatCompletionsBaseURL,
  normalizeAgentReasoningLevel,
  validateModelSelection,
  validateProviderAndModel,
  validateProviderKey
} = require('../../lib/agent/modelFactory');

const config = {
  openai: {
    apiKey: 'openai-test-key',
    responsesUrl: 'https://openai-proxy.example/custom/v1/responses',
    defaultTemperature: 0.25,
    defaultMaxTokens: 12345,
    timeoutMs: 45678
  },
  openrouter: {
    apiKey: 'openrouter-test-key',
    chatCompletionsUrl: 'https://router-proxy.example/api/v1/chat/completions',
    defaultTemperature: 0.75,
    defaultMaxTokens: 4096,
    timeoutMs: 98765
  }
};

test('normalizes compatible Responses API endpoints to OpenAI base URLs', () => {
  assert.equal(
    normalizeOpenAIResponsesBaseURL('https://api.openai.com/v1/responses'),
    'https://api.openai.com/v1'
  );
  assert.equal(
    normalizeOpenAIResponsesBaseURL('https://proxy.example/openai/v1/responses/'),
    'https://proxy.example/openai/v1'
  );
  assert.throws(
    () => normalizeOpenAIResponsesBaseURL('https://proxy.example/v1/chat/completions'),
    error => error.code === 'INCOMPATIBLE_PROVIDER_ENDPOINT'
  );
  assert.throws(
    () => normalizeOpenAIResponsesBaseURL('not a URL'),
    error => error.code === 'INVALID_PROVIDER_ENDPOINT'
  );
});

test('normalizes the configured OpenRouter operation endpoint', () => {
  assert.equal(
    normalizeOpenRouterChatCompletionsBaseURL('https://openrouter.ai/api/v1/chat/completions'),
    'https://openrouter.ai/api/v1'
  );
});

test('recognizes only exact supported provider identifiers', () => {
  assert.equal(isSupportedProvider('openai'), true);
  assert.equal(isSupportedProvider('openrouter'), true);
  assert.equal(isSupportedProvider('OpenAI'), false);
  assert.equal(isSupportedProvider('openai '), false);
  assert.equal(isSupportedProvider('deepseek'), false);

  assert.deepEqual(validateProviderAndModel('openai', '  gpt-5.6-sol  '), {
    provider: 'openai',
    model: 'gpt-5.6-sol'
  });
  assert.throws(
    () => validateProviderAndModel('OpenAI', 'gpt-5.6-sol'),
    error => error.code === 'UNSUPPORTED_PROVIDER' && error.status === 400
  );
  assert.throws(
    () => validateProviderAndModel('openai', '  '),
    error => error.code === 'INVALID_MODEL' && error.status === 400
  );
});

test('requires explicit tool-calling capability', () => {
  assert.doesNotThrow(() => assertToolCapability(true, 'openrouter', 'vendor/model'));
  assert.throws(
    () => assertToolCapability(false, 'openrouter', 'vendor/model'),
    error => {
      assert.equal(error.code, 'UNSUPPORTED_TOOL_CAPABILITY');
      assert.equal(error.status, 400);
      assert.match(error.message, /openrouter:vendor\/model/);
      assert.match(error.message, /tool calling/);
      return true;
    }
  );
  assert.throws(
    () => validateModelSelection({ provider: 'openai', model: 'gpt-5.6-sol' }),
    error => error.code === 'UNSUPPORTED_TOOL_CAPABILITY'
  );
});

test('validates the key for the exact selected provider', () => {
  assert.equal(validateProviderKey('openai', config), config.openai);
  assert.equal(validateProviderKey('openrouter', config), config.openrouter);
  assert.throws(
    () => validateProviderKey('openai', { openai: { apiKey: ' ' } }),
    error => error.code === 'MISSING_PROVIDER_KEY' && /OpenAI/.test(error.message)
  );
  assert.throws(
    () => validateProviderKey('openrouter', { openrouter: {} }),
    error => error.code === 'MISSING_PROVIDER_KEY' && /OpenRouter/.test(error.message)
  );
});

test('builds ChatOpenAI for the exact model with Responses API settings', () => {
  let received;
  class FakeChatOpenAI {
    constructor(options) {
      received = options;
    }
  }

  const model = createAgentModel(
    { provider: 'openai', model: 'gpt-5.6-sol', supportsToolCalling: true },
    { config, dependencies: { ChatOpenAI: FakeChatOpenAI } }
  );

  assert.ok(model instanceof FakeChatOpenAI);
  assert.deepEqual(received, {
    model: 'gpt-5.6-sol',
    apiKey: 'openai-test-key',
    useResponsesApi: true,
    temperature: 0.25,
    maxTokens: 12345,
    timeout: 45678,
    reasoning: { effort: 'high' },
    configuration: {
      baseURL: 'https://openai-proxy.example/custom/v1'
    }
  });
});

test('builds ChatOpenRouter without requiring every optional parameter', () => {
  let received;
  let runnableConfig;
  class FakeChatOpenRouter {
    constructor(options) {
      received = options;
    }

    withConfig(config) {
      runnableConfig = config;
      return this;
    }
  }

  const model = createAgentModel(
    { provider: 'openrouter', model: 'anthropic/claude-sonnet', supportsToolCalling: true },
    { config, dependencies: { ChatOpenRouter: FakeChatOpenRouter } }
  );

  assert.ok(model instanceof FakeChatOpenRouter);
  assert.deepEqual(received, {
    model: 'anthropic/claude-sonnet',
    apiKey: 'openrouter-test-key',
    baseURL: 'https://router-proxy.example/api/v1',
    temperature: 0.75,
    maxTokens: 4096,
    modelKwargs: {
      reasoning: { effort: 'high', exclude: true }
    },
    provider: {
      allow_fallbacks: false,
      require_parameters: false
    }
  });
  assert.deepEqual(runnableConfig, { timeout: 98765 });
  assert.equal('models' in received, false);
  assert.equal('route' in received, false);
});

test('uses the configured Agent reasoning level for both provider adapters', () => {
  let openaiReceived;
  class FakeChatOpenAI {
    constructor(options) {
      openaiReceived = options;
    }
  }
  createAgentModel(
    { provider: 'openai', model: 'gpt-5.6-sol', supportsToolCalling: true },
    {
      config: { ...config, agent: { reasoningLevel: 'low' } },
      dependencies: { ChatOpenAI: FakeChatOpenAI }
    }
  );
  assert.deepEqual(openaiReceived.reasoning, { effort: 'low' });

  let openrouterReceived;
  class FakeChatOpenRouter {
    constructor(options) {
      openrouterReceived = options;
    }
  }
  createAgentModel(
    { provider: 'openrouter', model: 'vendor/model', supportsToolCalling: true },
    {
      config: { ...config, agent: { reasoningLevel: 'medium' } },
      dependencies: { ChatOpenRouter: FakeChatOpenRouter }
    }
  );
  assert.deepEqual(openrouterReceived.modelKwargs.reasoning, { effort: 'medium', exclude: true });
});

test('falls back to high Agent reasoning when the configured level is invalid', () => {
  let received;
  class FakeChatOpenAI {
    constructor(options) {
      received = options;
    }
  }
  createAgentModel(
    { provider: 'openai', model: 'gpt-5.6-sol', supportsToolCalling: true },
    {
      config: { ...config, agent: { reasoningLevel: 'invalid' } },
      dependencies: { ChatOpenAI: FakeChatOpenAI }
    }
  );
  assert.deepEqual(received.reasoning, { effort: 'high' });
  assert.equal(normalizeAgentReasoningLevel(undefined), 'high');
  assert.equal(normalizeAgentReasoningLevel('HIGH'), 'high');
});

test('fails validation before constructing or loading an adapter', () => {
  let constructed = false;
  class UnexpectedAdapter {
    constructor() {
      constructed = true;
    }
  }

  assert.throws(
    () => createAgentModel(
      { provider: 'openai', model: 'gpt-5.6-sol', supportsToolCalling: false },
      { config, dependencies: { ChatOpenAI: UnexpectedAdapter } }
    ),
    error => error.code === 'UNSUPPORTED_TOOL_CAPABILITY'
  );
  assert.equal(constructed, false);
});
