import { get, fmt$, fmtTokens, fmtDate, fmtDuration } from '../utils.js';

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
          <label>Session</label>
          <select id="session-select">
            ${allSessions.map(s => `<option value="${s.id}" ${s.id === sessionId ? 'selected' : ''}>${s.name || s.id.slice(0, 8)}</option>`).join('')}
          </select>
        </div>
        <div class="control-group">
          <label>Skill</label>
          <select id="skill-filter">
            <option value="">All skills</option>
          </select>
        </div>
        <div class="control-group">
          <label>Model</label>
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

  // Store session data for future tab switching and filtering
  // This will be refactored into a closure in later tasks
  window.costAnalysisData = { skillCosts, subagentCosts, apiRequests, sessionId };

  // Render summary cards
  const summaryCardsEl = document.getElementById('summary-cards');
  if (summaryCardsEl) {
    await renderSummaryCards(summaryCardsEl, skillCosts, subagentCosts, apiRequests);
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
      const tabName = e.target.dataset.tab;
      if (tabName) {
        // Hide all panels and deactivate all tabs
        document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.remove('active'));
        document.querySelectorAll('.section-tab').forEach(tab => tab.classList.remove('active'));

        // Show selected panel and activate tab
        const panelId = `${tabName}-panel`;
        const panel = document.getElementById(panelId);
        if (panel) {
          panel.classList.add('active');
          e.target.classList.add('active');

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
        ${skillCosts.map(skill => `
          <tr class="skill-row" data-skill="${skill.skillName}">
            <td>${skill.skillName}</td>
            <td>${fmt$(skill.totalCost)}</td>
            <td>${fmtTokens(skill.totalTokens)}</td>
            <td>${skill.callCount}</td>
          </tr>
          <tr class="skill-detail" style="display: none;">
            <td colspan="4">
              <div class="detail-panel">
                <div><strong>Time Window:</strong> ${skill.timeWindow || 'N/A'}</div>
                <div><strong>Context Tokens:</strong> ${fmtTokens(skill.contextTokens || 0)}</div>
                <div><strong>Models:</strong> ${skill.models?.join(', ') || 'N/A'}</div>
                <div><strong>Cost:</strong> ${fmt$(skill.detailCost || skill.totalCost)}</div>
              </div>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  el.innerHTML = html;

  // Add click handlers for expand/collapse
  el.querySelectorAll('.skill-row').forEach(row => {
    row.addEventListener('click', (e) => {
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
 * @param {HTMLElement} el - Container to render into
 * @param {Array} apiRequests - Array of API request objects
 */
export async function renderAPIRequestsTab(el, apiRequests) {
  let currentSort = { column: 'timestamp', ascending: false };

  function renderTable(data) {
    const html = `
      <table class="requests-table">
        <thead>
          <tr>
            <th class="sortable" data-sort="timestamp">Timestamp</th>
            <th class="sortable" data-sort="cost">Cost</th>
            <th class="sortable" data-sort="tokens">Tokens</th>
            <th class="sortable" data-sort="model">Model</th>
          </tr>
        </thead>
        <tbody>
          ${data.map(req => `
            <tr class="request-row" data-timestamp="${req.timestamp}">
              <td>${fmtDate(req.timestamp)}</td>
              <td>${fmt$(req.cost)}</td>
              <td>${fmtTokens(req.tokens)}</td>
              <td>${req.model}</td>
            </tr>
            <tr class="request-detail" style="display: none;">
              <td colspan="4">
                <div class="detail-panel">
                  <div><strong>URL:</strong> ${req.url}</div>
                  <div><strong>Status:</strong> ${req.status}</div>
                  <div><strong>Duration:</strong> ${fmtDurationMs(req.durationMs)}</div>
                  ${req.error ? `<div class="error"><strong>Error:</strong> ${req.error}</div>` : ''}
                </div>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

    el.innerHTML = html;

    // Expandable rows
    el.querySelectorAll('.request-row').forEach(row => {
      row.addEventListener('click', () => {
        const detail = row.nextElementSibling;
        if (detail && detail.classList.contains('request-detail')) {
          detail.style.display = detail.style.display === 'none' ? '' : 'none';
        }
      });
    });

    // Sorting
    el.querySelectorAll('th.sortable').forEach(header => {
      header.addEventListener('click', () => {
        const column = header.dataset.sort;
        if (currentSort.column === column) {
          currentSort.ascending = !currentSort.ascending;
        } else {
          currentSort.column = column;
          currentSort.ascending = true;
        }

        const sorted = [...data].sort((a, b) => {
          const aVal = a[column];
          const bVal = b[column];
          const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
          return currentSort.ascending ? cmp : -cmp;
        });

        renderTable(sorted);
      });
    });
  }

  renderTable(apiRequests);
}

/**
 * Render the Agents sub-tab with a table of agents and expandable detail rows
 * @param {HTMLElement} el - Container to render into
 * @param {Object} subagentCosts - Object with agent names as keys and cost data as values
 */
export async function renderAgentsTab(el, subagentCosts) {
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
        ${Object.entries(subagentCosts).map(([key, agent]) => `
          <tr class="agent-row" data-agent="${agent.name || key}">
            <td>${agent.name || key}</td>
            <td>${fmt$(agent.totalCost)}</td>
            <td>${fmtTokens(agent.totalTokens)}</td>
            <td>${agent.callCount}</td>
          </tr>
          <tr class="agent-detail" style="display: none;">
            <td colspan="4">
              <div class="detail-panel">
                <div><strong>Time Window:</strong> ${agent.timeWindow || 'N/A'}</div>
                <div><strong>Context Tokens:</strong> ${fmtTokens(agent.contextTokens || 0)}</div>
                <div><strong>Models:</strong> ${agent.models?.join(', ') || 'N/A'}</div>
                <div><strong>Cost:</strong> ${fmt$(agent.detailCost || agent.totalCost)}</div>
              </div>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  el.innerHTML = html;

  // Add click handlers for expand/collapse
  el.querySelectorAll('.agent-row').forEach(row => {
    row.addEventListener('click', (e) => {
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

  const skillCallCount = skillCosts.length;
  const agentCallCount = Object.keys(subagentCosts).length;
  const apiRequestCount = apiRequests.length;

  // Render cards
  const cardsHtml = `
    <div class="summary-card">
      <div class="card-label">Total Cost</div>
      <div class="card-value">${fmt$(totalCost)}</div>
    </div>
    <div class="summary-card">
      <div class="card-label">Tokens</div>
      <div class="card-value">${fmtTokens(totalTokens)}</div>
    </div>
    <div class="summary-card">
      <div class="card-label">Context Overhead</div>
      <div class="card-value">${contextOverheadPct}%</div>
    </div>
    <div class="summary-card">
      <div class="card-label">Skill Calls</div>
      <div class="card-value">${skillCallCount}</div>
    </div>
    <div class="summary-card">
      <div class="card-label">Agent Calls</div>
      <div class="card-value">${agentCallCount}</div>
    </div>
    <div class="summary-card">
      <div class="card-label">API Requests</div>
      <div class="card-value">${apiRequestCount}</div>
    </div>
  `;

  el.innerHTML = cardsHtml;
}
