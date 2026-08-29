/**
 * Client wrapper for the project-local Micro Spreadsheet workbook.
 */

import { ENDPOINTS, JSON_HEADERS, TIMEOUTS } from '../config.js';

async function fetchWithTimeout(options) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), TIMEOUTS.defaultMs);
  try {
    return await fetch(ENDPOINTS.spreadsheet, { ...options, signal: controller.signal });
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Spreadsheet request timed out.');
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function responseError(response, operation) {
  let detail = '';
  try { detail = (await response.json()).error?.message || ''; } catch {}
  const suffix = detail ? `: ${detail}` : '';
  return new Error(`Spreadsheet ${operation} failed (${response.status})${suffix}`);
}

export async function fetchSpreadsheet() {
  const response = await fetchWithTimeout({ method: 'GET' });
  if (!response.ok) throw await responseError(response, 'load');
  return response.json();
}

export async function saveSpreadsheet(workbook) {
  const response = await fetchWithTimeout({
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify(workbook)
  });
  if (!response.ok) throw await responseError(response, 'save');
  return response.json();
}
