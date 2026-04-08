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
  console.log('Running cost-analysis summary cards tests...\n');

  try {
    await testSummaryCardsCount();
    await testCardLabels();
    await testCardValueFormatting();
    await testEmptyDataHandling();

    console.log('\n✅ All tests passed');
    process.exit(0);
  } catch (err) {
    console.error(`\n❌ Test failed: ${err.message}`);
    console.error(err.stack);
    process.exit(1);
  }
}

runTests();
