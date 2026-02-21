/**
 * pledge.js — 공약 선택 + 추적 UI
 */

const PLEDGES = [
  { id: 'population_rebound', name: '인구 반등', desc: '48턴 후 총인구 >= 초기값', difficulty: 3 },
  { id: 'youth_settlement', name: '청년 정착', desc: '청년(20-34) 비율 2%p 상승', difficulty: 2 },
  { id: 'tourism_coexist', name: '관광 상생', desc: '서교·합정·연남 만족도 >= 65 AND 상권활력 >= 60', difficulty: 3 },
  { id: 'elderly_care', name: '고령 돌봄', desc: '65+ 만족도 구 평균 >= 70', difficulty: 2 },
  { id: 'fiscal_health', name: '재정 건전', desc: '재정자립도 30% 달성', difficulty: 3 },
  { id: 'commerce_diversity', name: '상권 다양성', desc: '상권특색 구 평균 >= 75', difficulty: 2 },
  { id: 'transport_improve', name: '교통 개선', desc: '교통 만족도 구 평균 >= 70', difficulty: 1 },
  { id: 'green_mapo', name: '녹색 마포', desc: '환경 만족도 구 평균 >= 70', difficulty: 1 },
];

let selectedPledges = [];
let initialState = null;

export function showPledgeSelection(onComplete) {
  const modal = document.getElementById('modal-overlay');
  const content = document.getElementById('modal-content');
  if (!modal || !content) return;

  selectedPledges = [];

  content.innerHTML = `
    <div class="modal-title">공약 선택</div>
    <div class="modal-subtitle">4년 임기 동안 달성할 공약 1~4개를 선택하세요</div>
    <div class="pledge-grid" id="pledge-options"></div>
    <div style="text-align:center;margin-bottom:12px;font-size:12px;color:var(--text-muted)">
      선택: <span id="pledge-count">0</span>/4
    </div>
    <button class="modal-btn" id="pledge-confirm" disabled>공약 확정 (최소 1개 선택)</button>
  `;

  const optionsEl = document.getElementById('pledge-options');
  PLEDGES.forEach(p => {
    const div = document.createElement('div');
    div.className = 'pledge-option';
    div.dataset.id = p.id;
    div.innerHTML = `
      <div class="pledge-option-name">${p.name}</div>
      <div class="pledge-option-desc">${p.desc}</div>
      <div class="pledge-option-diff">${'★'.repeat(p.difficulty)}${'☆'.repeat(3 - p.difficulty)}</div>
    `;
    div.addEventListener('click', () => togglePledge(p.id, div));
    optionsEl.appendChild(div);
  });

  document.getElementById('pledge-confirm').addEventListener('click', () => {
    if (selectedPledges.length > 0) {
      modal.classList.remove('active');
      onComplete(selectedPledges);
    }
  });

  modal.classList.add('active');
}

function togglePledge(id, el) {
  const idx = selectedPledges.indexOf(id);
  if (idx >= 0) {
    selectedPledges.splice(idx, 1);
    el.classList.remove('selected');
  } else if (selectedPledges.length < 4) {
    selectedPledges.push(id);
    el.classList.add('selected');
  }

  document.getElementById('pledge-count').textContent = selectedPledges.length;
  const btn = document.getElementById('pledge-confirm');
  if (btn) btn.disabled = selectedPledges.length === 0;

  // Disable unselected if at max
  document.querySelectorAll('.pledge-option').forEach(opt => {
    if (selectedPledges.length >= 4 && !selectedPledges.includes(opt.dataset.id)) {
      opt.classList.add('disabled');
    } else {
      opt.classList.remove('disabled');
    }
  });
}

export function initPledgeBar(pledgeIds, state) {
  initialState = JSON.parse(JSON.stringify(state));
  renderPledgeBar(pledgeIds, state);
}

export function renderPledgeBar(pledgeIds, state) {
  const bar = document.getElementById('pledge-bar');
  if (!bar) return;

  bar.innerHTML = pledgeIds.map(id => {
    const pledge = PLEDGES.find(p => p.id === id);
    if (!pledge) return '';
    const progress = calcProgress(id, state);
    return `
      <div class="pledge-item">
        <span>${pledge.name}</span>
        <div class="pledge-progress">
          <div class="pledge-progress-fill" style="width:${Math.min(100, Math.max(0, progress))}%"></div>
        </div>
        <span>${Math.round(progress)}%</span>
      </div>
    `;
  }).join('');
}

