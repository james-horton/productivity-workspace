/**
 * Client session state (in-memory) + lightweight persistence for preferences.
 *
 * Model / mode are stored in localStorage (per-browser UI prefs).
 * Theme / city / state / reddit subreddits / UI options are stored server-side in secrets.json
 * via /api/settings and cached here in-memory after `loadUserSettings()`.
 */

import { fetchSettings, saveSettings } from './services/settingsService.js';

const LS_KEYS = {
  model: 'pw.model',
  mode: 'pw.mode'
};

export const THEMES = ['matrix', 'dark', 'dark-black', 'aurora', 'light', 'bright-white', 'nyan-cat', 'rainbow', 'bumblebee', 'orangeade', 'sky-blue', 'usa', '90s'];

// Reasoning levels exposed in the UI for the "Basic Info" chat mode only.
// Other modes use their server-side fixed reasoning value (see server/routes/chat.js MODE_SPECS).
export const BASIC_REASONING_LEVELS = ['minimal', 'low', 'medium', 'high', 'xhigh'];
export const DEFAULT_BASIC_REASONING = 'low';

export const UI_CONFIG = {
  mobileMaxWidthPx: 600,        // Mobile breakpoint (px) used for truncation logic
  redditBodyCharCap: 240,       // Max chars for Reddit post body in mobile view
  subredditBtnCharCap: 5        // Max chars for subreddit tab labels in mobile when all 10 are set
};

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
  },
  debate_lord: {
    id: 'debate_lord',
    label: 'Debate Lord',
    starter: 'State mode ("train" or "debate"), your side ("for" or "against"), and the topic.',
    disclaimer: '',
    defaultSearch: false
  },
  big_brain: {
    id: 'big_brain',
    label: 'Big Brain',
    starter: 'What complex problem should we think through with deep reasoning?',
    disclaimer: 'High-reasoning mode. No web search and no code interpreter are available.',
    defaultSearch: false
  },
  coder: {
    id: 'coder',
    label: 'Coder',
    starter: 'Whatcha wanna code?',
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
  eli5: [],
  big_brain: [],
  coder: []
};

const state = {
  theme: 'matrix',
  modelKey: 'openai:gpt-5', // populated by modelRegistry defaults
  mode: 'basic',
  // Session-only reasoning level for Basic Info mode. Not persisted to localStorage.
  basicReasoning: DEFAULT_BASIC_REASONING
};

function loadPersisted() {
  const m = localStorage.getItem(LS_KEYS.model);
  const md = localStorage.getItem(LS_KEYS.mode);
  if (m) state.modelKey = m;
  if (md && MODES[md]) {
    state.mode = md;
  }
}

function loadRenderedTheme() {
  const renderedTheme = document.body?.dataset?.theme;
  if (THEMES.includes(renderedTheme)) {
    state.theme = renderedTheme;
    userSettings.theme = renderedTheme;
  }
}

