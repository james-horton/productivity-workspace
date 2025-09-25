import { applyTheme } from './theme.js';
import { initState, getState, THEMES, MODES, setTheme, setMode, setModelKey, getChatHistory, appendChatMessage, clearChat, getLocation, setLocation, getRedditSubreddit, setRedditSubreddit, getRedditSubredditAt, setRedditSubredditAt, UI_CONFIG } from './state.js';
import { getModels, providerFor, modelIdFor, getDefaultModelKey } from './services/modelRegistry.js';
import { fetchQuote } from './services/quoteService.js';
import { sendChat } from './services/chatService.js';
import { fetchNews } from './services/newsService.js';
import { fetchReddit } from './services/redditService.js';
import { setDisclaimer, setBusy, renderChat, showAssistantTyping, hideAssistantTyping } from './ui/chatUI.js';
import { setNewsBusy, setActiveTab, renderNewsItems, renderNewsLoading, initNewsModalUI } from './ui/newsUI.js';
import { setRedditBusy, renderRedditItems, renderRedditLoading, updateRedditSummariesForViewport } from './ui/redditUI.js';
import { initMatrixRain, setMatrixRainEnabled } from './ui/matrixRain.js';
import { initNyanCat, setNyanCatEnabled } from './ui/nyanCat.js';
import { $, isMobileView } from './utils/helpers.js';
import { REDDIT, NEWS, UI_DEFAULTS } from './config.js';

const REDDIT_MAX_POSTS = REDDIT.maxPosts;

// Elements
const themeSelect = () => $('#themeSelect');
const modelSelect = () => $('#modelSelect');
const modeSelect = () => $('#modeSelect');
const chatForm = () => $('#chatForm');
const chatInput = () => $('#chatInput');
const chatMessages = () => $('#chatMessages');
const chatCopy = () => $('#chatCopy');
const chatDownload = () => $('#chatDownload');
const chatReset = () => $('#chatReset');
const quoteText = () => $('#quoteText');
const quoteRefresh = () => $('#quoteRefresh');
const newsTabs = () => $('#newsTabs');
const newsRefresh = () => $('#newsRefresh');
const newsItems = () => $('#newsItems');
const redditTabs = () => $('#redditTabs');
const redditRefresh = () => $('#redditRefresh');
const redditItems = () => $('#redditItems');
const redditTitle = () => $('#redditTitle');
const clockTime = () => $('#clockTime');
const clockDate = () => $('#clockDate');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  initState();
  const s = getState();

  // Apply saved theme
  applyTheme(s.theme);
  hydrateThemeSelect(s.theme);

  // Init header animations and toggle based on theme
  initMatrixRain(); initNyanCat();
  setMatrixRainEnabled(s.theme === 'matrix'); setNyanCatEnabled(s.theme === 'nyan-cat');
 
  // Populate model list and select
  populateModelSelect(s.modelKey || getDefaultModelKey());

  // Mode select + disclaimer + chat starter
  hydrateModeSelect(s.mode);
  syncDisclaimerForMode(s.mode);
  showStarterIfEmpty(s.mode);

  // Initial quote and news + reddit
  void refreshQuote();
  setActiveTab(NEWS.defaultCategory);
  void loadNews(NEWS.defaultCategory);
  hydrateRedditTabs();
  // Update subreddit tab labels when viewport crosses mobile threshold
  window.addEventListener('resize', () => { hydrateRedditTabs(); updateRedditSummariesForViewport(); });
  setActiveRedditTab(1);
  setRedditHeaderFromIndex(1);
  void loadReddit(1);

  // Clock + date
  startClock();

  // Wire listeners
  wireControls();
  wireStateEvents();
  initSettingsUI();
  initNewsModalUI();

  // Render initial chat from state (starter added above if needed)
  renderChat(getChatHistory(s.mode));
});

