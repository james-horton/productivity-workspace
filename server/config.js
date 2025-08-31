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

  return {
    openai: {
      apiKey: (json.openai && json.openai.apiKey) || process.env.OPENAI_API_KEY || ''
    },
    deepseek: {
      apiKey: (json.deepseek && json.deepseek.apiKey) || process.env.DEEPSEEK_API_KEY || ''
    },
    tavily: {
      apiKey: (json.tavily && json.tavily.apiKey) || process.env.TAVILY_API_KEY || ''
    },
    cors: {
      allowedOrigins
    },
    server: {
      port: (json.server && json.server.port) || parseInt(process.env.PORT || '8787', 10)
    }
  };
}

const config = loadSecrets();

module.exports = { config };