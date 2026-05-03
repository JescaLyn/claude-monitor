import { get, fmt$, fmtTokens, fmtDate, escapeHtml } from '../utils.js';

export async function render(el) {
  // Check for session ID in URL query parameter
  const params = new URLSearchParams(window.location.search);
  const sessionFromUrl = params.get('session');

  // Fetch all available sessions (top-level only, no subagents)
  const sessions = await get('/sessions');

  if (sessions.length === 0) {
    el.innerHTML = '<p class="empty">No sessions available.</p>';
    return;
  }

  // Determine selected session: URL param takes precedence, otherwise first session
  const selectedSession = sessionFromUrl || sessions[0].id;

  // Verify the selected session exists
  const sessionExists = sessions.some(s => s.id === selectedSession);
  const sessionToUse = sessionExists ? selectedSession : sessions[0].id;

  // Initial render with selected session and no subagent
  await renderCostAnalysis(el, sessionToUse, null, sessions);
}

async function renderCostAnalysis(el, sessionId, subagentId, allSessions) {
  // Fetch subagent sessions for the selected main session
  let subagentSessions = [];
  try {
    subagentSessions = await get(`/sessions/${sessionId}/subagents`);
  } catch (err) {
    console.error('Error fetching subagent sessions:', err);
  }

  // Create main container
  const html = `
    <div class="cost-analysis-container">
      <div class="cost-controls">
        <div class="control-group">
          <label for="session-select">Session</label>
          <select id="session-select">
            ${allSessions.map(s => `<option value="${escapeHtml(s.id)}" ${s.id === sessionId ? 'selected' : ''}>${escapeHtml(s.name || s.id.slice(0, 8))}</option>`).join('')}
          </select>
        </div>
        ${subagentSessions.length > 0 ? `
        <div class="control-group">
          <label for="subagent-select">Subagent</label>
          <select id="subagent-select">
            <option value="">All Subagents</option>
            ${subagentSessions.map(s => `<option value="${escapeHtml(s.id)}" ${s.id === subagentId ? 'selected' : ''}>${escapeHtml(s.model || s.id.slice(0, 8))}</option>`).join('')}
          </select>
        </div>
        ` : ''}
      </div>

      <div class="summary-cards" id="summary-cards"></div>
      <div class="models-section" id="models-section"></div>

      <div class="section-tabs">
        <button class="section-tab active" data-tab="skills">Skills <span class="tab-count">0</span></button>
        ${subagentSessions.length > 0 && !subagentId ? `<button class="section-tab" data-tab="agents">Agents <span class="tab-count">0</span></button>` : ''}
        <button class="section-tab" data-tab="requests">API Requests <span class="tab-count">0</span></button>
        <button class="section-tab" data-tab="tools">Tools <span class="tab-count">0</span></button>
      </div>

      <div class="tab-panels" id="tab-panels"></div>
    </div>
  `;

  el.innerHTML = html;

  // Fetch data for selected session or subagent
  let skillCosts = [];
  let subagentCosts = {};
  let apiRequests = [];
  let models = [];
  let toolEvents = [];

  try {
    const [breakdown, modelsData, toolData] = await Promise.all([
      subagentId ? get(`/sessions/${subagentId}/breakdown`) : get(`/sessions/${sessionId}/breakdown`),
      subagentId ? get(`/sessions/${subagentId}/models`) : get(`/sessions/${sessionId}/models`),
      subagentId ? get(`/sessions/${subagentId}/tools`).catch(() => []) : get(`/sessions/${sessionId}/tools`).catch(() => [])
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

  // Store session data in DOM data attributes
  el.dataset.sessionId = sessionId;
  el.dataset.subagentId = subagentId || '';
  el.dataset.subagentSessions = JSON.stringify(subagentSessions);

  // No filter dropdowns - render all data

  // Update tab badge counts
  const skillsBadge = el.querySelector('[data-tab="skills"] .tab-count');
  if (skillsBadge) skillsBadge.textContent = skillCosts.length;

  const agentsBadge = el.querySelector('[data-tab="agents"] .tab-count');
  if (agentsBadge) agentsBadge.textContent = subagentSessions.length;

  const requestsBadge = el.querySelector('[data-tab="requests"] .tab-count');
  if (requestsBadge) requestsBadge.textContent = apiRequests.length;

  const toolsBadge = el.querySelector('[data-tab="tools"] .tab-count');
  if (toolsBadge) toolsBadge.textContent = toolEvents.length;

  // Render summary cards with all data
  const summaryCardsEl = document.getElementById('summary-cards');
  if (summaryCardsEl) {
    renderSummaryCards(summaryCardsEl, skillCosts, subagentCosts, apiRequests);
  }

  // Render models section
  const modelsEl = document.getElementById('models-section');
  if (modelsEl) {
    await renderModelsSection(modelsEl, models);
  }

  // Initialize tab panels and render Skills tab by default
  const tabPanelsEl = document.getElementById('tab-panels');
  if (tabPanelsEl) {
    // Create tab panels for each section
    tabPanelsEl.innerHTML = `
      <div id="skills-panel" class="tab-panel active"></div>
      <div id="agents-panel" class="tab-panel"></div>
      <div id="requests-panel" class="tab-panel"></div>
      <div id="tools-panel" class="tab-panel"></div>
    `;

    // Render Skills tab by default
    const skillsPanel = document.getElementById('skills-panel');
    if (skillsPanel) {
      await renderSkillsTab(skillsPanel, skillCosts, sessionId);
    }

    // Render Agents tab if it exists
    const agentsPanel = document.getElementById('agents-panel');
    if (agentsPanel && subagentSessions.length > 0 && !subagentId) {
      renderSubagentsList(agentsPanel, subagentSessions);
    }
  }

  // Attach event listeners for session/subagent change
  document.getElementById('session-select')?.addEventListener('change', (e) => {
    const newSessionId = e.target.value;
    renderCostAnalysis(el, newSessionId, null, allSessions);
  });

  document.getElementById('subagent-select')?.addEventListener('change', (e) => {
    const newSubagentId = e.target.value || null;
    renderCostAnalysis(el, sessionId, newSubagentId, allSessions);
  });

  document.querySelectorAll('.section-tab').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const tabBtn = e.target.closest('.section-tab');
      const tabName = tabBtn?.dataset.tab;
      if (tabName) {
        // Hide all panels and deactivate all tabs
        document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.remove('active'));
        document.querySelectorAll('.section-tab').forEach(tab => tab.classList.remove('active'));

        // Show selected panel and activate tab
        const panelId = `${tabName}-panel`;
        const panel = document.getElementById(panelId);
        if (panel) {
          panel.classList.add('active');
          tabBtn.classList.add('active');

          // Render content based on selected tab
          if (tabName === 'skills') {
            renderSkillsTab(panel, skillCosts, sessionId);
          } else if (tabName === 'agents') {
            renderSubagentsList(panel, subagentSessions);
          } else if (tabName === 'requests') {
            renderAPIRequestsTab(panel, apiRequests);
          } else if (tabName === 'tools') {
            renderToolsTab(panel, toolEvents);
          }
        }
      }
    });
  });
}

