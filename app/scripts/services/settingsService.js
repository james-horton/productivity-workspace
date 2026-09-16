/**
 * settingsService: client wrapper for GET/PUT /api/settings
 *
 * Settings are persisted server-side in secrets.json (the `userSettings` section).
 */

import { ENDPOINTS, JSON_HEADERS, TIMEOUTS } from '../config.js';

/**
 * @typedef {{ theme: string, openaiModel: 'gpt-5.6-sol' | 'gpt-6-astra', city: string, state: string, subreddits: string[], showInspirationQuote: boolean, showCalculator: boolean, showClock: boolean, clockView: 'digital' | 'analog-marks' | 'analog-quarters' | 'analog-numerals' | 'analog-roman-numerals', showAnalogClockFrame: boolean, analogClockFrameWidth: number, showWebSearch: boolean, showAgent: boolean, showReddit: boolean, roundedBorders: boolean }} UserSettings
 */

/**
 * Fetch the current user settings from the server.
 * @returns {Promise<UserSettings>}
 */
export async function fetchSettings() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUTS.defaultMs);
  try {
    const res = await fetch(ENDPOINTS.settings, { method: 'GET', signal: ctrl.signal });
    if (!res.ok) {
      let info = '';
      try { info = (await res.json()).error?.message || ''; } catch {}
      throw new Error(`Settings load failed (${res.status}): ${info}`);
    }
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Persist the user settings to the server (writes to secrets.json).
 * @param {UserSettings} settings
 * @returns {Promise<UserSettings>}
 */
export async function saveSettings(settings) {
  const payload = {
    theme: String(settings?.theme || ''),
    openaiModel: ['gpt-5.6-sol', 'gpt-6-astra'].includes(settings?.openaiModel)
      ? settings.openaiModel
      : 'gpt-5.6-sol',
    city: String(settings?.city || ''),
    state: String(settings?.state || ''),
    subreddits: Array.isArray(settings?.subreddits)
      ? settings.subreddits.slice(0, 10).map(s => String(s || ''))
      : [],
    showInspirationQuote: settings?.showInspirationQuote !== false,
    showCalculator: settings?.showCalculator !== false,
    showClock: settings?.showClock !== false,
    clockView: ['analog-marks', 'analog-quarters', 'analog-numerals', 'analog-roman-numerals'].includes(settings?.clockView)
      ? settings.clockView
      : 'digital',
    showAnalogClockFrame: settings?.showAnalogClockFrame !== false,
    analogClockFrameWidth: Number.isFinite(Number(settings?.analogClockFrameWidth))
      ? Math.max(1, Math.min(10, Math.round(Number(settings.analogClockFrameWidth))))
      : 10,
    showWebSearch: settings?.showWebSearch !== false,
    showAgent: settings?.showAgent !== false,
    showReddit: settings?.showReddit === true,
    roundedBorders: settings?.roundedBorders !== false
  };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUTS.defaultMs);
  try {
    const res = await fetch(ENDPOINTS.settings, {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify(payload),
      signal: ctrl.signal
    });
    if (!res.ok) {
      let info = '';
      try { info = (await res.json()).error?.message || ''; } catch {}
      throw new Error(`Settings save failed (${res.status}): ${info}`);
    }
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}
