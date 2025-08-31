import { applyTheme } from './theme.js';
import { initState, getState, THEMES, MODES, setTheme, setMode, setWebSearch, setModelKey, getChatHistory, appendChatMessage } from './state.js';
import { getModels, providerFor, modelIdFor, getDefaultModelKey } from './services/modelRegistry.js';
import { fetchQuote } from './services/quoteService.js';
import { sendChat } from './services/chatService.js';
import { fetchNews } from './services/newsService.js';
import { setDisclaimer, setBusy, renderChat } from './ui/chatUI.js';
import { setNewsBusy, setActiveTab, renderNewsItems } from './ui/newsUI.js';

const $ = (sel) => document.querySelector(sel);

// Elements
const themeSelect = () => $('#themeSelect');
const modelSelect = () => $('#modelSelect');
const modeSelect = () => $('#modeSelect');
const webSearchToggle = () => $('#webSearchToggle');
const chatForm = () => $('#chatForm');
const chatInput = () => $('#chatInput');
const chatMessages = () => $('#chatMessages');
const quoteText = () => $('#quoteText');
const quoteRefresh = () => $('#quoteRefresh');
const newsTabs = () => $('#newsTabs');
const newsRefresh = () => $('#newsRefresh');
const newsItems = () => $('#newsItems');
const clockTime = () => $('#clockTime');
const clockDate = () => $('#clockDate');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  initState();
  const s = getState();

  // Apply saved theme
  applyTheme(s.theme);
  hydrateThemeSelect(s.theme);

  // Populate model list and select
  populateModelSelect(s.modelKey || getDefaultModelKey());

  // Mode select + disclaimer + chat starter
  hydrateModeSelect(s.mode);
  syncDisclaimerForMode(s.mode);
  showStarterIfEmpty(s.mode);

  // Web search toggle
  webSearchToggle().checked = !!s.webSearch;

  // Initial quote and news
  void refreshQuote();
  setActiveTab('national');
  void loadNews('national');

  // Clock + date + year
  startClock();
  const yEl = document.getElementById('year');
  if (yEl) yEl.textContent = String(new Date().getFullYear());

  // Wire listeners
  wireControls();
  wireStateEvents();

  // Render initial chat from state (starter added above if needed)
  renderChat(getChatHistory(s.mode));
});

function wireControls() {
  // Theme
  themeSelect().addEventListener('change', async (e) => {
    const theme = e.target.value;
    if (!THEMES.includes(theme)) return;
    setTheme(theme);
    applyTheme(theme);
    // Refresh quote to match theme vibe
    await refreshQuote();
  });

  // Model
  modelSelect().addEventListener('change', (e) => {
    const key = e.target.value;
    setModelKey(key);
  });

  // Mode
  modeSelect().addEventListener('change', (e) => {
    const m = e.target.value;
    setMode(m);
    syncDisclaimerForMode(m);
    showStarterIfEmpty(m);
    renderChat(getChatHistory(m));
  });

  // Web search toggle
  webSearchToggle().addEventListener('change', (e) => {
    setWebSearch(!!e.target.checked);
  });

  // Chat submit
  chatForm().addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = chatInput();
    const text = (input.value || '').trim();
    if (!text) return;

    const s = getState();
    // Append user message to history
    appendChatMessage(s.mode, { role: 'user', content: text });
    input.value = '';

    // Render pending
    setBusy(true);
    chatForm().querySelector('button[type="submit"]').disabled = true;
    input.disabled = true;

    try {
      const modelKey = s.modelKey || getDefaultModelKey();
      const provider = providerFor(modelKey);
      const modelId = modelIdFor(modelKey);

      const resp = await sendChat({
        mode: s.mode,
        messages: getChatHistory(s.mode),
        webSearch: !!s.webSearch,
        provider,
        model: modelId
      });

      if (resp?.disclaimer) setDisclaimer(resp.disclaimer);
      // Append assistant reply
      appendChatMessage(s.mode, resp.message);
      // Re-render with sources (if any)
      renderChat(getChatHistory(s.mode), { sources: resp.sources || [] });
    } catch (err) {
      // Surface error as assistant message
      appendChatMessage(getState().mode, {
        role: 'assistant',
        content: `Error: ${err.message || 'Something went wrong.'}`
      });
      renderChat(getChatHistory(getState().mode));
    } finally {
      setBusy(false);
      chatForm().querySelector('button[type="submit"]').disabled = false;
      input.disabled = false;
      input.focus();
    }
  });

  // Quote refresh
  quoteRefresh().addEventListener('click', () => void refreshQuote());

  // News tabs
  newsTabs().addEventListener('click', async (e) => {
    const btn = e.target.closest('.tab');
    if (!btn) return;
    const cat = btn.dataset.cat;
    setActiveTab(cat);
    await loadNews(cat);
  });

  // News refresh
  newsRefresh().addEventListener('click', async () => {
    const active = document.querySelector('#newsTabs .tab.active')?.dataset.cat || 'national';
    await loadNews(active);
  });
}