function wireControls() {
  // Theme
  themeSelect().addEventListener('change', (e) => {
    const theme = e.target.value;
    if (!THEMES.includes(theme)) return;
    setTheme(theme);
    applyTheme(theme);
    setMatrixRainEnabled(theme === 'matrix'); setNyanCatEnabled(theme === 'nyan-cat');
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


  // Copy chat to clipboard
  const copyBtn = chatCopy && chatCopy();
  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      const s = getState();
      const history = getChatHistory(s.mode);
      const text = formatChatForCopy(history, s.mode);
      const btn = copyBtn;
      const originalTitle = btn.title;
      const originalAria = btn.getAttribute('aria-label') || originalTitle || 'Copy';

      function resetLabel() {
        btn.title = originalTitle;
        btn.setAttribute('aria-label', originalAria);
      }

      try {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(text);
        } else {
          const ta = document.createElement('textarea');
          ta.value = text;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          ta.style.left = '-9999px';
          document.body.appendChild(ta);
          ta.focus();
          ta.select();
          const ok = document.execCommand('copy');
          document.body.removeChild(ta);
          if (!ok) throw new Error('execCommand copy failed');
        }
        btn.title = 'Copied!';
        btn.setAttribute('aria-label', 'Copied!');
        btn.classList.add('copied');
        setTimeout(() => { btn.classList.remove('copied'); resetLabel(); }, UI_DEFAULTS.copySuccessDelayMs);
      } catch (_) {
        btn.title = 'Copy failed';
        btn.setAttribute('aria-label', 'Copy failed');
        setTimeout(() => { resetLabel(); }, UI_DEFAULTS.copyFailDelayMs);
      }
    });
  }
 
  // Download chat as .txt
  const downloadBtn = chatDownload && chatDownload();
  if (downloadBtn) {
    downloadBtn.addEventListener('click', () => {
      const s = getState();
      const history = getChatHistory(s.mode);
      const text = formatChatForCopy(history, s.mode);

      const modeName = (MODES[s.mode]?.label || s.mode || 'chat');
      const modeSlug = String(modeName).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      const now = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const ts = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
      const filename = `${modeSlug}_${ts}.txt`;

      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 0);

      const btn = downloadBtn;
      const originalTitle = btn.title;
      const originalAria = btn.getAttribute('aria-label') || originalTitle || 'Download';
      btn.title = 'Downloaded';
      btn.setAttribute('aria-label', 'Downloaded');
      setTimeout(() => {
        btn.title = originalTitle;
        btn.setAttribute('aria-label', originalAria);
      }, UI_DEFAULTS.copySuccessDelayMs);
    });
  }
 
  // Reset all chats
  const resetBtn = chatReset && chatReset();
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      const s = getState();
      const btn = resetBtn;
      const originalTitle = btn.title;
      const originalAria = btn.getAttribute('aria-label') || originalTitle || 'Reset';
      try {
        // Clear all mode histories
        Object.keys(MODES).forEach((m) => clearChat(m));
        // Reset disclaimer + starter for current mode and re-render
        syncDisclaimerForMode(s.mode);
        showStarterIfEmpty(s.mode);
        renderChat(getChatHistory(s.mode));
        btn.title = 'Reset';
        btn.setAttribute('aria-label', 'Reset');
      } finally {
        setTimeout(() => {
          btn.title = originalTitle;
          btn.setAttribute('aria-label', originalAria);
        }, UI_DEFAULTS.copySuccessDelayMs);
      }
    });
  }
 
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
    renderChat(getChatHistory(s.mode));
    showAssistantTyping();
    chatForm().querySelector('button[type="submit"]').disabled = true;
    input.disabled = true;

    try {
      const modelKey = s.modelKey || getDefaultModelKey();
      const provider = providerFor(modelKey);
      const modelId = modelIdFor(modelKey);

      const resp = await sendChat({
        mode: s.mode,
        messages: getChatHistory(s.mode),
        provider,
        model: modelId
      });

      hideAssistantTyping();

      if (resp?.disclaimer) setDisclaimer(resp.disclaimer);
      // Append assistant reply
      appendChatMessage(s.mode, resp.message);
      // Re-render with sources (if any)
      renderChat(getChatHistory(s.mode), { sources: resp.sources || [] });
    } catch (err) {
      hideAssistantTyping();
      // Surface error as assistant message
      appendChatMessage(getState().mode, {
        role: 'assistant',
        content: `Error: ${err.message || 'Something went wrong.'}`
      });
      renderChat(getChatHistory(getState().mode));
    } finally {
      hideAssistantTyping();
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
    const active = document.querySelector('#newsTabs .tab.active')?.dataset.cat || NEWS.defaultCategory;
    await loadNews(active);
  });

  // Reddit tabs
  const rt = redditTabs && redditTabs();
  if (rt) {
    rt.addEventListener('click', async (e) => {
      const btn = e.target.closest('.tab');
      if (!btn) return;
      const index = parseInt(btn.dataset.index || '1', 10);
      setActiveRedditTab(index);
      setRedditHeaderFromIndex(index);
      await loadReddit(index);
    });
  }

  // Reddit refresh
  redditRefresh().addEventListener('click', async () => {
    await loadReddit(getActiveRedditTabIndex());
  });
}

