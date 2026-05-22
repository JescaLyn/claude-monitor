import { get, fmt$ } from '/utils.js';

const PERIODS = [
  { label: '7 days',   days: 7   },
  { label: '30 days',  days: 30  },
  { label: '90 days',  days: 90  },
  { label: '365 days', days: 365 },
];

let chartInstance = null;

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function fillGaps(rows, days) {
  const byDay = Object.fromEntries(rows.map(r => [r.day, r]));
  const result = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    result.push(byDay[key] ?? { day: key, cost_usd: 0, api_request_count: 0 });
  }
  return result;
}

function fmtDay(isoDay) {
  const [y, m, d] = isoDay.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function buildSummaryCards(rows, summary) {
  const total = rows.reduce((s, r) => s + r.cost_usd, 0);
  const activeDays = rows.filter(r => r.cost_usd > 0).length;
  const totalDays = rows.length;
  const avg = activeDays > 0 ? total / activeDays : 0;
  const totalReqs = rows.reduce((s, r) => s + r.api_request_count, 0);
  const totalSessions = summary.total_sessions;
  const avgCostPerSession = totalSessions > 0 ? total / totalSessions : 0;

  return `
    <div class="stat-grid" style="margin-bottom:24px">
      <div class="stat-card">
        <div class="stat-value">${fmt$(total)}</div>
        <div class="stat-label">Total Cost</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${fmt$(avg)}</div>
        <div class="stat-label">Avg / Active Day</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${activeDays} <span style="font-size:14px;font-weight:500;color:var(--text-muted)">/ ${totalDays}</span></div>
        <div class="stat-label">Active Days</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${fmt$(avgCostPerSession)}</div>
        <div class="stat-label">Avg Cost / Session</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${totalSessions.toLocaleString()}</div>
        <div class="stat-label">Sessions</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${totalReqs.toLocaleString()}</div>
        <div class="stat-label">API Requests</div>
      </div>
    </div>
  `;
}

function buildPeriodDropdown(selectedDays) {
  const options = PERIODS.map(p =>
    `<option value="${p.days}"${p.days === selectedDays ? ' selected' : ''}>${p.label}</option>`
  ).join('');
  return `
    <div class="timeline-period-wrap">
      <label for="timeline-period" class="timeline-period-label">Range</label>
      <select id="timeline-period" class="timeline-period-select">${options}</select>
    </div>
  `;
}

// HTML tooltip shown outside the canvas so it can use full CSS
let tooltipEl = null;

function getOrCreateTooltipEl() {
  if (!tooltipEl) {
    tooltipEl = document.createElement('div');
    tooltipEl.className = 'chart-tooltip';
    document.body.appendChild(tooltipEl);
  }
  return tooltipEl;
}

function externalTooltip(context, rows) {
  const { chart, tooltip } = context;
  const el = getOrCreateTooltipEl();

  if (tooltip.opacity === 0) {
    el.style.opacity = '0';
    return;
  }

  if (tooltip.dataPoints?.length) {
    const dp = tooltip.dataPoints[0];
    const row = rows[dp.dataIndex];
    const accent = cssVar('--accent');
    el.innerHTML = `
      <div class="ct-date">${dp.label}</div>
      <div class="ct-cost">${fmt$(dp.raw)}</div>
      <div class="ct-divider"></div>
      <div class="ct-row">
        <span class="ct-label">Requests</span>
        <span class="ct-val">${row.api_request_count.toLocaleString()}</span>
      </div>
    `;
    el.style.setProperty('--ct-accent', accent);
  }

  const rect = chart.canvas.getBoundingClientRect();
  const x = rect.left + tooltip.caretX;
  const y = rect.top + tooltip.caretY;

  el.style.opacity = '1';
  // Position to the right of the caret; flip left if near right edge
  const gap = 14;
  const elW = el.offsetWidth || 140;
  const viewW = window.innerWidth;
  if (x + gap + elW > viewW - 16) {
    el.style.left = `${x - gap - elW}px`;
  } else {
    el.style.left = `${x + gap}px`;
  }
  el.style.top = `${y - el.offsetHeight / 2}px`;
}

function renderChart(canvas, rows) {
  if (chartInstance) {
    chartInstance.destroy();
    chartInstance = null;
  }
  // Hide any leftover tooltip from previous render
  if (tooltipEl) tooltipEl.style.opacity = '0';

  const accent = cssVar('--accent');
  const accentRgb = hexToRgb(accent) ?? '129,140,248';
  const gridColor = cssVar('--border-color');
  const textMuted = cssVar('--text-muted');

  chartInstance = new Chart(canvas, {
    type: 'line',
    data: {
      labels: rows.map(r => fmtDay(r.day)),
      datasets: [{
        label: 'Cost (USD)',
        data: rows.map(r => r.cost_usd),
        borderColor: accent,
        borderWidth: 2,
        pointRadius: rows.length > 60 ? 0 : 3,
        pointHoverRadius: 6,
        pointHoverBackgroundColor: accent,
        pointHoverBorderColor: cssVar('--bg-surface') || '#fff',
        pointHoverBorderWidth: 2,
        pointBackgroundColor: accent,
        fill: true,
        backgroundColor: (ctx) => {
          const chart = ctx.chart;
          const { ctx: c, chartArea } = chart;
          if (!chartArea) return `rgba(${accentRgb}, 0.12)`;
          const gradient = c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
          gradient.addColorStop(0, `rgba(${accentRgb}, 0.25)`);
          gradient.addColorStop(1, `rgba(${accentRgb}, 0.02)`);
          return gradient;
        },
        tension: 0.3,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: false,
          external: (ctx) => externalTooltip(ctx, rows),
        },
      },
      scales: {
        x: {
          ticks: {
            color: textMuted,
            maxRotation: 45,
            font: { size: 11 },
            autoSkip: true,
            maxTicksLimit: 15,
          },
          grid: { display: false },
          border: { color: gridColor },
        },
        y: {
          beginAtZero: true,
          ticks: {
            color: textMuted,
            font: { size: 11 },
            callback: v => `$${v.toFixed(2)}`,
          },
          grid: { color: gridColor, lineWidth: 0.5 },
          border: { color: gridColor, dash: [4, 4] },
        },
      },
    },
  });
}

function hexToRgb(hex) {
  const clean = hex.replace(/^#/, '');
  if (clean.length === 3) {
    const [r, g, b] = clean.split('').map(c => parseInt(c + c, 16));
    return `${r},${g},${b}`;
  }
  if (clean.length === 6) {
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    return `${r},${g},${b}`;
  }
  return null;
}

async function renderPage(el, days) {
  const [raw, summary] = await Promise.all([
    get(`/cost/by-day?days=${days}`),
    get(`/cost/range-summary?days=${days}`),
  ]);
  const rows = fillGaps(raw, days);

  el.innerHTML = `
    <div class="timeline-container">
      <div class="timeline-header">
        <h2 class="timeline-title">Daily Cost Timeline</h2>
        ${buildPeriodDropdown(days)}
      </div>
      ${buildSummaryCards(rows, summary)}
      <div class="chart-card">
        <div class="chart-wrap">
          <canvas id="timeline-chart"></canvas>
        </div>
      </div>
    </div>
  `;

  el.querySelector('#timeline-period').addEventListener('change', e => {
    renderPage(el, parseInt(e.target.value, 10)).catch(err => {
      el.innerHTML = `<p class="error">Error: ${err.message}</p>`;
    });
  });

  const canvas = el.querySelector('#timeline-chart');
  renderChart(canvas, rows);
}

export async function render(el) {
  await renderPage(el, 30);
}
