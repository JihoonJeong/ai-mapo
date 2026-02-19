/**
 * dashboard.js — 대시보드 (요약 카드 + Chart.js 시계열 + 동별 순위)
 */

let trendChart = null;

export function initDashboard(state) {
  renderSummary(state);
  initTrendChart(state);
}

export function updateDashboard(state) {
  renderSummary(state);
  updateTrendChart(state);
}

function renderSummary(state) {
  const container = document.getElementById('dashboard-summary');
  if (!container) return;

  const totalPop = state.dongs.reduce((s, d) => s + d.population, 0);
  const avgSat = Math.round(state.dongs.reduce((s, d) => s + d.satisfaction, 0) / state.dongs.length);
  const budget = state.finance.totalBudget;
  const fiscal = state.finance.fiscalIndependence;

  // Deltas (compare with previous turn in history)
  const prev = state.history?.length > 0 ? state.history[state.history.length - 1] : null;
  const prevPop = prev?.totalPopulation || totalPop;
  const prevSat = prev?.avgSatisfaction || avgSat;

  container.innerHTML = `
    <div class="summary-card">
      <div class="summary-label">총인구</div>
      <div class="summary-value">${(totalPop / 10000).toFixed(1)}만</div>
      <div class="summary-delta ${totalPop >= prevPop ? 'delta-up' : 'delta-down'}">
        ${totalPop >= prevPop ? '+' : ''}${(totalPop - prevPop).toLocaleString()}
      </div>
    </div>
    <div class="summary-card">
      <div class="summary-label">분기예산</div>
      <div class="summary-value">${budget}억</div>
      <div class="summary-delta delta-flat">자유 ${state.finance.freeBudget}억</div>
    </div>
    <div class="summary-card">
      <div class="summary-label">재정자립도</div>
      <div class="summary-value">${fiscal}%</div>
      <div class="summary-delta delta-flat">서울 평균 26%</div>
    </div>
    <div class="summary-card">
      <div class="summary-label">평균만족도</div>
      <div class="summary-value">${avgSat}</div>
      <div class="summary-delta ${avgSat >= prevSat ? 'delta-up' : 'delta-down'}">
        ${avgSat >= prevSat ? '+' : ''}${avgSat - prevSat}
      </div>
    </div>
  `;
}

function initTrendChart(state) {
  const canvas = document.getElementById('trend-chart');
  if (!canvas || typeof Chart === 'undefined') return;

  const labels = ['시작'];
  const popData = [state.dongs.reduce((s, d) => s + d.population, 0)];
  const satData = [Math.round(state.dongs.reduce((s, d) => s + d.satisfaction, 0) / state.dongs.length)];

  trendChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: '인구(만)',
          data: popData.map(v => Math.round(v / 10000 * 10) / 10),
          borderColor: '#2563eb',
          backgroundColor: '#dbeafe',
          tension: 0.3,
          yAxisID: 'y',
        },
        {
          label: '만족도',
          data: satData,
          borderColor: '#16a34a',
          backgroundColor: '#dcfce7',
          tension: 0.3,
          yAxisID: 'y1',
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'top', labels: { font: { size: 11 }, boxWidth: 12 } },
      },
      scales: {
        y: {
          position: 'left',
          title: { display: true, text: '인구(만)', font: { size: 10 } },
          ticks: { font: { size: 10 } },
        },
        y1: {
          position: 'right',
          title: { display: true, text: '만족도', font: { size: 10 } },
          min: 0, max: 100,
          grid: { drawOnChartArea: false },
          ticks: { font: { size: 10 } },
        },
        x: { ticks: { font: { size: 10 } } },
      },
    },
  });
}

function updateTrendChart(state) {
  if (!trendChart) return;

  const turn = state.meta.turn;
  const totalPop = state.dongs.reduce((s, d) => s + d.population, 0);
  const avgSat = Math.round(state.dongs.reduce((s, d) => s + d.satisfaction, 0) / state.dongs.length);

  // Keep only last 8 data points visible
  trendChart.data.labels.push(`T${turn}`);
  trendChart.data.datasets[0].data.push(Math.round(totalPop / 10000 * 10) / 10);
  trendChart.data.datasets[1].data.push(avgSat);

  if (trendChart.data.labels.length > 9) {
    trendChart.data.labels.shift();
    trendChart.data.datasets.forEach(ds => ds.data.shift());
  }

  trendChart.update();
}
