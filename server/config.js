/* config.js: loads secrets.json (one level up) or env fallback */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const AGENT_REASONING_LEVELS = new Set(['low', 'medium', 'high']);

function normalizeAgentReasoningLevel(value) {
  const normalized = String(value == null ? '' : value).trim().toLowerCase();
  return AGENT_REASONING_LEVELS.has(normalized) ? normalized : 'high';
}

function configBoolean(envValue, jsonValue, fallback) {
  const value = envValue !== undefined ? envValue : jsonValue;
  if (typeof value === 'boolean') return value;
  if (value == null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function positiveInteger(envValue, jsonValue, fallback) {
  const value = envValue !== undefined ? envValue : jsonValue;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function resolveProjectPath(value, fallback) {
  const configuredPath = String(value || fallback).trim() || fallback;
  return path.isAbsolute(configuredPath)
    ? path.normalize(configuredPath)
    : path.resolve(PROJECT_ROOT, configuredPath);
}

function loadSecrets() {
  const secretsPath = path.resolve(__dirname, '..', 'secrets.json');
  let json = {};
  try {
    const buf = fs.readFileSync(secretsPath, 'utf8');
    json = JSON.parse(buf);
    console.log(`[config] Loaded secrets.json from ${secretsPath}`);
  } catch (err) {
    console.warn(`[config] secrets.json not found or unreadable at ${secretsPath}. Falling back to environment variables.`);
  }

  const allowedOrigins =
    (json.cors && Array.isArray(json.cors.allowedOrigins) && json.cors.allowedOrigins.length > 0)
      ? json.cors.allowedOrigins
      : (process.env.CORS_ALLOWED_ORIGINS ? process.env.CORS_ALLOWED_ORIGINS.split(',') : [
          'http://localhost:8787',
          'http://localhost:3000',
          'http://localhost:5173'
        ]);

  // News domain allowlist (can be overridden by env or secrets.json)
  const newsAllowedSources =
    (json.news && Array.isArray(json.news.allowedSources) && json.news.allowedSources.length > 0)
      ? json.news.allowedSources
      : (process.env.NEWS_ALLOWED_SOURCES
          ? process.env.NEWS_ALLOWED_SOURCES.split(',').map(s => s.trim()).filter(Boolean)
          : ['apnews.com', 'cnn.com', 'foxnews.com', 'meidastouch.com', 'msnbc.com']);

  const agentConfig = (json.agent && typeof json.agent === 'object') ? json.agent : {};

  return {
    openai: {
      apiKey: (json.openai && json.openai.apiKey) || process.env.OPENAI_API_KEY || '',
      responsesUrl: (json.openai && json.openai.responsesUrl) || process.env.OPENAI_RESPONSES_URL || 'https://api.openai.com/v1/responses',
      defaultTemperature: Number(process.env.OPENAI_DEFAULT_TEMPERATURE || (json.openai && json.openai.defaultTemperature) || 1),
      defaultMaxTokens: parseInt(process.env.OPENAI_DEFAULT_MAX_TOKENS || (json.openai && json.openai.defaultMaxTokens) || '80000', 10),
      timeoutMs: parseInt(process.env.OPENAI_TIMEOUT_MS || (json.openai && json.openai.timeoutMs) || '300000', 10)
    },
    openrouter: {
      apiKey: (json.openrouter && json.openrouter.apiKey) || process.env.OPENROUTER_API_KEY || '',
      chatCompletionsUrl: (json.openrouter && json.openrouter.chatCompletionsUrl) || process.env.OPENROUTER_CHAT_COMPLETIONS_URL || 'https://openrouter.ai/api/v1/chat/completions',
      modelsUrl: (json.openrouter && json.openrouter.modelsUrl) || process.env.OPENROUTER_MODELS_URL || 'https://openrouter.ai/api/v1/models',
      modelsUserUrl: (json.openrouter && json.openrouter.modelsUserUrl) || process.env.OPENROUTER_MODELS_USER_URL || 'https://openrouter.ai/api/v1/models/user',
      defaultModel: (json.openrouter && json.openrouter.defaultModel) || process.env.OPENROUTER_DEFAULT_MODEL || '',
      defaultTemperature: Number(process.env.OPENROUTER_DEFAULT_TEMPERATURE || (json.openrouter && json.openrouter.defaultTemperature) || 0.7),
      defaultMaxTokens: parseInt(process.env.OPENROUTER_DEFAULT_MAX_TOKENS || (json.openrouter && json.openrouter.defaultMaxTokens) || '4000', 10),
      timeoutMs: parseInt(process.env.OPENROUTER_TIMEOUT_MS || (json.openrouter && json.openrouter.timeoutMs) || '120000', 10),
      favoriteModels: Array.isArray(json.openrouter && json.openrouter.favoriteModels)
        ? json.openrouter.favoriteModels
        : (process.env.OPENROUTER_FAVORITE_MODELS
            ? process.env.OPENROUTER_FAVORITE_MODELS.split(',').map(s => s.trim()).filter(Boolean)
            : [])
    },
    tavily: {
      apiKey: (json.tavily && json.tavily.apiKey) || process.env.TAVILY_API_KEY || '',
      url: (json.tavily && json.tavily.url) || process.env.TAVILY_URL || 'https://api.tavily.com/search',
      maxResults: parseInt(process.env.TAVILY_MAX_RESULTS || (json.tavily && json.tavily.maxResults) || '6', 10),
      includeAnswer: String(
        process.env.TAVILY_INCLUDE_ANSWER ||
        ((json.tavily && json.tavily.includeAnswer) != null ? json.tavily.includeAnswer : 'false')
      ) === 'true',
      searchDepth: (json.tavily && json.tavily.searchDepth) || process.env.TAVILY_SEARCH_DEPTH || 'advanced',
      timeoutMs: parseInt(process.env.TAVILY_TIMEOUT_MS || (json.tavily && json.tavily.timeoutMs) || '30000', 10)
    },
    news: {
      allowedSources: newsAllowedSources,
      maxItems: parseInt(process.env.NEWS_MAX_ITEMS || (json.news && json.news.maxItems) || '6', 10),
      excerptLen: parseInt(process.env.NEWS_EXCERPT_LEN || (json.news && json.news.excerptLen) || '400', 10),
      naiveSummaryLen: parseInt(process.env.NEWS_NAIVE_SUMMARY_LEN || (json.news && json.news.naiveSummaryLen) || '220', 10),
      summarizerModel: (json.news && json.news.summarizerModel) || process.env.NEWS_SUMMARIZER_MODEL || 'gpt-5-mini',
      summarizerReasoning: (json.news && json.news.summarizerReasoning) || process.env.NEWS_SUMMARIZER_REASONING || 'medium'
    },
    reddit: {
      baseUrl: (json.reddit && json.reddit.baseUrl) || process.env.REDDIT_BASE_URL || 'https://www.reddit.com',
      defaultLimit: parseInt(process.env.REDDIT_DEFAULT_LIMIT || (json.reddit && json.reddit.defaultLimit) || '6', 10),
      maxLimit: parseInt(process.env.REDDIT_MAX_LIMIT || (json.reddit && json.reddit.maxLimit) || '25', 10),
      timeoutMs: parseInt(process.env.REDDIT_TIMEOUT_MS || (json.reddit && json.reddit.timeoutMs) || '10000', 10),
      userAgent: (json.reddit && json.reddit.userAgent) || process.env.REDDIT_USER_AGENT || 'WorkspaceAI/0.1 (+https://localhost)'
    },
    cors: {
      allowedOrigins
    },
    server: {
      // Prefer env PORT to allow overriding secrets.json during local dev
      port: parseInt(process.env.PORT || (json.server && json.server.port) || '8787', 10),
      // HTTPS configuration
      https: {
        enabled: (json.server && json.server.https && json.server.https.enabled !== undefined)
          ? json.server.https.enabled
          : (process.env.HTTPS_ENABLED === 'true'),
        port: parseInt(process.env.HTTPS_PORT || (json.server && json.server.https && json.server.https.port) || '8443', 10),
        key: (json.server && json.server.https && json.server.https.key) || process.env.HTTPS_KEY_PATH || '',
        cert: (json.server && json.server.https && json.server.https.cert) || process.env.HTTPS_CERT_PATH || ''
      }
    },
    updater: {
      // Update check interval in minutes (default: 5 minutes)
      checkIntervalMinutes: parseInt(process.env.UPDATER_CHECK_INTERVAL_MINUTES || (json.updater && json.updater.checkIntervalMinutes) || '5', 10),
      // PM2 process name to restart after update
      pm2ProcessName: (json.updater && json.updater.pm2ProcessName) || process.env.UPDATER_PM2_PROCESS_NAME || 'workspace-ai'
    },
    agent: {
      enabled: configBoolean(process.env.AGENT_ENABLED, agentConfig.enabled, true),
      localOnly: configBoolean(process.env.AGENT_LOCAL_ONLY, agentConfig.localOnly, true),
      allowYolo: configBoolean(process.env.AGENT_ALLOW_YOLO, agentConfig.allowYolo, true),
      reasoningLevel: normalizeAgentReasoningLevel(
        process.env.AGENT_REASONING_LEVEL !== undefined
          ? process.env.AGENT_REASONING_LEVEL
          : agentConfig.reasoningLevel
      ),
      projectRoot: PROJECT_ROOT,
      dbPath: resolveProjectPath(process.env.AGENT_DB_PATH || agentConfig.dbPath, 'agent.sqlite'),
      commandTimeoutMs: positiveInteger(process.env.AGENT_COMMAND_TIMEOUT_MS, agentConfig.commandTimeoutMs, 600000),
      maxOutputBytes: positiveInteger(process.env.AGENT_MAX_OUTPUT_BYTES, agentConfig.maxOutputBytes, 1024 * 1024),
      requestMaxLength: positiveInteger(process.env.AGENT_REQUEST_MAX_LENGTH, agentConfig.requestMaxLength, 20000),
      commandMaxLength: positiveInteger(process.env.AGENT_COMMAND_MAX_LENGTH, agentConfig.commandMaxLength, 20000),
      maxActionsPerApproval: positiveInteger(process.env.AGENT_MAX_ACTIONS_PER_APPROVAL, agentConfig.maxActionsPerApproval, 32),
      retentionDays: positiveInteger(process.env.AGENT_RETENTION_DAYS, agentConfig.retentionDays, 30),
      maxRuns: positiveInteger(process.env.AGENT_MAX_RUNS, agentConfig.maxRuns, 100),
      maxEventsPerRun: positiveInteger(process.env.AGENT_MAX_EVENTS_PER_RUN, agentConfig.maxEventsPerRun, 2000)
    },
    userSettings: {
      theme: (json.userSettings && typeof json.userSettings.theme === 'string') ? json.userSettings.theme : 'matrix',
      openaiModel: (json.userSettings && ['gpt-5.6-sol', 'gpt-6-astra'].includes(json.userSettings.openaiModel))
        ? json.userSettings.openaiModel
        : 'gpt-5.6-sol',
      city: (json.userSettings && typeof json.userSettings.city === 'string') ? json.userSettings.city : '',
      state: (json.userSettings && typeof json.userSettings.state === 'string') ? json.userSettings.state.toUpperCase() : '',
      subreddits: (json.userSettings && Array.isArray(json.userSettings.subreddits))
        ? json.userSettings.subreddits.slice(0, 10).map(s => String(s || ''))
        : [],
      showInspirationQuote: (json.userSettings && typeof json.userSettings.showInspirationQuote === 'boolean')
        ? json.userSettings.showInspirationQuote
        : true,
      showCalculator: (json.userSettings && typeof json.userSettings.showCalculator === 'boolean')
        ? json.userSettings.showCalculator
        : true,
      showClock: (json.userSettings && typeof json.userSettings.showClock === 'boolean')
        ? json.userSettings.showClock
        : true,
      clockView: (json.userSettings && json.userSettings.clockView === 'analog')
        ? 'analog-marks'
        : (json.userSettings && ['digital', 'analog-marks', 'analog-quarters', 'analog-numerals', 'analog-roman-numerals'].includes(json.userSettings.clockView))
          ? json.userSettings.clockView
          : 'digital',
      showAnalogClockFrame: (json.userSettings && typeof json.userSettings.showAnalogClockFrame === 'boolean')
        ? json.userSettings.showAnalogClockFrame
        : true,
      analogClockFrameWidth: (json.userSettings && Number.isFinite(Number(json.userSettings.analogClockFrameWidth)))
        ? Math.max(1, Math.min(10, Math.round(Number(json.userSettings.analogClockFrameWidth))))
        : 10,
      showWebSearch: (json.userSettings && typeof json.userSettings.showWebSearch === 'boolean')
        ? json.userSettings.showWebSearch
        : true,
      showNews: (json.userSettings && typeof json.userSettings.showNews === 'boolean')
        ? json.userSettings.showNews
        : true,
      showReddit: (json.userSettings && typeof json.userSettings.showReddit === 'boolean')
        ? json.userSettings.showReddit
        : false,
      showAgent: (json.userSettings && typeof json.userSettings.showAgent === 'boolean')
        ? json.userSettings.showAgent
        : true,
      roundedBorders: (json.userSettings && typeof json.userSettings.roundedBorders === 'boolean')
        ? json.userSettings.roundedBorders
        : true
    }
  };
}

const config = loadSecrets();

module.exports = { config, normalizeAgentReasoningLevel };
