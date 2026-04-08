import { get, fmt$, fmtTokens } from '/utils.js';

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
          <select id="session-select" onchange="window.costAnalysisSessionChange(this.value)">
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
            <option>sonnet</option>
            <option>haiku</option>
            <option>opus</option>
          </select>
        </div>
      </div>

      <div class="summary-cards" id="summary-cards"></div>
      <div class="context-bar" id="context-bar"></div>

      <div class="section-tabs">
        <button class="section-tab active" onclick="window.costAnalysisShowTab('skills')">Skills <span class="tab-count">0</span></button>
        <button class="section-tab" onclick="window.costAnalysisShowTab('agents')">Agents <span class="tab-count">0</span></button>
        <button class="section-tab" onclick="window.costAnalysisShowTab('requests')">API Requests <span class="tab-count">0</span></button>
      </div>

      <div class="tab-panels" id="tab-panels"></div>
    </div>
  `;

  el.innerHTML = html;

  // Fetch data for selected session
  const skillCosts = await get('/skills/costs');
  const subagentCosts = await get('/subagents/costs');
  const apiRequests = await get('/requests');

  // Store data globally for tab switching (will be moved to closure in later tasks)
  window.costAnalysisData = { skillCosts, subagentCosts, apiRequests, sessionId };
}
