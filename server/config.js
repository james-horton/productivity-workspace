/* config.js: loads secrets.json (one level up) or env fallback */

const fs = require('fs');
const path = require('path');

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

  return {
    openai: {
      apiKey: (json.openai && json.openai.apiKey) || process.env.OPENAI_API_KEY || '',
      responsesUrl: (json.openai && json.openai.responsesUrl) || process.env.OPENAI_RESPONSES_URL || 'https://api.openai.com/v1/responses',
      defaultTemperature: Number(process.env.OPENAI_DEFAULT_TEMPERATURE || (json.openai && json.openai.defaultTemperature) || 1),
      defaultMaxTokens: parseInt(process.env.OPENAI_DEFAULT_MAX_TOKENS || (json.openai && json.openai.defaultMaxTokens) || '80000', 10),
      timeoutMs: parseInt(process.env.OPENAI_TIMEOUT_MS || (json.openai && json.openai.timeoutMs) || '300000', 10)
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
    }
  };
}

const config = loadSecrets();

module.exports = { config };