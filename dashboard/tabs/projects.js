import { get } from '../utils.js';
import {
  getTimeThreshold,
  showTip, moveTip, hideTip,
  buildProjectView, groupByProject,
  loadModelsForProjects, loadModelsForSelection,
  buildFilterControl,
} from '../shared/session-table.js';

const expandedProjects = new Set();
let currentPageState = { sort: 'cost_usd', order: 'desc', hours: 0 };

async function renderPage(el, sort, order, hours) {
  const since = getTimeThreshold(hours);
  const [allRows, summary] = await Promise.all([
    get(`/sessions/with-subagents?limit=200&offset=0&sort=${sort}&order=${order}&since=${since}`),
    get(`/sessions/aggregate?since=${since}`),
  ]);
  const groups = groupByProject(allRows, sort, order);
  el.innerHTML = buildFilterControl(hours) + buildProjectView(groups, sort, order, expandedProjects, new Set(), summary);
  loadModelsForSelection(el, '.session-row', r => r.dataset.id);
  loadModelsForProjects(el, groups, since);
}

function handleTableClick(el, e) {
  const projectRow = e.target.closest('tr.project-header-row');
  if (projectRow) {
    const idx = projectRow.dataset.projectIdx;
    const expandIcon = projectRow.querySelector('.expand-icon');
    const willExpand = !expandedProjects.has(idx);
    if (willExpand) expandedProjects.add(idx); else expandedProjects.delete(idx);
    if (expandIcon) expandIcon.textContent = willExpand ? '▼' : '▶';
    el.querySelectorAll(`tr.session-row[data-project-idx="${idx}"]`).forEach(row => {
      row.style.display = willExpand ? '' : 'none';
    });
    const table = el.querySelector('table.sessions-table.project-view');
    if (table) table.classList.toggle('has-expanded', expandedProjects.size > 0);
    return;
  }

  const sortBtn = e.target.closest('.sort-btn');
  if (sortBtn) {
    expandedProjects.clear();
    currentPageState = { ...currentPageState, sort: sortBtn.dataset.field, order: sortBtn.dataset.order };
    renderPage(el, currentPageState.sort, currentPageState.order, currentPageState.hours);
    return;
  }
}

export async function render(el) {
  const wrapper = document.createElement('div');
  el.innerHTML = '';
  el.appendChild(wrapper);
  wrapper.addEventListener('click', (e) => handleTableClick(wrapper, e));
  wrapper.addEventListener('mouseover', (e) => {
    const t = e.target.closest('[data-tooltip]');
    if (t) showTip(e, t.dataset.tooltip);
  });
  wrapper.addEventListener('mousemove', (e) => moveTip(e));
  wrapper.addEventListener('mouseout', (e) => {
    if (e.target.closest('[data-tooltip]')) hideTip();
  });
  wrapper.addEventListener('change', (e) => {
    if (e.target.id === 'time-range-select') {
      expandedProjects.clear();
      const newHours = parseInt(e.target.value, 10);
      currentPageState = { ...currentPageState, hours: newHours };
      renderPage(wrapper, currentPageState.sort, currentPageState.order, newHours);
    }
  });
  await renderPage(wrapper, currentPageState.sort, currentPageState.order, currentPageState.hours);
}
