import { render as renderOverview } from '/tabs/overview.js';
import { render as renderSessions } from '/tabs/sessions.js';
import { render as renderCostAnalysis } from '/tabs/cost-analysis.js';

const TABS = {
  overview: renderOverview,
  sessions: renderSessions,
  'cost-analysis': renderCostAnalysis,
};

const content = document.getElementById('content');
const nav     = document.getElementById('tabs');

async function showTab(name) {
  nav.querySelectorAll('button').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === name)
  );
  content.innerHTML = '<p class="loading">Loading…</p>';
  try {
    content.innerHTML = '';
    await TABS[name](content);
  } catch (err) {
    content.innerHTML = `<p class="error">Error: ${err.message}</p>`;
  }
}

nav.addEventListener('click', e => {
  const tab = e.target.closest('button')?.dataset.tab;
  if (tab) showTab(tab);
});

// Load the Overview tab on startup
showTab('overview');
