import { get, fmt$, fmtTokens, fmtDateParts, escapeHtml } from '../utils.js';

export const DEFAULT_HOURS = 24;
export const LIMIT = 20;

export const TIME_OPTIONS = [
  { value: '24', label: 'Last 24 hours' },
  { value: '48', label: 'Last 48 hours' },
  { value: '168', label: 'Last 7 days' },
  { value: '720', label: 'Last 30 days' },
  { value: '0', label: 'All time' },
];

export function getTimeThreshold(hours) {
  if (!hours || hours === 0) return 0;
  const now = Date.now() * 1000;
  return now - (hours * 60 * 60 * 1000000);
}

export function simplifyMachineId(machineId) {
  if (!machineId) return '—';
  if (machineId === 'local') return 'MacBook';
  const hostname = machineId.split('.')[0];
  const match = hostname.match(/MacBook|iMac|Mac-|Windows|Zima|Linux/i);
  if (match) return match[0];
  return escapeHtml(hostname.charAt(0).toUpperCase() + hostname.slice(1));
}

const MODEL_FAMILY_ORDER = { opus: 0, sonnet: 1, haiku: 2 };
export function sortModelsByFamily(models) {
  const family = m => { const l = (m.model || '').toLowerCase(); for (const [f, o] of Object.entries(MODEL_FAMILY_ORDER)) { if (l.includes(f)) return o; } return 3; };
  const version = m => {
    const parts = (m.model || '').replace(/^claude-/, '').split('-').slice(1).filter(p => /^\d+$/.test(p) && p.length < 8);
    return parts.length >= 2 ? parseInt(parts[0]) * 1000 + parseInt(parts[1]) : parts.length === 1 ? parseInt(parts[0]) * 1000 : 0;
  };
  return [...models].sort((a, b) => {
    const fd = family(a) - family(b);
    return fd !== 0 ? fd : version(b) - version(a);
  });
}

// "claude-opus-4-8" → "Opus 4.8", "claude-haiku-4-5-20251001" → "Haiku 4.5"
export function getModelName(fullModel) {
  if (!fullModel) return 'Unknown';
  const bare = fullModel.split('/').pop() || fullModel;
  const parts = bare.replace(/^claude-/, '').split('-');
  const family = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
  const version = parts.slice(1).filter(p => /^\d+$/.test(p) && p.length < 8).slice(0, 2).join('.');
  return version ? `${family} ${version}` : family;
}

// Shared tooltip — singleton across all tabs (only one tab visible at a time)
let _tip = null;
function tip() {
  if (!_tip) {
    _tip = document.createElement('div');
    _tip.style.cssText = 'position:fixed;background:#444;color:#fff;padding:5px 9px;border-radius:4px;font-size:12px;line-height:1.5;max-width:320px;white-space:normal;z-index:10000;box-shadow:0 2px 8px rgba(0,0,0,0.2);pointer-events:none;display:none;';
    document.body.appendChild(_tip);
  }
  return _tip;
}
export function showTip(e, text) {
  const t = tip();
  t.textContent = text;
  t.style.display = 'block';
  moveTip(e);
}
export function moveTip(e) {
  if (!_tip || _tip.style.display === 'none') return;
  const t = tip();
  const x = e.clientX + 14;
  const y = e.clientY + 14;
  t.style.left = (x + t.offsetWidth > window.innerWidth ? e.clientX - t.offsetWidth - 8 : x) + 'px';
  t.style.top = y + 'px';
}
export function hideTip() { if (_tip) _tip.style.display = 'none'; }

