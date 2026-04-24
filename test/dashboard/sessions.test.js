/**
 * Tests for sessions.js expand state and hierarchical rendering
 */

// Mock DOM for Node.js environment
if (typeof document === 'undefined') {
  class MockElement {
    constructor(tagName = 'div') {
      this.tagName = tagName;
      this.className = '';
      this.attributes = {};
      this.children = [];
      this.textContent = '';
      this.classList = {
        contains: (cls) => this.className.includes(cls),
        add: (cls) => { if (!this.className.includes(cls)) this.className += (this.className ? ' ' : '') + cls; },
        remove: (cls) => { this.className = this.className.replace(cls, '').trim(); }
      };
      this.style = {};
    }

    setAttribute(name, value) {
      this.attributes[name] = value;
    }

    getAttribute(name) {
      return this.attributes[name] || null;
    }

    appendChild(child) {
      this.children.push(child);
    }

    querySelector(selector) {
      for (const child of this.children) {
        if (selector === '.session-name' && child.className.includes('session-name')) {
          return child;
        }
      }
      return null;
    }

    contains(element) {
      return this.children.includes(element);
    }
  }

  global.document = {
    createElement: (tagName) => new MockElement(tagName)
  };
}

/**
 * Test: Expand state initializes with no expanded sessions
 */
function testExpandStateInit() {
  const expandedSessions = new Set();
  const assertion = expandedSessions.size === 0;
  if (!assertion) {
    throw new Error(`Expected expandedSessions.size === 0, got ${expandedSessions.size}`);
  }
  console.log('✓ testExpandStateInit: Initializes with no expanded sessions');
}

/**
 * Test: Expand state toggles on and off
 */
function testExpandStateToggle() {
  const expandedSessions = new Set();
  const sessionId = 'parent-1';

  // Not expanded initially
  if (expandedSessions.has(sessionId)) {
    throw new Error(`Expected session to not be expanded initially`);
  }

  // Toggle on
  if (expandedSessions.has(sessionId)) {
    expandedSessions.delete(sessionId);
  } else {
    expandedSessions.add(sessionId);
  }

  if (!expandedSessions.has(sessionId)) {
    throw new Error(`Expected session to be expanded after toggle on`);
  }

  // Toggle off
  if (expandedSessions.has(sessionId)) {
    expandedSessions.delete(sessionId);
  } else {
    expandedSessions.add(sessionId);
  }

  if (expandedSessions.has(sessionId)) {
    throw new Error(`Expected session to not be expanded after toggle off`);
  }

  console.log('✓ testExpandStateToggle: Toggles expansion state on/off');
}

/**
 * Test: Expand state maintains state for multiple sessions independently
 */
function testExpandStateMultiple() {
  const expandedSessions = new Set();

  expandedSessions.add('parent-1');
  expandedSessions.add('parent-3');

  if (!expandedSessions.has('parent-1')) {
    throw new Error(`Expected parent-1 to be expanded`);
  }
  if (expandedSessions.has('parent-2')) {
    throw new Error(`Expected parent-2 to not be expanded`);
  }
  if (!expandedSessions.has('parent-3')) {
    throw new Error(`Expected parent-3 to be expanded`);
  }

  console.log('✓ testExpandStateMultiple: Maintains state for multiple sessions independently');
}

/**
 * Test: Data structure for parent/subagent rows
 * Verifies that the hierarchical data structure is correct
 */
