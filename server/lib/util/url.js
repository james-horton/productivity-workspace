'use strict';

/**
 * Extract hostname from a URL string, stripping a leading "www." if present.
 * Returns empty string on invalid input.
 * @param {string} url
 * @returns {string}
 */
function hostFromUrl(url) {
  try {
    return new URL(String(url || '')).hostname.replace(/^www\./i, '');
  } catch {
    return '';
  }
}

module.exports = { hostFromUrl };