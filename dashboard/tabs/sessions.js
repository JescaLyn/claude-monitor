import { get, fmt$, fmtTokens, fmtDate, fmtDateNoSeconds, fmtDateParts, fmtDuration, escapeHtml } from '/utils.js';

const LIMIT = 20;
const DEFAULT_HOURS = 24;  // Default: show sessions active in the last 24 hours

function simplifyMachineId(machineId) {
  if (!machineId) return '—';
  // Special case: 'local' sentinel (old sessions before hostname resolution)
  if (machineId === 'local') return 'MacBook'; // Normalize to match the actual machine
  // Remove domain suffix (e.g., "Jessicas-MacBook-Pro.local" → "Jessicas-MacBook-Pro")
  const hostname = machineId.split('.')[0];
  // Extract the device type (e.g., "Jessicas-MacBook-Pro" → "MacBook")
  const match = hostname.match(/MacBook|iMac|Mac-|Windows|Zima|Linux/i);
  if (match) return match[0];
  // Fallback for unknown machines
  return escapeHtml(hostname.charAt(0).toUpperCase() + hostname.slice(1));
}

function getTimeThreshold(hours) {
  if (!hours || hours === 0) return 0;  // 0 means "all time"
  const now = Date.now() * 1000;  // microseconds
  return now - (hours * 60 * 60 * 1000000);
}

function buildFilterControl(hours) {
  const options = [
    { value: '24', label: 'Last 24 hours' },
    { value: '48', label: 'Last 48 hours' },
    { value: '168', label: 'Last 7 days' },
    { value: '720', label: 'Last 30 days' },
    { value: '0', label: 'All time' },
  ];
  const selected = String(hours);
  return `
    <div class="sessions-filter">
      <label>Activity:</label>
      <select id="time-range-select">
        ${options.map(o => `<option value="${o.value}" ${selected === o.value ? 'selected' : ''}>${o.label}</option>`).join('')}
      </select>
    </div>
  `;
}

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

function dateCell(microseconds, tdClass = '') {
  const { date, time } = fmtDateParts(microseconds);
  const cls = tdClass ? ` ${tdClass}` : '';
  return `<td class="date-cell${cls}"><div class="date-main">${date}</div><div class="date-sub">${time}</div></td>`;
}

function buildTable(rows, offset, sort, order, totalCount = rows.length) {
  if (totalCount === 0 && offset === 0) {
    return '<p class="empty">No sessions in this time range.</p>';
  }

  return `
    <table class="sessions-table">
      <thead>
        <tr>
          <th>Name</th>
          ${sortHeader('Machine', 'machine_id', sort, order, 'th-center')}
          ${sortHeader('Started', 'started_at', sort, order, 'th-center')}
          ${sortHeader('Last Activity', 'last_event_ts', sort, order)}
          ${sortHeader('Cost', 'cost_usd', sort, order, 'th-center')}
          <th class="tokens-header"><div class="tokens-header-title">Tokens</div><table class="inline-tokens-header"><tbody><tr><td class="token-in">IN</td><td class="token-out">OUT</td></tr></tbody></table></th>
          <th class="models-header"><div class="models-header-title">Models</div><table class="inline-models-header"><tbody><tr><td class="model-name">Model</td><td class="model-requests">Req %</td><td class="model-cost">Cost %</td></tr></tbody></table></th>
          ${sortHeader('API Reqs', 'api_request_count', sort, order)}
          ${sortHeader('Tools', 'tool_call_count', sort, order, 'th-center')}
        </tr>
      </thead>
      <tbody>
        ${rows.map(r => {
          const machineDisplay = simplifyMachineId(r.machine_id);
          return `
            <tr class="session-row" data-id="${escapeHtml(r.id)}">
              ${nameCell(r)}
              <td class="td-center">${machineDisplay}</td>
              ${dateCell(r.started_at, 'td-center')}
              ${dateCell(r.last_event_ts)}
              <td class="td-center">${fmt$(r.cost_usd)}</td>
              <td class="tokens-cell"><div class="token-row"><span class="token-in">${fmtTokens(r.input_tokens)}</span><span class="token-out">${fmtTokens(r.output_tokens)}</span></div></td>
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
      <span>${rows.length === 0 ? 'No more rows' : `Rows ${offset + 1}–${offset + rows.length} of ${totalCount}`}</span>
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

async function renderPage(el, offset, sort = 'last_event_ts', order = 'desc', hours = DEFAULT_HOURS) {
  const allRows = await get(`/sessions?limit=200&offset=0&sort=${sort}&order=${order}`);
  const threshold = getTimeThreshold(hours);
  const filteredRows = allRows.filter(r => !r.last_event_ts || r.last_event_ts >= threshold);

  // Re-apply pagination after filtering
  const paginatedRows = filteredRows.slice(offset, offset + LIMIT);

  el.innerHTML = buildFilterControl(hours) + buildTable(paginatedRows, offset, sort, order, filteredRows.length);

  loadModelsForRows(el);
  attachNameHandlers(el);

  const timeSelect = el.querySelector('#time-range-select');
  if (timeSelect) {
    timeSelect.addEventListener('change', () => {
      const newHours = parseInt(timeSelect.value, 10);
      renderPage(el, 0, sort, order, newHours);
    });
  }

  el.querySelectorAll('.sort-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const timeSelect = el.querySelector('#time-range-select');
      const hours = timeSelect ? parseInt(timeSelect.value, 10) : DEFAULT_HOURS;
      renderPage(el, 0, btn.dataset.field, btn.dataset.order, hours);
    });
  });

  el.querySelector('#prev-btn')?.addEventListener('click', () => {
    const timeSelect = el.querySelector('#time-range-select');
    const hours = timeSelect ? parseInt(timeSelect.value, 10) : DEFAULT_HOURS;
    renderPage(el, Math.max(0, offset - LIMIT), sort, order, hours);
  });
  el.querySelector('#next-btn')?.addEventListener('click', () => {
    const timeSelect = el.querySelector('#time-range-select');
    const hours = timeSelect ? parseInt(timeSelect.value, 10) : DEFAULT_HOURS;
    renderPage(el, offset + LIMIT, sort, order, hours);
  });
}

export async function render(el) {
  await renderPage(el, 0, 'last_event_ts', 'desc', DEFAULT_HOURS);
}