export { PLEDGES };

export function calcProgress(pledgeId, state) {
  if (!initialState) return 0;

  const totalPop = state.dongs.reduce((s, d) => s + d.population, 0);
  const initialPop = initialState.dongs.reduce((s, d) => s + d.population, 0);

  switch (pledgeId) {
    case 'population_rebound':
      return (totalPop / initialPop) * 100;

    case 'youth_settlement': {
      const currentYouth = state.dongs.reduce((s, d) => s + d.populationByAge.youth, 0) / totalPop * 100;
      const initialYouth = initialState.dongs.reduce((s, d) => s + d.populationByAge.youth, 0) / initialPop * 100;
      return Math.min(100, ((currentYouth - initialYouth) / 2.0) * 100);
    }

    case 'tourism_coexist': {
      const targets = ['seogyo', 'hapjeong', 'yeonnam'];
      const satOk = targets.every(id => (state.dongs.find(d => d.id === id)?.satisfaction || 0) >= 65);
      const vitOk = targets.every(id => (state.dongs.find(d => d.id === id)?.commerceVitality || 0) >= 60);
      const satProg = targets.reduce((s, id) => s + Math.min(100, (state.dongs.find(d => d.id === id)?.satisfaction || 0) / 65 * 100), 0) / 3;
      const vitProg = targets.reduce((s, id) => s + Math.min(100, (state.dongs.find(d => d.id === id)?.commerceVitality || 0) / 60 * 100), 0) / 3;
      return (satOk && vitOk) ? 100 : (satProg + vitProg) / 2;
    }

    case 'elderly_care': {
      const avgElderlySat = state.dongs.reduce((s, d) => {
        const elderlyPct = d.populationByAge.elderly / d.population;
        return s + d.satisfactionFactors.welfare * elderlyPct;
      }, 0) / state.dongs.reduce((s, d) => s + d.populationByAge.elderly / d.population, 0);
      return Math.min(100, (avgElderlySat / 70) * 100);
    }

    case 'fiscal_health':
      return Math.min(100, (state.finance.fiscalIndependence / 30) * 100);

    case 'commerce_diversity': {
      const avg = state.dongs.reduce((s, d) => s + d.commerceCharacter, 0) / state.dongs.length;
      return Math.min(100, (avg / 75) * 100);
    }

    case 'transport_improve': {
      const avg = state.dongs.reduce((s, d) => s + d.satisfactionFactors.transport, 0) / state.dongs.length;
      return Math.min(100, (avg / 70) * 100);
    }

    case 'green_mapo': {
      const avg = state.dongs.reduce((s, d) => s + (d.satisfactionFactors.environment || d.satisfactionFactors.safety), 0) / state.dongs.length;
      return Math.min(100, (avg / 70) * 100);
    }

    default: return 0;
  }
}

/**
 * 공약 달성 여부 판정 (progress >= 100)
 */
export function checkAchieved(pledgeId, state) {
  return calcProgress(pledgeId, state) >= 100;
}

/**
 * 최종 점수 계산 — numerical-design-v1.md §8.3
 * 6개 KPI (70점 만점) + 공약 리스크-리워드 (최대 +60)
 * @returns {{ total, grade, kpis: { label, score, max, detail }[], pledgeResults }}
 */
