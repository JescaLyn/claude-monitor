import { get, fmt$ } from '/utils.js';

export async function render(el) {
  const rows = await get('/skills/costs');

  if (rows.length === 0) {
    el.innerHTML = '<p class="empty">No skill invocations recorded yet.</p>';
    return;
  }

  el.innerHTML = `
    <table>
      <thead>
        <tr>
          <th><button class="sort-btn" data-field="skill_name">Skill</button></th>
          <th><button class="sort-btn" data-field="invocation_count">Invocations</button></th>
          <th><button class="sort-btn" data-field="api_request_count">API Requests</button></th>
          <th><button class="sort-btn" data-field="total_cost_usd">Total Cost</button></th>
          <th>Avg Cost/Invocation</th>
          <th><button class="sort-btn" data-field="total_context_tokens">Context Tokens</button></th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(r => {
          const avgCost = r.invocation_count > 0 ? r.total_cost_usd / r.invocation_count : 0;
          return `
            <tr>
              <td>${r.skill_name}</td>
              <td>${r.invocation_count}</td>
              <td>${r.api_request_count}</td>
              <td>${fmt$(r.total_cost_usd)}</td>
              <td>${fmt$(avgCost)}</td>
              <td>${r.total_context_tokens}</td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;

  attachSorting(el, '/skills/costs');
}

function attachSorting(el, endpoint) {
  el.querySelectorAll('.sort-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const field = btn.dataset.field;
      const rows = await get(endpoint);
      const sorted = rows.sort((a, b) => {
        const aVal = a[field];
        const bVal = b[field];
        return typeof aVal === 'number' ? bVal - aVal : String(bVal).localeCompare(String(aVal));
      });
      el.innerHTML = `
        <table>
          <thead>
            <tr>
              <th><button class="sort-btn" data-field="skill_name">Skill</button></th>
              <th><button class="sort-btn" data-field="invocation_count">Invocations</button></th>
              <th><button class="sort-btn" data-field="api_request_count">API Requests</button></th>
              <th><button class="sort-btn" data-field="total_cost_usd">Total Cost</button></th>
              <th>Avg Cost/Invocation</th>
              <th><button class="sort-btn" data-field="total_context_tokens">Context Tokens</button></th>
            </tr>
          </thead>
          <tbody>
            ${sorted.map(r => {
              const avgCost = r.invocation_count > 0 ? r.total_cost_usd / r.invocation_count : 0;
              return `
                <tr>
                  <td>${r.skill_name}</td>
                  <td>${r.invocation_count}</td>
                  <td>${r.api_request_count}</td>
                  <td>${fmt$(r.total_cost_usd)}</td>
                  <td>${fmt$(avgCost)}</td>
                  <td>${r.total_context_tokens}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      `;
      attachSorting(el, endpoint);
    });
  });
}
