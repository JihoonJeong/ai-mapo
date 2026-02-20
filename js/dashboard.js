/**
 * dashboard.js — 대시보드 (요약 카드 + Chart.js 시계열 + 동별 순위)
 */

let trendChart = null;
let rankChart = null;

export function initDashboard(state) {
  renderSummary(state);
  initTrendChart(state);
  initRankChart(state);
  initDashTabs();
}

function initDashTabs() {
  document.querySelectorAll('.dash-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.dash-tab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.dash-view').forEach(v => v.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`dash-${btn.dataset.dash}`)?.classList.add('active');

      // Trigger Chart.js resize for newly visible chart
      if (btn.dataset.dash === 'trend' && trendChart) trendChart.resize();
      if (btn.dataset.dash === 'rank' && rankChart) rankChart.resize();
    });
  });
}

export function updateDashboard(state) {
  renderSummary(state);
  updateTrendChart(state);
  updateRankChart(state);
}

function renderSummary(state) {
  const container = document.getElementById('dashboard-summary');
  if (!container) return;

  const totalPop = state.dongs.reduce((s, d) => s + d.population, 0);
  const totalBiz = state.dongs.reduce((s, d) => s + d.businesses, 0);
  const avgSat = Math.round(state.dongs.reduce((s, d) => s + d.satisfaction, 0) / state.dongs.length);
  const budget = state.finance.totalBudget;
  const fiscal = state.finance.fiscalIndependence;

  // Deltas (compare with previous turn in history)
  const prev = state.history?.length > 0 ? state.history[state.history.length - 1] : null;
  const prevPop = prev?.totalPopulation || totalPop;
  const prevSat = prev?.avgSatisfaction || avgSat;
  const prevFiscal = prev?.fiscalIndependence || fiscal;

  container.innerHTML = `
    <div class="summary-card">
      <div class="summary-label">총인구</div>
      <div class="summary-value">${(totalPop / 10000).toFixed(1)}만</div>
      <div class="summary-delta ${totalPop >= prevPop ? 'delta-up' : 'delta-down'}">
        ${totalPop >= prevPop ? '+' : ''}${(totalPop - prevPop).toLocaleString()}
      </div>
    </div>
    <div class="summary-card">
      <div class="summary-label">사업체</div>
      <div class="summary-value">${(totalBiz / 10000).toFixed(1)}만</div>
      <div class="summary-delta delta-flat">종사자 ${(state.dongs.reduce((s, d) => s + d.workers, 0) / 10000).toFixed(1)}만</div>
    </div>
    <div class="summary-card">
      <div class="summary-label">재정자립도</div>
      <div class="summary-value">${fiscal}%</div>
      <div class="summary-delta ${fiscal >= prevFiscal ? 'delta-up' : 'delta-down'}">
        ${fiscal >= prevFiscal ? '+' : ''}${fiscal - prevFiscal}%p
      </div>
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

// === Trend Chart (시계열) ===
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
          pointRadius: 3,
          borderWidth: 2,
        },
        {
          label: '만족도',
          data: satData,
          borderColor: '#16a34a',
          backgroundColor: '#dcfce7',
          tension: 0.3,
          yAxisID: 'y1',
          pointRadius: 3,
          borderWidth: 2,
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

  trendChart.data.labels.push(`T${turn}`);
  trendChart.data.datasets[0].data.push(Math.round(totalPop / 10000 * 10) / 10);
  trendChart.data.datasets[1].data.push(avgSat);

  // Keep last 12 data points visible
  if (trendChart.data.labels.length > 13) {
    trendChart.data.labels.shift();
    trendChart.data.datasets.forEach(ds => ds.data.shift());
  }

  trendChart.update();
}

// === Rank Chart (동별 만족도 순위 바 차트) ===
function initRankChart(state) {
  const canvas = document.getElementById('rank-chart');
  if (!canvas || typeof Chart === 'undefined') return;

  const sorted = [...state.dongs].sort((a, b) => b.satisfaction - a.satisfaction);
  const labels = sorted.map(d => d.name);
  const data = sorted.map(d => d.satisfaction);
  const colors = data.map(v => {
    if (v >= 70) return '#16a34a';
    if (v >= 55) return '#2563eb';
    if (v >= 40) return '#d97706';
    return '#dc2626';
  });

  rankChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: '만족도',
        data,
        backgroundColor: colors,
        borderWidth: 0,
        borderRadius: 3,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: 'y',
      plugins: {
        legend: { display: false },
      },
      scales: {
        x: {
          min: 0,
          max: 100,
          ticks: { font: { size: 10 } },
          grid: { color: 'rgba(0,0,0,0.05)' },
        },
        y: {
          ticks: { font: { size: 10 } },
          grid: { display: false },
        },
      },
    },
  });
}

function updateRankChart(state) {
  if (!rankChart) return;

  const sorted = [...state.dongs].sort((a, b) => b.satisfaction - a.satisfaction);
  rankChart.data.labels = sorted.map(d => d.name);
  rankChart.data.datasets[0].data = sorted.map(d => d.satisfaction);
  rankChart.data.datasets[0].backgroundColor = sorted.map(d => {
    if (d.satisfaction >= 70) return '#16a34a';
    if (d.satisfaction >= 55) return '#2563eb';
    if (d.satisfaction >= 40) return '#d97706';
    return '#dc2626';
  });

  rankChart.update();
}