export function calcFinalScore(state) {
  if (!initialState) return { total: 0, grade: 'F', kpis: [], pledgeResults: [] };

  const initialPop = initialState.dongs.reduce((s, d) => s + d.population, 0);
  const totalPop = state.dongs.reduce((s, d) => s + d.population, 0);
  const popChangeRate = ((totalPop - initialPop) / initialPop) * 100;

  const initialBiz = initialState.dongs.reduce((s, d) => s + d.businesses, 0);
  const totalBiz = state.dongs.reduce((s, d) => s + d.businesses, 0);
  const initialWorkers = initialState.dongs.reduce((s, d) => s + d.workers, 0);
  const totalWorkers = state.dongs.reduce((s, d) => s + d.workers, 0);
  const econGrowth = ((totalBiz - initialBiz) / initialBiz * 100 + (totalWorkers - initialWorkers) / initialWorkers * 100) / 2;

  const initialTax = initialState.finance.revenue?.localTax || 613;
  const currentTax = state.finance.revenue?.localTax || 613;
  const taxChange = ((currentTax - initialTax) / initialTax) * 100;

  const initialFiscal = initialState.finance.fiscalIndependence || 28;
  const currentFiscal = state.finance.fiscalIndependence || 28;
  const fiscalDelta = currentFiscal - initialFiscal;

  const avgSat = state.dongs.reduce((s, d) => s + d.satisfaction, 0) / state.dongs.length;

  const satValues = state.dongs.map(d => d.satisfaction);
  const satMean = satValues.reduce((s, v) => s + v, 0) / satValues.length;
  const satStdDev = Math.sqrt(satValues.reduce((s, v) => s + (v - satMean) ** 2, 0) / satValues.length);

  // KPI scoring with linear interpolation
  // Design doc thresholds are anchor points; we extend linearly to max
  const kpis = [
    {
      id: 'population', label: '인구 변화', max: 15,
      score: linearScore(popChangeRate, -12, -2, 5, [-5, 0, 15], 15),
      detail: `${popChangeRate >= 0 ? '+' : ''}${popChangeRate.toFixed(1)}%`,
    },
    {
      id: 'economy', label: '경제 성장', max: 5,
      score: linearScore(econGrowth, -3, 0, 10, [0, 2, 5], 5),
      detail: `${econGrowth >= 0 ? '+' : ''}${econGrowth.toFixed(1)}%`,
    },
    {
      id: 'tax', label: '세수 증감', max: 5,
      score: linearScore(taxChange, -5, 0, 10, [0, 2, 5], 5),
      detail: `${taxChange >= 0 ? '+' : ''}${taxChange.toFixed(1)}%`,
    },
    {
      id: 'fiscal', label: '재정 건전성', max: 10,
      score: linearScore(fiscalDelta, -3, 0, 7, [0, 5, 10], 10),
      detail: `${fiscalDelta >= 0 ? '+' : ''}${fiscalDelta.toFixed(1)}%p`,
    },
    {
      id: 'satisfaction', label: '주민 만족도', max: 12,
      score: linearScore(avgSat, 42, 52, 72, [0, 8, 12], 12),
      detail: `평균 ${avgSat.toFixed(0)}`,
    },
    {
      id: 'balance', label: '균형 발전', max: 10,
      score: satStdDev < 10 ? 10 : satStdDev < 15 ? 5 : satStdDev > 20 ? 0 : Math.round(5 * (20 - satStdDev) / 5),
      detail: `σ = ${satStdDev.toFixed(1)}`,
    },
  ];

  // Pledge risk-reward
  const pledges = state.meta.pledges || [];
  const pledgeResults = pledges.map(id => {
    const pledge = PLEDGES.find(p => p.id === id);
    const achieved = checkAchieved(id, state);
    const progress = calcProgress(id, state);
    return {
      id, name: pledge?.name || id, achieved, progress: Math.round(progress),
      score: achieved ? 15 : -20,
    };
  });

  const kpiTotal = kpis.reduce((s, k) => s + k.score, 0);
  const pledgeTotal = pledgeResults.reduce((s, p) => s + p.score, 0);
  const total = kpiTotal + pledgeTotal;

  const grade = total >= 100 ? 'S' : total >= 80 ? 'A' : total >= 60 ? 'B' : total >= 40 ? 'C' : total >= 20 ? 'D' : 'F';

  return { total, grade, kpis, pledgeResults, kpiTotal, pledgeTotal };
}

/**
 * Linear interpolation for scoring
 * Given value, three thresholds (low, mid, high) and corresponding scores
 */
function linearScore(value, low, mid, high, scores, max) {
  if (value <= low) return scores[0];
  if (value >= high) return scores[2];
  if (value <= mid) {
    const t = (value - low) / (mid - low);
    return Math.round(scores[0] + t * (scores[1] - scores[0]));
  }
  const t = (value - mid) / (high - mid);
  return Math.min(max, Math.round(scores[1] + t * (scores[2] - scores[1])));
}
