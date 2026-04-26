/**
 * Model Registry
 * Exposes human-friendly labels and maps selection to backend provider/model hints.
 */

import { ENDPOINTS, TIMEOUTS } from '../config.js';

const STATIC_MODELS = [
  {
    key: 'openai:gpt-5',
    label: 'GPT-5.5 (OpenAI)',
    provider: 'openai',
    model: 'gpt-5.5',
    favorite: false,
    default: true,
    tier: 'high'
  }
];

let dynamicModels = [];
let favoriteModels = [];
let loadPromise = null;

function normalizeFavoriteModels(models) {
  const seen = new Set();
  const normalized = [];

  (Array.isArray(models) ? models : []).forEach(model => {
    const value = String(model || '').trim();
    if (!value || seen.has(value)) return;
    seen.add(value);
    normalized.push(value);
  });

  return normalized;
}

function favoriteRank(modelId) {
  return favoriteModels.findIndex(model => model === modelId);
}

function canFavoriteModel(model) {
  return model.provider === 'openrouter';
}

function decorateModel(model) {
  const isDefault = model.key === STATIC_MODELS[0].key;
  const rank = favoriteRank(model.model);
  return {
    ...model,
    favorite: canFavoriteModel(model) && (rank !== -1 || model.favorite === true),
    default: isDefault
  };
}

function mergeModels() {
  const seen = new Set();
  return [...STATIC_MODELS, ...dynamicModels]
    .filter(m => m && m.key && m.provider && m.model)
    .filter(m => {
      if (seen.has(m.key)) return false;
      seen.add(m.key);
      return true;
    })
    .map(decorateModel)
    .sort((a, b) => {
      if ((a.key === STATIC_MODELS[0].key) !== (b.key === STATIC_MODELS[0].key)) {
        return a.key === STATIC_MODELS[0].key ? -1 : 1;
      }

      if (a.default !== b.default) return a.default ? -1 : 1;

      const ar = favoriteRank(a.model);
      const br = favoriteRank(b.model);
      if (ar !== br) {
        if (ar === -1) return 1;
        if (br === -1) return -1;
        return ar - br;
      }

      if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
      return a.label.localeCompare(b.label);
    })
    .map(m => ({ ...m }));
}

function normalizeRemoteModel(model) {
  if (!model || typeof model !== 'object') return null;
  const key = typeof model.key === 'string' ? model.key.trim() : '';
  const provider = typeof model.provider === 'string' ? model.provider.trim() : '';
  const modelId = typeof model.model === 'string' ? model.model.trim() : '';
  if (!key || !provider || !modelId) return null;
  return {
    key,
    label: String(model.label || modelId),
    provider,
    model: modelId,
    favorite: model.favorite === true,
    default: model.default === true,
    tier: model.tier || 'medium'
  };
}

async function fetchRemoteModels() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUTS.defaultMs);
  try {
    const res = await fetch(ENDPOINTS.models, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`Model registry failed (${res.status})`);
    const data = await res.json();
    favoriteModels = normalizeFavoriteModels(data && data.favoriteModels);
    return ((data && data.models) || []).map(normalizeRemoteModel).filter(Boolean);
  } finally {
    clearTimeout(timer);
  }
}

async function saveRemoteFavorites(models) {
  const res = await fetch(ENDPOINTS.modelFavorites, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ favoriteModels: models })
  });

  if (!res.ok) throw new Error(`Saving favorites failed (${res.status})`);
  return res.json();
}

export function getModels() {
  return mergeModels();
}

export async function loadModels() {
  if (!loadPromise) {
    loadPromise = fetchRemoteModels()
      .then(models => {
        dynamicModels = models;
        return getModels();
      })
      .catch(err => {
        console.warn('[modelRegistry] Dynamic model loading failed:', err.message || err);
        dynamicModels = [];
        loadPromise = null;
        return getModels();
      });
  }
  return loadPromise;
}

export async function saveFavoriteModels(models) {
  const previousFavorites = favoriteModels.slice();
  favoriteModels = normalizeFavoriteModels(models);

  try {
    const data = await saveRemoteFavorites(favoriteModels);
    favoriteModels = normalizeFavoriteModels(data && data.favoriteModels);
    dynamicModels = dynamicModels.map(model => ({
      ...model,
      favorite: favoriteModels.includes(model.model),
      default: false
    }));
    loadPromise = Promise.resolve(getModels());
    return getModels();
  } catch (err) {
    favoriteModels = previousFavorites;
    throw err;
  }
}

export function getFavoriteModelIds() {
  return normalizeFavoriteModels(favoriteModels);
}

export function findByKey(modelKey) {
  const models = getModels();
  return models.find(m => m.key === modelKey) || models[0];
}

export function getDefaultModelKey() {
  return 'openai:gpt-5';
}

export function labelFor(modelKey) {
  return findByKey(modelKey).label;
}

export function providerFor(modelKey) {
  return findByKey(modelKey).provider;
}

export function modelIdFor(modelKey) {
  return findByKey(modelKey).model;
}

export function tierFor(modelKey) {
  return findByKey(modelKey).tier;
}
