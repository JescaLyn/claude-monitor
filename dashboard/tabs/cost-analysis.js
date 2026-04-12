import { get, fmt$, fmtTokens, fmtDate, escapeHtml } from '../utils.js';

export async function render(el) {
  // Check for session ID in URL query parameter
  const params = new URLSearchParams(window.location.search);
  const sessionFromUrl = params.get('session');

  // Fetch all available sessions
  // TODO: add pagination/infinite scroll if > 50 sessions; currently uses default API limit
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

  // Initial render with selected session
  await renderCostAnalysis(el, sessionToUse, sessions);
}

async function renderCostAnalysis(el, sessionId, allSessions) {
  // Create main container
  // Note: Model filter was replaced with Tool filter; Skill filter remains for filtering by skill.
  // Session-level model breakdown is shown separately (see renderModelsSection)
  const html = `
    <div class="cost-analysis-container">
      <div class="cost-controls">
        <div class="control-group">
          <label for="session-select">Session</label>
          <select id="session-select">
            ${allSessions.map(s => `<option value="${escapeHtml(s.id)}" ${s.id === sessionId ? 'selected' : ''}>${escapeHtml(s.name || s.id.slice(0, 8))}</option>`).join('')}
          </select>
        </div>
        <div class="control-group">
          <label for="skill-filter">Skill</label>
          <select id="skill-filter">
            <option value="">All Skills</option>
          </select>
        </div>
        <div class="control-group">
          <label for="tool-filter">Tool</label>
          <select id="tool-filter">
            <option value="">All Tools</option>
          </select>
        </div>
      </div>

      <div class="summary-cards" id="summary-cards"></div>
      <div class="models-section" id="models-section"></div>

      <div class="section-tabs">
        <button class="section-tab active" data-tab="skills">Skills <span class="tab-count">0</span></button>
        <button class="section-tab" data-tab="agents">Agents <span class="tab-count">0</span></button>
        <button class="section-tab" data-tab="requests">API Requests <span class="tab-count">0</span></button>
      </div>

      <div class="tab-panels" id="tab-panels"></div>
    </div>
  `;

  el.innerHTML = html;

  // Fetch data for selected session
  let skillCosts = [];
  let subagentCosts = {};
  let apiRequests = [];
  let models = [];

  try {
    const [breakdown, modelsData] = await Promise.all([
      get(`/sessions/${sessionId}/breakdown`),
      get(`/sessions/${sessionId}/models`)
    ]);
    skillCosts = breakdown.skill_costs || [];
    subagentCosts = breakdown.subagent_costs || {};
    apiRequests = breakdown.api_requests || [];
    models = modelsData || [];
  } catch (err) {
    console.error('Error fetching cost analysis data:', err);
    el.innerHTML = `<p class="error">Error loading cost analysis: ${err.message}</p>`;
    return;
  }

  // Store session data in DOM data attributes instead of window global
  el.dataset.sessionId = sessionId;

  // Populate skill filter dropdown
  const skillSelect = document.getElementById('skill-filter');
  if (skillSelect) {
    skillCosts.forEach(skill => {
      const option = document.createElement('option');
      option.value = skill.skill_name;
      option.textContent = skill.skill_name;
      skillSelect.appendChild(option);
    });
  }

  // Populate tool filter dropdown
  const toolSelect = document.getElementById('tool-filter');
  if (toolSelect && subagentCosts.invocation_count > 0) {
    const option = document.createElement('option');
    option.value = 'agents';
    option.textContent = 'Agents';
    toolSelect.appendChild(option);
  }

  // Function to render display based on current filter selections
  function renderFilteredDisplay() {
    const selectedSkill = skillSelect?.value || '';
    const selectedTool = toolSelect?.value || '';

    // Filter data based on selections
    const filteredSkillCosts = selectedSkill
      ? skillCosts.filter(s => s.skill_name === selectedSkill)
      : skillCosts;

    const filteredSubagentCosts = selectedTool === 'agents' ? subagentCosts : { invocation_count: 0, api_request_count: 0, total_cost_usd: 0 };
    const filteredApiRequests = apiRequests; // API requests aren't filtered by skill in breakdown

    // Render summary cards with filtered data
    const summaryCardsEl = document.getElementById('summary-cards');
    if (summaryCardsEl) {
      renderSummaryCards(summaryCardsEl, filteredSkillCosts, filteredSubagentCosts, filteredApiRequests);
    }

    // Update tab counts based on filter
    document.querySelectorAll('.section-tab').forEach(btn => {
      const tabName = btn.dataset.tab;
      const countEl = btn.querySelector('.tab-count');
      if (countEl) {
        if (tabName === 'skills') {
          countEl.textContent = filteredSkillCosts.length;
        } else if (tabName === 'agents') {
          countEl.textContent = filteredSubagentCosts.invocation_count > 0 ? 1 : 0;
        } else if (tabName === 'requests') {
          countEl.textContent = filteredApiRequests.length;
        }
      }
    });

    // Update tab panel contents if visible
    const skillsPanel = document.getElementById('skills-panel');
    if (skillsPanel && skillsPanel.classList.contains('active')) {
      renderSkillsTab(skillsPanel, filteredSkillCosts);
    }

    const agentsPanel = document.getElementById('agents-panel');
    if (agentsPanel && agentsPanel.classList.contains('active')) {
      renderAgentsTab(agentsPanel, filteredSubagentCosts);
    }
  }

  // Render initial display
  renderFilteredDisplay();

  // Render models section (not filtered by skill/tool as it's session-level)
  const modelsEl = document.getElementById('models-section');
  if (modelsEl) {
    await renderModelsSection(modelsEl, models);
  }

  // Attach filter change listeners
  skillSelect?.addEventListener('change', renderFilteredDisplay);
  toolSelect?.addEventListener('change', renderFilteredDisplay);

  // Initialize tab panels and render Skills tab by default
  const tabPanelsEl = document.getElementById('tab-panels');
  if (tabPanelsEl) {
    // Create tab panels for each section
    tabPanelsEl.innerHTML = `
      <div id="skills-panel" class="tab-panel active"></div>
      <div id="agents-panel" class="tab-panel"></div>
      <div id="requests-panel" class="tab-panel"></div>
    `;

    // Render Skills tab by default
    const skillsPanel = document.getElementById('skills-panel');
    if (skillsPanel) {
      await renderSkillsTab(skillsPanel, skillCosts);
    }
  }

  // Attach event listeners for session change and tab switching
  document.getElementById('session-select')?.addEventListener('change', (e) => {
    const newSessionId = e.target.value;
    renderCostAnalysis(el, newSessionId, allSessions);
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

          // Get current filter selections
          const selectedSkill = skillSelect?.value || '';
          const selectedTool = toolSelect?.value || '';

          // Filter data based on current selections
          const filteredSkillCosts = selectedSkill
            ? skillCosts.filter(s => s.skill_name === selectedSkill)
            : skillCosts;

          const filteredSubagentCosts = selectedTool === 'agents' ? subagentCosts : { invocation_count: 0, api_request_count: 0, total_cost_usd: 0 };

          // Render content based on selected tab with filtered data
          if (tabName === 'skills') {
            renderSkillsTab(panel, filteredSkillCosts);
          } else if (tabName === 'agents') {
            renderAgentsTab(panel, filteredSubagentCosts);
          } else if (tabName === 'requests') {
            renderAPIRequestsTab(panel, apiRequests);
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
            <th>Cache Read</th>
            <th>Cache Create</th>
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
                <td>${fmtTokens(m.cache_read_tokens)}</td>
                <td>${fmtTokens(m.cache_creation_tokens)}</td>
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
 */
export async function renderSkillsTab(el, skillCosts) {
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
                <div>API Requests: ${skill.api_request_count}</div>
                <div>Cost per Call: ${fmt$(skill.invocation_count > 0 ? skill.total_cost_usd / skill.invocation_count : 0)}</div>
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
    row.addEventListener('click', () => {
      const detailRow = row.nextElementSibling;
      if (detailRow && detailRow.classList.contains('skill-detail')) {
        detailRow.style.display = detailRow.style.display === 'none' ? '' : 'none';
      }
    });
  });
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
export async function renderAPIRequestsTab(el, apiRequests) {
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
          <th class="sortable" data-sort="output_tokens">Output Tokens</th>
          <th class="sortable" data-sort="model">Model</th>
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
      const totalInputTokens = (req.input_tokens || 0) + (req.cache_read_tokens || 0);
      return `
        <tr class="request-row" data-timestamp="${req.ts}">
          <td>${fmtDate(req.ts)}</td>
          <td class="cost-cell">
            <div class="cost-bar" style="width: ${costPercentage}%"></div>
            <span class="cost-value">${fmt$(req.cost_usd)}</span>
          </td>
          <td>${fmtTokens(req.output_tokens)}</td>
          <td>${modelBadge}</td>
        </tr>
        <tr class="request-detail" style="display: none;">
          <td colspan="4">
            <div class="detail-panel">
              <div>Input Tokens: ${fmtTokens(req.input_tokens)}</div>
              <div>Cache Read: ${fmtTokens(req.cache_read_tokens)}</div>
              <div>Cache Creation: ${fmtTokens(req.cache_creation_tokens)}</div>
              <div>Duration: ${fmtDurationMs(req.duration_ms)}</div>
              <div>Fast Mode: ${req.is_fast_mode ? 'Yes' : 'No'}</div>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    // Attach row click handlers for expand/collapse
    attachRowHandlers();
  }

  /**
   * Attach expand/collapse handlers to request rows
   */
  function attachRowHandlers() {
    tbody.querySelectorAll('.request-row').forEach(row => {
      row.addEventListener('click', () => {
        const detail = row.nextElementSibling;
        if (detail && detail.classList.contains('request-detail')) {
          detail.style.display = detail.style.display === 'none' ? '' : 'none';
        }
      });
    });
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
export async function renderAgentsTab(el, subagentCosts) {
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
export async function renderSummaryCards(el, skillCosts, subagentCosts, apiRequests) {
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
      <div class="card-label">Agent Cost</div>
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
