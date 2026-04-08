/**
 * Escape HTML special characters to prevent XSS
 * @param {string} text - Text to escape
 * @returns {string} Escaped HTML
 */
export function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * GET /api{path} and return parsed JSON. Throws on non-2xx.
 * @param {string} path  e.g. '/summary' or '/sessions?limit=20'
 */
export async function get(path) {
  const res = await fetch(`/api${path}`);
  if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
  return res.json();
}

/**
 * Format a dollar amount to 4 decimal places.
 * @param {number|null|undefined} n
 */
export function fmt$(n) {
  return `$${(n ?? 0).toFixed(4)}`;
}

/**
 * Format a token count with K/M suffix.
 * @param {number|null|undefined} n
 */
export function fmtTokens(n) {
  n = n ?? 0;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}

/**
 * Format a microsecond timestamp as a human-readable local date/time.
 * @param {number|null|undefined} microseconds
 */
export function fmtDate(microseconds) {
  if (!microseconds) return '—';
  return new Date(microseconds / 1000).toLocaleString();
}

/**
 * Format elapsed time between two microsecond timestamps.
 * Returns 'active' if endUs is null/undefined.
 * @param {number} startUs
 * @param {number|null|undefined} endUs
 */
export function fmtDuration(startUs, endUs) {
  if (!endUs) return 'active';
  const secs = Math.round((endUs - startUs) / 1_000_000);
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
}