export function chevronIcon(isActive, order) {
  if (isActive && order === 'asc') {
    return `<svg class="chev chev-active" viewBox="0 0 10 6" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M1 5L5 1L9 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }
  if (isActive && order === 'desc') {
    return `<svg class="chev chev-active" viewBox="0 0 10 6" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M1 1L5 5L9 1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }
  return `<svg class="chev chev-idle" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M1 3.5L5 1L9 3.5" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/><path d="M1 6.5L5 9L9 6.5" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

export function sortHeader(label, field, sort, order, thClass = '') {
  const isActive = sort === field;
  const nextOrder = isActive && order === 'desc' ? 'asc' : 'desc';
  const cls = thClass ? ` class="${thClass}"` : '';
  return `<th${cls}><button class="sort-btn" data-field="${field}" data-order="${nextOrder}">${label}${chevronIcon(isActive, order)}</button></th>`;
}

export function dateCell(microseconds, tdClass = '') {
  const { date, time } = fmtDateParts(microseconds);
  const cls = tdClass ? ` ${tdClass}` : '';
  return `<td class="date-cell${cls}"><div class="date-main">${date}</div><div class="date-sub">${time}</div></td>`;
}

export function buildTableHead(sort, order) {
  return `
    <thead>
      <tr>
        ${sortHeader('Name', 'name', sort, order)}
        ${sortHeader('Machine', 'machine_id', sort, order, 'th-center col-machine')}
        ${sortHeader('Started', 'started_at', sort, order, 'th-center col-started')}
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
  `;
}

// expandedSessions and expandedProjects are passed as params so each tab module owns its own Sets
export function buildSessionRowHtml(r, projectIdx = null, expandedSessions = new Set(), expandedProjects = new Set()) {
  const isExpanded = expandedSessions.has(r.id);
  const machineDisplay = simplifyMachineId(r.machine_id);
  const expandIcon = r.subagents && r.subagents.length > 0 ? (isExpanded ? '▼' : '▶') : '';

  const projectAttr = projectIdx !== null ? ` data-project-idx="${projectIdx}"` : '';
  const projectExpanded = projectIdx === null || expandedProjects.has(String(projectIdx));
  const sessionDisplay = projectExpanded ? '' : 'none';

  let html = `
    <tr class="session-row"${projectAttr} data-id="${escapeHtml(r.id)}" data-expandable="${r.subagents && r.subagents.length > 0 ? 'true' : 'false'}" style="display:${sessionDisplay};">
      <td class="session-name">
        <span class="expand-icon" style="display: inline-block; min-width: 16px;">${expandIcon}</span>
        ${r.name ? escapeHtml(r.name) : `<span class="mono muted" title="${escapeHtml(r.id)}">${escapeHtml(r.id)}</span>`}
      </td>
      <td class="td-center col-machine">${machineDisplay}</td>
      ${dateCell(r.started_at, 'td-center col-started')}
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

  if (r.subagents && r.subagents.length > 0) {
    html += r.subagents.map(s => {
      const label = s.name || s.agent_type || s.id.slice(0, 8);
      const subDisplay = projectExpanded && isExpanded ? '' : 'none';
      return `
        <tr class="subagent-row" data-parent-id="${escapeHtml(r.id)}" data-id="${escapeHtml(s.id)}" style="background: var(--bg-surface-alt); display:${subDisplay};">
          <td class="session-name" style="padding-left: 30px; font-size: 11px;">
            └ <span data-tooltip="${escapeHtml(label)}">${escapeHtml(label)}</span>
          </td>
          <td class="td-center col-machine">—</td>
          ${s.started_at ? dateCell(s.started_at, 'td-center col-started') : '<td class="td-center col-started">—</td>'}
          ${s.last_event_ts ? dateCell(s.last_event_ts) : '<td>—</td>'}
          <td class="td-center">${fmt$(s.cost_usd)}</td>
          <td class="td-center">${fmtTokens(s.input_tokens)}</td>
          <td class="td-center">${fmtTokens(s.output_tokens)}</td>
          <td class="models-cell"><span class="models-list">Loading...</span></td>
          <td>${s.api_request_count}</td>
          <td>—</td>
          <td style="text-align: center;"><a href="/?tab=cost-analysis&session=${encodeURIComponent(s.id)}" class="details-link">→</a></td>
        </tr>
      `;
    }).join('');
  }

  return html;
}

