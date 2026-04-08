import { get, fmt$, fmtTokens, fmtDate, fmtDuration } from '/utils.js';

const LIMIT = 20;

function buildTable(rows, offset) {
  if (rows.length === 0 && offset === 0) {
    return '<p class="empty">No sessions recorded yet.</p>';
  }

  return `
    <table>
      <thead>
        <tr>
          <th>Session ID</th>
          <th>Machine</th>
          <th>Model</th>
          <th>Started</th>
          <th>Duration</th>
          <th>Cost</th>
          <th>In / Out Tokens</th>
          <th>Requests</th>
          <th>Tools</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(r => `
          <tr>
            <td class="mono">${r.id.slice(0, 8)}…</td>
            <td>${r.machine_id}</td>
            <td>${r.model ?? '—'}</td>
            <td>${fmtDate(r.started_at)}</td>
            <td>${fmtDuration(r.started_at, r.ended_at)}</td>
            <td>${fmt$(r.cost_usd)}</td>
            <td>${fmtTokens(r.input_tokens)} / ${fmtTokens(r.output_tokens)}</td>
            <td>${r.api_request_count}</td>
            <td>${r.tool_call_count}</td>
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
}

async function renderPage(el, offset) {
  const rows = await get(`/sessions?limit=${LIMIT}&offset=${offset}`);
  el.innerHTML = buildTable(rows, offset);

  el.querySelector('#prev-btn')?.addEventListener('click', () =>
    renderPage(el, Math.max(0, offset - LIMIT))
  );
  el.querySelector('#next-btn')?.addEventListener('click', () =>
    renderPage(el, offset + LIMIT)
  );
}

export async function render(el) {
  await renderPage(el, 0);
}
