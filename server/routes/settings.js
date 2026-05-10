/**
 * User settings persistence (city, state, reddit subreddits).
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
const SUBREDDIT_SLOTS = 3;

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

function normalizeCity(value) {
  return String(value == null ? '' : value).trim().slice(0, MAX_CITY_LEN);
}

function normalizeState(value) {
  return String(value == null ? '' : value).trim().toUpperCase().slice(0, MAX_STATE_LEN);
}

function buildSettingsResponse() {
  const s = config.userSettings || {};
  const subs = Array.isArray(s.subreddits) ? s.subreddits : [];
  const slots = [];
  for (let i = 0; i < SUBREDDIT_SLOTS; i += 1) {
    slots.push(String(subs[i] || ''));
  }
  return {
    city: String(s.city || ''),
    state: String(s.state || '').toUpperCase(),
    subreddits: slots
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
    const city = normalizeCity(body.city);
    const state = normalizeState(body.state);

    const incomingSubs = Array.isArray(body.subreddits) ? body.subreddits : [];
    const subreddits = [];
    for (let i = 0; i < SUBREDDIT_SLOTS; i += 1) {
      subreddits.push(normalizeSubreddit(incomingSubs[i]));
    }

    const secrets = readSecretsFile();
    secrets.userSettings = (secrets.userSettings && typeof secrets.userSettings === 'object')
      ? secrets.userSettings
      : {};
    secrets.userSettings.city = city;
    secrets.userSettings.state = state;
    secrets.userSettings.subreddits = subreddits;
    writeSecretsFile(secrets);

    // Sync in-memory config so subsequent GETs reflect the change immediately.
    config.userSettings = { city, state, subreddits };

    res.json(buildSettingsResponse());
  } catch (err) {
    next(err);
  }
});

module.exports = router;