export function initState() {
  loadPersisted();
  loadRenderedTheme();
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
  userSettings.theme = theme;
  void persistUserSettings();
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

// Session-only setter for the Basic Info reasoning level. Invalid values are ignored.
export function setBasicReasoning(level) {
  if (!BASIC_REASONING_LEVELS.includes(level)) return;
  state.basicReasoning = level;
  dispatch('pw:basic-reasoning:changed', { level });
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

// ---------------------------------------------------------------------------
// User settings (theme/city/state/subreddits/UI options) — persisted on the server in secrets.json.
// Cached in-memory so getters can stay synchronous for callers throughout the UI.
// ---------------------------------------------------------------------------

const SUBREDDIT_SLOTS = 10;

const userSettings = {
  theme: state.theme,
  city: '',
  state: '',
  subreddits: ['', '', '', '', '', '', '', '', '', ''],
  showInspirationQuote: true,
  showCalculator: true,
  showClock: true,
  roundedBorders: true
};

let settingsLoaded = false;

function clampSlotIndex(index) {
  const i = parseInt(index, 10);
  if (!Number.isFinite(i)) return 0;
  return Math.max(0, Math.min(SUBREDDIT_SLOTS - 1, i - 1));
}

function normalizeSubredditName(name) {
  return String(name || '').replace(/^\/?r\//i, '').trim();
}

/**
 * Fetch persisted user settings from the server and populate the in-memory cache.
 * Should be awaited once during app startup before widgets that depend on
 * theme/city/state/subreddits initialize. Safe to call multiple times.
 */
export async function loadUserSettings() {
  let loadedTheme = state.theme;
  try {
    const data = await fetchSettings();
    loadedTheme = THEMES.includes(data?.theme) ? data.theme : state.theme;
    userSettings.theme = loadedTheme;
    state.theme = loadedTheme;
    userSettings.city = String(data?.city || '').trim();
    userSettings.state = String(data?.state || '').trim().toUpperCase();
    userSettings.showInspirationQuote = data?.showInspirationQuote !== false;
    userSettings.showCalculator = data?.showCalculator !== false;
    userSettings.showClock = data?.showClock !== false;
    userSettings.roundedBorders = data?.roundedBorders !== false;
    const subs = Array.isArray(data?.subreddits) ? data.subreddits : [];
    for (let i = 0; i < SUBREDDIT_SLOTS; i += 1) {
      userSettings.subreddits[i] = normalizeSubredditName(subs[i]);
    }
  } catch (err) {
    console.warn('[settings] failed to load from server:', err && err.message);
  } finally {
    settingsLoaded = true;
    dispatch('pw:settings:loaded', {
      theme: userSettings.theme,
      city: userSettings.city,
      state: userSettings.state,
      subreddits: [...userSettings.subreddits],
      showInspirationQuote: userSettings.showInspirationQuote,
      showCalculator: userSettings.showCalculator,
      showClock: userSettings.showClock,
      roundedBorders: userSettings.roundedBorders
    });
    dispatch('pw:theme:changed', { theme: loadedTheme });
  }
}

export function isUserSettingsLoaded() {
  return settingsLoaded;
}

// Debounce persistence so that multiple rapid setters (e.g. the settings
// form submitting theme, city, state, and 10 subreddits in succession) collapse into
// a single PUT carrying the latest cached state. Avoids races where
// out-of-order requests could clobber newer values.
const PERSIST_DEBOUNCE_MS = 50;
let persistTimer = null;
let persistPending = null;
let resolvePersistPending = null;

function persistUserSettings() {
  if (!persistPending) {
    persistPending = new Promise((resolve) => { resolvePersistPending = resolve; });
  }
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    const resolver = resolvePersistPending;
    persistPending = null;
    resolvePersistPending = null;
    saveSettings({
      theme: userSettings.theme,
      city: userSettings.city,
      state: userSettings.state,
      subreddits: [...userSettings.subreddits],
      showInspirationQuote: userSettings.showInspirationQuote,
      showCalculator: userSettings.showCalculator,
      showClock: userSettings.showClock,
      roundedBorders: userSettings.roundedBorders
    }).catch(err => {
      console.warn('[settings] failed to save to server:', err && err.message);
    }).finally(() => {
      if (resolver) resolver();
    });
  }, PERSIST_DEBOUNCE_MS);
  return persistPending;
}

// Location persistence
export function getLocation() {
  return { city: userSettings.city, state: userSettings.state };
}

export function setLocation({ city, state } = {}) {
  const c = String(city || '').trim();
  const s = String(state || '').trim().toUpperCase();
  userSettings.city = c;
  userSettings.state = s;
  void persistUserSettings();
  dispatch('pw:location:changed', { city: c, state: s });
}

export function getShowInspirationQuote() {
  return userSettings.showInspirationQuote !== false;
}

export function setShowInspirationQuote(show) {
  const value = show !== false;
  userSettings.showInspirationQuote = value;
  void persistUserSettings();
  dispatch('pw:ui-settings:changed', {
    showInspirationQuote: value,
    showCalculator: getShowCalculator(),
    showClock: getShowClock(),
    roundedBorders: getRoundedBorders()
  });
}

export function getShowCalculator() {
  return userSettings.showCalculator !== false;
}

export function setShowCalculator(show) {
  const value = show !== false;
  userSettings.showCalculator = value;
  void persistUserSettings();
  dispatch('pw:ui-settings:changed', {
    showInspirationQuote: getShowInspirationQuote(),
    showCalculator: value,
    showClock: getShowClock(),
    roundedBorders: getRoundedBorders()
  });
}

export function getShowClock() {
  return userSettings.showClock !== false;
}

export function setShowClock(show) {
  const value = show !== false;
  userSettings.showClock = value;
  void persistUserSettings();
  dispatch('pw:ui-settings:changed', {
    showInspirationQuote: getShowInspirationQuote(),
    showCalculator: getShowCalculator(),
    showClock: value,
    roundedBorders: getRoundedBorders()
  });
}

export function getRoundedBorders() {
  return userSettings.roundedBorders !== false;
}

export function setRoundedBorders(rounded) {
  const value = rounded !== false;
  userSettings.roundedBorders = value;
  void persistUserSettings();
  dispatch('pw:ui-settings:changed', {
    showInspirationQuote: getShowInspirationQuote(),
    showCalculator: getShowCalculator(),
    showClock: getShowClock(),
    roundedBorders: value
  });
}

// Reddit subreddit persistence (up to 10 slots)
export function getRedditSubredditAt(index = 1) {
  return userSettings.subreddits[clampSlotIndex(index)] || '';
}

/**
 * Backwards-compatible getter for the first subreddit.
 */
export function getRedditSubreddit() {
  return getRedditSubredditAt(1);
}

/**
 * Set the preferred subreddit name at a specific slot (1-10).
 * Accepts values like "news" or "/r/news" and normalizes to "news".
 */
export function setRedditSubredditAt(index = 1, name) {
  const n = normalizeSubredditName(name);
  const slot = clampSlotIndex(index);
  userSettings.subreddits[slot] = n;
  void persistUserSettings();
  dispatch('pw:reddit:changed', { subreddit: n, index: slot + 1 });
}

/**
 * Backwards-compatible setter for the first subreddit.
 */
export function setRedditSubreddit(name) {
  setRedditSubredditAt(1, name);
}
