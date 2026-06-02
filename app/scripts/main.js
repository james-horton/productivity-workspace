import { applyTheme } from './theme.js';
import { initState, getState, THEMES, MODES, setTheme, setMode, setModelKey, getChatHistory, appendChatMessage, clearChat, getLocation, setLocation, getRedditSubreddit, setRedditSubreddit, getRedditSubredditAt, setRedditSubredditAt, UI_CONFIG, loadUserSettings, getShowInspirationQuote, setShowInspirationQuote, getShowCalculator, setShowCalculator, getShowClock, setShowClock, getRoundedBorders, setRoundedBorders, BASIC_REASONING_LEVELS, DEFAULT_BASIC_REASONING, setBasicReasoning } from './state.js';
import { getModels, loadModels, providerFor, modelIdFor, getDefaultModelKey, getFavoriteModelIds, saveFavoriteModels } from './services/modelRegistry.js';
import { fetchQuote } from './services/quoteService.js';
import { sendChat } from './services/chatService.js';
import { fetchNews } from './services/newsService.js';
import { fetchReddit } from './services/redditService.js';
import { setDisclaimer, setBusy, renderChat, showAssistantTyping, hideAssistantTyping } from './ui/chatUI.js';
import { setNewsBusy, setActiveTab, renderNewsItems, renderNewsLoading, initNewsModalUI } from './ui/newsUI.js';
import { setRedditBusy, renderRedditItems, renderRedditLoading, updateRedditSummariesForViewport } from './ui/redditUI.js';
import { webSearch } from './services/webSearchService.js';
import { setWebSearchBusy, renderWebSearchResults, renderWebSearchLoading } from './ui/webSearchUI.js';
import { initMatrixRain, setMatrixRainEnabled } from './ui/matrixRain.js';
import { initNyanCat, setNyanCatEnabled } from './ui/nyanCat.js';
import { initUsaFlag, setUsaFlagEnabled } from './ui/usaFlag.js';
import { $, isMobileView } from './utils/helpers.js';
import { REDDIT, NEWS, UI_DEFAULTS } from './config.js';
import { initCalculatorUI } from './ui/calculatorUI.js';

const REDDIT_MAX_POSTS = REDDIT.maxPosts;
const ASSISTANT_TOP_ANCHOR_GAP_PX = UI_DEFAULTS.assistantTopAnchorGapPx || 0;

// Elements
const themeSelect = () => $('#themeSelect');
const modelSelect = () => $('#modelSelect');
const modelSelectLabel = () => $('#modelSelectLabel');
const modelCombobox = () => $('#modelCombobox');
const modelOptionsPanel = () => $('#modelOptionsPanel');
const modelFilterInput = () => $('#modelFilterInput');
const modelOptions = () => $('#modelOptions');
const modeSelect = () => $('#modeSelect');
const reasoningSelect = () => $('#reasoningSelect');
const reasoningControl = () => $('#reasoningControl');
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
const webSearchForm = () => $('#webSearchForm');
const webSearchInput = () => $('#webSearchInput');
const webSearchItems = () => $('#webSearchItems');
const webSearchReset = () => $('#webSearchReset');
const redditTabs = () => $('#redditTabs');
const redditRefresh = () => $('#redditRefresh');
const redditItems = () => $('#redditItems');
const redditTitle = () => $('#redditTitle');
const clockTime = () => $('#clockTime');
const clockDate = () => $('#clockDate');
let availableModels = [];
let modelFilterText = '';
let highlightedModelIndex = -1;
let modelDragState = null;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  initState();
  const s = getState();

  // Apply saved theme
  applyTheme(s.theme);
  applyRoundedBorders(getRoundedBorders());
  hydrateThemeSelect(s.theme);

  // Init header animations and toggle based on theme
  initMatrixRain(); initNyanCat(); initUsaFlag();
  setMatrixRainEnabled(s.theme === 'matrix'); setNyanCatEnabled(s.theme === 'nyan-cat'); setUsaFlagEnabled(s.theme === 'usa');
 
  // Populate model list and select
  void populateModelSelect(s.modelKey || getDefaultModelKey());

  // Mode select + disclaimer + chat starter
  hydrateModeSelect(s.mode);
  hydrateReasoningSelect(s.basicReasoning);
  syncReasoningControlVisibility(s.mode);
  syncDisclaimerForMode(s.mode);
  showStarterIfEmpty(s.mode);

  // Initial news + reddit
  setActiveTab(NEWS.defaultCategory);

  // Collapsible toggles are rendered inline below summaries in News and Web Search.

  void loadNews(NEWS.defaultCategory);

  // Update subreddit tab labels when viewport crosses mobile threshold
  window.addEventListener('resize', () => { hydrateRedditTabs(); updateRedditSummariesForViewport(); });

  // Clock + date
  startClock();

  // Wire listeners (safe before settings load — none depend on city/subreddits)
  wireControls();
  wireStateEvents();
  initSettingsUI();
  initNewsModalUI();
  initCalculatorUI();

  // Render initial chat from state (starter added above if needed)
  renderChat(getChatHistory(s.mode), { mode: s.mode });

  // Load user settings (city/state/subreddits) from server (secrets.json) and
  // then initialize the Reddit widget which depends on subreddit settings.
  loadUserSettings().finally(() => {
    syncInspirationSection();
    syncCalculatorSection();
    syncClockSection();
    document.body.dataset.userSettingsReady = 'true';
    applyRoundedBorders(getRoundedBorders());
    if (getShowInspirationQuote()) void refreshQuote();
    hydrateRedditTabs();
    setActiveRedditTab(1);
    setRedditHeaderFromIndex(1);
    void loadReddit(1);
  });
});