export function buildTotalRow(allRows, isProjectView = false, aggregateSummary = null) {
  const totalCost     = aggregateSummary?.total_cost_usd      ?? allRows.reduce((s, r) => s + r.cost_usd, 0);
  const totalInput    = aggregateSummary?.total_input_tokens   ?? allRows.reduce((s, r) => s + r.input_tokens, 0);
  const totalOutput   = aggregateSummary?.total_output_tokens  ?? allRows.reduce((s, r) => s + r.output_tokens, 0);
  const totalApiReqs  = aggregateSummary?.total_api_requests   ?? allRows.reduce((s, r) => s + r.api_request_count, 0);
  const totalTools    = aggregateSummary?.total_tool_calls     ?? allRows.reduce((s, r) => s + r.tool_call_count, 0);
  const count         = aggregateSummary?.total_sessions       ?? allRows.length;
  const label = `Total &mdash; <span class="muted">${count} session${count === 1 ? '' : 's'}</span>`;
  const firstCells = isProjectView
    ? `<td>${label}</td><td class="col-machine"></td><td class="col-started"></td><td></td>`
    : `<td colspan="4">${label}</td>`;
  return `
    <tr class="total-row">
      ${firstCells}
      <td class="td-center">${fmt$(totalCost)}</td>
      <td class="td-center">${fmtTokens(totalInput)}</td>
      <td class="td-center">${fmtTokens(totalOutput)}</td>
      <td></td>
      <td>${totalApiReqs.toLocaleString()}</td>
      <td>${totalTools.toLocaleString()}</td>
      <td></td>
    </tr>
  `;
}

export function groupByProject(allRows, sort = 'cost_usd', order = 'desc') {
  const map = new Map();
  for (const row of allRows) {
    const proj = row.project || '';
    if (!map.has(proj)) {
      map.set(proj, { sessions: [], cost_usd: 0, input_tokens: 0, output_tokens: 0, api_request_count: 0, tool_call_count: 0, last_event_ts: 0 });
    }
    const g = map.get(proj);
    g.sessions.push(row);
    g.cost_usd += row.cost_usd;
    g.input_tokens += row.input_tokens;
    g.output_tokens += row.output_tokens;
    g.api_request_count += row.api_request_count;
    g.tool_call_count += row.tool_call_count;
    if (row.last_event_ts > g.last_event_ts) g.last_event_ts = row.last_event_ts;
  }
  const aggregateSorts = new Set(['cost_usd', 'input_tokens', 'output_tokens', 'api_request_count', 'tool_call_count']);
  const groupField = aggregateSorts.has(sort) ? sort : 'cost_usd';
  const dir = order === 'asc' ? 1 : -1;
  return [...map.entries()].sort((a, b) => dir * (a[1][groupField] - b[1][groupField]) || a[0].localeCompare(b[0]));
}

export function buildProjectView(groups, sort, order, expandedProjects = new Set(), expandedSessions = new Set(), aggregateSummary = null) {
  if (groups.length === 0) return '<p class="empty">No sessions in this time range.</p>';

  const allRows = groups.flatMap(([, g]) => g.sessions);
  const bodyHtml = groups.map(([proj, g], i) => {
    const label = proj || '(no project)';
    const isExpanded = expandedProjects.has(String(i));
    const chevron = isExpanded ? '▼' : '▶';
    const headerRow = `
      <tr class="project-header-row" data-project-idx="${i}" style="cursor:pointer;">
        <td class="project-header-name">
          <span class="expand-icon" style="display:inline-block;min-width:16px;">${chevron}</span>
          ${escapeHtml(label)}
          <span class="project-session-count">${g.sessions.length}</span>
        </td>
        <td class="td-center col-machine"></td>
        <td class="td-center col-started"></td>
        ${g.last_event_ts ? dateCell(g.last_event_ts) : '<td>—</td>'}
        <td class="td-center">${fmt$(g.cost_usd)}</td>
        <td class="td-center">${fmtTokens(g.input_tokens)}</td>
        <td class="td-center">${fmtTokens(g.output_tokens)}</td>
        <td class="models-cell" data-project-group-idx="${i}"><span class="models-list"></span></td>
        <td>${g.api_request_count.toLocaleString()}</td>
        <td>${g.tool_call_count.toLocaleString()}</td>
        <td style="text-align: center;">${proj ? `<a href="/?tab=cost-analysis&project=${encodeURIComponent(proj)}" class="details-link">→</a>` : ''}</td>
      </tr>
    `;
    return headerRow + g.sessions.map(r => buildSessionRowHtml(r, i, expandedSessions, expandedProjects)).join('');
  }).join('');

  const hasExpanded = expandedProjects.size > 0;
  return `
    <table class="sessions-table project-view${hasExpanded ? ' has-expanded' : ''}">
      ${buildTableHead(sort, order)}
      <tbody>
        ${buildTotalRow(allRows, true, aggregateSummary)}
        ${bodyHtml}
      </tbody>
    </table>
  `;
}

