/**
 * Client session state (in-memory) + lightweight persistence for preferences
 */

const LS_KEYS = {
  theme: 'pw.theme',
  model: 'pw.model',
  mode: 'pw.mode',
  city: 'pw.city',
  state: 'pw.state',
  redditSubreddit: 'pw.reddit.subreddit',
  redditSubreddit2: 'pw.reddit.subreddit2',
  redditSubreddit3: 'pw.reddit.subreddit3'
};

export const THEMES = ['matrix', 'dark', 'dark-black', 'aurora', 'light', 'bright-white', 'nyan-cat', 'rainbow', 'bumblebee', 'orangeade', 'sky-blue'];

export const UI_CONFIG = {
  mobileMaxWidthPx: 600,        // Mobile breakpoint (px) used for truncation logic
  redditBodyCharCap: 240,       // Max chars for Reddit post body in mobile view
  subredditBtnCharCap: 5        // Max chars for subreddit tab labels in mobile when all 3 are set
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

// Reddit subreddit persistence (up to 3)
export function getRedditSubredditAt(index = 1) {
  try {
    const key = index === 2
      ? LS_KEYS.redditSubreddit2
      : index === 3
        ? LS_KEYS.redditSubreddit3
        : LS_KEYS.redditSubreddit;
    return (localStorage.getItem(key) || '').trim();
  } catch {
    return '';
  }
}

/**
 * Backwards-compatible getter for the first subreddit.
 */
export function getRedditSubreddit() {
  return getRedditSubredditAt(1);
}

/**
 * Set the preferred subreddit name at a specific slot (1-3).
 * Accepts values like "news" or "/r/news" and normalizes to "news".
 */
export function setRedditSubredditAt(index = 1, name) {
  const n = String(name || '').replace(/^\/?r\//i, '').trim();
  const key = index === 2
    ? LS_KEYS.redditSubreddit2
    : index === 3
      ? LS_KEYS.redditSubreddit3
      : LS_KEYS.redditSubreddit;
  try {
    if (n) localStorage.setItem(key, n);
    else localStorage.removeItem(key);
  } finally {
    dispatch('pw:reddit:changed', { subreddit: n, index });
  }
}

/**
 * Backwards-compatible setter for the first subreddit.
 */
export function setRedditSubreddit(name) {
  setRedditSubredditAt(1, name);
}