/**
 * Tests for app.js and index.html integration
 * Verifies that the unified Cost Analysis tab is properly wired
 */

import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';

// Setup: Load HTML
const htmlPath = path.resolve('./dashboard/index.html');
const htmlContent = fs.readFileSync(htmlPath, 'utf8');
const dom = new JSDOM(htmlContent);
global.document = dom.window.document;
global.window = dom.window;

/**
 * Test: "Cost Analysis" button exists in HTML
 */
function testCostAnalysisButtonExists() {
  const costAnalysisBtn = document.querySelector('[data-tab="cost-analysis"]');
  if (!costAnalysisBtn) {
    throw new Error('Cost Analysis button not found in HTML');
  }
  if (costAnalysisBtn.textContent.trim() !== 'Cost Analysis') {
    throw new Error(`Expected "Cost Analysis" text, got "${costAnalysisBtn.textContent.trim()}"`);
  }
  console.log('✓ testCostAnalysisButtonExists: Cost Analysis button found');
}

/**
 * Test: Old three cost buttons are removed
 */
function testOldCostButtonsRemoved() {
  const skillsCostBtn = document.querySelector('[data-tab="skillsCost"]');
  const subagentsCostBtn = document.querySelector('[data-tab="subagentsCost"]');
  const apiRequestsBtn = document.querySelector('[data-tab="apiRequests"]');

  if (skillsCostBtn) {
    throw new Error('Old "Skills by Cost" button still exists in HTML');
  }
  if (subagentsCostBtn) {
    throw new Error('Old "Subagents by Cost" button still exists in HTML');
  }
  if (apiRequestsBtn) {
    throw new Error('Old "API Requests" button still exists in HTML');
  }
  console.log('✓ testOldCostButtonsRemoved: Old cost buttons removed');
}

/**
 * Test: Other tabs are preserved
 */
function testOtherTabsPreserved() {
  const expectedTabs = ['overview', 'sessions'];
  const missingTabs = [];

  expectedTabs.forEach(tabName => {
    const btn = document.querySelector(`[data-tab="${tabName}"]`);
    if (!btn) {
      missingTabs.push(tabName);
    }
  });

  if (missingTabs.length > 0) {
    throw new Error(`Expected tabs missing: ${missingTabs.join(', ')}`);
  }
  console.log('✓ testOtherTabsPreserved: All other tabs preserved');
}

/**
 * Test: CSS stylesheet for cost-analysis is included
 */
function testCostAnalysisCSSIncluded() {
  const cssLink = document.querySelector('link[href="/css/cost-analysis.css"]');
  if (!cssLink) {
    throw new Error('Cost Analysis CSS stylesheet not found in HTML');
  }
  console.log('✓ testCostAnalysisCSSIncluded: CSS stylesheet included');
}

/**
 * Test: app.js correctly imports cost-analysis module
 */
async function testAppJSImportsUnified() {
  const appPath = path.resolve('./dashboard/app.js');
  const appContent = fs.readFileSync(appPath, 'utf8');

  // Check for unified import
  if (!appContent.includes("import { render as renderCostAnalysis } from '/tabs/cost-analysis.js'")) {
    throw new Error('app.js does not import the unified cost-analysis module');
  }

  // Check that old imports are removed
  if (appContent.includes("import * as skillsCostTab")) {
    throw new Error('app.js still imports old skillsCostTab');
  }
  if (appContent.includes("import * as subagentsCostTab")) {
    throw new Error('app.js still imports old subagentsCostTab');
  }
  if (appContent.includes("import * as apiRequestsTab")) {
    throw new Error('app.js still imports old apiRequestsTab');
  }

  console.log('✓ testAppJSImportsUnified: app.js correctly imports unified module');
}

/**
 * Test: app.js correctly registers the unified tab
 */
async function testAppJSRegistersUnifiedTab() {
  const appPath = path.resolve('./dashboard/app.js');
  const appContent = fs.readFileSync(appPath, 'utf8');

  // Check for tab registration
  if (!appContent.includes("'cost-analysis': renderCostAnalysis")) {
    throw new Error('app.js does not register the unified cost-analysis tab');
  }

  // Check that old registrations are removed
  if (appContent.includes("skillsCost: skillsCostTab.render")) {
    throw new Error('app.js still registers old skillsCost tab');
  }
  if (appContent.includes("subagentsCost: subagentsCostTab.render")) {
    throw new Error('app.js still registers old subagentsCost tab');
  }
  if (appContent.includes("apiRequests: apiRequestsTab.render")) {
    throw new Error('app.js still registers old apiRequests tab');
  }

  console.log('✓ testAppJSRegistersUnifiedTab: app.js correctly registers unified tab');
}

/**
 * Test: Cost Analysis button is placed among other tabs
 */
function testButtonPlacement() {
  const navTabs = document.querySelector('nav#tabs');
  const buttons = Array.from(navTabs.querySelectorAll('button'));
  const tabNames = buttons.map(b => b.dataset.tab);

  // Verify cost-analysis is in the list
  if (!tabNames.includes('cost-analysis')) {
    throw new Error('cost-analysis tab not in navigation');
  }

  // Verify it comes after basic tabs
  const costAnalysisIndex = tabNames.indexOf('cost-analysis');
  const sessionsIndex = tabNames.indexOf('sessions');

  if (costAnalysisIndex < sessionsIndex) {
    throw new Error(`cost-analysis button is not placed logically (index ${costAnalysisIndex}, should be after sessions at ${sessionsIndex})`);
  }

  console.log('✓ testButtonPlacement: Cost Analysis button placed correctly');
}

/**
 * Test: Total number of tabs is correct (3 tabs, not 8)
 */
function testTabCount() {
  const buttons = document.querySelectorAll('nav#tabs button');
  const expectedCount = 3; // overview, sessions, cost-analysis

  if (buttons.length !== expectedCount) {
    throw new Error(`Expected ${expectedCount} tab buttons, found ${buttons.length}`);
  }

  console.log(`✓ testTabCount: Correct number of tabs (${expectedCount})`);
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
  console.log('Running app integration tests...\n');

  try {
    console.log('--- HTML Structure Tests ---');
    testCostAnalysisButtonExists();
    testOldCostButtonsRemoved();
    testOtherTabsPreserved();
    testCostAnalysisCSSIncluded();

    console.log('\n--- app.js Integration Tests ---');
    await testAppJSImportsUnified();
    await testAppJSRegistersUnifiedTab();

    console.log('\n--- Layout Tests ---');
    testButtonPlacement();
    testTabCount();

    console.log('\n✅ All app integration tests passed');
    process.exit(0);
  } catch (err) {
    console.error(`\n❌ Test failed: ${err.message}`);
    console.error(err.stack);
    process.exit(1);
  }
}

runTests();
