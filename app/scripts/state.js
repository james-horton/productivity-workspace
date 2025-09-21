/**
 * Client session state (in-memory) + lightweight persistence for preferences
 */

const LS_KEYS = {
  theme: 'pw.theme',
  model: 'pw.model',
  mode: 'pw.mode',
  city: 'pw.city',
  state: 'pw.state'
};

export const THEMES = ['matrix', 'dark', 'aurora', 'light', 'bright-white', 'nyan-cat', 'rainbow'];

export const MODES = {
  doctor: {
    id: 'doctor',
    label: 'Medical Doctor',
    starter: 'What health issue are you dealing with today, and what symptoms have you noticed?',
    disclaimer: 'Not medical advice. For urgent symptoms, contact a licensed clinician or emergency services.',
    defaultSearch: false
  },
  therapist: {
    id: 'therapist',
    label: 'Therapist',
    starter: 'What’s on your mind today, and how would you like to feel by the end of this chat?',
    disclaimer: 'Supportive conversation only, not a substitute for professional care. If in crisis, contact local emergency services or a crisis hotline.',
    defaultSearch: false
  },
  web: {
    id: 'web',
    label: 'Web Search',
    starter: 'What do you want to look up right now?',
    disclaimer: '',
    defaultSearch: true
  },
  basic: {
    id: 'basic',
    label: 'Basic Info',
    starter: 'What quick info do you need right now?',
    disclaimer: '',
    defaultSearch: false
  },
  excuse: {
    id: 'excuse',
    label: 'Excuse Generator',
    starter: 'What do you need an excuse for, and how believable should it be?',
    disclaimer: '',
    defaultSearch: false
  },
  grammar: {
    id: 'grammar',
    label: 'Grammar Corrector',
    starter: 'Paste text to correct. I will return only the corrected text.',
    disclaimer: '',
    defaultSearch: false
  },
  eli5: {
    id: 'eli5',
    label: "ELI5",
    starter: 'What do you want explained simply?',
    disclaimer: '',
    defaultSearch: false
  }
};

// Per-mode chat histories (in-memory for session only)
const chatHistories = {
  doctor: [],
  therapist: [],
  web: [],
  basic: [],
  excuse: [],
  grammar: [],
  eli5: []
};

const state = {
  theme: 'matrix',
  modelKey: 'openai:gpt-5', // populated by modelRegistry defaults
  mode: 'basic'
};

function loadPersisted() {
  const t = localStorage.getItem(LS_KEYS.theme);
  const m = localStorage.getItem(LS_KEYS.model);
  const md = localStorage.getItem(LS_KEYS.mode);
  if (t && THEMES.includes(t)) state.theme = t;
  if (m) state.modelKey = m;
  if (md && MODES[md]) {
    state.mode = md;
  }
}

export function initState() {
  loadPersisted();
  // Ensure histories exist for all modes
  Object.keys(MODES).forEach(k => { if (!chatHistories[k]) chatHistories[k] = []; });
  dispatch('pw:state:init', { ...state });
}

export function getState() {
  return { ...state };
}

export function setTheme(theme) {
  if (!THEMES.includes(theme)) return;
  state.theme = theme;
  localStorage.setItem(LS_KEYS.theme, theme);
  dispatch('pw:theme:changed', { theme });
}

export function setModelKey(modelKey) {
  state.modelKey = modelKey;
  localStorage.setItem(LS_KEYS.model, modelKey);
  dispatch('pw:model:changed', { modelKey });
}

export function setMode(mode) {
  if (!MODES[mode]) return;
  state.mode = mode;
  localStorage.setItem(LS_KEYS.mode, mode);
  dispatch('pw:mode:changed', { mode });
}


// Chat history ops
export function getChatHistory(mode) {
  return [...(chatHistories[mode] || [])];
}

export function appendChatMessage(mode, message) {
  if (!MODES[mode]) return;
  const arr = chatHistories[mode];
  arr.push({ role: message.role, content: String(message.content || '').slice(0, 8000) });
  dispatch('pw:chat:updated', { mode, messages: [...arr] });
}

export function clearChat(mode) {
  if (!MODES[mode]) return;
  chatHistories[mode] = [];
  dispatch('pw:chat:updated', { mode, messages: [] });
}

function dispatch(type, detail) {
  document.dispatchEvent(new CustomEvent(type, { detail }));
}

// Location persistence
export function getLocation() {
  try {
    const city = (localStorage.getItem(LS_KEYS.city) || '').trim();
    const state = (localStorage.getItem(LS_KEYS.state) || '').trim().toUpperCase();
    return { city, state };
  } catch {
    return { city: '', state: '' };
  }
}

export function setLocation({ city, state } = {}) {
  const c = String(city || '').trim();
  const s = String(state || '').trim().toUpperCase();
  try {
    if (c) localStorage.setItem(LS_KEYS.city, c);
    else localStorage.removeItem(LS_KEYS.city);

    if (s) localStorage.setItem(LS_KEYS.state, s);
    else localStorage.removeItem(LS_KEYS.state);
  } finally {
    // Notify listeners (e.g., UI) that location changed
    dispatch('pw:location:changed', { city: c, state: s });
  }
}