function wireControls() {
  // Model
  wireModelCombobox();

  // Mode
  modeSelect().addEventListener('change', (e) => {
    const m = e.target.value;
    setMode(m);
    syncDisclaimerForMode(m);
    showStarterIfEmpty(m);
    renderChat(getChatHistory(m), { mode: m });
  });

  // Reasoning level (only effective for Basic Info mode; server ignores it for other modes)
  const reasoningEl = reasoningSelect();
  if (reasoningEl) {
    reasoningEl.addEventListener('change', (e) => {
      setBasicReasoning(e.target.value);
    });
  }


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
 
  // Download chat or coder files
  const downloadBtn = chatDownload && chatDownload();
  if (downloadBtn) {
    downloadBtn.addEventListener('click', async () => {
      const s = getState();
      const history = getChatHistory(s.mode);

      if (s.mode === 'coder') {
        const files = collectCoderFiles(history);
        try {
          if (files && files.length) {
            try {
              await downloadCoderZip(files);
            } catch (err) {
              // Fallback: single text file when zipping is not available
              downloadCoderText(files, s.mode);
            }
          } else {
            // No code files parsed; fallback to conversation text export (JSON excluded by formatter)
            const text = formatChatForCopy(history, s.mode);
            const modeName = (MODES[s.mode]?.label || s.mode || 'chat');
            const modeSlug = String(modeName).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
            const now = new Date();
            const pad = (n) => String(n).padStart(2, '0');
            const ts = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
            const filename = `${modeSlug}_${ts}.txt`;
            const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
            triggerBlobDownload(blob, filename);
          }
        } finally {
          // Button feedback
          const btn = downloadBtn;
          const originalTitle = btn.title;
          const originalAria = btn.getAttribute('aria-label') || originalTitle || 'Download';
          btn.title = 'Downloaded';
          btn.setAttribute('aria-label', 'Downloaded');
          setTimeout(() => {
            btn.title = originalTitle;
            btn.setAttribute('aria-label', originalAria);
          }, UI_DEFAULTS.copySuccessDelayMs);
        }
        return;
      }

      // Non-coder modes: download plain text export
      const text = formatChatForCopy(history, s.mode);

      const modeName = (MODES[s.mode]?.label || s.mode || 'chat');
      const modeSlug = String(modeName).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      const now = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const ts = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
      const filename = `${modeSlug}_${ts}.txt`;

      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      triggerBlobDownload(blob, filename);

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

    // Scroll anchoring handled after assistant typing bubble is inserted.

    const s = getState();
    // Append user message to history
    appendChatMessage(s.mode, { role: 'user', content: text });
    input.value = '';
    // If textarea, trigger auto-resize shrink after clearing
    if (input.tagName && input.tagName.toLowerCase() === 'textarea') {
      input.dispatchEvent(new Event('input'));
    }

    // Render pending
    setBusy(true);
    renderChat(getChatHistory(s.mode), { mode: s.mode });
    showAssistantTyping();

    // Anchor the assistant typing message to the top of the viewport
    (() => {
      const row = document.querySelector('#chatMessages .msg.assistant.loading');
      if (!row) return;
      let headerOffset = 0;
      const header = document.getElementById('top');
      if (header) {
        const pos = window.getComputedStyle(header).position;
        if (pos === 'fixed' || pos === 'sticky') {
          headerOffset = header.getBoundingClientRect().height || 0;
        }
      }
      const rect = row.getBoundingClientRect();
      const y = window.scrollY + rect.top - headerOffset - ASSISTANT_TOP_ANCHOR_GAP_PX;
      window.scrollTo({ top: Math.max(0, y), left: 0, behavior: 'auto' });
    })();

    // Helper: keep the latest assistant message aligned to the top (avoids bottom-scrolling)
    const anchorLatestAssistantToTop = () => {
      const rows = document.querySelectorAll('#chatMessages .msg.assistant');
      const el = rows[rows.length - 1];
      if (!el) return;
      let headerOffset = 0;
      const header = document.getElementById('top');
      if (header) {
        const pos = window.getComputedStyle(header).position;
        if (pos === 'fixed' || pos === 'sticky') {
          headerOffset = header.getBoundingClientRect().height || 0;
        }
      }
      const rect = el.getBoundingClientRect();
      const y = window.scrollY + rect.top - headerOffset - ASSISTANT_TOP_ANCHOR_GAP_PX;
      window.scrollTo({ top: Math.max(0, y), left: 0, behavior: 'auto' });
    };

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
        model: modelId,
        reasoning: s.mode === 'basic' ? s.basicReasoning : undefined
      });

      hideAssistantTyping();

      if (resp?.disclaimer) setDisclaimer(resp.disclaimer);
      // Append assistant reply
      appendChatMessage(s.mode, resp.message);
      // Re-render with sources (if any)
      renderChat(getChatHistory(s.mode), { sources: resp.sources || [], mode: s.mode });
      // Maintain top anchoring on the final assistant message (avoid bottom scrolling)
      requestAnimationFrame(() => { anchorLatestAssistantToTop(); });
    } catch (err) {
      hideAssistantTyping();
      // Surface error as assistant message
      appendChatMessage(getState().mode, {
        role: 'assistant',
        content: `Error: ${err.message || 'Something went wrong.'}`
      });
      renderChat(getChatHistory(getState().mode), { mode: getState().mode });
      // Maintain top anchoring on the error assistant message as well
      requestAnimationFrame(() => { anchorLatestAssistantToTop(); });
    } finally {
      hideAssistantTyping();
      setBusy(false);
      chatForm().querySelector('button[type="submit"]').disabled = false;
      input.disabled = false;
      if (input.tagName && input.tagName.toLowerCase() === 'textarea') {
        input.dispatchEvent(new Event('input'));
      }
      
      // Keep the viewport at the top of a newly received assistant message.
      // Only autofocus the input on desktop when the last message is NOT from the assistant.
      const last = (getChatHistory(getState().mode) || []).slice(-1)[0];
      if (!isMobileView() && (!last || last.role !== 'assistant')) {
        input.focus();
      }
    }
  });

  // Enhance chat input when using textarea: auto-grow and Enter-to-send (Shift+Enter for newline)
  const inputEl = chatInput && chatInput();
  if (inputEl && inputEl.tagName.toLowerCase() === 'textarea') {
    const autoGrow = () => {
      const el = inputEl;
      if (!el) return;
      el.style.height = 'auto';
      const cs = window.getComputedStyle(el);
      const maxH = parseFloat(cs.maxHeight || '0') || Infinity;
      const newH = Math.min(el.scrollHeight, maxH);
      el.style.height = newH + 'px';
    };
    inputEl.setAttribute('rows', '1');
    inputEl.style.height = 'auto';
    inputEl.addEventListener('input', autoGrow);
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        chatForm().dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
      }
    });
    // Initialize height
    autoGrow();
  }

  // Web Search submit
  {
    const wsForm = webSearchForm && webSearchForm();
    if (wsForm) {
      let webSearchRequestId = 0;
      const wsResetBtn = webSearchReset && webSearchReset();
      if (wsResetBtn) {
        wsResetBtn.addEventListener('click', () => {
          const btn = wsResetBtn;
          const input = webSearchInput && webSearchInput();
          const box = webSearchItems && webSearchItems();
          const originalTitle = btn.title;
          const originalAria = btn.getAttribute('aria-label') || originalTitle || 'Reset';

          try {
            webSearchRequestId += 1;

            if (input) {
              input.value = '';
              input.disabled = false;
              if (input.tagName && input.tagName.toLowerCase() === 'textarea') {
                input.dispatchEvent(new Event('input'));
              }
            }

            if (box) {
              box.innerHTML = '';
              box.removeAttribute('data-collapsible');
              box.removeAttribute('aria-hidden');
            }

            setWebSearchBusy(false);

            const sourcesToggle = document.getElementById('webSearchSourcesToggle');
            if (sourcesToggle) sourcesToggle.remove();

            const submitBtn = wsForm.querySelector('button[type="submit"]');
            if (submitBtn) submitBtn.disabled = false;

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

      wsForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const input = webSearchInput && webSearchInput();
        const text = (input && input.value || '').trim();
        if (!text) return;

        const requestId = webSearchRequestId + 1;
        webSearchRequestId = requestId;
        setWebSearchBusy(true);
        renderWebSearchLoading();

        const btnEl = wsForm.querySelector('button[type="submit"]');
        if (btnEl) btnEl.disabled = true;
        if (input) input.disabled = true;

        try {
          const data = await webSearch(text);
          if (requestId !== webSearchRequestId) return;
          renderWebSearchResults((data && data.items) || [], { answer: data && data.answer });
        } catch (err) {
          if (requestId !== webSearchRequestId) return;
          const box = webSearchItems && webSearchItems();
          if (box) {
            box.innerHTML = '<div class="news-item">Failed to search the web. Try again.</div>';
          }
        } finally {
          if (requestId !== webSearchRequestId) return;
          setWebSearchBusy(false);
          if (btnEl) btnEl.disabled = false;
          if (input) {
            input.disabled = false;
            if (input.tagName && input.tagName.toLowerCase() === 'textarea') {
              input.dispatchEvent(new Event('input'));
            }
          }
        }
      });

      // Enhance web search input: auto-grow and Enter-to-submit (Shift+Enter for newline)
      const inputEl = webSearchInput && webSearchInput();
      if (inputEl && inputEl.tagName.toLowerCase() === 'textarea') {
        const autoGrowWS = () => {
          const el = inputEl;
          if (!el) return;
          el.style.height = 'auto';
          const cs = window.getComputedStyle(el);
          const maxH = parseFloat(cs.maxHeight || '0') || Infinity;
          const newH = Math.min(el.scrollHeight, maxH);
          el.style.height = newH + 'px';
        };
        inputEl.setAttribute('rows', '1');
        inputEl.style.height = 'auto';
        inputEl.addEventListener('input', autoGrowWS);
        inputEl.addEventListener('focus', () => inputEl.select());
        inputEl.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            wsForm.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
          }
        });
        autoGrowWS();
      }
    }
  }

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
    applyTheme(theme);
    setMatrixRainEnabled(theme === 'matrix'); setNyanCatEnabled(theme === 'nyan-cat'); setUsaFlagEnabled(theme === 'usa');
  });
  document.addEventListener('pw:model:changed', (e) => {
    const { modelKey } = e.detail || {};
    hydrateModelSelect(modelKey);
  });
  document.addEventListener('pw:mode:changed', (e) => {
    const { mode } = e.detail || {};
    hydrateModeSelect(mode);
    syncReasoningControlVisibility(mode);
    syncDisclaimerForMode(mode);
    showStarterIfEmpty(mode);
    renderChat(getChatHistory(mode), { mode });
  });
  document.addEventListener('pw:chat:updated', () => {
    const s = getState();
    renderChat(getChatHistory(s.mode), { mode: s.mode });
  });
  document.addEventListener('pw:reddit:changed', (e) => {
    hydrateRedditTabs();
    const idx = getActiveRedditTabIndex();
    setRedditHeaderFromIndex(idx);
    // Do not auto-fetch here; API only on page load, refresh click, or tab click
  });
  document.addEventListener('pw:ui-settings:changed', () => {
    syncInspirationSection();
    syncCalculatorSection();
    syncClockSection();
    applyRoundedBorders(getRoundedBorders());
  });
}

