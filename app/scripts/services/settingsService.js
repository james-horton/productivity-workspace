/**
 * settingsService: client wrapper for GET/PUT /api/settings
 *
 * Settings are persisted server-side in secrets.json (the `userSettings` section).
 */

import { ENDPOINTS, JSON_HEADERS } from '../config.js';

/**
 * @typedef {{ city: string, state: string, subreddits: string[] }} UserSettings
 */

/**
 * Fetch the current user settings from the server.
 * @returns {Promise<UserSettings>}
 */
export async function fetchSettings() {
  const res = await fetch(ENDPOINTS.settings, { method: 'GET' });
  if (!res.ok) {
    let info = '';
    try { info = (await res.json()).error?.message || ''; } catch {}
    throw new Error(`Settings load failed (${res.status}): ${info}`);
  }
  return res.json();
}

/**
 * Persist the user settings to the server (writes to secrets.json).
 * @param {UserSettings} settings
 * @returns {Promise<UserSettings>}
 */
export async function saveSettings(settings) {
  const payload = {
    city: String(settings?.city || ''),
    state: String(settings?.state || ''),
    subreddits: Array.isArray(settings?.subreddits)
      ? settings.subreddits.slice(0, 3).map(s => String(s || ''))
      : []
  };

  const res = await fetch(ENDPOINTS.settings, {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    let info = '';
    try { info = (await res.json()).error?.message || ''; } catch {}
    throw new Error(`Settings save failed (${res.status}): ${info}`);
  }
  return res.json();
}
