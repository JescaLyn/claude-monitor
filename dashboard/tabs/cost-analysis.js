import { get, fmt$, fmtTokens, fmtDate, escapeHtml } from '../utils.js';
import { DEFAULT_HOURS, TIME_OPTIONS, getTimeThreshold } from '../shared/session-table.js';

let caState = { hours: DEFAULT_HOURS, project: '', session: '', subagent: null };
let _allSessions = null;

async function refreshSessions() {
  const since = getTimeThreshold(caState.hours);
  _allSessions = await get(`/sessions/with-subagents?limit=200&since=${since}`);
}

export async function render(el) {
  const params = new URLSearchParams(window.location.search);
  const sessionFromUrl = params.get('session');
  const projectFromUrl = params.get('project');
  if (sessionFromUrl) {
    caState.session = sessionFromUrl;
  } else if (!projectFromUrl) {
    caState.session = '';
    caState.subagent = null;
  }
  if (projectFromUrl !== null) caState.project = projectFromUrl;
  try {
    await refreshSessions();
  } catch (err) {
    el.innerHTML = `<p class="error">Failed to load sessions: ${err.message}</p>`;
    return;
  }
  await renderCostAnalysis(el);
}

async function renderCostAnalysis(el) {
  const { project, hours } = caState;

  if (!_allSessions || _allSessions.length === 0) {
    el.innerHTML = '<p class="empty">No sessions available.</p>';
    return;
  }

  const projects = [...new Set(_allSessions.map(s => s.project).filter(Boolean))].sort();
  const projectSessions = project ? _allSessions.filter(s => s.project === project) : _allSessions;

  const validSession = caState.session && projectSessions.some(s => s.id === caState.session)
    ? caState.session : '';
  caState.session = validSession;
  const sessionId = caState.session;
  const subagentId = caState.subagent;

  let subagentSessions = [];
  if (sessionId) {
    try { subagentSessions = await get(`/sessions/${sessionId}/subagents`); }
    catch (e) { console.error(e); }
  }
  const hasSubagents = subagentSessions.length > 0;

  let subagentDisabled = '';
  let subagentOptions = '<option value="">All Subagents</option>';
  if (!sessionId) {
    subagentDisabled = 'disabled';
  } else if (!hasSubagents) {
    subagentDisabled = 'disabled';
    subagentOptions = '<option value="">No subagents</option>';
  } else {
    subagentOptions += subagentSessions.map(s => {
      const shortModel = (s.model || 'unknown').split('/').pop() || 'unknown';
      const label = s.name || s.agent_type || `Untyped (${shortModel})`;
      return `<option value="${escapeHtml(s.id)}" ${s.id === subagentId ? 'selected' : ''}>${escapeHtml(label)}</option>`;
    }).join('');
  }

  const controlsHtml = `
    <div class="cost-controls">
      <div class="control-group">
        <label for="project-select">Project</label>
        <select id="project-select">
          <option value="">All</option>
          ${projects.map(p => `<option value="${escapeHtml(p)}" ${p === project ? 'selected' : ''}>${escapeHtml(p)}</option>`).join('')}
        </select>
      </div>
      <div class="control-group">
        <label for="session-select">Session</label>
        <select id="session-select">
          <option value="" ${!sessionId ? 'selected' : ''}>All</option>
          ${projectSessions.map(s => `<option value="${escapeHtml(s.id)}" ${s.id === sessionId ? 'selected' : ''}>${escapeHtml(s.name || s.id.slice(0, 8))}</option>`).join('')}
        </select>
      </div>
      <div class="control-group">
        <label for="subagent-select">Subagent</label>
        <select id="subagent-select" ${subagentDisabled}>${subagentOptions}</select>
      </div>
      <div class="control-group">
        <label for="time-range-select">Period</label>
        <select id="time-range-select">
          ${TIME_OPTIONS.map(o => `<option value="${o.value}" ${String(hours) === o.value ? 'selected' : ''}>${o.label}</option>`).join('')}
        </select>
      </div>
    </div>
  `;

  if (!sessionId) {
    el.innerHTML = `<div class="cost-analysis-container">${controlsHtml}<div id="aggregate-section"><p class="loading">Loading…</p></div></div>`;
    attachControlListeners(el);
    const since = getTimeThreshold(caState.hours);
    const aggregateEl = el.querySelector('#aggregate-section');
    try {
      const summary = await get(`/sessions/aggregate?since=${since}&project=${encodeURIComponent(project)}`);
      if (aggregateEl) aggregateEl.innerHTML = renderAggregateSummaryHtml(summary);
    } catch (err) {
      if (aggregateEl) aggregateEl.innerHTML = `<p class="error">Failed to load summary: ${escapeHtml(err.message)}</p>`;
    }
    return;
  }

  el.innerHTML = `<div class="cost-analysis-container">${controlsHtml}<div class="summary-cards" id="summary-cards"></div>
    <div class="models-section" id="models-section"></div>
    <div class="section-tabs">
      <button class="section-tab active" data-tab="skills">Skills <span class="tab-count">0</span></button>
      ${hasSubagents && !subagentId ? `<button class="section-tab" data-tab="agents">Agents <span class="tab-count">0</span></button>` : ''}
      <button class="section-tab" data-tab="requests">API Requests <span class="tab-count">0</span></button>
      <button class="section-tab" data-tab="tools">Tools <span class="tab-count">0</span></button>
    </div>
    <div class="tab-panels" id="tab-panels"></div>
  </div>`;

  attachControlListeners(el);

  let skillCosts = [], subagentCosts = {}, apiRequests = [], models = [], toolEvents = [];
  try {
    const target = subagentId || sessionId;
    const [breakdown, modelsData, toolData] = await Promise.all([
      get(`/sessions/${target}/breakdown`),
      get(`/sessions/${target}/models`),
      get(`/sessions/${target}/tools`).catch(() => []),
    ]);
    skillCosts = breakdown.skill_costs || [];
    subagentCosts = breakdown.subagent_costs || {};
    apiRequests = breakdown.api_requests || [];
    models = modelsData || [];
    toolEvents = toolData || [];
  } catch (err) {
    console.error('Error fetching cost analysis data:', err);
    el.innerHTML = `<p class="error">Error loading cost analysis: ${err.message}</p>`;
    return;
  }

  el.querySelector('[data-tab="skills"] .tab-count').textContent = skillCosts.length;
  const agentsBadge = el.querySelector('[data-tab="agents"] .tab-count');
  if (agentsBadge) agentsBadge.textContent = subagentSessions.length;
  el.querySelector('[data-tab="requests"] .tab-count').textContent = apiRequests.length;
  el.querySelector('[data-tab="tools"] .tab-count').textContent = toolEvents.length;

  const summaryCardsEl = el.querySelector('#summary-cards');
  if (summaryCardsEl) renderSummaryCards(summaryCardsEl, skillCosts, subagentCosts, apiRequests);

  const modelsEl = el.querySelector('#models-section');
  if (modelsEl) await renderModelsSection(modelsEl, models);

  const tabPanelsEl = el.querySelector('#tab-panels');
  if (tabPanelsEl) {
    tabPanelsEl.innerHTML = `
      <div id="skills-panel" class="tab-panel active"></div>
      <div id="agents-panel" class="tab-panel"></div>
      <div id="requests-panel" class="tab-panel"></div>
      <div id="tools-panel" class="tab-panel"></div>
    `;
    const skillsPanel = el.querySelector('#skills-panel');
    if (skillsPanel) await renderSkillsTab(skillsPanel, skillCosts, sessionId);
    const agentsPanel = el.querySelector('#agents-panel');
    if (agentsPanel && hasSubagents && !subagentId) renderSubagentsList(agentsPanel, subagentSessions);
  }

  el.querySelectorAll('.section-tab').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const tabBtn = e.target.closest('.section-tab');
      const tabName = tabBtn?.dataset.tab;
      if (!tabName) return;
      el.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      el.querySelectorAll('.section-tab').forEach(t => t.classList.remove('active'));
      const panel = el.querySelector(`#${tabName}-panel`);
      if (panel) {
        panel.classList.add('active');
        tabBtn.classList.add('active');
        if (tabName === 'skills') renderSkillsTab(panel, skillCosts, sessionId);
        else if (tabName === 'agents') renderSubagentsList(panel, subagentSessions);
        else if (tabName === 'requests') renderAPIRequestsTab(panel, apiRequests);
        else if (tabName === 'tools') renderToolsTab(panel, toolEvents);
      }
    });
  });
}