function hydrateThemeSelect(theme) {
  if (!themeSelect()) return;
  themeSelect().value = theme;
}

async function populateModelSelect(selectedKey) {
  const button = modelSelect();
  button.disabled = true;
  let models = getModels();
  try {
    models = await loadModels();
  } catch (_) {
    models = getModels();
  }
  availableModels = models;
  renderModelOptions();
  hydrateModelSelect(selectedKey || getDefaultModelKey());
  button.disabled = false;
}

function hydrateModelSelect(modelKey) {
  const selected = availableModels.find(m => m.key === modelKey);
  const found = !!selected;
  const defaultKey = getDefaultModelKey();
  const model = found ? selected : availableModels.find(m => m.key === defaultKey);
  if (modelSelectLabel()) modelSelectLabel().textContent = model ? model.label : 'Select model';
  if (modelSelect()) modelSelect().dataset.value = model ? model.key : '';
  syncSelectedModelOption(model ? model.key : '');
  if (!found && modelKey && modelKey !== defaultKey) {
    setModelKey(defaultKey);
  }
}

function wireModelCombobox() {
  const button = modelSelect();
  const filter = modelFilterInput();
  const list = modelOptions();
  if (!button || !filter || !list) return;

  button.addEventListener('click', () => {
    if (button.disabled) return;
    isModelComboboxOpen() ? closeModelCombobox() : openModelCombobox();
  });

  button.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openModelCombobox();
    }
  });

  filter.addEventListener('input', (e) => {
    modelFilterText = e.target.value || '';
    renderModelOptions();
  });

  filter.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      moveModelHighlight(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      moveModelHighlight(-1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      selectHighlightedModel();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeModelCombobox();
      button.focus();
    }
  });

  list.addEventListener('click', (e) => {
    if (modelDragState?.suppressClick) {
      e.preventDefault();
      modelDragState.suppressClick = false;
      return;
    }

    const favoriteToggle = e.target.closest('[data-model-favorite-toggle]');
    if (favoriteToggle) {
      e.preventDefault();
      e.stopPropagation();
      void toggleModelFavorite(favoriteToggle.dataset.modelKey);
      return;
    }

    const option = e.target.closest('[data-model-key]');
    if (!option) return;
    selectModel(option.dataset.modelKey);
  });

  list.addEventListener('pointerdown', handleModelPointerDown);
  list.addEventListener('pointermove', handleModelPointerMove);
  list.addEventListener('pointerup', handleModelPointerUp);
  list.addEventListener('pointercancel', cancelModelDrag);

  list.addEventListener('keydown', (e) => {
    const option = e.target.closest('[data-model-key]');
    if (!option || e.target.closest('[data-model-favorite-toggle]')) return;

    if ((e.altKey || e.ctrlKey) && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      const direction = e.key === 'ArrowUp' ? -1 : 1;
      void reorderFavoriteModel(option.dataset.modelKey, direction);
    }
  });

  modelCombobox()?.addEventListener('focusout', (e) => {
    const root = modelCombobox();
    if (root && !root.contains(e.relatedTarget)) closeModelCombobox();
  });

  document.addEventListener('click', (e) => {
    const root = modelCombobox();
    if (root && !root.contains(e.target)) closeModelCombobox();
  });
}

