/**
 * dashboard.ts — Dashboard numbers display for MCP App
 *
 * Simplified from js/dashboard.js: summary cards only, no Chart.js.
 */

interface DashboardData {
  totalPop: number;
  totalBiz: number;
  avgSat: number;
  fiscal: number;
  freeBudget: number;
}

let prevData: DashboardData | null = null;

export function updateDashboard(data: DashboardData) {
  const el = document.getElementById('summary-cards');
  if (!el) return;

  const delta = (curr: number, prev: number) => {
    const diff = curr - prev;
    if (diff === 0) return '<span style="color:#64748b">-</span>';
    return diff > 0
      ? `<span class="delta-up">+${diff.toLocaleString()}</span>`
      : `<span class="delta-down">${diff.toLocaleString()}</span>`;
  };

  const prev = prevData || data;

  el.innerHTML = `
    <div class="summary-card">
      <div class="summary-label">총인구</div>
      <div class="summary-value">${(data.totalPop / 10000).toFixed(1)}만</div>
      <div class="summary-delta">${delta(data.totalPop, prev.totalPop)}</div>
    </div>
    <div class="summary-card">
      <div class="summary-label">사업체</div>
      <div class="summary-value">${(data.totalBiz / 10000).toFixed(1)}만</div>
      <div class="summary-delta">${delta(data.totalBiz, prev.totalBiz)}</div>
    </div>
    <div class="summary-card">
      <div class="summary-label">평균만족도</div>
      <div class="summary-value">${data.avgSat}</div>
      <div class="summary-delta">${delta(data.avgSat, prev.avgSat)}</div>
    </div>
    <div class="summary-card">
      <div class="summary-label">재정자립도</div>
      <div class="summary-value">${data.fiscal}%</div>
      <div class="summary-delta">${delta(data.fiscal, prev.fiscal)}</div>
    </div>
  `;

  prevData = { ...data };
}