function attachControlListeners(el) {
  el.querySelector('#project-select')?.addEventListener('change', (e) => {
    caState.project = e.target.value;
    caState.session = '';
    caState.subagent = null;
    renderCostAnalysis(el);
  });
  el.querySelector('#session-select')?.addEventListener('change', (e) => {
    caState.session = e.target.value;
    caState.subagent = null;
    renderCostAnalysis(el);
  });
  el.querySelector('#subagent-select')?.addEventListener('change', (e) => {
    caState.subagent = e.target.value || null;
    renderCostAnalysis(el);
  });
  el.querySelector('#time-range-select')?.addEventListener('change', async (e) => {
    caState.hours = parseInt(e.target.value, 10);
    caState.session = '';
    caState.subagent = null;
    _allSessions = null;
    await refreshSessions();
    await renderCostAnalysis(el);
  });
}

function renderAggregateSummaryHtml(summary) {
  const { total_cost_usd: cost, total_api_requests: reqs, total_input_tokens: input,
          total_output_tokens: output, total_sessions: sessions } = summary;
  if (sessions === 0) return '<p class="empty">No sessions in this time range.</p>';
  return `
    <div class="summary-cards">
      <div class="summary-card">
        <div class="card-label">Total Cost</div>
        <div class="card-value">${fmt$(cost)}</div>
        <div class="card-subtext">${sessions} session${sessions === 1 ? '' : 's'}</div>
      </div>
      <div class="summary-card">
        <div class="card-label">API Requests</div>
        <div class="card-value">${reqs.toLocaleString()}</div>
        <div class="card-subtext">across all sessions</div>
      </div>
      <div class="summary-card">
        <div class="card-label">Input Tokens</div>
        <div class="card-value">${fmtTokens(input)}</div>
        <div class="card-subtext">total input</div>
      </div>
      <div class="summary-card">
        <div class="card-label">Output Tokens</div>
        <div class="card-value">${fmtTokens(output)}</div>
        <div class="card-subtext">total output</div>
      </div>
      <div class="summary-card">
        <div class="card-label">Avg Cost/Session</div>
        <div class="card-value">${fmt$(sessions > 0 ? cost / sessions : 0)}</div>
        <div class="card-subtext">per session</div>
      </div>
      <div class="summary-card">
        <div class="card-label">Sessions</div>
        <div class="card-value">${sessions.toLocaleString()}</div>
        <div class="card-subtext">with API activity</div>
      </div>
    </div>
    <p class="muted" style="margin-top: 1.5rem; font-size: 13px;">Select a session to view detailed breakdown.</p>
  `;
}

