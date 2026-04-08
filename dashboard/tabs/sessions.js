import { get, fmt$, fmtTokens, fmtDate, fmtDuration } from '/utils.js';

const LIMIT = 20;

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function nameCell(row) {
  if (row.name) {
    return `<td class="session-name" data-id="${escapeHtml(row.id)}" data-name="${escapeHtml(row.name)}">${escapeHtml(row.name)}</td>`;
  }
  return `<td class="session-name mono muted" data-id="${escapeHtml(row.id)}" data-name="">${escapeHtml(row.id.slice(0, 8))}…</td>`;
}

function sortHeader(label, field, sort, order) {
  const isActive = sort === field;
  const indicator = isActive ? (order === 'asc' ? ' ↑' : ' ↓') : '';
  const nextOrder = isActive && order === 'desc' ? 'asc' : 'desc';
  return `<th><button class="sort-btn" data-field="${field}" data-order="${nextOrder}">${label}${indicator}</button></th>`;
}

function buildTable(rows, offset, sort, order) {
  if (rows.length === 0 && offset === 0) {
    return '<p class="empty">No sessions recorded yet.</p>';
  }

  return `
    <table>
      <thead>
        <tr>
          <th>Name</th>
          ${sortHeader('Machine', 'machine_id', sort, order)}
          <th>Model</th>
          ${sortHeader('Started', 'started_at', sort, order)}
          <th>Duration</th>
          ${sortHeader('Cost', 'cost_usd', sort, order)}
          <th>In / Out Tokens</th>
          ${sortHeader('Requests', 'api_request_count', sort, order)}
          ${sortHeader('Tools', 'tool_call_count', sort, order)}
        </tr>
      </thead>
      <tbody>
        ${rows.map(r => `
          <tr>
            ${nameCell(r)}
            <td>${escapeHtml(r.machine_id)}</td>
            <td>${r.model ? escapeHtml(r.model) : '—'}</td>
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

function attachNameEdit(el) {
  el.querySelectorAll('.session-name').forEach(cell => {
    cell.addEventListener('click', () => {
      const id = cell.dataset.id;
      const currentName = cell.dataset.name;
      const input = document.createElement('input');
      input.type = 'text';
      input.value = currentName;
      input.className = 'name-edit';
      input.style.width = '100%';
      cell.innerHTML = '';
      cell.appendChild(input);
      input.focus();

      async function commit() {
        const newName = input.value.trim();
        if (newName === currentName) {
          restoreCell(cell, id, currentName);
          return;
        }
        try {
          const res = await fetch(`/api/sessions/${encodeURIComponent(id)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: newName }),
          });
          if (res.ok) {
            cell.dataset.name = newName;
            restoreCell(cell, id, newName);
          } else {
            restoreCell(cell, id, currentName);
          }
        } catch {
          restoreCell(cell, id, currentName);
        }
      }

      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        if (e.key === 'Escape') { restoreCell(cell, id, currentName); }
      });
      input.addEventListener('blur', commit);
    });

    cell.addEventListener('dblclick', () => {
      const sessionId = cell.dataset.id;
      showSessionDetail(sessionId);
    });
  });
}

function restoreCell(cell, id, name) {
  cell.className = name ? 'session-name' : 'session-name mono muted';
  cell.dataset.name = name;
  if (name) {
    cell.textContent = name;
  } else {
    cell.textContent = id.slice(0, 8) + '…';
  }
}

async function renderPage(el, offset, sort = 'started_at', order = 'desc') {
  const rows = await get(`/sessions?limit=${LIMIT}&offset=${offset}&sort=${sort}&order=${order}`);
  el.innerHTML = buildTable(rows, offset, sort, order);

  attachNameEdit(el);

  el.querySelectorAll('.sort-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      renderPage(el, 0, btn.dataset.field, btn.dataset.order);
    });
  });

  el.querySelector('#prev-btn')?.addEventListener('click', () =>
    renderPage(el, Math.max(0, offset - LIMIT), sort, order)
  );
  el.querySelector('#next-btn')?.addEventListener('click', () =>
    renderPage(el, offset + LIMIT, sort, order)
  );
}

export async function render(el) {
  await renderPage(el, 0);
  attachDetailModal();
}

function attachDetailModal() {
  const detailModal = document.createElement('div');
  detailModal.id = 'session-detail-modal';
  detailModal.style.display = 'none';
  detailModal.style.position = 'fixed';
  detailModal.style.top = '0';
  detailModal.style.left = '0';
  detailModal.style.width = '100%';
  detailModal.style.height = '100%';
  detailModal.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
  detailModal.style.zIndex = '1000';
  document.body.appendChild(detailModal);

  detailModal.addEventListener('click', (e) => {
    if (e.target === detailModal) {
      detailModal.style.display = 'none';
    }
  });
}

async function showSessionDetail(sessionId) {
  const breakdown = await get(`/api/sessions/${encodeURIComponent(sessionId)}/breakdown`);
  const modal = document.getElementById('session-detail-modal');

  const content = document.createElement('div');
  content.style.backgroundColor = 'white';
  content.style.padding = '20px';
  content.style.borderRadius = '8px';
  content.style.maxWidth = '90%';
  content.style.maxHeight = '90vh';
  content.style.overflowY = 'auto';
  content.style.margin = '5vh auto';

  content.innerHTML = `
    <h2>Session Detail</h2>

    <h3>Skills</h3>
    ${breakdown.skill_costs.length > 0 ? `
      <table>
        <thead>
          <tr>
            <th>Skill</th>
            <th>Calls</th>
            <th>API Requests</th>
            <th>Cost</th>
            <th>Context Tokens</th>
          </tr>
        </thead>
        <tbody>
          ${breakdown.skill_costs.map(s => `
            <tr>
              <td>${s.skill_name}</td>
              <td>${s.invocation_count}</td>
              <td>${s.api_request_count}</td>
              <td>${fmt$(s.total_cost_usd)}</td>
              <td>${s.total_context_tokens}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    ` : '<p>No skills invoked in this session.</p>'}

    <h3>Subagents</h3>
    ${breakdown.subagent_costs.invocation_count > 0 ? `
      <table>
        <thead>
          <tr>
            <th>Metric</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Invocations</td>
            <td>${breakdown.subagent_costs.invocation_count}</td>
          </tr>
          <tr>
            <td>API Requests</td>
            <td>${breakdown.subagent_costs.api_request_count}</td>
          </tr>
          <tr>
            <td>Total Cost</td>
            <td>${fmt$(breakdown.subagent_costs.total_cost_usd)}</td>
          </tr>
        </tbody>
      </table>
    ` : '<p>No subagents invoked in this session.</p>'}

    <h3>Context Overhead</h3>
    <table>
      <thead>
        <tr>
          <th>Metric</th>
          <th>Value</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Total Context Tokens</td>
          <td>${breakdown.total_context_tokens}</td>
        </tr>
        <tr>
          <td>Context Token Ratio</td>
          <td>${(breakdown.context_token_ratio * 100).toFixed(2)}%</td>
        </tr>
      </tbody>
    </table>

    <h3>API Requests (${breakdown.api_requests.length})</h3>
    <table>
      <thead>
        <tr>
          <th>Model</th>
          <th>Input</th>
          <th>Cache Read</th>
          <th>Cache Create</th>
          <th>Output</th>
          <th>Cost</th>
        </tr>
      </thead>
      <tbody>
        ${breakdown.api_requests.map(r => `
          <tr>
            <td>${r.model}</td>
            <td>${r.input_tokens}</td>
            <td>${r.cache_read_tokens}</td>
            <td>${r.cache_creation_tokens}</td>
            <td>${r.output_tokens}</td>
            <td>${fmt$(r.cost_usd)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>

    <button id="close-detail" style="margin-top: 20px; padding: 8px 16px; cursor: pointer;">Close</button>
  `;

  modal.innerHTML = '';
  modal.appendChild(content);
  modal.style.display = 'block';
  content.querySelector('#close-detail').addEventListener('click', () => {
    modal.style.display = 'none';
  });
}
