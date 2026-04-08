import { get, fmt$ } from '/utils.js';

export async function render(el) {
  const data = await get('/subagents/costs');

  if (data.invocation_count === 0) {
    el.innerHTML = '<p class="empty">No subagent invocations recorded yet.</p>';
    return;
  }

  const avgCost = data.invocation_count > 0 ? data.total_cost_usd / data.invocation_count : 0;

  el.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Metric</th>
          <th>Value</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Total Invocations</td>
          <td>${data.invocation_count}</td>
        </tr>
        <tr>
          <td>API Requests Triggered</td>
          <td>${data.api_request_count}</td>
        </tr>
        <tr>
          <td>Total Cost</td>
          <td>${fmt$(data.total_cost_usd)}</td>
        </tr>
        <tr>
          <td>Avg Cost/Invocation</td>
          <td>${fmt$(avgCost)}</td>
        </tr>
      </tbody>
    </table>
  `;
}