async function renderModelsSection(el, models) {
  if (!models || models.length === 0) {
    el.innerHTML = '<p class="empty">No API requests in this session.</p>';
    return;
  }
  const sessionTotalCost = models.reduce((sum, m) => sum + (m.total_cost_usd || 0), 0);
  const sessionTotalRequests = models.reduce((sum, m) => sum + (m.api_request_count || 0), 0);
  const fmtPct = (part, total) => total > 0 ? `${((part / total) * 100).toFixed(1)}%` : '—';
  el.innerHTML = `
    <div class="models-breakdown">
      <h3>Models Used</h3>
      <table class="models-table">
        <thead>
          <tr>
            <th>Model</th>
            <th>Requests</th>
            <th>Requests % of Session</th>
            <th>Input Tokens</th>
            <th>Output Tokens</th>
            <th>Cost</th>
            <th>Cost % of Session</th>
          </tr>
        </thead>
        <tbody>
          ${models.map(m => {
            const shortModel = (m.model || 'unknown').split('/').pop() || 'unknown';
            return `
              <tr>
                <td>${escapeHtml(shortModel)}</td>
                <td>${m.api_request_count}</td>
                <td>${fmtPct(m.api_request_count || 0, sessionTotalRequests)}</td>
                <td>${fmtTokens(m.input_tokens)}</td>
                <td>${fmtTokens(m.output_tokens)}</td>
                <td>${fmt$(m.total_cost_usd)}</td>
                <td>${fmtPct(m.total_cost_usd || 0, sessionTotalCost)}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

export async function renderSkillsTab(el, skillCosts, sessionId) {
  const costs = skillCosts.map(s => s.total_cost_usd || 0);
  const maxCost = costs.length > 0 ? Math.max(...costs) : 0;
  el.innerHTML = `
    <table class="skills-table">
      <thead>
        <tr>
          <th>Skill</th>
          <th>Cost</th>
          <th>Context Tokens</th>
          <th>Calls</th>
        </tr>
      </thead>
      <tbody>
        ${skillCosts.map(skill => {
          const costPercentage = maxCost > 0 ? ((skill.total_cost_usd || 0) / maxCost) * 100 : 0;
          return `
          <tr class="skill-row" data-skill="${escapeHtml(skill.skill_name)}">
            <td>${escapeHtml(skill.skill_name)}</td>
            <td class="cost-cell">
              <div class="cost-bar" style="width: ${costPercentage}%"></div>
              <span class="cost-value">${fmt$(skill.total_cost_usd)}</span>
            </td>
            <td>${fmtTokens(skill.total_context_tokens)}</td>
            <td>${skill.invocation_count}</td>
          </tr>
          <tr class="skill-detail" style="display: none;">
            <td colspan="4">
              <div class="detail-panel">
                <div class="invocation-summary">
                  <div>API Requests: ${skill.api_request_count}</div>
                  <div>Cost per Call: ${fmt$(skill.invocation_count > 0 ? skill.total_cost_usd / skill.invocation_count : 0)}</div>
                </div>
                <div class="invocation-list-container">
                  <div class="invocation-list-placeholder">Loading invocations...</div>
                </div>
              </div>
            </td>
          </tr>
        `;
        }).join('')}
      </tbody>
    </table>
  `;

  el.querySelectorAll('.skill-row').forEach(row => {
    row.addEventListener('click', async () => {
      const detailRow = row.nextElementSibling;
      if (detailRow && detailRow.classList.contains('skill-detail')) {
        const isHidden = detailRow.style.display === 'none';
        if (isHidden) {
          const skillName = row.dataset.skill;
          const listContainer = detailRow.querySelector('.invocation-list-container');
          const placeholder = listContainer?.querySelector('.invocation-list-placeholder');
          if (placeholder) {
            try {
              const invocations = await get(`/sessions/${sessionId}/skills/${encodeURIComponent(skillName)}/invocations`);
              renderSkillInvocationsList(listContainer, invocations, skillName);
            } catch (err) {
              console.error(`Error fetching invocations for ${skillName}:`, err);
              listContainer.innerHTML = `<p class="error">Error loading invocations: ${err.message}</p>`;
            }
          }
        }
        detailRow.style.display = isHidden ? '' : 'none';
      }
    });
  });
}

function renderSkillInvocationsList(container, invocations, skillName) {
  if (!invocations || invocations.length === 0) {
    container.innerHTML = '<p class="empty">No invocations found for this skill.</p>';
    return;
  }
  const costs = invocations.map(i => i.cost_usd || 0);
  const maxCost = costs.length > 0 ? Math.max(...costs) : 0;
  container.innerHTML = `
    <div class="invocation-list">
      <h4>Individual Invocations</h4>
      <table class="invocation-table">
        <thead>
          <tr>
            <th>Timestamp</th>
            <th>Cost</th>
            <th>API Requests</th>
            <th>Duration</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${invocations.map(inv => {
            const costPercentage = maxCost > 0 ? (inv.cost_usd / maxCost) * 100 : 0;
            const status = inv.success === null ? '—' : inv.success === 1 ? 'Success' : 'Failed';
            const statusClass = inv.success === 1 ? 'success' : inv.success === 0 ? 'failed' : '';
            return `
              <tr class="invocation-row" data-invocation="${escapeHtml(inv.tool_event_id)}">
                <td>${fmtDate(inv.ts)}</td>
                <td class="cost-cell">
                  <div class="cost-bar" style="width: ${costPercentage}%"></div>
                  <span class="cost-value">${fmt$(inv.cost_usd)}</span>
                </td>
                <td>${inv.api_request_count}</td>
                <td>${fmtDurationMs(inv.duration_ms)}</td>
                <td><span class="status-badge ${statusClass}">${status}</span></td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function fmtDurationMs(ms) {
  if (!ms) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function renderAPIRequestsTab(el, apiRequests) {
  let currentSort = { column: null, ascending: false };
  let filterMin = 0;
  let filterMax = Infinity;

  el.innerHTML = `
    <div class="cost-range-filter">
      <div class="filter-input-group">
        <label for="min-cost">Min Cost</label>
        <input type="number" id="min-cost" placeholder="0.0000" step="0.0001" min="0">
      </div>
      <div class="filter-input-group">
        <label for="max-cost">Max Cost</label>
        <input type="number" id="max-cost" placeholder="∞" step="0.0001" min="0">
      </div>
    </div>
    <table class="requests-table">
      <thead>
        <tr>
          <th class="sortable" data-sort="ts">Timestamp</th>
          <th class="sortable" data-sort="cost_usd">Cost</th>
          <th class="sortable" data-sort="input_tokens">Input Tokens</th>
          <th class="sortable" data-sort="output_tokens">Output Tokens</th>
          <th colspan="2" style="text-align: center;">Cache</th>
          <th class="sortable" data-sort="duration_ms">Duration</th>
          <th class="sortable" data-sort="is_fast_mode">Fast Mode</th>
          <th class="sortable" data-sort="model">Model</th>
        </tr>
        <tr style="border-top: none;">
          <th colspan="4"></th>
          <th class="sortable" data-sort="cache_read_tokens">Read</th>
          <th class="sortable" data-sort="cache_creation_tokens">Creation</th>
          <th colspan="3"></th>
        </tr>
      </thead>
      <tbody></tbody>
    </table>
  `;

  const tbody = el.querySelector('tbody');
  const minCostInput = el.querySelector('#min-cost');
  const maxCostInput = el.querySelector('#max-cost');

  function updateTableBody() {
    const filtered = apiRequests.filter(req => {
      const cost = req.cost_usd || 0;
      return cost >= filterMin && cost <= filterMax;
    });
    let sorted = filtered;
    if (currentSort.column !== null) {
      sorted = [...filtered].sort((a, b) => {
        const aVal = a[currentSort.column];
        const bVal = b[currentSort.column];
        const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
        return currentSort.ascending ? cmp : -cmp;
      });
    }
    const costs = sorted.map(req => req.cost_usd || 0);
    const maxCost = costs.length > 0 ? Math.max(...costs) : 0;
    tbody.innerHTML = sorted.map(req => {
      const costPercentage = maxCost > 0 ? (req.cost_usd / maxCost) * 100 : 0;
      const modelName = req.model || 'Unknown';
      const modelBadge = `<span class="model-badge ${getModelBadgeClass(modelName)}">${escapeHtml(modelName)}</span>`;
      const fastModeIndicator = req.is_fast_mode ? '<span style="color: var(--accent-green); font-weight: 600;">Yes</span>' : 'No';
      return `
        <tr class="request-row" data-timestamp="${req.ts}">
          <td>${fmtDate(req.ts)}</td>
          <td class="cost-cell">
            <div class="cost-bar" style="width: ${costPercentage}%"></div>
            <span class="cost-value">${fmt$(req.cost_usd)}</span>
          </td>
          <td>${fmtTokens(req.input_tokens)}</td>
          <td>${fmtTokens(req.output_tokens)}</td>
          <td>${fmtTokens(req.cache_read_tokens)}</td>
          <td>${fmtTokens(req.cache_creation_tokens)}</td>
          <td>${fmtDurationMs(req.duration_ms)}</td>
          <td>${fastModeIndicator}</td>
          <td>${modelBadge}</td>
        </tr>
      `;
    }).join('');
  }

  minCostInput.addEventListener('change', () => {
    filterMin = parseFloat(minCostInput.value) || 0;
    updateTableBody();
  });
  maxCostInput.addEventListener('change', () => {
    filterMax = parseFloat(maxCostInput.value) || Infinity;
    updateTableBody();
  });
  el.querySelectorAll('th.sortable').forEach(header => {
    header.addEventListener('click', () => {
      const column = header.dataset.sort;
      if (currentSort.column === column) {
        currentSort.ascending = !currentSort.ascending;
      } else {
        currentSort.column = column;
        currentSort.ascending = true;
      }
      updateTableBody();
    });
  });

  updateTableBody();
}

export function renderAgentsTab(el, subagentCosts) {
  if (!subagentCosts || subagentCosts.invocation_count === 0) {
    el.innerHTML = '<p class="empty">No agent invocations in this session.</p>';
    return;
  }
  el.innerHTML = `
    <table class="agents-table">
      <thead><tr><th>Metric</th><th>Value</th></tr></thead>
      <tbody>
        <tr><td>Total Invocations</td><td>${subagentCosts.invocation_count}</td></tr>
        <tr><td>API Requests</td><td>${subagentCosts.api_request_count}</td></tr>
        <tr><td>Total Cost</td><td>${fmt$(subagentCosts.total_cost_usd)}</td></tr>
        <tr><td>Cost per Invocation</td><td>${fmt$(subagentCosts.invocation_count > 0 ? subagentCosts.total_cost_usd / subagentCosts.invocation_count : 0)}</td></tr>
      </tbody>
    </table>
  `;
}

export function renderSummaryCards(el, skillCosts, subagentCosts, apiRequests) {
  const skillCostTotal = skillCosts.reduce((sum, s) => sum + (s.total_cost_usd || 0), 0);
  const agentCostTotal = subagentCosts.total_cost_usd || 0;
  const totalCost = apiRequests.reduce((sum, r) => sum + (r.cost_usd || 0), 0);
  const directToolCostTotal = totalCost - skillCostTotal - agentCostTotal;
  const contextTokens = skillCosts.reduce((sum, s) => sum + (s.total_context_tokens || 0), 0);
  const apiRequestCount = apiRequests.length;
  const skillCallCount = skillCosts.reduce((sum, s) => sum + (s.invocation_count || 0), 0);
  const agentCallCount = subagentCosts.invocation_count || 0;
  el.innerHTML = `
    <div class="summary-card">
      <div class="card-label">Total Cost</div>
      <div class="card-value">${fmt$(totalCost)}</div>
      <div class="card-subtext">${apiRequestCount} API requests</div>
    </div>
    <div class="summary-card">
      <div class="card-label">Skill Cost</div>
      <div class="card-value">${fmt$(skillCostTotal)}</div>
      <div class="card-subtext">${skillCallCount} invocations</div>
    </div>
    <div class="summary-card">
      <div class="card-label">Subagent Cost</div>
      <div class="card-value">${fmt$(agentCostTotal)}</div>
      <div class="card-subtext">${agentCallCount} invocations</div>
    </div>
    <div class="summary-card">
      <div class="card-label">Direct Tool Cost</div>
      <div class="card-value">${fmt$(Math.max(0, directToolCostTotal))}</div>
      <div class="card-subtext">Other tool invocations</div>
    </div>
    <div class="summary-card">
      <div class="card-label">Context Tokens</div>
      <div class="card-value">${fmtTokens(contextTokens)}</div>
      <div class="card-subtext">Overhead from skills</div>
    </div>
    <div class="summary-card">
      <div class="card-label">Avg Cost/Request</div>
      <div class="card-value">${fmt$(apiRequestCount > 0 ? totalCost / apiRequestCount : 0)}</div>
      <div class="card-subtext">Cost per API call</div>
    </div>
  `;
}

function renderSubagentsList(el, subagentSessions) {
  if (!subagentSessions || subagentSessions.length === 0) {
    el.innerHTML = '<p class="empty">No subagent sessions in this session.</p>';
    return;
  }
  const totalCost = subagentSessions.reduce((sum, s) => sum + (s.cost_usd || 0), 0);
  const fmtPct = (part, total) => total > 0 ? `${((part / total) * 100).toFixed(1)}%` : '—';
  el.innerHTML = `
    <table class="subagents-table">
      <thead>
        <tr>
          <th>Subagent</th>
          <th>Model</th>
          <th>Cost</th>
          <th>Cost % of Parent</th>
          <th>API Requests</th>
          <th>Input Tokens</th>
          <th>Output Tokens</th>
        </tr>
      </thead>
      <tbody>
        ${subagentSessions.map(s => {
          const shortModel = (s.model || 'unknown').split('/').pop() || 'unknown';
          const agentType = s.name || s.agent_type || `Untyped (${shortModel})`;
          return `
            <tr>
              <td>${escapeHtml(agentType)}</td>
              <td>${escapeHtml(shortModel)}</td>
              <td>${fmt$(s.cost_usd || 0)}</td>
              <td>${fmtPct(s.cost_usd || 0, totalCost)}</td>
              <td>${s.api_request_count || 0}</td>
              <td>${fmtTokens(s.input_tokens || 0)}</td>
              <td>${fmtTokens(s.output_tokens || 0)}</td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;
}

export function renderToolsTab(el, toolEvents) {
  if (!toolEvents || toolEvents.length === 0) {
    el.innerHTML = '<p class="empty">No tool invocations in this session.</p>';
    return;
  }
  let currentSort = { column: null, ascending: false };
  const tools = Array.isArray(toolEvents) ? toolEvents : [];
  el.innerHTML = `
    <div class="tools-header"><h3>Tool Invocations</h3></div>
    <table class="tools-table">
      <thead>
        <tr>
          <th class="sortable" data-sort="tool_name">Tool Name</th>
          <th class="sortable" data-sort="invocation_count">Invocation Count</th>
          <th class="sortable" data-sort="api_request_count">API Requests</th>
          <th class="sortable" data-sort="total_cost_usd">Total Cost</th>
          <th class="sortable" data-sort="success_count">Success Rate</th>
          <th class="sortable" data-sort="avg_duration_ms">Avg Duration</th>
        </tr>
      </thead>
      <tbody></tbody>
    </table>
  `;
  const tbody = el.querySelector('tbody');

  function updateTableBody() {
    let sorted = tools;
    if (currentSort.column !== null) {
      sorted = [...tools].sort((a, b) => {
        const aVal = a[currentSort.column];
        const bVal = b[currentSort.column];
        const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
        return currentSort.ascending ? cmp : -cmp;
      });
    }
    const costs = sorted.map(t => t.total_cost_usd || 0);
    const maxCost = costs.length > 0 ? Math.max(...costs) : 0;
    tbody.innerHTML = sorted.map(tool => {
      const costPercentage = maxCost > 0 ? (tool.total_cost_usd / maxCost) * 100 : 0;
      const successRate = tool.invocation_count > 0 ? ((tool.success_count / tool.invocation_count) * 100).toFixed(1) : 0;
      const durationStr = tool.avg_duration_ms ? `${tool.avg_duration_ms.toFixed(0)}ms` : '—';
      return `
        <tr class="tool-row" data-tool="${escapeHtml(tool.tool_name)}">
          <td>${escapeHtml(tool.tool_name)}</td>
          <td>${tool.invocation_count}</td>
          <td>${tool.api_request_count}</td>
          <td class="cost-cell">
            <div class="cost-bar" style="width: ${costPercentage}%"></div>
            <span class="cost-value">${fmt$(tool.total_cost_usd)}</span>
          </td>
          <td>${successRate}%</td>
          <td>${durationStr}</td>
        </tr>
      `;
    }).join('');
  }

  el.querySelectorAll('th.sortable').forEach(header => {
    header.addEventListener('click', () => {
      const column = header.dataset.sort;
      if (currentSort.column === column) {
        currentSort.ascending = !currentSort.ascending;
      } else {
        currentSort.column = column;
        currentSort.ascending = true;
      }
      updateTableBody();
    });
  });

  updateTableBody();
}

function getModelBadgeClass(model) {
  if (!model) return '';
  const lower = model.toLowerCase();
  if (lower.includes('sonnet')) return 'sonnet';
  if (lower.includes('haiku')) return 'haiku';
  if (lower.includes('opus')) return 'opus';
  return '';
}
