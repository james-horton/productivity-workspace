/**
 * Centralized client-side configuration for endpoints, timeouts, and UI constants.
 * Adjust values here to avoid magic strings/numbers across the app.
 */

export const API_BASE = '/api';

export const ENDPOINTS = Object.freeze({
  chat: `${API_BASE}/chat`,
  news: `${API_BASE}/news`,
  reddit: `${API_BASE}/reddit`,
  quote: `${API_BASE}/quote`
});

export const JSON_HEADERS = Object.freeze({
  'Content-Type': 'application/json'
});

export const TIMEOUTS = Object.freeze({
  // Default fetch abort timeout for generic operations
  defaultMs: 45000,
  // Chat requests may stream longer
  chatMs: 180000,
  // Quote is quick
  quoteMs: 20000
});

export const NEWS = Object.freeze({
  defaultCategory: 'national'
});

export const REDDIT = Object.freeze({
  // Max posts to display per subreddit tab
  maxPosts: 8
});

export const UI_DEFAULTS = Object.freeze({
  // Number of skeleton items to render while loading lists
  skeletonItemCount: 5,
  // Standard success feedback delay for temporary button labels/styles
  copySuccessDelayMs: 1200,
  // Slightly longer delay to restore labels after failure
  copyFailDelayMs: 1500,
  // Clock update frequency for the Now card
  clockTickMs: 1000
});