import { get, fmt$, fmtTokens, fmtDate, fmtDateNoSeconds, fmtDateParts, fmtDuration, escapeHtml } from '/utils.js';

const LIMIT = 20;

function nameCell(row) {
  if (row.name) {
    return `<td class="session-name" data-id="${escapeHtml(row.id)}">${escapeHtml(row.name)}</td>`;
  }
  return `<td class="session-name mono muted" data-id="${escapeHtml(row.id)}" title="${escapeHtml(row.id)}">${escapeHtml(row.id)}</td>`;
}

function sortHeader(label, field, sort, order, thClass = '') {
  const isActive = sort === field;
  const indicator = isActive ? (order === 'asc' ? ' ↑' : ' ↓') : '';
  const nextOrder = isActive && order === 'desc' ? 'asc' : 'desc';
  const cls = thClass ? ` class="${thClass}"` : '';
  return `<th${cls}><button class="sort-btn" data-field="${field}" data-order="${nextOrder}">${label}${indicator}</button></th>`;
}

function dateCell(microseconds) {
  const { date, time } = fmtDateParts(microseconds);
  return `<td class="date-cell"><div class="date-main">${date}</div><div class="date-sub">${time}</div></td>`;
}

function buildTable(rows, offset, sort, order) {
  if (rows.length === 0 && offset === 0) {
    return '<p class="empty">No sessions recorded yet.</p>';
  }

  return `
    <table class="sessions-table">
      <thead>
        <tr>
          <th>Name</th>
          ${sortHeader('Machine', 'machine_id', sort, order)}
          ${sortHeader('Started', 'started_at', sort, order)}
          ${sortHeader('Last Activity', 'last_event_ts', sort, order)}
          ${sortHeader('Cost', 'cost_usd', sort, order, 'th-center')}
          <th class="stacked-header"><div>Tokens</div><div class="stacked-sub">In / Out</div></th>
          <th class="models-header"><div class="models-header-title">Models</div><table class="inline-models-header"><tbody><tr><td class="model-name">Model</td><td class="model-requests">Req %</td><td class="model-cost">Cost %</td></tr></tbody></table></th>
          ${sortHeader('API Reqs', 'api_request_count', sort, order)}
          ${sortHeader('Tools', 'tool_call_count', sort, order, 'th-center')}
        </tr>
      </thead>
      <tbody>
        ${rows.map(r => {
          const machineDisplay = r.machine_id === 'local' ? 'This Machine' : escapeHtml(r.machine_id);
          return `
            <tr class="session-row" data-id="${escapeHtml(r.id)}">
              ${nameCell(r)}
              <td>${machineDisplay}</td>
              ${dateCell(r.started_at)}
              ${dateCell(r.last_event_ts)}
              <td>${fmt$(r.cost_usd)}</td>
              <td>${fmtTokens(r.input_tokens)} / ${fmtTokens(r.output_tokens)}</td>
              <td class="models-cell"><span class="models-list">Loading...</span></td>
              <td>${r.api_request_count}</td>
              <td>${r.tool_call_count}</td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
    <div class="pagination">
      <button id="prev-btn" ${offset === 0 ? 'disabled' : ''}>← Prev</button>
      <span>${rows.length === 0 ? 'No more rows' : `Rows ${offset + 1}–${offset + rows.length}`}</span>
      <button id="next-btn" ${rows.length < LIMIT ? 'disabled' : ''}>Next →</button>
    </div>
  `;
}

function getModelName(fullModel) {
  if (fullModel.includes('haiku')) return 'Haiku';
  if (fullModel.includes('sonnet')) return 'Sonnet';
  if (fullModel.includes('opus')) return 'Opus';
  return fullModel.split('/').pop() || fullModel;
}

async function loadModelsForRows(el) {
  const rows = el.querySelectorAll('.session-row');

  for (const row of rows) {
    const sessionId = row.dataset.id;
    const modelsList = row.querySelector('.models-list');

    try {
      const models = await get(`/sessions/${encodeURIComponent(sessionId)}/models`);
      if (models.length === 0) {
        modelsList.innerHTML = 'No API requests';
      } else {
        const totalCost = models.reduce((sum, m) => sum + m.total_cost_usd, 0);
        const totalRequests = models.reduce((sum, m) => sum + m.api_request_count, 0);

        const html = `
          <table class="inline-models-table">
            <tbody>
              ${models.map(m => {
                const modelName = getModelName(m.model);
                const costPct = totalCost > 0 ? ((m.total_cost_usd / totalCost) * 100).toFixed(1) : 0;
                const reqPct = totalRequests > 0 ? ((m.api_request_count / totalRequests) * 100).toFixed(1) : 0;
                return `
                  <tr>
                    <td class="model-name">${escapeHtml(modelName)}</td>
                    <td class="model-requests">${reqPct}%</td>
                    <td class="model-cost">${costPct}%</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        `;
        modelsList.innerHTML = html;
      }
    } catch (err) {
      modelsList.innerHTML = 'Error loading models';
      console.error(err);
    }
  }
}

function attachNameHandlers(el) {
  el.querySelectorAll('.session-name').forEach(cell => {
    cell.style.cursor = 'pointer';
    let tooltipTimeout = null;

    cell.addEventListener('click', () => {
      const sessionId = cell.dataset.id;
      window.location.href = `/?tab=cost-analysis&session=${encodeURIComponent(sessionId)}`;
    });

    // Track mouse position while hovering
    let currentMouseX = 0;
    let currentMouseY = 0;

    cell.addEventListener('mousemove', (e) => {
      currentMouseX = e.clientX;
      currentMouseY = e.clientY;
    });

    cell.addEventListener('mouseenter', (e) => {
      currentMouseX = e.clientX;
      currentMouseY = e.clientY;

      tooltipTimeout = setTimeout(() => {
        const sessionId = cell.dataset.id;
        const tooltip = document.createElement('div');
        tooltip.className = 'session-id-tooltip';

        // Position off-screen initially so it can measure
        tooltip.style.position = 'fixed';
        tooltip.style.top = '-9999px';
        tooltip.style.left = '0px';
        tooltip.textContent = sessionId;
        document.body.appendChild(tooltip);
        cell.dataset.tooltip = 'true';

        // Measure tooltip size
        const tooltipRect = tooltip.getBoundingClientRect();

        // Pin left edge to the left edge of the sessions table; position just above the cursor vertically.
        const table = cell.closest('table');
        const tableLeft = table ? table.getBoundingClientRect().left : 0;
        const targetTop = currentMouseY - tooltipRect.height - 12;

        tooltip.style.top = targetTop + 'px';
        tooltip.style.left = Math.max(0, tableLeft) + 'px';
      }, 300);
    });

    cell.addEventListener('mouseleave', () => {
      clearTimeout(tooltipTimeout);
      const tooltip = document.querySelector('.session-id-tooltip');
      if (tooltip) tooltip.remove();
      delete cell.dataset.tooltip;
    });
  });
}

async function renderPage(el, offset, sort = 'last_event_ts', order = 'desc') {
  const rows = await get(`/sessions?limit=${LIMIT}&offset=${offset}&sort=${sort}&order=${order}`);
  el.innerHTML = buildTable(rows, offset, sort, order);

  loadModelsForRows(el);
  attachNameHandlers(el);

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
