/**
 * Theme utilities: apply theme to document root
 */

export function applyTheme(theme) {
  if (!theme) return;
  document.body.setAttribute('data-theme', theme);
}