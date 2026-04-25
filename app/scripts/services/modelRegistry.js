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
    tier: 'high'
  }
];

let dynamicModels = [];
let loadPromise = null;

function mergeModels() {
  const seen = new Set();
  return [...STATIC_MODELS, ...dynamicModels]
    .filter(m => m && m.key && m.provider && m.model)
    .filter(m => {
      if (seen.has(m.key)) return false;
      seen.add(m.key);
      return true;
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
    return ((data && data.models) || []).map(normalizeRemoteModel).filter(Boolean);
  } finally {
    clearTimeout(timer);
  }
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