function isModelComboboxOpen() {
  return modelSelect()?.getAttribute('aria-expanded') === 'true';
}

function openModelCombobox() {
  const button = modelSelect();
  const panel = modelOptionsPanel();
  const filter = modelFilterInput();
  if (!button || !panel || !filter) return;
  button.setAttribute('aria-expanded', 'true');
  panel.hidden = false;
  modelFilterText = '';
  filter.value = '';
  renderModelOptions();
  requestAnimationFrame(() => filter.focus());
}

function closeModelCombobox() {
  const button = modelSelect();
  const panel = modelOptionsPanel();
  if (!button || !panel) return;
  button.setAttribute('aria-expanded', 'false');
  panel.hidden = true;
  highlightedModelIndex = -1;
  updateModelHighlight();
}

function renderModelOptions() {
  const list = modelOptions();
  if (!list) return;
  list.innerHTML = '';

  const query = normalizeModelSearch(modelFilterText);
  const matches = availableModels.filter(model => {
    if (!query) return true;
    return normalizeModelSearch(`${model.label} ${model.model} ${model.provider}`).includes(query);
  });

  const selectedKey = modelSelect()?.dataset.value || getState().modelKey || getDefaultModelKey();
  if (matches.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'model-combobox-empty';
    empty.textContent = 'No matching models';
    list.appendChild(empty);
    highlightedModelIndex = -1;
    modelFilterInput()?.removeAttribute('aria-activedescendant');
    return;
  }

  matches.forEach((model, index) => {
    const option = document.createElement('button');
    option.type = 'button';
    option.id = `model-option-${index}`;
    option.className = 'model-combobox-option';
    option.dataset.modelKey = model.key;
    option.dataset.modelId = model.model;
    option.dataset.index = String(index);
    option.dataset.favorite = model.favorite ? 'true' : 'false';
    option.dataset.default = model.default ? 'true' : 'false';
    option.dataset.favoritable = canFavoriteModel(model) ? 'true' : 'false';
    option.setAttribute('role', 'option');
    option.setAttribute('aria-selected', model.key === selectedKey ? 'true' : 'false');

    const label = document.createElement('span');
    label.className = 'model-combobox-option-label';
    label.textContent = model.label;

    option.append(label);

    if (canFavoriteModel(model)) {
      const favoriteToggle = document.createElement('span');
      favoriteToggle.className = 'model-favorite-toggle';
      favoriteToggle.dataset.modelFavoriteToggle = 'true';
      favoriteToggle.dataset.modelKey = model.key;
      favoriteToggle.setAttribute('role', 'button');
      favoriteToggle.setAttribute('tabindex', '-1');
      favoriteToggle.setAttribute('aria-label', model.favorite ? `Unfavorite ${model.label}` : `Favorite ${model.label}`);
      favoriteToggle.setAttribute('aria-pressed', model.favorite ? 'true' : 'false');
      favoriteToggle.title = model.favorite ? 'Remove from favorites' : 'Add to favorites';
      favoriteToggle.textContent = model.favorite ? '★' : '☆';
      option.append(favoriteToggle);
    }

    list.appendChild(option);

    if (model.favorite && matches[index + 1] && !matches[index + 1].favorite) {
      const separator = document.createElement('div');
      separator.className = 'model-combobox-separator';
      separator.setAttribute('role', 'separator');
      list.appendChild(separator);
    }
  });

  const selectedIndex = matches.findIndex(model => model.key === selectedKey);
  highlightedModelIndex = selectedIndex >= 0 ? selectedIndex : 0;
  updateModelHighlight();
}

function normalizeModelSearch(value) {
  return String(value || '').trim().toLowerCase();
}

