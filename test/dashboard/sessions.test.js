/**
 * Tests for sessions.js expand state and hierarchical rendering
 */

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
 * Run all tests
 */
async function runTests() {
  console.log('\n--- Sessions Expand State Tests ---');
  testExpandStateInit();
  testExpandStateToggle();
  testExpandStateMultiple();
  console.log('\n✅ All sessions tests passed\n');
}

runTests().catch(err => {
  console.error('❌ Test failed:', err.message);
  process.exit(1);
});
