const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { config } = require('../config');

const router = express.Router();
const CACHE_TTL_MS = 10 * 60 * 1000;

let cachedPayload = null;
let cachedAt = 0;

const SECRETS_PATH = path.resolve(__dirname, '..', '..', 'secrets.json');

function defaultModelId() {
  return String((config.openrouter && config.openrouter.defaultModel) || '').trim();
}

function normalizeFavoriteModels(favorites) {
  const seen = new Set();
  const normalized = [];

  (Array.isArray(favorites) ? favorites : []).forEach(favorite => {
    const value = String(favorite || '').trim();
    if (!value || value.length > 200 || seen.has(value)) return;
    seen.add(value);
    normalized.push(value);
  });

  return normalized;
}

function configuredFavorites() {
  return normalizeFavoriteModels(Array.isArray(config.openrouter.favoriteModels) ? config.openrouter.favoriteModels : []);
}

function favoriteRank(modelId) {
  const favorites = configuredFavorites();
  return favorites.findIndex(f => String(f).trim() === modelId);
}

function invalidateModelCache() {
  cachedPayload = null;
  cachedAt = 0;
}

function readSecretsFile() {
  try {
    return JSON.parse(fs.readFileSync(SECRETS_PATH, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
}

function writeSecretsFile(secrets) {
  const dir = path.dirname(SECRETS_PATH);
  const tmpPath = path.join(dir, `.secrets.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmpPath, `${JSON.stringify(secrets, null, 2)}\n`, 'utf8');
  fs.renameSync(tmpPath, SECRETS_PATH);
}

function saveFavoriteModels(favoriteModels) {
  const normalized = normalizeFavoriteModels(favoriteModels);
  const secrets = readSecretsFile();
  secrets.openrouter = secrets.openrouter && typeof secrets.openrouter === 'object' ? secrets.openrouter : {};
  if (!secrets.openrouter.defaultModel && defaultModelId()) {
    secrets.openrouter.defaultModel = defaultModelId();
  }
  secrets.openrouter.favoriteModels = normalized;
  writeSecretsFile(secrets);
  config.openrouter.favoriteModels = normalized;
  invalidateModelCache();
  return normalized;
}

function modelName(model) {
  return model.name || model.id || model.canonical_slug || '';
}

function isExpired(model) {
  const expiresAt = model.expiration_date || model.expires_at || model.expiresAt;
  if (!expiresAt) return false;
  const ts = Date.parse(expiresAt);
  return Number.isFinite(ts) && ts > 0 && ts < Date.now();
}

function supportsTextOutput(model) {
  const architecture = model.architecture || {};
  const outputModalities = architecture.output_modalities || architecture.outputModalities;
  const inputModalities = architecture.input_modalities || architecture.inputModalities;

  if (Array.isArray(outputModalities) && outputModalities.length && !outputModalities.includes('text')) {
    return false;
  }

  if (Array.isArray(inputModalities) && inputModalities.length && !inputModalities.includes('text')) {
    return false;
  }

  return true;
}

function normalizeTier(modelId) {
  const id = String(modelId || '').toLowerCase();
  if (id.includes('pro') || id.includes('opus') || id.includes('reason') || id.includes('o3')) return 'high';
  if (id.includes('mini') || id.includes('small') || id.includes('nano') || id.includes('flash')) return 'low';
  return 'medium';
}

function normalizeModels(rawModels) {
  const seen = new Set();
  return (Array.isArray(rawModels) ? rawModels : [])
    .filter(model => model && typeof model.id === 'string' && model.id.trim())
    .filter(model => !isExpired(model))
    .filter(supportsTextOutput)
    .map(model => {
      const modelId = model.id.trim();
      const labelName = modelName(model) || modelId;
      return {
        key: `openrouter:${modelId}`,
        label: `OpenRouter: ${labelName}`,
        provider: 'openrouter',
        model: modelId,
        favorite: favoriteRank(modelId) !== -1,
        default: false,
        tier: normalizeTier(modelId)
      };
    })
    .filter(model => {
      if (seen.has(model.key)) return false;
      seen.add(model.key);
      return true;
    })
    .sort((a, b) => {
      if (a.default !== b.default) return a.default ? -1 : 1;
      const ar = favoriteRank(a.model);
      const br = favoriteRank(b.model);
      if (ar !== br) {
        if (ar === -1 && a.favorite) return -1;
        if (br === -1 && b.favorite) return 1;
        if (ar === -1) return 1;
        if (br === -1) return -1;
        return ar - br;
      }
      if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
      return a.label.localeCompare(b.label);
    });
}

async function fetchOpenRouterModels() {
  const hasKey = !!(config.openrouter && config.openrouter.apiKey);
  if (!hasKey) return [];

  const url = config.openrouter.modelsUserUrl || config.openrouter.modelsUrl;
  const headers = { 'Authorization': `Bearer ${config.openrouter.apiKey}` };

  const res = await axios.get(url, {
    headers,
    timeout: (config.openrouter && config.openrouter.timeoutMs) || 120000
  });

  return normalizeModels((res.data && res.data.data) || []);
}

router.get('/', async (req, res, next) => {
  try {
    const now = Date.now();
    if (cachedPayload && now - cachedAt < CACHE_TTL_MS) {
      return res.json(cachedPayload);
    }

    let openrouter = [];
    try {
      openrouter = await fetchOpenRouterModels();
    } catch (err) {
      console.warn(`[models] OpenRouter model discovery failed: ${err.message}`);
    }

    cachedPayload = {
      models: openrouter,
      favoriteModels: configuredFavorites(),
      defaultModel: defaultModelId(),
      providers: {
        openrouter: {
          configured: !!(config.openrouter && config.openrouter.apiKey),
          modelCount: openrouter.length
        }
      }
    };
    cachedAt = now;

    res.json(cachedPayload);
  } catch (err) {
    next(err);
  }
});

router.put('/favorites', (req, res, next) => {
  try {
    const body = req.body || {};
    if (!Array.isArray(body.favoriteModels)) {
      return res.status(400).json({ error: { message: 'favoriteModels must be an array' } });
    }

    const favoriteModels = saveFavoriteModels(body.favoriteModels);
    res.json({ favoriteModels, defaultModel: defaultModelId() });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
