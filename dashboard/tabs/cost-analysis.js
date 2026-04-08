import { get, fmt$ } from '/utils.js';

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

      <!-- Tab content will be populated in future tasks (Task 3+) -->
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

  // Attach event listeners for session change and tab switching
  document.getElementById('session-select')?.addEventListener('change', (e) => {
    const newSessionId = e.target.value;
    renderCostAnalysis(el, newSessionId, allSessions);
  });

  document.querySelectorAll('.section-tab').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const tabName = e.target.dataset.tab;
      if (tabName) {
        // Tab switching logic will be implemented in future tasks
        console.log('Tab:', tabName);
      }
    });
  });
}