function modelByKey(modelKey) {
  return availableModels.find(model => model.key === modelKey);
}

function canFavoriteModel(model) {
  return model?.provider === 'openrouter';
}

function getFavoriteModelsInOrder() {
  const ids = getFavoriteModelIds();
  const presentFavorites = availableModels
    .filter(model => canFavoriteModel(model) && model.favorite && !model.default)
    .map(model => model.model);
  const ordered = [];

  [...ids, ...presentFavorites].forEach(modelId => {
    if (!modelId || ordered.includes(modelId)) return;
    ordered.push(modelId);
  });

  return ordered;
}

function applyFavoriteState(favoriteIds) {
  const favoriteSet = new Set(favoriteIds);
  const staticDefaultKey = getDefaultModelKey();
  availableModels = availableModels.map(model => ({
    ...model,
    favorite: canFavoriteModel(model) && favoriteSet.has(model.model),
    default: model.key === staticDefaultKey
  })).sort((a, b) => {
    if ((a.key === staticDefaultKey) !== (b.key === staticDefaultKey)) {
      return a.key === staticDefaultKey ? -1 : 1;
    }

    if (a.default !== b.default) return a.default ? -1 : 1;

    const ar = favoriteIds.indexOf(a.model);
    const br = favoriteIds.indexOf(b.model);
    if (ar !== br) {
      if (ar === -1) return 1;
      if (br === -1) return -1;
      return ar - br;
    }

    if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
    return a.label.localeCompare(b.label);
  });
}

async function persistFavoriteModels(favoriteIds) {
  const previousModels = availableModels.map(model => ({ ...model }));
  const normalizedFavorites = favoriteIds.filter((modelId, index, list) => modelId && list.indexOf(modelId) === index);
  applyFavoriteState(normalizedFavorites);
  renderModelOptions();
  const selectedKey = modelSelect()?.dataset.value || getState().modelKey || getDefaultModelKey();
  hydrateModelSelect(selectedKey);

  try {
    availableModels = await saveFavoriteModels(normalizedFavorites);
    renderModelOptions();
    hydrateModelSelect(selectedKey);
  } catch (err) {
    console.warn('[models] Favorite update failed:', err.message || err);
    availableModels = previousModels;
    renderModelOptions();
    hydrateModelSelect(selectedKey);
  }
}

async function toggleModelFavorite(modelKey) {
  const model = modelByKey(modelKey);
  if (!canFavoriteModel(model) || model.default) return;

  const favorites = getFavoriteModelsInOrder();
  const favoriteIndex = favorites.indexOf(model.model);
  if (favoriteIndex === -1) {
    favorites.push(model.model);
  } else if (!model.default) {
    favorites.splice(favoriteIndex, 1);
  }

  await persistFavoriteModels(favorites);
}

async function reorderFavoriteModel(modelKey, direction) {
  const model = modelByKey(modelKey);
  if (!canFavoriteModel(model) || !model.favorite || model.default) return;

  const favorites = getFavoriteModelsInOrder();
  const currentIndex = favorites.indexOf(model.model);
  if (currentIndex === -1) return;

  const movableStart = firstMovableFavoriteIndex(favorites);
  const nextIndex = Math.max(movableStart, Math.min(favorites.length - 1, currentIndex + direction));
  if (nextIndex === currentIndex) return;

  favorites.splice(currentIndex, 1);
  favorites.splice(nextIndex, 0, model.model);
  await persistFavoriteModels(favorites);
}

function firstMovableFavoriteIndex(favorites) {
  const index = favorites.findIndex(modelId => {
    const model = availableModels.find(item => item.model === modelId);
    return !model || (canFavoriteModel(model) && !model.default);
  });
  return index === -1 ? 0 : index;
}

function dragTargetFromPointer(clientY) {
  const favoriteOptions = Array.from(modelOptions()?.querySelectorAll('[data-model-key][data-favoritable="true"][data-favorite="true"]:not([data-default="true"])') || [])
    .filter(option => option !== modelDragState?.option);
  if (!favoriteOptions.length) return null;

  const target = favoriteOptions.find(option => {
    const rect = option.getBoundingClientRect();
    return clientY < rect.top + rect.height / 2;
  });

  return target
    ? { option: target, after: false }
    : { option: favoriteOptions[favoriteOptions.length - 1], after: true };
}

function startModelDrag() {
  if (!modelDragState || !modelDragState.option || modelDragState.dragging) return;
  modelDragState.dragging = true;
  modelDragState.suppressClick = true;
  modelDragState.option.classList.add('dragging');
  modelOptions()?.classList.add('is-reordering');
}

function handleModelPointerDown(e) {
  if (e.button !== 0 || e.target.closest('[data-model-favorite-toggle]')) return;

  const option = e.target.closest('[data-model-key]');
  if (!option || option.dataset.favoritable !== 'true' || option.dataset.favorite !== 'true' || option.dataset.default === 'true') return;

  modelDragState = {
    pointerId: e.pointerId,
    option,
    modelKey: option.dataset.modelKey,
    startX: e.clientX,
    startY: e.clientY,
    holdReady: false,
    dragging: false,
    suppressClick: false,
    holdTimer: window.setTimeout(() => {
      if (!modelDragState) return;
      modelDragState.holdReady = true;
      startModelDrag();
    }, 250)
  };

  option.setPointerCapture?.(e.pointerId);
}

function handleModelPointerMove(e) {
  if (!modelDragState || e.pointerId !== modelDragState.pointerId) return;

  const deltaX = Math.abs(e.clientX - modelDragState.startX);
  const deltaY = Math.abs(e.clientY - modelDragState.startY);

  if (!modelDragState.dragging) {
    if ((deltaX > 6 || deltaY > 6) && !modelDragState.holdReady) {
      window.clearTimeout(modelDragState.holdTimer);
      cancelModelDrag();
    }

    return;
  }

  e.preventDefault();
  const targetInfo = dragTargetFromPointer(e.clientY);
  Array.from(modelOptions()?.querySelectorAll('[data-model-key]') || []).forEach(option => {
    option.classList.remove('drag-over-before', 'drag-over-after');
  });

  if (targetInfo?.option && targetInfo.option !== modelDragState.option) {
    targetInfo.option.classList.add(targetInfo.after ? 'drag-over-after' : 'drag-over-before');
  }
}

