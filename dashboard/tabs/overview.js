import { get, fmt$, fmtTokens } from '../utils.js';

export async function render(el) {
  const d = await get('/summary');

  el.innerHTML = `
    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-value">${fmt$(d.total_cost_usd)}</div>
        <div class="stat-label">Total Cost</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${d.total_sessions}</div>
        <div class="stat-label">Sessions</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${d.total_api_requests}</div>
        <div class="stat-label">API Requests</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${fmtTokens(d.total_input_tokens)}</div>
        <div class="stat-label">Input Tokens</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${fmtTokens(d.total_output_tokens)}</div>
        <div class="stat-label">Output Tokens</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${fmtTokens(d.total_cache_read_tokens)}</div>
        <div class="stat-label">Cache Read</div>
      </div>
    </div>
  `;
}
