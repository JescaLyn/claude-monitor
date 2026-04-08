import { get, fmt$, fmtTokens } from '/utils.js';

export async function render(el) {
  const [byDay, byModel, byMachine] = await Promise.all([
    get('/cost/by-day?days=30'),
    get('/cost/by-model'),
    get('/cost/by-machine'),
  ]);

  el.innerHTML = `
    <h2>Daily Cost — last 30 days</h2>
    <div class="chart-container">
      <canvas id="cost-chart"></canvas>
    </div>

    <h2>Cost by Model</h2>
    ${byModel.length === 0
      ? '<p class="empty">No data yet.</p>'
      : `<table>
          <thead>
            <tr><th>Model</th><th>Cost</th><th>Input Tokens</th><th>Output Tokens</th></tr>
          </thead>
          <tbody>
            ${byModel.map(r => `
              <tr>
                <td>${r.model ?? '—'}</td>
                <td>${fmt$(r.cost_usd)}</td>
                <td>${fmtTokens(r.input_tokens)}</td>
                <td>${fmtTokens(r.output_tokens)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>`
    }

    <h2>Cost by Machine</h2>
    ${byMachine.length === 0
      ? '<p class="empty">No data yet.</p>'
      : `<table>
          <thead>
            <tr><th>Machine</th><th>Cost</th><th>Sessions</th></tr>
          </thead>
          <tbody>
            ${byMachine.map(r => `
              <tr>
                <td>${r.machine_id}</td>
                <td>${fmt$(r.cost_usd)}</td>
                <td>${r.session_count}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>`
    }
  `;

  // Chart is a CDN global loaded before this module runs
  const ctx = el.querySelector('#cost-chart').getContext('2d');
  new Chart(ctx, {
    type: 'line',
    data: {
      labels: byDay.map(r => r.day),
      datasets: [{
        label: 'Cost (USD)',
        data: byDay.map(r => r.cost_usd),
        borderColor: '#4f7df3',
        backgroundColor: 'rgba(79, 125, 243, 0.1)',
        tension: 0.3,
        fill: true,
        pointRadius: 3,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => `$${ctx.parsed.y.toFixed(4)}`,
          },
        },
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { callback: v => `$${Number(v).toFixed(3)}` },
        },
      },
    },
  });
}
