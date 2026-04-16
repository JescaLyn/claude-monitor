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
 * Format a dollar amount to 2 decimal places.
 * @param {number|null|undefined} n
 */
export function fmt$(n) {
  return `$${(n ?? 0).toFixed(2)}`;
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
 * Format a timestamp as a human-readable local date/time.
 * Handles both milliseconds (started_at) and microseconds (ts).
 * @param {number|null|undefined} timestamp
 */
export function fmtDate(timestamp) {
  if (!timestamp) return '—';
  // If value > 1e13, likely microseconds; if < 1e13, likely milliseconds
  const ms = timestamp > 1e13 ? timestamp / 1000 : timestamp;
  return new Date(ms).toLocaleString();
}

/**
 * Format a timestamp as a human-readable local date/time without seconds.
 * Handles both milliseconds (started_at) and microseconds (ts).
 * @param {number|null|undefined} timestamp
 */
export function fmtDateNoSeconds(timestamp) {
  if (!timestamp) return '—';
  // If value > 1e13, likely microseconds; if < 1e13, likely milliseconds
  const ms = timestamp > 1e13 ? timestamp / 1000 : timestamp;
  const date = new Date(ms);
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });
}

/**
 * Split a timestamp into a short date and a short time,
 * for rendering stacked inside narrow table cells. Year is omitted
 * when it matches the current year. Handles both milliseconds and microseconds.
 * @param {number|null|undefined} timestamp
 * @returns {{date: string, time: string}}
 */
export function fmtDateParts(timestamp) {
  if (!timestamp) return { date: '—', time: '' };
  // If value > 1e13, likely microseconds; if < 1e13, likely milliseconds
  const ms = timestamp > 1e13 ? timestamp / 1000 : timestamp;
  const d = new Date(ms);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  const month = d.toLocaleDateString('en-US', { month: 'short' });
  const day = String(d.getDate()).padStart(2, '0');
  const date = sameYear ? `${month} ${day}` : `${month} ${day} ${d.getFullYear()}`;
  const time = d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  return { date, time };
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