function wireStateEvents() {
  document.addEventListener('pw:theme:changed', (e) => {
    const { theme } = e.detail || {};
    hydrateThemeSelect(theme);
    setMatrixRainEnabled(theme === 'matrix'); setNyanCatEnabled(theme === 'nyan-cat');
  });
  document.addEventListener('pw:model:changed', (e) => {
    const { modelKey } = e.detail || {};
    hydrateModelSelect(modelKey);
  });
  document.addEventListener('pw:mode:changed', (e) => {
    const { mode } = e.detail || {};
    hydrateModeSelect(mode);
    syncDisclaimerForMode(mode);
    showStarterIfEmpty(mode);
    renderChat(getChatHistory(mode));
  });
  document.addEventListener('pw:chat:updated', () => {
    const s = getState();
    renderChat(getChatHistory(s.mode));
  });
  document.addEventListener('pw:reddit:changed', (e) => {
    hydrateRedditTabs();
    const idx = getActiveRedditTabIndex();
    setRedditHeaderFromIndex(idx);
    // Do not auto-fetch here; API only on page load, refresh click, or tab click
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

function formatChatForCopy(messages, mode) {
  const modeLabel = MODES[mode]?.label || mode || '';
  const ts = new Date().toLocaleString();
  const header = `Chat - ${modeLabel} (${ts})`;
  const sep = '\n' + '-'.repeat(header.length) + '\n\n';
  const body = (messages || []).map(m => {
    const role = m.role === 'user' ? 'User' : 'Assistant';
    const text = String(m.content || '');
    return `${role}:\n${text}`;
  }).join('\n\n');
  return header + sep + body + '\n';
}

async function refreshQuote() {
  const box = quoteText();
  const currentTheme = getState().theme;
  if (box) {
    box.classList.add('is-loading');
    box.innerHTML = `
      <div class="skeleton-line skeleton"></div>
      <div class="skeleton-line skeleton"></div>
      <div class="skeleton-line skeleton"></div>
    `;
  }
  try {
    const res = await fetchQuote(currentTheme);
    if (box) {
      box.classList.remove('is-loading');
      box.textContent = res.quote || '…';
    }
  } catch (err) {
    if (box) {
      box.classList.remove('is-loading');
      box.textContent = 'Could not load a quote right now. Try again.';
    }
  }
}

async function loadNews(category) {
  setNewsBusy(true);
  renderNewsLoading();

  try {
    let data;
    if (category === 'local') {
      const { city, state } = getLocation();
      if (!city || !state) {
        const msg = '<div class="news-item">Local news requires your city and state. Use the Settings (gear icon) to enter them.</div>';
        newsItems().innerHTML = msg;
      } else {
        data = await fetchNews(category, { city, state });
        renderNewsItems(data.items || []);
      }
    } else {
      data = await fetchNews(category);
      renderNewsItems(data.items || []);
    }
  } catch (err) {
    newsItems().innerHTML = '<div class="news-item">Failed to load news. Try refresh.</div>';
  } finally {
    setNewsBusy(false);
  }
}

function getActiveRedditTabIndex() {
  const active = document.querySelector('#redditTabs .tab.active');
  const idx = parseInt(active?.dataset.index || '1', 10);
  return Number.isFinite(idx) ? idx : 1;
}

function setActiveRedditTab(index = 1) {
  const tabs = document.querySelectorAll('#redditTabs .tab');
  tabs.forEach(btn => {
    if (parseInt(btn.dataset.index || '1', 10) === index) btn.classList.add('active');
    else btn.classList.remove('active');
  });
}

function hydrateRedditTabs() {
  const tabs = document.querySelectorAll('#redditTabs .tab');
  const s1 = (getRedditSubreddit() || '').trim();
  const s2 = (getRedditSubredditAt(2) || '').trim();
  const s3 = (getRedditSubredditAt(3) || '').trim();
  const allSet = !!(s1 && s2 && s3);
  const mobile = isMobileView();
  tabs.forEach(btn => {
    const idx = parseInt(btn.dataset.index || '1', 10);
    let name = idx === 2 ? s2 : idx === 3 ? s3 : s1;
    name = (name || '').trim();
    let label = name || String(idx);
    if (mobile && allSet && name) {
      const cap = UI_CONFIG.subredditBtnCharCap;
      if (Number.isFinite(cap) && cap > 0 && label.length > cap) {
        label = label.slice(0, cap).replace(/\s+$/,'') + '…';
      }
    }
    btn.textContent = label;
    if (name) btn.title = name;
  });
}

function setRedditHeaderFromIndex(index = getActiveRedditTabIndex()) {
  const h = redditTitle && redditTitle();
  if (!h) return;
  const name = (index === 2 ? getRedditSubredditAt(2) : index === 3 ? getRedditSubredditAt(3) : getRedditSubreddit()).trim();
  h.textContent = name ? `Reddit - /r/${name}` : 'Reddit';
}

async function loadReddit(index = getActiveRedditTabIndex()) {
  setRedditBusy(true);
  renderRedditLoading();

  try {
    const sub = (index === 2 ? getRedditSubredditAt(2) : index === 3 ? getRedditSubredditAt(3) : getRedditSubreddit()).trim();
    if (!sub) {
      const msg = '<div class="news-item">Reddit requires a subreddit. Use the Settings (gear icon) to enter it.</div>';
      redditItems().innerHTML = msg;
      return;
    }
    const LIMIT = REDDIT_MAX_POSTS;
    const data = await fetchReddit(sub, { limit: LIMIT });
    renderRedditItems(data.items || []);
    updateRedditSummariesForViewport();
  } catch (err) {
    redditItems().innerHTML = '<div class="news-item">Failed to load Reddit. Try refresh.</div>';
  } finally {
    setRedditBusy(false);
  }
}


function initSettingsUI() {
  const btn = document.getElementById('settingsBtn');
  const modal = document.getElementById('settingsModal');
  const form = document.getElementById('settingsForm');
  const inputCity = document.getElementById('settingsCity');
  const selectState = document.getElementById('settingsState');
  const inputReddit = document.getElementById('settingsRedditSubreddit');
  const inputReddit2 = document.getElementById('settingsRedditSubreddit2');
  const inputReddit3 = document.getElementById('settingsRedditSubreddit3');
  const btnClose = document.getElementById('settingsClose');
  const btnCancel = document.getElementById('settingsCancel');

  if (!btn || !modal || !form || !inputCity || !selectState) return;

  function prefill() {
    const { city, state } = getLocation();
    inputCity.value = city || '';
    selectState.value = state || '';
    if (inputReddit) inputReddit.value = getRedditSubreddit() || '';
    if (inputReddit2) inputReddit2.value = getRedditSubredditAt(2) || '';
    if (inputReddit3) inputReddit3.value = getRedditSubredditAt(3) || '';
  }

  function open() {
    prefill();
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
    setTimeout(() => inputCity.focus(), 0);
  }

  function close() {
    modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('modal-open');
  }

  btn.addEventListener('click', open);
  if (btnClose) btnClose.addEventListener('click', close);
  if (btnCancel) btnCancel.addEventListener('click', close);

  // Click on backdrop closes
  modal.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-backdrop') || e.target.dataset.close === 'true') {
      close();
    }
  });

  // Esc closes while open
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.getAttribute('aria-hidden') === 'false') {
      close();
    }
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const city = (inputCity.value || '').trim();
    const state = (selectState.value || '').trim().toUpperCase();
    setLocation({ city, state });

    if (inputReddit) {
      const subreddit = (inputReddit.value || '').trim();
      setRedditSubreddit(subreddit);
    }
    if (inputReddit2) {
      const subreddit2 = (inputReddit2.value || '').trim();
      setRedditSubredditAt(2, subreddit2);
    }
    if (inputReddit3) {
      const subreddit3 = (inputReddit3.value || '').trim();
      setRedditSubredditAt(3, subreddit3);
    }

    close();

    // Refresh sections dependent on settings
    const active = document.querySelector('#newsTabs .tab.active')?.dataset.cat;
    if (active === 'local') {
      // Refresh local news with newly saved location
      void loadNews('local');
    }

    hydrateRedditTabs();
    setRedditHeaderFromIndex(getActiveRedditTabIndex());
    // no automatic Reddit fetch on settings save
  });
}
function startClock() {
  const update = () => {
    const now = new Date();
    if (clockTime()) clockTime().textContent = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (clockDate()) clockDate().textContent = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  };
  update();
  setInterval(update, UI_DEFAULTS.clockTickMs);
}