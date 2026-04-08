import { get, fmt$, fmtDate } from '/utils.js';

const LIMIT = 50;

function formatDuration(ms) {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

async function renderRequests(el, offset = 0, filters = {}) {
  const params = new URLSearchParams({
    limit: LIMIT,
    offset,
    ...filters,
  });
  const rows = await get(`/api/requests?${params}`);

  if (rows.length === 0 && offset === 0) {
    el.innerHTML = '<p class="empty">No API requests recorded yet.</p>';
    return;
  }

  el.innerHTML = `
    <div class="filters">
      <input type="text" id="model-filter" placeholder="Filter by model" value="${filters.model || ''}">
      <input type="number" id="min-cost" placeholder="Min cost" value="${filters.minCost || 0}" step="0.01">
      <input type="number" id="max-cost" placeholder="Max cost" value="${filters.maxCost || ''}" step="0.01">
      <button id="apply-filters">Apply Filters</button>
    </div>
    <table>
      <thead>
        <tr>
          <th>Timestamp</th>
          <th>Session ID</th>
          <th>Model</th>
          <th>Input</th>
          <th>Cache Read</th>
          <th>Cache Create</th>
          <th>Output</th>
          <th>Cost</th>
          <th>Duration</th>
          <th>Mode</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(r => `
          <tr>
            <td>${fmtDate(r.ts)}</td>
            <td class="mono muted">${r.session_id.slice(0, 8)}…</td>
            <td>${r.model}</td>
            <td>${r.input_tokens}</td>
            <td>${r.cache_read_tokens}</td>
            <td>${r.cache_creation_tokens}</td>
            <td>${r.output_tokens}</td>
            <td>${fmt$(r.cost_usd)}</td>
            <td>${formatDuration(r.duration_ms)}</td>
            <td>${r.is_fast_mode ? 'fast' : 'normal'}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    <div class="pagination">
      <button id="prev-btn" ${offset === 0 ? 'disabled' : ''}>← Prev</button>
      <span>${rows.length === 0 ? 'No more rows' : `Rows ${offset + 1}–${offset + rows.length}`}</span>
      <button id="next-btn" ${rows.length < LIMIT ? 'disabled' : ''}>Next →</button>
    </div>
  `;

  attachFilters(el, filters);
  attachPagination(el, offset, filters);
}

function attachFilters(el, filters) {
  const applyBtn = el.querySelector('#apply-filters');
  applyBtn?.addEventListener('click', () => {
    const newFilters = {
      model: el.querySelector('#model-filter')?.value || undefined,
      minCost: el.querySelector('#min-cost')?.value ? parseFloat(el.querySelector('#min-cost').value) : undefined,
      maxCost: el.querySelector('#max-cost')?.value ? parseFloat(el.querySelector('#max-cost').value) : undefined,
    };
    Object.keys(newFilters).forEach(k => newFilters[k] === undefined && delete newFilters[k]);
    renderRequests(el, 0, newFilters);
  });
}

function attachPagination(el, offset, filters) {
  el.querySelector('#prev-btn')?.addEventListener('click', () => {
    renderRequests(el, Math.max(0, offset - LIMIT), filters);
  });
  el.querySelector('#next-btn')?.addEventListener('click', () => {
    renderRequests(el, offset + LIMIT, filters);
  });
}

export async function render(el) {
  await renderRequests(el);
}