export async function loadModelsForSelection(el, selector, idExtractor) {
  const rows = el.querySelectorAll(selector);
  for (const row of rows) {
    const sessionId = idExtractor(row);
    const modelsList = row.querySelector('.models-list');
    if (!modelsList) continue;
    try {
      const models = await get(`/sessions/${encodeURIComponent(sessionId)}/models`);
      if (models.length === 0) {
        modelsList.innerHTML = 'No API requests';
      } else {
        const sorted = sortModelsByFamily(models);
        const totalCost = sorted.reduce((sum, m) => sum + m.total_cost_usd, 0);
        const totalRequests = sorted.reduce((sum, m) => sum + m.api_request_count, 0);
        modelsList.innerHTML = `
          <table class="inline-models-table">
            <tbody>
              ${sorted.map(m => {
                const modelName = getModelName(m.model);
                const costPct = totalCost > 0 ? ((m.total_cost_usd / totalCost) * 100).toFixed(1) : 0;
                const reqPct = totalRequests > 0 ? ((m.api_request_count / totalRequests) * 100).toFixed(1) : 0;
                return `<tr><td class="model-name">${escapeHtml(modelName)}</td><td class="model-requests">${reqPct}%</td><td class="model-cost">${costPct}%</td></tr>`;
              }).join('')}
            </tbody>
          </table>
        `;
      }
    } catch (err) {
      modelsList.innerHTML = 'Error loading models';
      console.error(err);
    }
  }
}

export async function loadModelsForProjects(el, groups, since) {
  for (let i = 0; i < groups.length; i++) {
    const [proj] = groups[i];
    if (!proj) {
      const noCell = el.querySelector(`.models-cell[data-project-group-idx="${i}"]`);
      if (noCell) noCell.querySelector('.models-list').textContent = '—';
      continue;
    }
    const cell = el.querySelector(`.models-cell[data-project-group-idx="${i}"]`);
    if (!cell) continue;
    const modelsList = cell.querySelector('.models-list');
    if (!modelsList) continue;
    try {
      const models = await get(`/sessions/projects/${encodeURIComponent(proj)}/models?since=${since}`);
      if (models.length === 0) {
        modelsList.innerHTML = 'No API requests';
      } else {
        const sorted = sortModelsByFamily(models);
        const totalCost = sorted.reduce((sum, m) => sum + m.total_cost_usd, 0);
        const totalRequests = sorted.reduce((sum, m) => sum + m.api_request_count, 0);
        modelsList.innerHTML = `
          <table class="inline-models-table">
            <tbody>
              ${sorted.map(m => {
                const modelName = getModelName(m.model);
                const costPct = totalCost > 0 ? ((m.total_cost_usd / totalCost) * 100).toFixed(1) : 0;
                const reqPct = totalRequests > 0 ? ((m.api_request_count / totalRequests) * 100).toFixed(1) : 0;
                return `<tr><td class="model-name">${escapeHtml(modelName)}</td><td class="model-requests">${reqPct}%</td><td class="model-cost">${costPct}%</td></tr>`;
              }).join('')}
            </tbody>
          </table>
        `;
      }
    } catch (err) {
      modelsList.innerHTML = 'Error';
      console.error('[session-table] Failed to load project models:', err);
    }
  }
}

export function buildFilterControl(hours) {
  return `
    <div class="sessions-filter">
      <div class="filter-group filter-group-right">
        <label>Activity:</label>
        <select id="time-range-select">
          ${TIME_OPTIONS.map(o => `<option value="${o.value}" ${String(hours) === o.value ? 'selected' : ''}>${o.label}</option>`).join('')}
        </select>
      </div>
    </div>
  `;
}