function wireStateEvents() {
  document.addEventListener('pw:theme:changed', (e) => {
    const { theme } = e.detail || {};
    hydrateThemeSelect(theme);
  });
  document.addEventListener('pw:model:changed', (e) => {
    const { modelKey } = e.detail || {};
    hydrateModelSelect(modelKey);
  });
  document.addEventListener('pw:mode:changed', (e) => {
    const { mode, webSearch } = e.detail || {};
    hydrateModeSelect(mode);
    webSearchToggle().checked = !!webSearch;
    syncDisclaimerForMode(mode);
    showStarterIfEmpty(mode);
    renderChat(getChatHistory(mode));
  });
  document.addEventListener('pw:chat:updated', () => {
    const s = getState();
    renderChat(getChatHistory(s.mode));
  });
}

function hydrateThemeSelect(theme) {
  if (!themeSelect()) return;
  themeSelect().value = theme;
}

function populateModelSelect(selectedKey) {
  const sel = modelSelect();
  sel.innerHTML = '';
  const models = getModels();
  models.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m.key;
    opt.textContent = m.label;
    sel.appendChild(opt);
  });
  hydrateModelSelect(selectedKey || getDefaultModelKey());
}

function hydrateModelSelect(modelKey) {
  const sel = modelSelect();
  const found = Array.from(sel.options).some(o => o.value === modelKey);
  sel.value = found ? modelKey : getDefaultModelKey();
}

function hydrateModeSelect(mode) {
  const sel = modeSelect();
  if (!MODES[mode]) mode = 'basic';
  sel.value = mode;
}

function syncDisclaimerForMode(mode) {
  const text = MODES[mode]?.disclaimer || '';
  setDisclaimer(text);
}

function showStarterIfEmpty(mode) {
  const history = getChatHistory(mode);
  if (!history || history.length === 0) {
    const starter = MODES[mode]?.starter || 'How can I help?';
    appendChatMessage(mode, { role: 'assistant', content: starter });
  }
}

async function refreshQuote() {
  const box = quoteText();
  const currentTheme = getState().theme;
  if (box) box.textContent = 'Loading quote...';
  try {
    const res = await fetchQuote(currentTheme);
    if (box) box.textContent = res.quote || '…';
  } catch (err) {
    if (box) box.textContent = 'Could not load a quote right now. Try again.';
  }
}

async function loadNews(category) {
  setNewsBusy(true);
  newsItems().innerHTML = '<div class="news-item">Loading…</div>';

  try {
    let geo = {};
    if (category === 'local' && navigator.geolocation) {
      try {
        const pos = await new Promise((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 8000 });
        });
        geo = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      } catch {
        // If denied or timed out, proceed without geo
        geo = {};
      }
    }

    const data = await fetchNews(category, geo);
    renderNewsItems(data.items || []);
  } catch (err) {
    newsItems().innerHTML = '<div class="news-item">Failed to load news. Try refresh.</div>';
  } finally {
    setNewsBusy(false);
  }
}

function startClock() {
  const update = () => {
    const now = new Date();
    if (clockTime()) clockTime().textContent = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (clockDate()) clockDate().textContent = now.toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  };
  update();
  setInterval(update, 1000);
}