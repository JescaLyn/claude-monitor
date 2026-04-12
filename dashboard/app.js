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
  if (tab && TABS[tab]) {
    // Clear URL params when clicking nav (other than preserving session param for cost-analysis)
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get('session');
    if (tab === 'cost-analysis' && sessionId) {
      window.history.pushState({}, '', `/?tab=${tab}&session=${encodeURIComponent(sessionId)}`);
    } else {
      window.history.pushState({}, '', `/?tab=${tab}`);
    }
    showTab(tab);
  }
});

// Theme toggle
document.getElementById('theme-toggle').addEventListener('click', () => {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
});

// Load the appropriate tab on startup (from URL param or default to overview)
const params = new URLSearchParams(window.location.search);
const initialTab = (params.get('tab') && TABS[params.get('tab')]) ? params.get('tab') : 'overview';
showTab(initialTab);
