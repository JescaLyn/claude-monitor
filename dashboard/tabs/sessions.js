import { get } from '../utils.js';
import {
  DEFAULT_HOURS, LIMIT, getTimeThreshold,
  showTip, moveTip, hideTip,
  buildTableHead, buildSessionRowHtml, buildTotalRow,
  loadModelsForSelection, buildFilterControl,
} from '../shared/session-table.js';

const expandedSessions = new Set();
let currentPageState = { offset: 0, sort: 'last_event_ts', order: 'desc', hours: DEFAULT_HOURS };

function buildTable(rows, offset, sort, order, totalCount, allRows, summary) {
  if (totalCount === 0 && offset === 0) return '<p class="empty">No sessions in this time range.</p>';
  const displayTotal = summary?.total_sessions ?? totalCount;
  return `
    <table class="sessions-table">
      ${buildTableHead(sort, order)}
      <tbody>
        ${buildTotalRow(allRows, false, summary)}
        ${rows.map(r => buildSessionRowHtml(r, null, expandedSessions)).join('')}
      </tbody>
    </table>
    <div class="pagination">
      <button id="prev-btn" ${offset === 0 ? 'disabled' : ''}>← Prev</button>
      <span>${rows.length === 0 ? 'No more rows' : `Rows ${offset + 1}–${offset + rows.length} of ${displayTotal}`}</span>
      <button id="next-btn" ${rows.length < LIMIT ? 'disabled' : ''}>Next →</button>
    </div>
  `;
}

async function renderPage(el, offset, sort, order, hours) {
  const since = getTimeThreshold(hours);
  const [allRows, summary] = await Promise.all([
    get(`/sessions/with-subagents?limit=200&offset=0&sort=${sort}&order=${order}&since=${since}`),
    get(`/sessions/aggregate?since=${since}`),
  ]);
  const paginatedRows = allRows.slice(offset, offset + LIMIT);
  el.innerHTML = buildFilterControl(hours) + buildTable(paginatedRows, offset, sort, order, allRows.length, allRows, summary);
  loadModelsForSelection(el, '.session-row:not(.subagent-row)', r => r.dataset.id);
  loadModelsForSelection(el, '.subagent-row', r => r.dataset.id);
}

function handleTableClick(el, e) {
  const expandRow = e.target.closest('tr.session-row[data-expandable="true"]');
  if (expandRow) {
    const sessionId = expandRow.dataset.id;
    const expandIcon = expandRow.querySelector('.expand-icon');
    const willExpand = !expandedSessions.has(sessionId);
    if (willExpand) expandedSessions.add(sessionId); else expandedSessions.delete(sessionId);
    if (expandIcon) expandIcon.textContent = willExpand ? '▼' : '▶';
    el.querySelectorAll(`tr[data-parent-id="${sessionId}"]`).forEach(sub => {
      sub.style.display = willExpand ? '' : 'none';
    });
    return;
  }

  const sortBtn = e.target.closest('.sort-btn');
  if (sortBtn) {
    currentPageState = { ...currentPageState, offset: 0, sort: sortBtn.dataset.field, order: sortBtn.dataset.order };
    renderPage(el, 0, currentPageState.sort, currentPageState.order, currentPageState.hours);
    return;
  }

  if (e.target.id === 'prev-btn') {
    const newOffset = Math.max(0, currentPageState.offset - LIMIT);
    currentPageState.offset = newOffset;
    renderPage(el, newOffset, currentPageState.sort, currentPageState.order, currentPageState.hours);
    return;
  }
  if (e.target.id === 'next-btn') {
    const newOffset = currentPageState.offset + LIMIT;
    currentPageState.offset = newOffset;
    renderPage(el, newOffset, currentPageState.sort, currentPageState.order, currentPageState.hours);
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
      const newHours = parseInt(e.target.value, 10);
      currentPageState = { ...currentPageState, offset: 0, hours: newHours };
      renderPage(wrapper, 0, currentPageState.sort, currentPageState.order, newHours);
    }
  });
  await renderPage(wrapper, currentPageState.offset, currentPageState.sort, currentPageState.order, currentPageState.hours);
}
