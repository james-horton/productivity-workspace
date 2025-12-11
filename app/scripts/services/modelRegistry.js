/**
 * Model Registry
 * Exposes human-friendly labels and maps selection to backend provider/model hints.
 */

const MODELS = [
  {
    key: 'openai:gpt-5',
    label: 'GPT-5 (OpenAI)',
    provider: 'openai',
    model: 'gpt-5.2',
    tier: 'high'
  }
];

export function getModels() {
  return MODELS.map(m => ({ ...m }));
}

export function findByKey(modelKey) {
  return MODELS.find(m => m.key === modelKey) || MODELS[0];
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