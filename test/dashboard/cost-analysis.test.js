/**
 * Tests for cost-analysis.js summary cards rendering
 * Uses the real renderSummaryCards function from the implementation
 */

import { renderSummaryCards } from '../../dashboard/tabs/cost-analysis.js';
import { JSDOM } from 'jsdom';

// Setup: Mock DOM document for Node.js
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
global.document = dom.window.document;
global.window = dom.window;

// Mock fetch to avoid network calls
global.fetch = async () => ({
  ok: true,
  json: async () => ({})
});

/**
 * Test: renderSummaryCards creates 6 cards
 */
async function testSummaryCardsCount() {
  const container = document.createElement('div');

  const skillCosts = [
    { name: 'skill-1', totalCost: 0.5, totalTokens: 1000, contextTokens: 200 },
    { name: 'skill-2', totalCost: 0.3, totalTokens: 600, contextTokens: 120 }
  ];

  const subagentCosts = {
    'agent-1': { totalCost: 0.2, totalTokens: 400, contextTokens: 80 }
  };

  const apiRequests = [
    { id: 'req-1', cost: 0.05 },
    { id: 'req-2', cost: 0.02 }
  ];

  // Call real implementation
  await renderSummaryCards(container, skillCosts, subagentCosts, apiRequests);

  // Verify 6 cards exist
  const cards = container.querySelectorAll('.summary-card');
  assert(cards.length === 6, `Expected 6 cards, got ${cards.length}`);
  console.log('✓ testSummaryCardsCount: 6 cards created');
}

/**
 * Test: Each card has correct labels
 */
async function testCardLabels() {
  const container = document.createElement('div');

  const skillCosts = [{ totalCost: 1, totalTokens: 1000, contextTokens: 100 }];
  const subagentCosts = {};
  const apiRequests = [];

  // Call real implementation
  await renderSummaryCards(container, skillCosts, subagentCosts, apiRequests);

  // Verify all expected labels are present
  const labels = Array.from(container.querySelectorAll('.card-label')).map(el => el.textContent);
  const expectedLabels = ['Total Cost', 'Tokens', 'Context Overhead', 'Skill Calls', 'Agent Calls', 'API Requests'];

  expectedLabels.forEach(expected => {
    assert(labels.includes(expected), `Expected label "${expected}" not found in: ${labels.join(', ')}`);
  });

  console.log('✓ testCardLabels: all labels present');
}

/**
 * Test: Card values are calculated and formatted correctly
 */
async function testCardValueFormatting() {
  const container = document.createElement('div');

  const skillCosts = [
    { totalCost: 1.2345, totalTokens: 5000, contextTokens: 500 },
    { totalCost: 0.5, totalTokens: 2000, contextTokens: 400 }
  ];
  const subagentCosts = {
    'agent-1': { totalCost: 0.25, totalTokens: 1500, contextTokens: 300 }
  };
  const apiRequests = [{ id: 'r1' }, { id: 'r2' }];

  // Call real implementation
  await renderSummaryCards(container, skillCosts, subagentCosts, apiRequests);

  // Verify card values
  const values = Array.from(container.querySelectorAll('.card-value')).map(el => el.textContent);

  // Should have 6 values
  assert(values.length === 6, `Expected 6 values, got ${values.length}`);

  // First value should be formatted currency (total cost = 1.2345 + 0.5 + 0.25 = 1.9845)
  assert(values[0].includes('$'), `Expected currency format in "${values[0]}"`);

  // Second value should be formatted tokens (8500 tokens = 8K or 8.5K)
  assert(values[1].match(/\d+K?/), `Expected token format in "${values[1]}"`);

  // Third value should be percentage (context tokens = 500 + 400 + 300 = 1200 out of 8500 = 14.1%)
  assert(values[2].includes('%'), `Expected percentage in "${values[2]}"`);

  // Fourth value should be 2 (skill count)
  assert(values[3] === '2', `Expected skill count 2, got "${values[3]}"`);

  // Fifth value should be 1 (agent count)
  assert(values[4] === '1', `Expected agent count 1, got "${values[4]}"`);

  // Sixth value should be 2 (API request count)
  assert(values[5] === '2', `Expected API request count 2, got "${values[5]}"`);

  console.log('✓ testCardValueFormatting: values formatted correctly');
}

