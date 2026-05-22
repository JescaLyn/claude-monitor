import { get, fmt$, fmtTokens, fmtDate, fmtDateNoSeconds, fmtDateParts, fmtDuration, escapeHtml } from '/utils.js';

const expandedSessions = new Set();

let _tip = null;
function tip() {
  if (!_tip) {
    _tip = document.createElement('div');
    _tip.style.cssText = 'position:fixed;background:#444;color:#fff;padding:5px 9px;border-radius:4px;font-size:12px;line-height:1.5;max-width:320px;white-space:normal;z-index:10000;box-shadow:0 2px 8px rgba(0,0,0,0.2);pointer-events:none;display:none;';
    document.body.appendChild(_tip);
  }
  return _tip;
}
function showTip(e, text) {
  const t = tip();
  t.textContent = text;
  t.style.display = 'block';
  moveTip(e);
}
function moveTip(e) {
  const t = tip();
  const x = e.clientX + 14;
  const y = e.clientY + 14;
  t.style.left = (x + t.offsetWidth > window.innerWidth ? e.clientX - t.offsetWidth - 8 : x) + 'px';
  t.style.top = y + 'px';
}
function hideTip() { tip().style.display = 'none'; }
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

function chevronIcon(isActive, order) {
  if (isActive && order === 'asc') {
    return `<svg class="chev chev-active" viewBox="0 0 10 6" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M1 5L5 1L9 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }
  if (isActive && order === 'desc') {
    return `<svg class="chev chev-active" viewBox="0 0 10 6" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M1 1L5 5L9 1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }
  return `<svg class="chev chev-idle" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M1 3.5L5 1L9 3.5" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/><path d="M1 6.5L5 9L9 6.5" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function sortHeader(label, field, sort, order, thClass = '') {
  const isActive = sort === field;
  const nextOrder = isActive && order === 'desc' ? 'asc' : 'desc';
  const cls = thClass ? ` class="${thClass}"` : '';
  return `<th${cls}><button class="sort-btn" data-field="${field}" data-order="${nextOrder}">${label}${chevronIcon(isActive, order)}</button></th>`;
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
          ${sortHeader('Name', 'name', sort, order)}
          ${sortHeader('Machine', 'machine_id', sort, order, 'th-center')}
          ${sortHeader('Started', 'started_at', sort, order, 'th-center')}
          ${sortHeader('Last Activity', 'last_event_ts', sort, order)}
          ${sortHeader('Cost', 'cost_usd', sort, order, 'th-center')}
          ${sortHeader('Tokens In', 'input_tokens', sort, order, 'th-center')}
          ${sortHeader('Tokens Out', 'output_tokens', sort, order, 'th-center')}
          <th class="models-header"><div class="models-header-title">Models</div><table class="inline-models-header"><tbody><tr><td class="model-name">Model</td><td class="model-requests">Req %</td><td class="model-cost">Cost %</td></tr></tbody></table></th>
          ${sortHeader('API Reqs', 'api_request_count', sort, order)}
          ${sortHeader('Tools', 'tool_call_count', sort, order, 'th-center')}
          <th style="width: 40px; text-align: center;">Details</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(r => {
          const isExpanded = expandedSessions.has(r.id);
          const machineDisplay = simplifyMachineId(r.machine_id);
          const expandIcon = r.subagents && r.subagents.length > 0 ? (isExpanded ? '▼' : '▶') : '';

          let html = `
            <tr class="session-row" data-id="${escapeHtml(r.id)}" data-expandable="${r.subagents && r.subagents.length > 0 ? 'true' : 'false'}">
              <td class="session-name">
                <span class="expand-icon" style="display: inline-block; min-width: 16px;">${expandIcon}</span>
                ${r.name ? escapeHtml(r.name) : `<span class="mono muted" title="${escapeHtml(r.id)}">${escapeHtml(r.id)}</span>`}
              </td>
              <td class="td-center">${machineDisplay}</td>
              ${dateCell(r.started_at, 'td-center')}
              ${dateCell(r.last_event_ts)}
              <td class="td-center">${fmt$(r.cost_usd)}</td>
              <td class="td-center">${fmtTokens(r.input_tokens)}</td>
              <td class="td-center">${fmtTokens(r.output_tokens)}</td>
              <td class="models-cell"><span class="models-list">Loading...</span></td>
              <td>${r.api_request_count}</td>
              <td>${r.tool_call_count}</td>
              <td style="text-align: center;"><a href="/?tab=cost-analysis&session=${encodeURIComponent(r.id)}" class="details-link">→</a></td>
            </tr>
          `;

          // Add subagent rows (always render, hide by default)
          if (r.subagents && r.subagents.length > 0) {
            html += r.subagents.map(s => {
              const label = s.name || s.agent_type || s.id.slice(0, 8);
              return `
              <tr class="subagent-row" data-parent-id="${escapeHtml(r.id)}" data-id="${escapeHtml(s.id)}" style="background: var(--bg-surface-alt); display: ${isExpanded ? '' : 'none'};">
                <td class="session-name" style="padding-left: 30px; font-size: 11px;">
                  └ <span data-tooltip="${escapeHtml(label)}">${escapeHtml(label)}</span>
                </td>
                <td class="td-center">—</td>
                ${s.started_at ? dateCell(s.started_at, 'td-center') : '<td class="td-center">—</td>'}
                ${s.last_event_ts ? dateCell(s.last_event_ts) : '<td>—</td>'}
                <td class="td-center">${fmt$(s.cost_usd)}</td>
                <td class="td-center">${fmtTokens(s.input_tokens)}</td>
                <td class="td-center">${fmtTokens(s.output_tokens)}</td>
                <td class="models-cell"><span class="models-list">Loading...</span></td>
                <td>${s.api_request_count}</td>
                <td>—</td>
                <td style="text-align: center;"><a href="/?tab=cost-analysis&session=${encodeURIComponent(s.id)}" class="details-link">→</a></td>
              </tr>
            `}).join('');
          }

          return html;
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

async function loadModelsForSelection(el, selector, idExtractor) {
  const rows = el.querySelectorAll(selector);

  for (const row of rows) {
    const sessionId = idExtractor(row);
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

async function renderPage(el, offset, sort = 'last_event_ts', order = 'desc', hours = DEFAULT_HOURS) {
  const since = getTimeThreshold(hours);
  const allRows = await get(`/sessions/with-subagents?limit=200&offset=0&sort=${sort}&order=${order}&since=${since}`);

  const paginatedRows = allRows.slice(offset, offset + LIMIT);

  el.innerHTML = buildFilterControl(hours) + buildTable(paginatedRows, offset, sort, order, allRows.length);

  // Load model data for all rows (parent and subagent)
  loadModelsForSelection(el, '.session-row:not(.subagent-row)', r => r.dataset.id);
  loadModelsForSelection(el, '.subagent-row', r => r.dataset.id);
}

let currentPageState = {
  offset: 0,
  sort: 'last_event_ts',
  order: 'desc',
  hours: DEFAULT_HOURS
};
let listenersAttached = false;

function handleTableClick(el, e) {
  // Handle expand/collapse on expand icon or session row
  const expandRow = (e.target).closest('tr.session-row[data-expandable="true"]');
  if (expandRow) {
    const sessionId = expandRow.dataset.id;
    const sessionNameCell = expandRow.querySelector('.session-name');
    const expandIcon = sessionNameCell?.querySelector('.expand-icon');

    // Check if click was on the expand icon
    if (expandIcon && expandIcon.contains(e.target)) {
      // Clicked on expand icon, toggle expansion
      const willExpand = !expandedSessions.has(sessionId);
      if (willExpand) {
        expandedSessions.add(sessionId);
      } else {
        expandedSessions.delete(sessionId);
      }

      // Toggle icon and show/hide subagent rows without full re-render
      expandIcon.textContent = willExpand ? '▼' : '▶';
      const subagentRows = Array.from(el.querySelectorAll(`tr[data-parent-id="${sessionId}"]`));
      for (const subRow of subagentRows) {
        subRow.style.display = willExpand ? '' : 'none';
      }
      return;
    }

    // Clicked elsewhere on the row (not expand icon), toggle expansion
    const willExpand = !expandedSessions.has(sessionId);
    if (willExpand) {
      expandedSessions.add(sessionId);
    } else {
      expandedSessions.delete(sessionId);
    }

    // Toggle icon and show/hide subagent rows without full re-render
    if (expandIcon) {
      expandIcon.textContent = willExpand ? '▼' : '▶';
    }
    const subagentRows = Array.from(el.querySelectorAll(`tr[data-parent-id="${sessionId}"]`));
    for (const subRow of subagentRows) {
      subRow.style.display = willExpand ? '' : 'none';
    }
    return;
  }

  // Handle sort button clicks
  const sortBtn = (e.target).closest('.sort-btn');
  if (sortBtn) {
    const newSort = sortBtn.dataset.field;
    const newOrder = sortBtn.dataset.order;
    currentPageState = {
      offset: 0,
      sort: newSort,
      order: newOrder,
      hours: currentPageState.hours
    };
    renderPage(el, 0, newSort, newOrder, currentPageState.hours);
    return;
  }

  // Handle pagination buttons
  if (e.target.id === 'prev-btn') {
    const newOffset = Math.max(0, currentPageState.offset - LIMIT);
    currentPageState.offset = newOffset;
    renderPage(el, newOffset, currentPageState.sort, currentPageState.order, currentPageState.hours);
    return;
  } else if (e.target.id === 'next-btn') {
    const newOffset = currentPageState.offset + LIMIT;
    currentPageState.offset = newOffset;
    renderPage(el, newOffset, currentPageState.sort, currentPageState.order, currentPageState.hours);
    return;
  }
}

export async function render(el) {
  // Attach persistent event listeners only once
  if (!listenersAttached) {
    el.addEventListener('click', (e) => handleTableClick(el, e));
    el.addEventListener('mouseover', (e) => {
      const t = e.target.closest('[data-tooltip]');
      if (t) showTip(e, t.dataset.tooltip);
    });
    el.addEventListener('mousemove', (e) => {
      if (_tip && _tip.style.display !== 'none') moveTip(e);
    });
    el.addEventListener('mouseout', (e) => {
      if (e.target.closest('[data-tooltip]')) hideTip();
    });
    el.addEventListener('change', (e) => {
      if (e.target.id === 'time-range-select') {
        const newHours = parseInt(e.target.value, 10);
        currentPageState = {
          offset: 0,
          sort: currentPageState.sort,
          order: currentPageState.order,
          hours: newHours
        };
        renderPage(el, 0, currentPageState.sort, currentPageState.order, newHours);
      }
    });
    listenersAttached = true;
  }

  await renderPage(el, currentPageState.offset, currentPageState.sort, currentPageState.order, currentPageState.hours);
}
