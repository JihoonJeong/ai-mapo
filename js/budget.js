/**
 * budget.js — 예산 배분 슬라이더 UI
 */

const CATEGORIES = [
  { id: 'economy', name: '경제·일자리', lag: '2~4턴', icon: '💼' },
  { id: 'transport', name: '교통·인프라', lag: '3~6턴', icon: '🚇' },
  { id: 'culture', name: '문화·관광', lag: '1~3턴', icon: '🎭' },
  { id: 'environment', name: '환경·안전', lag: '1~2턴', icon: '🌳' },
  { id: 'education', name: '교육·보육', lag: '4~8턴', icon: '📚' },
  { id: 'welfare', name: '주거·복지', lag: '2~6턴', icon: '🏠' },
  { id: 'renewal', name: '도시재생', lag: '6~12턴', icon: '🏗️' },
];

let allocation = {};
let freeBudget = 0;

export function initBudget(state) {
  allocation = { ...state.finance.allocation };
  freeBudget = state.finance.freeBudget;
  renderBudget();
}

export function getAllocation() {
  return { ...allocation };
}

export function setAllocation(alloc, currentFreeBudget) {
  allocation = { ...alloc };
  if (currentFreeBudget !== undefined) freeBudget = currentFreeBudget;
  renderBudget();
}

function renderBudget() {
  const container = document.getElementById('tab-budget');
  if (!container) return;

  const total = Object.values(allocation).reduce((s, v) => s + v, 0);

  container.innerHTML = CATEGORIES.map(cat => {
    const pct = allocation[cat.id] || 0;
    const amount = Math.round(freeBudget * pct / 100);
    return `
      <div class="budget-category">
        <div class="budget-label">
          <span class="budget-name">${cat.icon} ${cat.name}</span>
          <span>
            <span class="budget-pct">${pct}%</span>
            <span class="budget-amount">(${amount}억)</span>
          </span>
        </div>
        <input type="range" class="budget-slider" data-cat="${cat.id}"
               min="0" max="40" value="${pct}" step="1">
        <div style="font-size:10px;color:var(--text-muted);margin-top:1px">효과 ${cat.lag} 후</div>
      </div>
    `;
  }).join('') + `
    <div class="budget-total ${total !== 100 ? 'budget-over' : ''}">
      <span>합계</span>
      <span>${total}% / 100%</span>
    </div>
  `;

  // Bind slider events — clamp so total never exceeds 100%
  container.querySelectorAll('.budget-slider').forEach(slider => {
    slider.addEventListener('input', (e) => {
      const cat = e.target.dataset.cat;
      const desired = parseInt(e.target.value);
      const othersSum = Object.entries(allocation)
        .filter(([k]) => k !== cat)
        .reduce((s, [, v]) => s + v, 0);
      const maxAllowed = Math.min(40, 100 - othersSum);
      allocation[cat] = Math.min(desired, Math.max(0, maxAllowed));
      renderBudget();
    });
  });
}
