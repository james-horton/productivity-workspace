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
const CLOCK_VIEWS = ['digital', 'analog-marks', 'analog-quarters', 'analog-numerals', 'analog-roman-numerals'];
const MIN_ANALOG_CLOCK_FRAME_WIDTH = 1;
const MAX_ANALOG_CLOCK_FRAME_WIDTH = 10;

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
  try {
    fs.renameSync(tmpPath, SECRETS_PATH);
  } catch (err) {
    if (!['EEXIST', 'EPERM'].includes(err.code)) throw err;
    const backupPath = path.join(dir, `.secrets.${process.pid}.${Date.now()}.bak`);
    let backupCreated = false;
    try {
      if (fs.existsSync(SECRETS_PATH)) {
        fs.renameSync(SECRETS_PATH, backupPath);
        backupCreated = true;
      }
      fs.renameSync(tmpPath, SECRETS_PATH);
    } catch (replaceErr) {
      if (backupCreated && !fs.existsSync(SECRETS_PATH)) {
        try {
          fs.renameSync(backupPath, SECRETS_PATH);
        } catch {
          fs.copyFileSync(backupPath, SECRETS_PATH);
        }
      }
      throw replaceErr;
    }
    if (backupCreated) {
      try { fs.unlinkSync(backupPath); } catch {}
    }
  }
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

function normalizeClockView(value) {
  if (value === 'analog') return 'analog-marks';
  return CLOCK_VIEWS.includes(value) ? value : 'digital';
}

function normalizeBoolean(value, fallback = true) {
  if (typeof value === 'boolean') return value;
  if (value == null) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function normalizeAnalogClockFrameWidth(value) {
  const width = Math.round(Number(value));
  return Number.isFinite(width)
    ? Math.max(MIN_ANALOG_CLOCK_FRAME_WIDTH, Math.min(MAX_ANALOG_CLOCK_FRAME_WIDTH, width))
    : MAX_ANALOG_CLOCK_FRAME_WIDTH;
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
    clockView: normalizeClockView(s.clockView),
    showAnalogClockFrame: normalizeBoolean(s.showAnalogClockFrame, true),
    analogClockFrameWidth: normalizeAnalogClockFrameWidth(s.analogClockFrameWidth),
    showWebSearch: normalizeBoolean(s.showWebSearch, true),
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
    const currentClockView = normalizeClockView((config.userSettings || {}).clockView);
    const currentShowAnalogClockFrame = normalizeBoolean((config.userSettings || {}).showAnalogClockFrame, true);
    const currentAnalogClockFrameWidth = normalizeAnalogClockFrameWidth((config.userSettings || {}).analogClockFrameWidth);
    const currentShowWebSearch = normalizeBoolean((config.userSettings || {}).showWebSearch, true);
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
    const clockView = Object.prototype.hasOwnProperty.call(body, 'clockView')
      ? normalizeClockView(body.clockView)
      : currentClockView;
    const showAnalogClockFrame = Object.prototype.hasOwnProperty.call(body, 'showAnalogClockFrame')
      ? normalizeBoolean(body.showAnalogClockFrame, true)
      : currentShowAnalogClockFrame;
    const analogClockFrameWidth = Object.prototype.hasOwnProperty.call(body, 'analogClockFrameWidth')
      ? normalizeAnalogClockFrameWidth(body.analogClockFrameWidth)
      : currentAnalogClockFrameWidth;
    const showWebSearch = Object.prototype.hasOwnProperty.call(body, 'showWebSearch')
      ? normalizeBoolean(body.showWebSearch, true)
      : currentShowWebSearch;
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
    secrets.userSettings.clockView = clockView;
    secrets.userSettings.showAnalogClockFrame = showAnalogClockFrame;
    secrets.userSettings.analogClockFrameWidth = analogClockFrameWidth;
    secrets.userSettings.showWebSearch = showWebSearch;
    secrets.userSettings.roundedBorders = roundedBorders;
    writeSecretsFile(secrets);

    // Sync in-memory config so subsequent GETs reflect the change immediately.
    config.userSettings = { theme, city, state, subreddits, showInspirationQuote, showCalculator, showClock, clockView, showAnalogClockFrame, analogClockFrameWidth, showWebSearch, roundedBorders };

    res.json(buildSettingsResponse());
  } catch (err) {
    next(err);
  }
});

module.exports = router;
