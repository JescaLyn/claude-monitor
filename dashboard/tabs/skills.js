import { get } from '/utils.js';

export async function render(el) {
  const rows = await get('/skills');

  if (rows.length === 0) {
    el.innerHTML = '<p class="empty">No skill invocations recorded yet.</p>';
    return;
  }

  el.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Skill</th>
          <th>Calls</th>
          <th>Successes</th>
          <th>Success Rate</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(r => {
          const rate = r.call_count > 0
            ? Math.round((r.success_count / r.call_count) * 100)
            : 0;
          return `
            <tr>
              <td>${r.skill_name}</td>
              <td>${r.call_count}</td>
              <td>${r.success_count}</td>
              <td>${rate}%</td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;
}