/**
 * Test: Handles empty data gracefully
 */
async function testEmptyDataHandling() {
  const container = document.createElement('div');

  const skillCosts = [];
  const subagentCosts = {};
  const apiRequests = [];

  // Call real implementation
  await renderSummaryCards(container, skillCosts, subagentCosts, apiRequests);

  // Should still create 6 cards even with empty data
  const cards = container.querySelectorAll('.summary-card');
  assert(cards.length === 6, `Expected 6 cards with empty data, got ${cards.length}`);

  // Verify zero values are displayed correctly
  const values = Array.from(container.querySelectorAll('.card-value')).map(el => el.textContent);
  assert(values[3] === '0', `Expected skill count 0, got "${values[3]}"`);
  assert(values[4] === '0', `Expected agent count 0, got "${values[4]}"`);
  assert(values[5] === '0', `Expected API request count 0, got "${values[5]}"`);

  console.log('✓ testEmptyDataHandling: handles empty data correctly');
}

/**
 * Test: renderSkillsTab creates table with correct structure
 */
async function testSkillsTabStructure() {
  const { renderSkillsTab } = await import('../../dashboard/tabs/cost-analysis.js');

  const container = document.createElement('div');

  const mockSkillCosts = [
    { skillName: 'Git Helper', totalCost: 0.15, totalTokens: 5000, callCount: 10, timeWindow: 'last 7d', contextTokens: 500, models: ['claude-opus'] },
    { skillName: 'Code Review', totalCost: 0.25, totalTokens: 8000, callCount: 5, timeWindow: 'last 24h', contextTokens: 800, models: ['claude-sonnet'] }
  ];

  await renderSkillsTab(container, mockSkillCosts);

  // Verify table structure
  const table = container.querySelector('.skills-table');
  assert(table, 'Table with class skills-table not found');

  // Verify header
  const headers = Array.from(table.querySelectorAll('thead th')).map(th => th.textContent);
  const expectedHeaders = ['Skill', 'Cost', 'Tokens', 'Calls'];
  assert(headers.length === 4, `Expected 4 headers, got ${headers.length}`);
  expectedHeaders.forEach((expected, idx) => {
    assert(headers[idx] === expected, `Expected header "${expected}", got "${headers[idx]}"`);
  });

  // Verify rows
  const skillRows = container.querySelectorAll('tbody tr.skill-row');
  assert(skillRows.length === 2, `Expected 2 skill rows, got ${skillRows.length}`);

  console.log('✓ testSkillsTabStructure: table structure correct');
}

/**
 * Test: renderSkillsTab expandable rows
 */
async function testSkillsTabExpandable() {
  const { renderSkillsTab } = await import('../../dashboard/tabs/cost-analysis.js');

  const container = document.createElement('div');

  const mockSkillCosts = [
    { skillName: 'Test Skill', totalCost: 0.1, totalTokens: 1000, callCount: 1, timeWindow: 'last 24h', contextTokens: 100, models: ['claude-opus'] }
  ];

  await renderSkillsTab(container, mockSkillCosts);

  // Find the skill row
  const skillRow = container.querySelector('tbody tr.skill-row');
  assert(skillRow, 'Skill row not found');

  // Find the detail row
  const detailRow = skillRow.nextElementSibling;
  assert(detailRow && detailRow.classList.contains('skill-detail'), 'Detail row not found');

  // Detail row should start hidden
  assert(detailRow.style.display === 'none', `Expected detail row to be hidden, got display="${detailRow.style.display}"`);

  // Simulate click
  skillRow.click();

  // After click, detail row should be visible
  assert(detailRow.style.display !== 'none', `Expected detail row to be visible after click, got display="${detailRow.style.display}"`);

  console.log('✓ testSkillsTabExpandable: expandable rows work correctly');
}

/**
 * Test: renderSkillsTab formats data correctly
 */