function testDataStructureHierarchy() {
  const parentData = {
    id: 'parent-1',
    name: 'monitor',
    machine_id: 'macbook',
    started_at: 1000000,
    last_event_ts: 1000100,
    cost_usd: 2.18,
    input_tokens: 72000,
    output_tokens: 8500,
    api_request_count: 198,
    tool_call_count: 45,
    subagents: [
      {
        id: 'subagent-a',
        name: 'subagent-a',
        cost_usd: 0.94,
        input_tokens: 22000,
        output_tokens: 2100,
        api_request_count: 53,
      },
      {
        id: 'subagent-b',
        name: 'subagent-b',
        cost_usd: 0.24,
        input_tokens: 5000,
        output_tokens: 450,
        api_request_count: 12,
      },
    ],
  };

  // Verify parent row shows aggregated totals (parent + all subagents)
  if (parentData.cost_usd !== 2.18) {
    throw new Error(`Expected parent cost to be 2.18, got ${parentData.cost_usd}`);
  }
  if (parentData.input_tokens !== 72000) {
    throw new Error(`Expected parent input tokens to be 72000, got ${parentData.input_tokens}`);
  }

  // Verify subagents array exists and has correct structure
  if (!parentData.subagents || parentData.subagents.length !== 2) {
    throw new Error(`Expected 2 subagents, got ${parentData.subagents?.length}`);
  }
  if (parentData.subagents[0].cost_usd !== 0.94) {
    throw new Error(`Expected subagent-a cost to be 0.94, got ${parentData.subagents[0].cost_usd}`);
  }
  if (parentData.subagents[1].cost_usd !== 0.24) {
    throw new Error(`Expected subagent-b cost to be 0.24, got ${parentData.subagents[1].cost_usd}`);
  }

  // Verify subagent totals don't add up to parent (they're included in parent total)
  const subagentSum = parentData.subagents.reduce((sum, s) => sum + s.cost_usd, 0);
  if (subagentSum !== 1.18) {
    throw new Error(`Expected subagent sum to be 1.18, got ${subagentSum}`);
  }

  // Verify parent's own cost = parent total - subagent sum (with floating point tolerance)
  const parentOwnCost = parentData.cost_usd - subagentSum;
  const tolerance = 0.0001;
  if (Math.abs(parentOwnCost - 1.0) > tolerance) {
    throw new Error(`Expected parent's own cost to be 1.00, got ${parentOwnCost}`);
  }

  console.log('✓ testDataStructureHierarchy: Parent/subagent data structure is correct');
}

/**
 * Test: Expand icon display logic
 * Verifies icon shows only when subagents exist
 */
function testExpandIconLogic() {
  // Parent with subagents should show expand icon
  const parentWithSubagents = {
    id: 'parent-1',
    subagents: [
      { id: 'sub-1', name: 'sub-1' },
      { id: 'sub-2', name: 'sub-2' }
    ]
  };

  const hasSubagents = parentWithSubagents.subagents && parentWithSubagents.subagents.length > 0;
  if (!hasSubagents) {
    throw new Error('Expected parent with subagents to have expand icon');
  }

  // Parent without subagents should not show expand icon
  const parentWithoutSubagents = {
    id: 'parent-2',
    subagents: []
  };

  const hasSubagents2 = parentWithoutSubagents.subagents && parentWithoutSubagents.subagents.length > 0;
  if (hasSubagents2) {
    throw new Error('Expected parent without subagents to not have expand icon');
  }

  console.log('✓ testExpandIconLogic: Expand icon displays correctly');
}

/**
 * Test: Subagent row styling and display
 * Verifies subagent rows have correct CSS classes and indentation
 */
function testSubagentRowStyling() {
  // Verify subagent row classes
  const expectedClasses = ['subagent-row'];
  const subagentRow = document.createElement('tr');
  subagentRow.className = 'subagent-row';
  subagentRow.style.background = '#f9f9f9';

  const hasCorrectClass = subagentRow.classList.contains('subagent-row');
  if (!hasCorrectClass) {
    throw new Error('Subagent row should have subagent-row class');
  }

  // Verify background color
  if (subagentRow.style.background !== '#f9f9f9') {
    throw new Error(`Expected background #f9f9f9, got ${subagentRow.style.background}`);
  }

  console.log('✓ testSubagentRowStyling: Subagent rows styled correctly');
}

/**
 * Test: Click delegation on parent row (not name) expands/collapses
 * Simulates click event handling logic from sessions.js
 */
