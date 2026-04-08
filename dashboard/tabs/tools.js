import { get } from '/utils.js';

export async function render(el) {
  const rows = await get('/tools');

  if (rows.length === 0) {
    el.innerHTML = '<p class="empty">No tool events recorded yet.</p>';
    return;
  }

  el.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Tool</th>
          <th>Calls</th>
          <th>Successes</th>
          <th>Failures</th>
          <th>Avg Duration</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(r => `
          <tr>
            <td>${r.tool_name}</td>
            <td>${r.call_count}</td>
            <td>${r.success_count}</td>
            <td>${r.failure_count}</td>
            <td>${r.avg_duration_ms != null ? `${Math.round(r.avg_duration_ms)}ms` : '—'}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}