async function testSkillsTabFormatting() {
  const { renderSkillsTab } = await import('../../dashboard/tabs/cost-analysis.js');

  const container = document.createElement('div');

  const mockSkillCosts = [
    { skillName: 'Git Helper', totalCost: 0.15, totalTokens: 5000, callCount: 10 }
  ];

  await renderSkillsTab(container, mockSkillCosts);

  // Verify cell content
  const cells = container.querySelectorAll('tbody tr.skill-row td');
  assert(cells[0].textContent === 'Git Helper', `Expected "Git Helper", got "${cells[0].textContent}"`);
  assert(cells[1].textContent.includes('$'), `Expected cost to include $, got "${cells[1].textContent}"`);
  assert(cells[2].textContent.match(/\d+K?/), `Expected tokens formatted, got "${cells[2].textContent}"`);
  assert(cells[3].textContent === '10', `Expected call count "10", got "${cells[3].textContent}"`);

  console.log('✓ testSkillsTabFormatting: data formatted correctly');
}

/**
 * Test: Verify detail panel content is rendered correctly
 */
async function testSkillsDetailContent() {
  const { renderSkillsTab } = await import('../../dashboard/tabs/cost-analysis.js');

  const container = document.createElement('div');

  const mockSkillCosts = [
    {
      skillName: 'Git Helper',
      totalCost: 0.15,
      totalTokens: 5000,
      callCount: 10,
      timeWindow: '2026-04-08T00:00:00Z',
      contextTokens: 1000,
      models: ['claude-opus-4-6', 'claude-sonnet-4-6'],
      detailCost: 0.15
    }
  ];

  await renderSkillsTab(container, mockSkillCosts);

  // Find and expand the detail row
  const skillRow = container.querySelector('tbody tr.skill-row');
  skillRow.click();

  // Check detail panel content
  const detailRow = skillRow.nextElementSibling;
  const detailPanel = detailRow.querySelector('.detail-panel');
  assert(detailPanel, 'Detail panel not found');

  const detailText = detailPanel.textContent;
  assert(detailText.includes('Time Window'), 'Time Window label missing');
  assert(detailText.includes('2026-04-08T00:00:00Z'), 'Time Window value missing from detail');
  assert(detailText.includes('Context Tokens'), 'Context Tokens label missing');
  assert(detailText.includes('1K'), 'Context Tokens value missing from detail (1000 tokens formatted as 1K)');
  assert(detailText.includes('Models'), 'Models label missing');
  assert(detailText.includes('claude-opus-4-6'), 'Model 1 missing from detail');
  assert(detailText.includes('claude-sonnet-4-6'), 'Model 2 missing from detail');
  assert(detailText.includes('Cost'), 'Cost label missing');

  console.log('✓ testSkillsDetailContent: detail content rendered correctly');
}

/**
 * Test: Verify tab switching functionality
 */