function handleModelPointerUp(e) {
  if (!modelDragState || e.pointerId !== modelDragState.pointerId) return;

  window.clearTimeout(modelDragState.holdTimer);
  modelDragState.option.releasePointerCapture?.(e.pointerId);

  if (modelDragState.dragging) {
    e.preventDefault();
    const model = modelByKey(modelDragState.modelKey);
    const targetInfo = dragTargetFromPointer(e.clientY);
    const target = targetInfo?.option;
    const favorites = getFavoriteModelsInOrder();
    const currentIndex = model ? favorites.indexOf(model.model) : -1;

    if (model && currentIndex !== -1 && target) {
      const targetModel = modelByKey(target.dataset.modelKey);
      const nextIndex = targetModel ? favorites.indexOf(targetModel.model) : -1;
      const movableStart = firstMovableFavoriteIndex(favorites);
      const insertionIndex = Math.max(movableStart, nextIndex + (targetInfo.after ? 1 : 0));

      if (nextIndex !== -1 && insertionIndex !== currentIndex) {
        favorites.splice(currentIndex, 1);
        favorites.splice(insertionIndex > currentIndex ? insertionIndex - 1 : insertionIndex, 0, model.model);
        void persistFavoriteModels(favorites);
      }
    }
  }

  cancelModelDrag();
}

function cancelModelDrag() {
  if (!modelDragState) return;
  window.clearTimeout(modelDragState.holdTimer);
  modelDragState.option?.classList.remove('dragging');
  Array.from(modelOptions()?.querySelectorAll('[data-model-key]') || []).forEach(option => {
    option.classList.remove('drag-over-before', 'drag-over-after');
  });
  modelOptions()?.classList.remove('is-reordering');

  const suppressClick = modelDragState.suppressClick;
  modelDragState = suppressClick ? { suppressClick: true } : null;
  if (suppressClick) {
    window.setTimeout(() => {
      if (modelDragState?.suppressClick) modelDragState = null;
    }, 0);
  }
}

function moveModelHighlight(direction) {
  const options = Array.from(modelOptions()?.querySelectorAll('[data-model-key]') || []);
  if (!options.length) return;
  highlightedModelIndex = (highlightedModelIndex + direction + options.length) % options.length;
  updateModelHighlight();
}

function updateModelHighlight() {
  const filter = modelFilterInput();
  const options = Array.from(modelOptions()?.querySelectorAll('[data-model-key]') || []);
  options.forEach((option, index) => {
    const active = index === highlightedModelIndex;
    option.classList.toggle('active', active);
    if (active) {
      filter?.setAttribute('aria-activedescendant', option.id);
      option.scrollIntoView({ block: 'nearest' });
    }
  });
  if (!options.length) filter?.removeAttribute('aria-activedescendant');
}

function selectHighlightedModel() {
  const option = Array.from(modelOptions()?.querySelectorAll('[data-model-key]') || [])[highlightedModelIndex];
  if (option) selectModel(option.dataset.modelKey);
}

function selectModel(modelKey) {
  if (!availableModels.some(model => model.key === modelKey)) return;
  setModelKey(modelKey);
  closeModelCombobox();
  modelSelect()?.focus();
}

function syncSelectedModelOption(modelKey) {
  const options = Array.from(modelOptions()?.querySelectorAll('[data-model-key]') || []);
  options.forEach(option => {
    option.setAttribute('aria-selected', option.dataset.modelKey === modelKey ? 'true' : 'false');
  });
}

function hydrateModeSelect(mode) {
  const sel = modeSelect();
  if (!MODES[mode]) mode = 'basic';
  sel.value = mode;
}

function hydrateReasoningSelect(level) {
  const sel = reasoningSelect();
  if (!sel) return;
  const val = BASIC_REASONING_LEVELS.includes(level) ? level : DEFAULT_BASIC_REASONING;
  sel.value = val;
}

