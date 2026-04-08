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
}