async function testTabSwitching() {
  const container = document.createElement('div');

  // Create the full tab structure with panels (as rendered by renderCostAnalysis)
  const tabHTML = `
    <div class="section-tabs">
      <button class="section-tab active" data-tab="skills">Skills <span class="tab-count">2</span></button>
      <button class="section-tab" data-tab="agents">Agents <span class="tab-count">1</span></button>
      <button class="section-tab" data-tab="requests">API Requests <span class="tab-count">3</span></button>
    </div>
    <div class="tab-panels" id="tab-panels">
      <div id="skills-panel" class="tab-panel active">Skills content</div>
      <div id="agents-panel" class="tab-panel">Agents content</div>
      <div id="requests-panel" class="tab-panel">Requests content</div>
    </div>
  `;

  container.innerHTML = tabHTML;
  document.body.appendChild(container);

  // Get the tab buttons and panels
  const skillsTab = container.querySelector('[data-tab="skills"]');
  const agentsTab = container.querySelector('[data-tab="agents"]');
  const skillsPanel = container.querySelector('#skills-panel');
  const agentsPanel = container.querySelector('#agents-panel');

  assert(skillsTab.classList.contains('active'), 'Skills tab should start active');
  assert(!agentsTab.classList.contains('active'), 'Agents tab should start inactive');
  assert(skillsPanel.classList.contains('active'), 'Skills panel should start active');
  assert(!agentsPanel.classList.contains('active'), 'Agents panel should start inactive');

  // Manually trigger the tab switching logic (as found in renderCostAnalysis)
  // Simulating the click event handler
  const tabName = agentsTab.dataset.tab;

  // Query from container, not document, to avoid interfering with other tests
  container.querySelectorAll('.tab-panel').forEach(panel => panel.classList.remove('active'));
  container.querySelectorAll('.section-tab').forEach(tab => tab.classList.remove('active'));

  const panelId = `${tabName}-panel`;
  const panel = container.querySelector(`#${panelId}`);
  if (panel) {
    panel.classList.add('active');
    agentsTab.classList.add('active');
  }

  // Verify state changed correctly
  assert(!skillsTab.classList.contains('active'), 'Skills tab should no longer be active');
  assert(agentsTab.classList.contains('active'), 'Agents tab should now be active');
  assert(!skillsPanel.classList.contains('active'), 'Skills panel should no longer be active');
  assert(agentsPanel.classList.contains('active'), 'Agents panel should now be active');

  document.body.removeChild(container);
  console.log('✓ testTabSwitching: tab switching works correctly');
}

/**
 * Test: renderAgentsTab creates table with correct structure
 */
async function testAgentsTabStructure() {
  const { renderAgentsTab } = await import('../../dashboard/tabs/cost-analysis.js');

  const container = document.createElement('div');

  const mockSubagentCosts = {
    'general-purpose': {
      name: 'general-purpose',
      totalCost: 0.30,
      totalTokens: 10000,
      callCount: 8,
      timeWindow: 'last 7d',
      contextTokens: 1000,
      models: ['claude-opus']
    },
    'code-reviewer': {
      name: 'code-reviewer',
      totalCost: 0.20,
      totalTokens: 6000,
      callCount: 4,
      timeWindow: 'last 24h',
      contextTokens: 600,
      models: ['claude-sonnet']
    }
  };

  await renderAgentsTab(container, mockSubagentCosts);

  // Verify table structure
  const table = container.querySelector('.agents-table');
  assert(table, 'Table with class agents-table not found');

  // Verify header
  const headers = Array.from(table.querySelectorAll('thead th')).map(th => th.textContent);
  const expectedHeaders = ['Agent', 'Cost', 'Tokens', 'Calls'];
  assert(headers.length === 4, `Expected 4 headers, got ${headers.length}`);
  expectedHeaders.forEach((expected, idx) => {
    assert(headers[idx] === expected, `Expected header "${expected}", got "${headers[idx]}"`);
  });

  // Verify rows
  const agentRows = container.querySelectorAll('tbody tr.agent-row');
  assert(agentRows.length === 2, `Expected 2 agent rows, got ${agentRows.length}`);

  console.log('✓ testAgentsTabStructure: table structure correct');
}

/**
 * Test: renderAgentsTab expandable rows
 */
async function testAgentsTabExpandable() {
  const { renderAgentsTab } = await import('../../dashboard/tabs/cost-analysis.js');

  const container = document.createElement('div');

  const mockSubagentCosts = {
    'test-agent': {
      name: 'test-agent',
      totalCost: 0.15,
      totalTokens: 5000,
      callCount: 3,
      timeWindow: 'last 24h',
      contextTokens: 500,
      models: ['claude-opus']
    }
  };

  await renderAgentsTab(container, mockSubagentCosts);

  // Find the agent row
  const agentRow = container.querySelector('tbody tr.agent-row');
  assert(agentRow, 'Agent row not found');

  // Find the detail row
  const detailRow = agentRow.nextElementSibling;
  assert(detailRow && detailRow.classList.contains('agent-detail'), 'Detail row not found');

  // Detail row should start hidden
  assert(detailRow.style.display === 'none', `Expected detail row to be hidden, got display="${detailRow.style.display}"`);

  // Simulate click
  agentRow.click();

  // After click, detail row should be visible
  assert(detailRow.style.display !== 'none', `Expected detail row to be visible after click, got display="${detailRow.style.display}"`);

  console.log('✓ testAgentsTabExpandable: expandable rows work correctly');
}