function syncReasoningControlVisibility(mode) {
  const wrap = reasoningControl();
  if (!wrap) return;
  const show = mode === 'basic';
  wrap.hidden = !show;
  const sel = reasoningSelect();
  if (sel) sel.disabled = !show;
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
  // Special formatting for coder mode: include messages and code by filename, but never include raw JSON
  if (mode === 'coder') {
    return formatChatForCoderCopy(messages);
  }
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

// Build a copyable text for coder mode without including any JSON from the API
function formatChatForCoderCopy(messages) {
  const modeLabel = MODES['coder']?.label || 'Coder';
  const ts = new Date().toLocaleString();
  const header = `Chat - ${modeLabel} (${ts})`;
  const sep = '\n' + '-'.repeat(header.length) + '\n\n';
  const parts = [];
  (messages || []).forEach(m => {
    if (m.role === 'user') {
      parts.push(`User:\n${String(m.content || '')}`);
    } else {
      const blocks = tryParseCoderBlocks(String(m.content || ''));
      if (blocks) {
        blocks.forEach(b => {
          if (!b || typeof b !== 'object') return;
          if (b.type === 'paragraph') {
            parts.push(`Assistant:\n${String(b.text || '')}`);
          } else if (b.type === 'code') {
            const fname = sanitizeFilename(b.filename) || '(untitled)';
            const lang = (b.language || '').toString().trim();
            const label = `Assistant - File: ${fname}` + (lang ? ` [${lang}]` : '');
            parts.push(`${label}\n${String(b.code || '')}`);
          }
        });
      } else {
        // Not coder JSON; include as plain assistant text
        parts.push(`Assistant:\n${String(m.content || '')}`);
      }
    }
  });
  return header + sep + parts.join('\n\n') + '\n';
}

// Attempt to parse coder_blocks_v1 from assistant content; return blocks or null
function tryParseCoderBlocks(raw) {
  try {
    const obj = JSON.parse(String(raw || ''));
    if (obj && obj.format === 'coder_blocks_v1' && Array.isArray(obj.blocks)) {
      return obj.blocks;
    }
  } catch {}
  return null;
}

// Sanitize filenames for safe downloads
function sanitizeFilename(name) {
  const s = String(name || '').trim();
  if (!s) return '';
  return s.replace(/[/\\?%*:|"<>]/g, '').replace(/\s+/g, ' ').slice(0, 180);
}

// Collect the latest code block for each filename across the conversation (assistant messages only)
function collectCoderFiles(messages) {
  const map = new Map(); // filename -> { language, code }
  const order = [];
  (messages || []).forEach(m => {
    if (m.role !== 'assistant') return;
    const blocks = tryParseCoderBlocks(String(m.content || ''));
    if (!blocks) return;
    blocks.forEach(b => {
      if (!b || b.type !== 'code') return;
      const fname = sanitizeFilename(b.filename || '') || '';
      if (!fname) return;
      if (!map.has(fname)) order.push(fname);
      map.set(fname, {
        language: String(b.language || '').trim(),
        code: String(b.code || '')
      });
    });
  });
  return order.map(fname => ({ filename: fname, ...(map.get(fname) || { language: '', code: '' }) }));
}

// Derive a zip filename from the first code filename (exclude extension)
function fileBaseNameForZip(files) {
  const first = files && files[0] && files[0].filename;
  const base = sanitizeFilename(first || 'export');
  const name = base.replace(/\.[^.]+$/, '') || 'export';
  return name;
}

// Ensure JSZip is available (load from CDN if needed)
async function ensureJSZip() {
  if (window.JSZip) return window.JSZip;
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';
    s.onload = resolve;
    s.onerror = () => reject(new Error('Failed to load JSZip'));
    document.head.appendChild(s);
  });
  return window.JSZip;
}

// Generic blob download helper
function triggerBlobDownload(blob, filename) {
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
}

// Build and download a zip of all code files (coder mode)
async function downloadCoderZip(files) {
  const JSZip = await ensureJSZip();
  const zip = new JSZip();
  files.forEach(f => {
    const name = f.filename || 'snippet.txt';
    zip.file(name, String(f.code || ''));
  });
  const blob = await zip.generateAsync({ type: 'blob' });
  const zipName = fileBaseNameForZip(files) + '.zip';
  triggerBlobDownload(blob, zipName);
}

// Fallback: download a single .txt containing all code files with headers
function downloadCoderText(files, mode) {
  const modeLabel = MODES[mode]?.label || mode || 'chat';
  const ts = new Date().toLocaleString();
  const header = `Chat - ${modeLabel} (${ts})`;
  const sep = '\n' + '-'.repeat(header.length) + '\n\n';
  const body = (files || []).map(f => {
    const fname = f.filename || '(untitled)';
    return `=== ${fname} ===\n${String(f.code || '')}`;
  }).join('\n\n');
  const text = header + sep + body + '\n';

  const modeName = (MODES[mode]?.label || mode || 'chat');
  const modeSlug = String(modeName).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const ts2 = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  const filename = `${modeSlug}_${ts2}.txt`;

  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  triggerBlobDownload(blob, filename);
}

async function refreshQuote() {
  if (!getShowInspirationQuote()) {
    syncInspirationSection();
    return;
  }
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
    if (!getShowInspirationQuote()) {
      syncInspirationSection();
      return;
    }
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

function syncInspirationSection() {
  const show = getShowInspirationQuote();
  const card = document.querySelector('.quote-card');
  if (card) {
    card.hidden = !show;
    card.setAttribute('aria-hidden', show ? 'false' : 'true');
  }
  const btn = quoteRefresh && quoteRefresh();
  if (btn) btn.disabled = !show;
  if (!show) {
    const box = quoteText && quoteText();
    if (box) {
      box.classList.remove('is-loading');
      box.textContent = '';
    }
  }
}

function syncCalculatorSection() {
  const show = getShowCalculator();
  const card = document.getElementById('calculator');
  if (card) {
    card.hidden = !show;
    card.setAttribute('aria-hidden', show ? 'false' : 'true');
  }
}

function syncClockSection() {
  const show = getShowClock();
  const card = document.querySelector('.clock-card');
  if (card) {
    card.hidden = !show;
    card.setAttribute('aria-hidden', show ? 'false' : 'true');
  }
}

function applyRoundedBorders(rounded) {
  document.body.dataset.roundedBorders = rounded === false ? 'false' : 'true';
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
        renderNewsItems(data.items || [], { answer: data.answer });
      }
    } else {
      data = await fetchNews(category);
      renderNewsItems(data.items || [], { answer: data.answer });
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
  const names = [];
  let allSet = true;
  for (let i = 1; i <= 10; i += 1) {
    const n = (getRedditSubredditAt(i) || '').trim();
    names[i] = n;
    if (!n) allSet = false;
  }
  const mobile = isMobileView();
  tabs.forEach(btn => {
    const idx = parseInt(btn.dataset.index || '1', 10);
    const name = names[idx] || '';
    let label = name || String(idx);
    if (mobile && allSet && name) {
      const cap = UI_CONFIG.subredditBtnCharCap;
      if (Number.isFinite(cap) && cap > 0 && label.length > cap) {
        label = label.slice(0, cap).replace(/\s+$/,'') + '\u2026';
      }
    }
    btn.textContent = label;
    if (name) btn.title = name;
  });
}

function setRedditHeaderFromIndex(index = getActiveRedditTabIndex()) {
  const h = redditTitle && redditTitle();
  if (!h) return;
  const name = (getRedditSubredditAt(index) || '').trim();
  h.textContent = name ? `Reddit - /r/${name}` : 'Reddit';
}

async function loadReddit(index = getActiveRedditTabIndex()) {
  setRedditBusy(true);
  renderRedditLoading();

  try {
    const sub = (getRedditSubredditAt(index) || '').trim();
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
  const selectTheme = document.getElementById('themeSelect');
  const inputShowInspiration = document.getElementById('settingsShowInspiration');
  const inputShowCalculator = document.getElementById('settingsShowCalculator');
  const inputShowClock = document.getElementById('settingsShowClock');
  const inputRoundedBorders = document.getElementById('settingsRoundedBorders');
  const inputCity = document.getElementById('settingsCity');
  const selectState = document.getElementById('settingsState');
  const inputReddit = document.getElementById('settingsRedditSubreddit');
  const inputReddit2 = document.getElementById('settingsRedditSubreddit2');
  const inputReddit3 = document.getElementById('settingsRedditSubreddit3');
  const inputReddit4 = document.getElementById('settingsRedditSubreddit4');
  const inputReddit5 = document.getElementById('settingsRedditSubreddit5');
  const inputReddit6 = document.getElementById('settingsRedditSubreddit6');
  const inputReddit7 = document.getElementById('settingsRedditSubreddit7');
  const inputReddit8 = document.getElementById('settingsRedditSubreddit8');
  const inputReddit9 = document.getElementById('settingsRedditSubreddit9');
  const inputReddit10 = document.getElementById('settingsRedditSubreddit10');
  const btnClose = document.getElementById('settingsClose');
  const btnCancel = document.getElementById('settingsCancel');

  const settingsTabs = document.getElementById('settingsTabs');
  const panelGeneral = document.getElementById('settingsPanelGeneral');
  const panelUI = document.getElementById('settingsPanelUI');

  if (!btn || !modal || !form || !selectTheme || !inputCity || !selectState) return;

  if (settingsTabs && panelGeneral && panelUI) {
    const tabButtons = settingsTabs.querySelectorAll('.tab');
    tabButtons.forEach(button => {
      button.addEventListener('click', () => {
        tabButtons.forEach(btn => btn.classList.remove('active'));
        button.classList.add('active');

        const targetTab = button.dataset.tab;
        if (targetTab === 'general') {
          panelGeneral.classList.remove('hidden');
          panelUI.classList.add('hidden');
        } else if (targetTab === 'ui') {
          panelGeneral.classList.add('hidden');
          panelUI.classList.remove('hidden');
        }
      });
    });
  }

  function prefill() {
    selectTheme.value = getState().theme || 'matrix';
    if (inputShowInspiration) inputShowInspiration.checked = getShowInspirationQuote();
    if (inputShowCalculator) inputShowCalculator.checked = getShowCalculator();
    if (inputShowClock) inputShowClock.checked = getShowClock();
    if (inputRoundedBorders) inputRoundedBorders.checked = getRoundedBorders();
    const { city, state } = getLocation();
    inputCity.value = city || '';
    selectState.value = state || '';
    if (inputReddit) inputReddit.value = getRedditSubreddit() || '';
    if (inputReddit2) inputReddit2.value = getRedditSubredditAt(2) || '';
    if (inputReddit3) inputReddit3.value = getRedditSubredditAt(3) || '';
    if (inputReddit4) inputReddit4.value = getRedditSubredditAt(4) || '';
    if (inputReddit5) inputReddit5.value = getRedditSubredditAt(5) || '';
    if (inputReddit6) inputReddit6.value = getRedditSubredditAt(6) || '';
    if (inputReddit7) inputReddit7.value = getRedditSubredditAt(7) || '';
    if (inputReddit8) inputReddit8.value = getRedditSubredditAt(8) || '';
    if (inputReddit9) inputReddit9.value = getRedditSubredditAt(9) || '';
    if (inputReddit10) inputReddit10.value = getRedditSubredditAt(10) || '';
  }

  function open() {
    prefill();
    // Reset to General tab on open
    if (settingsTabs && panelGeneral && panelUI) {
      const tabButtons = settingsTabs.querySelectorAll('.tab');
      tabButtons.forEach(btn => {
        if (btn.dataset.tab === 'general') {
          btn.classList.add('active');
        } else {
          btn.classList.remove('active');
        }
      });
      panelGeneral.classList.remove('hidden');
      panelUI.classList.add('hidden');
    }
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
    setTimeout(() => {
      if (inputCity) inputCity.focus();
    }, 0);
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
    const theme = (selectTheme.value || '').trim();
    if (THEMES.includes(theme)) setTheme(theme);
    const wasShowingInspiration = getShowInspirationQuote();
    if (inputShowInspiration) setShowInspirationQuote(inputShowInspiration.checked);
    if (inputShowCalculator) setShowCalculator(inputShowCalculator.checked);
    if (inputShowClock) setShowClock(inputShowClock.checked);
    if (inputRoundedBorders) setRoundedBorders(inputRoundedBorders.checked);
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
    if (inputReddit4) {
      const subreddit4 = (inputReddit4.value || '').trim();
      setRedditSubredditAt(4, subreddit4);
    }
    if (inputReddit5) {
      const subreddit5 = (inputReddit5.value || '').trim();
      setRedditSubredditAt(5, subreddit5);
    }
    if (inputReddit6) {
      const subreddit6 = (inputReddit6.value || '').trim();
      setRedditSubredditAt(6, subreddit6);
    }
    if (inputReddit7) {
      const subreddit7 = (inputReddit7.value || '').trim();
      setRedditSubredditAt(7, subreddit7);
    }
    if (inputReddit8) {
      const subreddit8 = (inputReddit8.value || '').trim();
      setRedditSubredditAt(8, subreddit8);
    }
    if (inputReddit9) {
      const subreddit9 = (inputReddit9.value || '').trim();
      setRedditSubredditAt(9, subreddit9);
    }
    if (inputReddit10) {
      const subreddit10 = (inputReddit10.value || '').trim();
      setRedditSubredditAt(10, subreddit10);
    }

    close();

    syncInspirationSection();
    syncCalculatorSection();
    syncClockSection();
    applyRoundedBorders(getRoundedBorders());
    if (!wasShowingInspiration && getShowInspirationQuote()) void refreshQuote();

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