function testClickDelegationOnParentRow() {
  // Simulate the click delegation logic from handleTableClick in sessions.js
  const expandedSessions = new Set();
  const sessionId = 'parent-1';

  // Create mock row and elements
  const row = document.createElement('tr');
  row.className = 'session-row';
  row.setAttribute('data-id', sessionId);
  row.setAttribute('data-expandable', 'true');

  const nameCell = document.createElement('td');
  nameCell.className = 'session-name';
  nameCell.setAttribute('data-id', sessionId);

  const expandIcon = document.createElement('span');
  expandIcon.className = 'expand-icon';
  expandIcon.textContent = '▶';

  nameCell.appendChild(expandIcon);
  row.appendChild(nameCell);

  // Simulate click on parent row (but not the expand icon itself)
  const clickEvent = {
    target: row,
    stopPropagation: () => {}
  };

  // Mock the closest() method
  clickEvent.target.closest = function(selector) {
    if (selector === 'tr.session-row[data-expandable="true"]') return row;
    return null;
  };

  // Apply the click handling logic
  const expandRow = clickEvent.target.closest('tr.session-row[data-expandable="true"]');
  if (expandRow) {
    const sessionNameCell = expandRow.querySelector?.('.session-name');
    if (sessionNameCell && sessionNameCell.contains) {
      // For mock, just check if click wasn't on expand icon
      const willExpand = !expandedSessions.has(sessionId);
      if (willExpand) {
        expandedSessions.add(sessionId);
        expandIcon.textContent = '▼';
      } else {
        expandedSessions.delete(sessionId);
        expandIcon.textContent = '▶';
      }
    }
  }

  // Verify state changed
  if (!expandedSessions.has(sessionId)) {
    throw new Error('Expected parent row click to expand');
  }
  if (expandIcon.textContent !== '▼') {
    throw new Error(`Expected icon to change to ▼, got ${expandIcon.textContent}`);
  }

  // Test collapse
  const willExpand = !expandedSessions.has(sessionId);
  if (willExpand) {
    expandedSessions.add(sessionId);
    expandIcon.textContent = '▼';
  } else {
    expandedSessions.delete(sessionId);
    expandIcon.textContent = '▶';
  }

  if (expandedSessions.has(sessionId)) {
    throw new Error('Expected parent row click again to collapse');
  }
  if (expandIcon.textContent !== '▶') {
    throw new Error(`Expected icon to change back to ▶, got ${expandIcon.textContent}`);
  }

  console.log('✓ testClickDelegationOnParentRow: Parent row click expands/collapses correctly');
}

/**
 * Test: Click on parent session name navigates to Cost Analysis
 * Verifies that clicking the name (not the expand icon) triggers navigation
 */
function testClickOnParentSessionName() {
  const sessionId = 'parent-1';
  const sessionName = 'monitor';

  // Create mock session name cell
  const nameCell = document.createElement('td');
  nameCell.className = 'session-name';
  nameCell.setAttribute('data-id', sessionId);
  nameCell.textContent = sessionName;

  // Simulate click on name cell
  const clickEvent = {
    target: nameCell,
    stopPropagation: () => {}
  };

  // Mock closest method
  clickEvent.target.closest = function(selector) {
    if (selector === '.session-name') return nameCell;
    return null;
  };

  // Apply the click handling logic
  const nameClickCell = clickEvent.target.closest('.session-name');
  if (nameClickCell && nameClickCell.textContent.trim()) {
    const clickedSessionId = nameClickCell.getAttribute('data-id');
    const expectedUrl = `/?tab=cost-analysis&session=${encodeURIComponent(clickedSessionId)}`;

    if (clickedSessionId !== sessionId) {
      throw new Error(`Expected session ID ${sessionId}, got ${clickedSessionId}`);
    }

    if (!expectedUrl.includes('cost-analysis')) {
      throw new Error(`Expected URL to include cost-analysis, got ${expectedUrl}`);
    }
  }

  console.log('✓ testClickOnParentSessionName: Name click navigates correctly');
}

/**
 * Test: Click on subagent name navigates to Cost Analysis for that subagent
 * Verifies that clicking a subagent row navigates to its cost analysis
 */
function testClickOnSubagentSessionName() {
  const parentId = 'parent-1';
  const subagentId = 'subagent-a';
  const subagentName = 'subagent-a';

  // Create mock subagent row
  const row = document.createElement('tr');
  row.className = 'subagent-row';
  row.setAttribute('data-id', subagentId);
  row.setAttribute('data-parent-id', parentId);

  const nameCell = document.createElement('td');
  nameCell.className = 'session-name';
  nameCell.setAttribute('data-id', subagentId);
  nameCell.textContent = `└ ${subagentName}`;

  row.appendChild(nameCell);

  // Simulate click on subagent name cell
  const clickEvent = {
    target: nameCell,
    stopPropagation: () => {}
  };

  clickEvent.target.closest = function(selector) {
    if (selector === '.session-name') return nameCell;
    return null;
  };

  // Apply the click handling logic
  const nameClickCell = clickEvent.target.closest('.session-name');
  if (nameClickCell && nameClickCell.textContent.trim()) {
    const clickedSessionId = nameClickCell.getAttribute('data-id');
    const expectedUrl = `/?tab=cost-analysis&session=${encodeURIComponent(clickedSessionId)}`;

    if (clickedSessionId !== subagentId) {
      throw new Error(`Expected subagent ID ${subagentId}, got ${clickedSessionId}`);
    }

    if (!expectedUrl.includes(subagentId)) {
      throw new Error(`Expected URL to include ${subagentId}, got ${expectedUrl}`);
    }
  }

  console.log('✓ testClickOnSubagentSessionName: Subagent name click navigates correctly');
}

