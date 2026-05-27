/**
 * User settings persistence (theme, city, state, reddit subreddits, UI options).
 * Reads/writes the `userSettings` section of secrets.json.
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const { config } = require('../config');

const router = express.Router();

const SECRETS_PATH = path.resolve(__dirname, '..', '..', 'secrets.json');

const MAX_CITY_LEN = 100;
const MAX_STATE_LEN = 4;
const MAX_SUBREDDIT_LEN = 64;
const SUBREDDIT_SLOTS = 10;
const THEMES = ['matrix', 'dark', 'dark-black', 'aurora', 'light', 'bright-white', 'nyan-cat', 'rainbow', 'bumblebee', 'orangeade', 'sky-blue', 'usa', '90s'];

function readSecretsFile() {
  try {
    return JSON.parse(fs.readFileSync(SECRETS_PATH, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
}

function writeSecretsFile(secrets) {
  const dir = path.dirname(SECRETS_PATH);
  const tmpPath = path.join(dir, `.secrets.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmpPath, `${JSON.stringify(secrets, null, 2)}\n`, 'utf8');
  fs.renameSync(tmpPath, SECRETS_PATH);
}

function normalizeSubreddit(name) {
  return String(name == null ? '' : name)
    .replace(/^\/?r\//i, '')
    .trim()
    .slice(0, MAX_SUBREDDIT_LEN);
}

function normalizeTheme(value) {
  const theme = String(value == null ? '' : value).trim();
  return THEMES.includes(theme) ? theme : 'matrix';
}

function normalizeCity(value) {
  return String(value == null ? '' : value).trim().slice(0, MAX_CITY_LEN);
}

function normalizeState(value) {
  return String(value == null ? '' : value).trim().toUpperCase().slice(0, MAX_STATE_LEN);
}

function normalizeBoolean(value, fallback = true) {
  if (typeof value === 'boolean') return value;
  if (value == null) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function buildSettingsResponse() {
  const s = config.userSettings || {};
  const subs = Array.isArray(s.subreddits) ? s.subreddits : [];
  const slots = [];
  for (let i = 0; i < SUBREDDIT_SLOTS; i += 1) {
    slots.push(String(subs[i] || ''));
  }
  return {
    theme: normalizeTheme(s.theme),
    city: String(s.city || ''),
    state: String(s.state || '').toUpperCase(),
    subreddits: slots,
    showInspirationQuote: normalizeBoolean(s.showInspirationQuote, true),
    showCalculator: normalizeBoolean(s.showCalculator, true),
    showClock: normalizeBoolean(s.showClock, true),
    roundedBorders: normalizeBoolean(s.roundedBorders, true)
  };
}

router.get('/', (req, res, next) => {
  try {
    res.json(buildSettingsResponse());
  } catch (err) {
    next(err);
  }
});

router.put('/', (req, res, next) => {
  try {
    const body = req.body || {};
    const currentTheme = normalizeTheme((config.userSettings || {}).theme);
    const theme = Object.prototype.hasOwnProperty.call(body, 'theme')
      ? normalizeTheme(body.theme)
      : currentTheme;
    const currentShowInspirationQuote = normalizeBoolean((config.userSettings || {}).showInspirationQuote, true);
    const currentShowCalculator = normalizeBoolean((config.userSettings || {}).showCalculator, true);
    const currentShowClock = normalizeBoolean((config.userSettings || {}).showClock, true);
    const currentRoundedBorders = normalizeBoolean((config.userSettings || {}).roundedBorders, true);
    const city = normalizeCity(body.city);
    const state = normalizeState(body.state);
    const showInspirationQuote = Object.prototype.hasOwnProperty.call(body, 'showInspirationQuote')
      ? normalizeBoolean(body.showInspirationQuote, true)
      : currentShowInspirationQuote;
    const showCalculator = Object.prototype.hasOwnProperty.call(body, 'showCalculator')
      ? normalizeBoolean(body.showCalculator, true)
      : currentShowCalculator;
    const showClock = Object.prototype.hasOwnProperty.call(body, 'showClock')
      ? normalizeBoolean(body.showClock, true)
      : currentShowClock;
    const roundedBorders = Object.prototype.hasOwnProperty.call(body, 'roundedBorders')
      ? normalizeBoolean(body.roundedBorders, true)
      : currentRoundedBorders;

    const incomingSubs = Array.isArray(body.subreddits) ? body.subreddits : [];
    const subreddits = [];
    for (let i = 0; i < SUBREDDIT_SLOTS; i += 1) {
      subreddits.push(normalizeSubreddit(incomingSubs[i]));
    }

    const secrets = readSecretsFile();
    secrets.userSettings = (secrets.userSettings && typeof secrets.userSettings === 'object')
      ? secrets.userSettings
      : {};
    secrets.userSettings.theme = theme;
    secrets.userSettings.city = city;
    secrets.userSettings.state = state;
    secrets.userSettings.subreddits = subreddits;
    secrets.userSettings.showInspirationQuote = showInspirationQuote;
    secrets.userSettings.showCalculator = showCalculator;
    secrets.userSettings.showClock = showClock;
    secrets.userSettings.roundedBorders = roundedBorders;
    writeSecretsFile(secrets);

    // Sync in-memory config so subsequent GETs reflect the change immediately.
    config.userSettings = { theme, city, state, subreddits, showInspirationQuote, showCalculator, showClock, roundedBorders };

    res.json(buildSettingsResponse());
  } catch (err) {
    next(err);
  }
});

module.exports = router;