/**
 * Render models breakdown section at the top of the page
 * @param {HTMLElement} el - Container to render into
 * @param {Array} models - Array of model breakdown objects
 */
async function renderModelsSection(el, models) {
  if (!models || models.length === 0) {
    el.innerHTML = '<p class="empty">No API requests in this session.</p>';
    return;
  }

  // Session totals for percentage columns
  const sessionTotalCost = models.reduce((sum, m) => sum + (m.total_cost_usd || 0), 0);
  const sessionTotalRequests = models.reduce((sum, m) => sum + (m.api_request_count || 0), 0);
  const fmtPct = (part, total) => total > 0 ? `${((part / total) * 100).toFixed(1)}%` : '—';

  const html = `
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

  el.innerHTML = html;
}

/**
 * Render the Skills sub-tab with a table of skills and expandable detail rows
 * @param {HTMLElement} el - Container to render into
 * @param {Array} skillCosts - Array of skill cost objects
 * @param {string} sessionId - Session ID for fetching invocation details
 */
export async function renderSkillsTab(el, skillCosts, sessionId) {
  const costs = skillCosts.map(s => s.total_cost_usd || 0);
  const maxCost = costs.length > 0 ? Math.max(...costs) : 0;
  const html = `
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

  el.innerHTML = html;

  // Add click handlers for expand/collapse
  el.querySelectorAll('.skill-row').forEach(row => {
    row.addEventListener('click', async () => {
      const detailRow = row.nextElementSibling;
      if (detailRow && detailRow.classList.contains('skill-detail')) {
        const isHidden = detailRow.style.display === 'none';

        if (isHidden) {
          // Expanding - fetch invocation details if not already loaded
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

/**
 * Render the list of individual skill invocations
 * @param {HTMLElement} container - Container to render into
 * @param {Array} invocations - Array of SkillInvocation objects
 * @param {string} skillName - Name of the skill
 */
function renderSkillInvocationsList(container, invocations, skillName) {
  if (!invocations || invocations.length === 0) {
    container.innerHTML = '<p class="empty">No invocations found for this skill.</p>';
    return;
  }

  const costs = invocations.map(i => i.cost_usd || 0);
  const maxCost = costs.length > 0 ? Math.max(...costs) : 0;

  const html = `
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

  container.innerHTML = html;
}

/**
 * Format duration in milliseconds to a readable string.
 * @param {number|null|undefined} ms - Duration in milliseconds
 */
function fmtDurationMs(ms) {
  if (!ms) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Render the API Requests sub-tab with a table of API requests and sortable columns
 * Separates filter UI from table body to prevent filter inputs from being wiped on sort
 * @param {HTMLElement} el - Container to render into
 * @param {Array} apiRequests - Array of API request objects
 */
export function renderAPIRequestsTab(el, apiRequests) {
  let currentSort = { column: null, ascending: false };
  let filterMin = 0;
  let filterMax = Infinity;

  // Render filter UI once (never replaced)
  const filterHtml = `
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

  el.innerHTML = filterHtml;

  // Store references to reusable DOM elements
  const table = el.querySelector('.requests-table');
  const tbody = table.querySelector('tbody');
  const minCostInput = el.querySelector('#min-cost');
  const maxCostInput = el.querySelector('#max-cost');

  /**
   * Update table body with filtered and sorted data
   * Only modifies tbody, leaving filter inputs and table headers intact
   */
  function updateTableBody() {
    // Apply filter
    const filtered = apiRequests.filter(req => {
      const cost = req.cost_usd || 0;
      return cost >= filterMin && cost <= filterMax;
    });

    // Apply sort only if a column has been selected
    let sorted = filtered;
    if (currentSort.column !== null) {
      sorted = [...filtered].sort((a, b) => {
        const aVal = a[currentSort.column];
        const bVal = b[currentSort.column];
        const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
        return currentSort.ascending ? cmp : -cmp;
      });
    }

    // Render only tbody
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

  /**
   * Handle filter input changes
   */
  minCostInput.addEventListener('change', () => {
    filterMin = parseFloat(minCostInput.value) || 0;
    updateTableBody();
  });

  maxCostInput.addEventListener('change', () => {
    filterMax = parseFloat(maxCostInput.value) || Infinity;
    updateTableBody();
  });

  /**
   * Handle sort column clicks
   */
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

  // Initial render
  updateTableBody();
}

/**
 * Render the Agents sub-tab with a summary of agent costs
 * @param {HTMLElement} el - Container to render into
 * @param {Object} subagentCosts - Aggregated agent cost data with invocation_count, api_request_count, total_cost_usd
 */
export function renderAgentsTab(el, subagentCosts) {
  if (!subagentCosts || subagentCosts.invocation_count === 0) {
    el.innerHTML = '<p class="empty">No agent invocations in this session.</p>';
    return;
  }

  const html = `
    <table class="agents-table">
      <thead>
        <tr>
          <th>Metric</th>
          <th>Value</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Total Invocations</td>
          <td>${subagentCosts.invocation_count}</td>
        </tr>
        <tr>
          <td>API Requests</td>
          <td>${subagentCosts.api_request_count}</td>
        </tr>
        <tr>
          <td>Total Cost</td>
          <td>${fmt$(subagentCosts.total_cost_usd)}</td>
        </tr>
        <tr>
          <td>Cost per Invocation</td>
          <td>${fmt$(subagentCosts.invocation_count > 0 ? subagentCosts.total_cost_usd / subagentCosts.invocation_count : 0)}</td>
        </tr>
      </tbody>
    </table>
  `;

  el.innerHTML = html;
}

/**
 * Render six summary cards with cost attribution totals
 * @param {HTMLElement} el - Container to render into
 * @param {Array} skillCosts - Array of skill cost objects
 * @param {Object} subagentCosts - Object of subagent cost data
 * @param {Array} apiRequests - Array of API request objects
 */
export function renderSummaryCards(el, skillCosts, subagentCosts, apiRequests) {
  // Calculate totals — sum actual API request costs (the source of truth)
  const skillCostTotal = skillCosts.reduce((sum, s) => sum + (s.total_cost_usd || 0), 0);
  const agentCostTotal = subagentCosts.total_cost_usd || 0;
  const directToolCostTotal = apiRequests.reduce((sum, r) => sum + (r.cost_usd || 0), 0) - skillCostTotal - agentCostTotal;
  const totalCost = apiRequests.reduce((sum, r) => sum + (r.cost_usd || 0), 0);

  const contextTokens = skillCosts.reduce((sum, s) => sum + (s.total_context_tokens || 0), 0);
  const apiRequestCount = apiRequests.length;

  const skillCallCount = skillCosts.reduce((sum, s) => sum + (s.invocation_count || 0), 0);
  const agentCallCount = subagentCosts.invocation_count || 0;

  // Render cards
  const cardsHtml = `
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

  el.innerHTML = cardsHtml;
}

/**
 * Render the list of subagent sessions with their costs
 * @param {HTMLElement} el - Container to render into
 * @param {Array} subagentSessions - Array of subagent session objects
 */
function renderSubagentsList(el, subagentSessions) {
  if (!subagentSessions || subagentSessions.length === 0) {
    el.innerHTML = '<p class="empty">No subagent sessions in this session.</p>';
    return;
  }

  // Calculate total cost for percentage column
  const totalCost = subagentSessions.reduce((sum, s) => sum + (s.cost_usd || 0), 0);
  const fmtPct = (part, total) => total > 0 ? `${((part / total) * 100).toFixed(1)}%` : '—';

  const html = `
    <table class="subagents-table">
      <thead>
        <tr>
          <th>Subagent</th>
          <th>Type</th>
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
          const shortId = s.id.slice(0, 8);
          const shortModel = (s.model || 'unknown').split('/').pop() || 'unknown';
          const agentType = s.agent_type || '—';
          return `
            <tr>
              <td>${escapeHtml(shortId)}</td>
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

  el.innerHTML = html;
}

/**
 * Render the Tools sub-tab with a table of tool invocations and their costs
 * @param {HTMLElement} el - Container to render into
 * @param {Array} toolEvents - Array of tool event objects
 */
export function renderToolsTab(el, toolEvents) {
  if (!toolEvents || toolEvents.length === 0) {
    el.innerHTML = '<p class="empty">No tool invocations in this session.</p>';
    return;
  }

  let currentSort = { column: null, ascending: false };

  // Data is already aggregated from backend; just convert to array for sorting
  let tools = Array.isArray(toolEvents) ? toolEvents : [];

  // Render filter UI and table
  const filterHtml = `
    <div class="tools-header">
      <h3>Tool Invocations</h3>
    </div>
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

  el.innerHTML = filterHtml;

  const table = el.querySelector('.tools-table');
  const tbody = table.querySelector('tbody');

  /**
   * Update table body with sorted data
   */
  function updateTableBody() {
    // Apply sort if a column has been selected
    let sorted = tools;
    if (currentSort.column !== null) {
      sorted = [...tools].sort((a, b) => {
        const aVal = a[currentSort.column];
        const bVal = b[currentSort.column];
        const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
        return currentSort.ascending ? cmp : -cmp;
      });
    }

    // Calculate max cost for cost bar visualization
    const costs = sorted.map(t => t.total_cost_usd || 0);
    const maxCost = costs.length > 0 ? Math.max(...costs) : 0;

    // Session total cost for percentage calculation
    const sessionTotalCost = tools.reduce((sum, t) => sum + (t.total_cost_usd || 0), 0);
    const fmtPct = (part, total) => total > 0 ? `${((part / total) * 100).toFixed(1)}%` : '—';

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

  /**
   * Handle sort column clicks
   */
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

  // Initial render
  updateTableBody();
}

/**
 * Get model badge styling based on model name
 * @param {string} model - Model name (e.g., 'claude-3-5-sonnet-20241022')
 * @returns {string} Badge class name
 */
function getModelBadgeClass(model) {
  if (!model) return '';
  const lower = model.toLowerCase();
  if (lower.includes('sonnet')) return 'sonnet';
  if (lower.includes('haiku')) return 'haiku';
  if (lower.includes('opus')) return 'opus';
  return '';
}