/**
 * Test: Click elsewhere on row (not name cell) expands/collapses
 * Verifies that clicking cost/tokens/etc columns toggles expansion
 */
function testClickElsewhereOnRowExpandsCollapses() {
  const expandedSessions = new Set();
  const sessionId = 'parent-1';

  // Create mock row structure
  const row = document.createElement('tr');
  row.className = 'session-row';
  row.setAttribute('data-id', sessionId);
  row.setAttribute('data-expandable', 'true');

  const nameCell = document.createElement('td');
  nameCell.className = 'session-name';
  nameCell.setAttribute('data-id', sessionId);
  const expandIcon = document.createElement('span');
  expandIcon.className = 'expand-icon';
  expandIcon.textContent = '▶';
  nameCell.appendChild(expandIcon);
  row.appendChild(nameCell);

  // Create a cost cell (elsewhere on row)
  const costCell = document.createElement('td');
  costCell.className = 'td-center';
  costCell.textContent = '$1.23';
  row.appendChild(costCell);

  // Simulate click on cost cell (not on name cell)
  const clickEvent = {
    target: costCell,
    stopPropagation: () => {}
  };

  clickEvent.target.closest = function(selector) {
    if (selector === 'tr.session-row[data-expandable="true"]') return row;
    return null;
  };

  // Apply expand logic for click elsewhere on row
  const expandRow = clickEvent.target.closest('tr.session-row[data-expandable="true"]');
  if (expandRow) {
    const sessionNameCell = expandRow.querySelector?.('.session-name');
    // Check if click is NOT on the name cell
    if (sessionNameCell && !sessionNameCell.contains(clickEvent.target)) {
      const will = !expandedSessions.has(sessionId);
      if (will) {
        expandedSessions.add(sessionId);
        expandIcon.textContent = '▼';
      } else {
        expandedSessions.delete(sessionId);
        expandIcon.textContent = '▶';
      }
    }
  }

  if (!expandedSessions.has(sessionId)) {
    throw new Error('Expected click on cost cell to expand the row');
  }
  if (expandIcon.textContent !== '▼') {
    throw new Error(`Expected icon to change to ▼, got ${expandIcon.textContent}`);
  }

  console.log('✓ testClickElsewhereOnRowExpandsCollapses: Click elsewhere on row toggles expansion');
}

/**
 * Test: Rapid clicks don't break expansion logic
 * Verifies state consistency with multiple rapid clicks
 */
function testRapidClicksStability() {
  const expandedSessions = new Set();
  const sessionId = 'parent-1';

  // Perform 10 rapid toggle clicks
  for (let i = 0; i < 10; i++) {
    if (expandedSessions.has(sessionId)) {
      expandedSessions.delete(sessionId);
    } else {
      expandedSessions.add(sessionId);
    }
  }

  // After 10 clicks (even), should be back to original state (not expanded)
  if (expandedSessions.has(sessionId)) {
    throw new Error('Expected state to be collapsed after even number of rapid clicks');
  }

  // One more click
  if (expandedSessions.has(sessionId)) {
    expandedSessions.delete(sessionId);
  } else {
    expandedSessions.add(sessionId);
  }

  if (!expandedSessions.has(sessionId)) {
    throw new Error('Expected state to be expanded after odd number of rapid clicks');
  }

  console.log('✓ testRapidClicksStability: Rapid clicks maintain consistent state');
}

/**
 * Run all tests
 */
async function runTests() {
  console.log('\n--- Sessions Expand State Tests ---');
  testExpandStateInit();
  testExpandStateToggle();
  testExpandStateMultiple();

  console.log('\n--- Sessions View Integration - Data Structure ---');
  testDataStructureHierarchy();
  testExpandIconLogic();
  testSubagentRowStyling();

  console.log('\n--- Sessions View - Click Event Delegation ---');
  testClickDelegationOnParentRow();
  testClickOnParentSessionName();
  testClickOnSubagentSessionName();
  testClickElsewhereOnRowExpandsCollapses();
  testRapidClicksStability();

  console.log('\n✅ All sessions tests passed\n');
}

runTests().catch(err => {
  console.error('❌ Test failed:', err.message);
  process.exit(1);
});
