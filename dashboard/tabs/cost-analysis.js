import { get, fmt$, fmtTokens, fmtDate } from '../utils.js';

/**
 * Escape HTML special characters to prevent XSS
 * @param {string} text - Text to escape
 * @returns {string} Escaped HTML
 */
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

export async function render(el) {
  // Fetch all available sessions and current selection
  const sessions = await get('/sessions');
  const selectedSession = sessions.length > 0 ? sessions[0].id : null;

  if (!selectedSession) {
    el.innerHTML = '<p class="empty">No sessions available.</p>';
    return;
  }

  // Initial render with first session
  await renderCostAnalysis(el, selectedSession, sessions);
}

async function renderCostAnalysis(el, sessionId, allSessions) {
  // Create main container
  const html = `
    <div class="cost-analysis-container">
      <div class="cost-controls">
        <div class="control-group">
          <label for="session-select">Session</label>
          <select id="session-select">
            ${allSessions.map(s => `<option value="${s.id}" ${s.id === sessionId ? 'selected' : ''}>${s.name || s.id.slice(0, 8)}</option>`).join('')}
          </select>
        </div>
        <div class="control-group">
          <label for="skill-filter">Skill</label>
          <select id="skill-filter">
            <option value="">All skills</option>
          </select>
        </div>
        <div class="control-group">
          <label for="model-filter">Model</label>
          <select id="model-filter">
            <option value="">All models</option>
          </select>
        </div>
      </div>

      <div class="summary-cards" id="summary-cards"></div>
      <div class="context-bar" id="context-bar"></div>

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

  try {
    const results = await Promise.all([
      get('/skills/costs'),
      get('/subagents/costs'),
      get('/requests')
    ]);
    skillCosts = results[0] || [];
    subagentCosts = results[1] || {};
    apiRequests = results[2] || [];
  } catch (err) {
    console.error('Error fetching cost analysis data:', err);
    el.innerHTML = `<p class="error">Error loading cost analysis: ${err.message}</p>`;
    return;
  }

  // Store session data in DOM data attributes instead of window global
  el.dataset.sessionId = sessionId;

  // Render summary cards
  const summaryCardsEl = document.getElementById('summary-cards');
  if (summaryCardsEl) {
    await renderSummaryCards(summaryCardsEl, skillCosts, subagentCosts, apiRequests);
  }

  // Render context bar if context overhead is significant
  const contextBarEl = document.getElementById('context-bar');
  if (contextBarEl) {
    const totalTokens = skillCosts.reduce((sum, s) => sum + (s.totalTokens || 0), 0) +
                        Object.values(subagentCosts).reduce((sum, a) => sum + (a.totalTokens || 0), 0);
    const contextTokens = skillCosts.reduce((sum, s) => sum + (s.contextTokens || 0), 0);
    const contextOverheadPct = totalTokens > 0 ?
      ((contextTokens / totalTokens) * 100).toFixed(1) :
      0;

    if (contextOverheadPct > 10) {
      contextBarEl.innerHTML = `
        <div class="context-bar-icon">⚠️</div>
        <div class="context-bar-message">
          Context overhead is <strong>${contextOverheadPct}%</strong> of total tokens. Consider optimizing context to reduce costs.
        </div>
      `;
    } else {
      contextBarEl.style.display = 'none';
    }
  }

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

          // Render content based on selected tab
          if (tabName === 'skills') {
            renderSkillsTab(panel, skillCosts);
          } else if (tabName === 'agents') {
            renderAgentsTab(panel, subagentCosts);
          } else if (tabName === 'requests') {
            renderAPIRequestsTab(panel, apiRequests);
          }
        }
      }
    });
  });
}

/**
 * Render the Skills sub-tab with a table of skills and expandable detail rows
 * @param {HTMLElement} el - Container to render into
 * @param {Array} skillCosts - Array of skill cost objects
 */
export async function renderSkillsTab(el, skillCosts) {
  const maxCost = Math.max(...skillCosts.map(s => s.totalCost || 0));
  const html = `
    <table class="skills-table">
      <thead>
        <tr>
          <th>Skill</th>
          <th>Cost</th>
          <th>Tokens</th>
          <th>Calls</th>
        </tr>
      </thead>
      <tbody>
        ${skillCosts.map(skill => {
          const costPercentage = maxCost > 0 ? ((skill.totalCost || 0) / maxCost) * 100 : 0;
          const modelBadges = skill.models?.map(m => `<span class="model-badge ${getModelBadgeClass(m)}">${m}</span>`).join(' ') || 'N/A';
          return `
          <tr class="skill-row" data-skill="${skill.skillName}">
            <td>${skill.skillName}</td>
            <td class="cost-cell">
              <div class="cost-bar" style="width: ${costPercentage}%"></div>
              <span class="cost-value">${fmt$(skill.totalCost)}</span>
            </td>
            <td>${fmtTokens(skill.totalTokens)}</td>
            <td>${skill.callCount}</td>
          </tr>
          <tr class="skill-detail" style="display: none;">
            <td colspan="4">
              <div class="detail-panel">
                <div>Time Window: ${escapeHtml(skill.timeWindow || 'N/A')}</div>
                <div>Context Tokens: ${fmtTokens(skill.contextTokens || 0)}</div>
                <div>Models: ${modelBadges}</div>
                <div>Cost: ${fmt$(skill.detailCost || skill.totalCost)}</div>
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
          <th class="sortable" data-sort="timestamp">Timestamp</th>
          <th class="sortable" data-sort="cost">Cost</th>
          <th class="sortable" data-sort="tokens">Tokens</th>
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
      const cost = req.cost || 0;
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
    const maxCost = Math.max(...sorted.map(req => req.cost || 0));
    tbody.innerHTML = sorted.map(req => {
      const costPercentage = maxCost > 0 ? (req.cost / maxCost) * 100 : 0;
      const modelName = req.model || 'Unknown';
      const modelBadge = `<span class="model-badge ${getModelBadgeClass(modelName)}">${modelName}</span>`;
      return `
        <tr class="request-row" data-timestamp="${req.timestamp}">
          <td>${fmtDate(req.timestamp)}</td>
          <td class="cost-cell">
            <div class="cost-bar" style="width: ${costPercentage}%"></div>
            <span class="cost-value">${fmt$(req.cost)}</span>
          </td>
          <td>${fmtTokens(req.tokens)}</td>
          <td>${modelBadge}</td>
        </tr>
        <tr class="request-detail" style="display: none;">
          <td colspan="4">
            <div class="detail-panel">
              <div>URL: ${escapeHtml(req.url)}</div>
              <div>Status: ${escapeHtml(String(req.status))}</div>
              <div>Duration: ${fmtDurationMs(req.durationMs)}</div>
              ${req.error ? `<div class="error">Error: ${escapeHtml(req.error)}</div>` : ''}
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
 * Render the Agents sub-tab with a table of agents and expandable detail rows
 * @param {HTMLElement} el - Container to render into
 * @param {Object} subagentCosts - Object with agent names as keys and cost data as values
 */
export async function renderAgentsTab(el, subagentCosts) {
  const agentsArray = Object.entries(subagentCosts);
  const maxCost = Math.max(...agentsArray.map(([, agent]) => agent.totalCost || 0));

  const html = `
    <table class="agents-table">
      <thead>
        <tr>
          <th>Agent</th>
          <th>Cost</th>
          <th>Tokens</th>
          <th>Calls</th>
        </tr>
      </thead>
      <tbody>
        ${agentsArray.map(([key, agent]) => {
          const costPercentage = maxCost > 0 ? ((agent.totalCost || 0) / maxCost) * 100 : 0;
          const modelBadges = agent.models?.map(m => `<span class="model-badge ${getModelBadgeClass(m)}">${m}</span>`).join(' ') || 'N/A';
          return `
          <tr class="agent-row" data-agent="${agent.name || key}">
            <td>${agent.name || key}</td>
            <td class="cost-cell">
              <div class="cost-bar" style="width: ${costPercentage}%"></div>
              <span class="cost-value">${fmt$(agent.totalCost)}</span>
            </td>
            <td>${fmtTokens(agent.totalTokens)}</td>
            <td>${agent.callCount}</td>
          </tr>
          <tr class="agent-detail" style="display: none;">
            <td colspan="4">
              <div class="detail-panel">
                <div>Time Window: ${escapeHtml(agent.timeWindow || 'N/A')}</div>
                <div>Context Tokens: ${fmtTokens(agent.contextTokens || 0)}</div>
                <div>Models: ${modelBadges}</div>
                <div>Cost: ${fmt$(agent.detailCost || agent.totalCost)}</div>
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
  el.querySelectorAll('.agent-row').forEach(row => {
    row.addEventListener('click', () => {
      const detailRow = row.nextElementSibling;
      if (detailRow && detailRow.classList.contains('agent-detail')) {
        detailRow.style.display = detailRow.style.display === 'none' ? '' : 'none';
      }
    });
  });
}

/**
 * Render six summary cards with cost attribution totals
 * @param {HTMLElement} el - Container to render into
 * @param {Array} skillCosts - Array of skill cost objects
 * @param {Object} subagentCosts - Object of subagent cost data
 * @param {Array} apiRequests - Array of API request objects
 */
export async function renderSummaryCards(el, skillCosts, subagentCosts, apiRequests) {
  // Calculate totals
  const totalCost = skillCosts.reduce((sum, s) => sum + (s.totalCost || 0), 0) +
                    Object.values(subagentCosts).reduce((sum, a) => sum + (a.totalCost || 0), 0);

  const totalTokens = skillCosts.reduce((sum, s) => sum + (s.totalTokens || 0), 0) +
                      Object.values(subagentCosts).reduce((sum, a) => sum + (a.totalTokens || 0), 0);

  const contextTokens = skillCosts.reduce((sum, s) => sum + (s.contextTokens || 0), 0);
  const contextOverheadPct = totalTokens > 0 ?
    ((contextTokens / totalTokens) * 100).toFixed(1) :
    0;

  const skillCallCount = skillCosts.reduce((sum, s) => sum + (s.callCount || 0), 0);
  const agentCallCount = Object.values(subagentCosts).reduce((sum, a) => sum + (a.callCount || 0), 0);
  const apiRequestCount = apiRequests.length;

  // Render cards with context overhead card highlighted
  const cardsHtml = `
    <div class="summary-card">
      <div class="card-label">Total Cost</div>
      <div class="card-value">${fmt$(totalCost)}</div>
      <div class="card-subtext">Total spend this session</div>
    </div>
    <div class="summary-card">
      <div class="card-label">Tokens</div>
      <div class="card-value">${fmtTokens(totalTokens)}</div>
      <div class="card-subtext">Input + output tokens</div>
    </div>
    <div class="summary-card context-overhead">
      <div class="card-label">Context Overhead</div>
      <div class="card-value">${contextOverheadPct}%</div>
      <div class="card-subtext">Tokens spent on context</div>
    </div>
    <div class="summary-card">
      <div class="card-label">Skill Calls</div>
      <div class="card-value">${skillCallCount}</div>
      <div class="card-subtext">Total skill invocations</div>
    </div>
    <div class="summary-card">
      <div class="card-label">Agent Calls</div>
      <div class="card-value">${agentCallCount}</div>
      <div class="card-subtext">Total agent invocations</div>
    </div>
    <div class="summary-card">
      <div class="card-label">API Requests</div>
      <div class="card-value">${apiRequestCount}</div>
      <div class="card-subtext">Claude API calls made</div>
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