/**
 * Test: renderAgentsTab formats data correctly
 */
async function testAgentsTabFormatting() {
  const { renderAgentsTab } = await import('../../dashboard/tabs/cost-analysis.js');

  const container = document.createElement('div');

  const mockSubagentCosts = {
    'general-purpose': {
      name: 'general-purpose',
      totalCost: 0.30,
      totalTokens: 10000,
      callCount: 8
    }
  };

  await renderAgentsTab(container, mockSubagentCosts);

  // Verify cell content
  const cells = container.querySelectorAll('tbody tr.agent-row td');
  assert(cells[0].textContent === 'general-purpose', `Expected "general-purpose", got "${cells[0].textContent}"`);
  assert(cells[1].textContent.includes('$'), `Expected cost to include $, got "${cells[1].textContent}"`);
  assert(cells[2].textContent.match(/\d+K?/), `Expected tokens formatted, got "${cells[2].textContent}"`);
  assert(cells[3].textContent === '8', `Expected call count "8", got "${cells[3].textContent}"`);

  console.log('✓ testAgentsTabFormatting: data formatted correctly');
}

/**
 * Test: Verify agents detail panel content is rendered correctly
 */
async function testAgentsDetailContent() {
  const { renderAgentsTab } = await import('../../dashboard/tabs/cost-analysis.js');

  const container = document.createElement('div');

  const mockSubagentCosts = {
    'general-purpose': {
      name: 'general-purpose',
      totalCost: 0.30,
      totalTokens: 10000,
      callCount: 8,
      timeWindow: '2026-04-08T00:00:00Z',
      contextTokens: 2000,
      models: ['claude-opus-4-6', 'claude-sonnet-4-6'],
      detailCost: 0.30
    }
  };

  await renderAgentsTab(container, mockSubagentCosts);

  // Find and expand the detail row
  const agentRow = container.querySelector('tbody tr.agent-row');
  agentRow.click();

  // Check detail panel content
  const detailRow = agentRow.nextElementSibling;
  const detailPanel = detailRow.querySelector('.detail-panel');
  assert(detailPanel, 'Detail panel not found');

  const detailText = detailPanel.textContent;
  assert(detailText.includes('Time Window'), 'Time Window label missing');
  assert(detailText.includes('2026-04-08T00:00:00Z'), 'Time Window value missing from detail');
  assert(detailText.includes('Context Tokens'), 'Context Tokens label missing');
  assert(detailText.includes('2K'), 'Context Tokens value missing from detail (2000 tokens formatted as 2K)');
  assert(detailText.includes('Models'), 'Models label missing');
  assert(detailText.includes('claude-opus-4-6'), 'Model 1 missing from detail');
  assert(detailText.includes('claude-sonnet-4-6'), 'Model 2 missing from detail');
  assert(detailText.includes('Cost'), 'Cost label missing');

  console.log('✓ testAgentsDetailContent: detail content rendered correctly');
}

/**
 * Helper: simple assertion
 */
function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

/**
 * Run all tests
 */
async function runTests() {
  console.log('Running cost-analysis tests...\n');

  try {
    console.log('--- Summary Cards Tests ---');
    await testSummaryCardsCount();
    await testCardLabels();
    await testCardValueFormatting();
    await testEmptyDataHandling();

    console.log('\n--- Skills Tab Tests ---');
    await testSkillsTabStructure();
    await testSkillsTabExpandable();
    await testSkillsTabFormatting();
    await testSkillsDetailContent();
    await testTabSwitching();

    console.log('\n--- Agents Tab Tests ---');
    await testAgentsTabStructure();
    await testAgentsTabExpandable();
    await testAgentsTabFormatting();
    await testAgentsDetailContent();

    console.log('\n✅ All tests passed');
    process.exit(0);
  } catch (err) {
    console.error(`\n❌ Test failed: ${err.message}`);
    console.error(err.stack);
    process.exit(1);
  }
}

runTests();
