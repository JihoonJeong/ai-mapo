/**
 * pledge.js — 공약 선택 + 추적 UI
 */

const PLEDGES = [
  { id: 'population_rebound', name: '인구 반등', desc: '인구 감소율 5% 이내 억제', difficulty: 3 },
  { id: 'youth_settlement', name: '청년 정착', desc: '청년(20-34) 비율 1%p 상승', difficulty: 2 },
  { id: 'tourism_coexist', name: '관광 상생', desc: '서교·합정·연남 만족도 >= 65 AND 상권활력 >= 60', difficulty: 3 },
  { id: 'elderly_care', name: '고령 돌봄', desc: '65+ 만족도 구 평균 >= 60', difficulty: 2 },
  { id: 'fiscal_health', name: '재정 건전', desc: '재정자립도 35% 달성', difficulty: 3 },
  { id: 'commerce_diversity', name: '상권 다양성', desc: '상권특색 구 평균 >= 80', difficulty: 2 },
  { id: 'transport_improve', name: '교통 개선', desc: '교통 만족도 구 평균 >= 65', difficulty: 1 },
  { id: 'green_mapo', name: '녹색 마포', desc: '환경 만족도 구 평균 >= 65', difficulty: 1 },
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
    case 'population_rebound': {
      // 감소율 5% 이내 = 95% 이상 유지하면 달성
      const ratio = totalPop / initialPop;
      return Math.min(100, (ratio / 0.95) * 100);
    }

    case 'youth_settlement': {
      const currentYouth = state.dongs.reduce((s, d) => s + d.populationByAge.youth, 0) / totalPop * 100;
      const initialYouth = initialState.dongs.reduce((s, d) => s + d.populationByAge.youth, 0) / initialPop * 100;
      return Math.min(100, ((currentYouth - initialYouth) / 1.0) * 100);
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
      return Math.min(100, (avgElderlySat / 60) * 100);
    }

    case 'fiscal_health':
      return Math.min(100, (state.finance.fiscalIndependence / 35) * 100);

    case 'commerce_diversity': {
      const avg = state.dongs.reduce((s, d) => s + d.commerceCharacter, 0) / state.dongs.length;
      return Math.min(100, (avg / 80) * 100);
    }

    case 'transport_improve': {
      const avg = state.dongs.reduce((s, d) => s + d.satisfactionFactors.transport, 0) / state.dongs.length;
      return Math.min(100, (avg / 65) * 100);
    }

    case 'green_mapo': {
      const avg = state.dongs.reduce((s, d) => s + (d.satisfactionFactors.environment || d.satisfactionFactors.safety), 0) / state.dongs.length;
      return Math.min(100, (avg / 65) * 100);
    }

    default: return 0;
  }
}

/**
 * 공약 달성 여부 판정 (progress >= 99.5 — 부동소수점 오차 허용)
 */
export function checkAchieved(pledgeId, state) {
  return calcProgress(pledgeId, state) >= 99.5;
}

/**
 * 최종 점수 계산
 * 4개 KPI (60점 만점) + 공약 리스크-리워드 (달성 +10, 미달 -5, 최대 4개)
 * 만점 = KPI 60 + 공약 40 = 100 (S등급)
 * @returns {{ total, grade, kpis: { label, score, max, detail }[], pledgeResults }}
 */
export function calcFinalScore(state) {
  if (!initialState) return { total: 0, grade: 'F', kpis: [], pledgeResults: [] };

  const initialPop = initialState.dongs.reduce((s, d) => s + d.population, 0);
  const totalPop = state.dongs.reduce((s, d) => s + d.population, 0);
  const popChangeRate = ((totalPop - initialPop) / initialPop) * 100;

  const initialFiscal = initialState.finance.fiscalIndependence || 28;
  const currentFiscal = state.finance.fiscalIndependence || 28;
  const fiscalDelta = currentFiscal - initialFiscal;

  const avgSat = state.dongs.reduce((s, d) => s + d.satisfaction, 0) / state.dongs.length;

  const satValues = state.dongs.map(d => d.satisfaction);
  const satMean = satValues.reduce((s, v) => s + v, 0) / satValues.length;
  const satStdDev = Math.sqrt(satValues.reduce((s, v) => s + (v - satMean) ** 2, 0) / satValues.length);

  // 4개 KPI (총 60점)
  const kpis = [
    {
      id: 'population', label: '인구 변화', max: 15,
      score: linearScore(popChangeRate, -12, -7, -2, [0, 5, 12], 15),
      detail: `${popChangeRate >= 0 ? '+' : ''}${popChangeRate.toFixed(1)}%`,
    },
    {
      id: 'economy_fiscal', label: '경제·재정', max: 15,
      score: linearScore(fiscalDelta, 0, 7, 14, [0, 6, 15], 15),
      detail: `재정자립도 ${fiscalDelta >= 0 ? '+' : ''}${fiscalDelta.toFixed(1)}%p`,
    },
    {
      id: 'satisfaction', label: '주민 만족도', max: 20,
      score: linearScore(avgSat, 42, 55, 72, [0, 10, 20], 20),
      detail: `평균 ${avgSat.toFixed(0)}`,
    },
    {
      id: 'balance', label: '균형 발전', max: 10,
      score: satStdDev <= 3 ? 10 : satStdDev <= 5 ? 7 : satStdDev <= 8 ? 4 : satStdDev <= 12 ? 1 : 0,
      detail: `σ = ${satStdDev.toFixed(1)}`,
    },
  ];

  // 공약: 달성 +10, 미달 -5
  const pledges = state.meta.pledges || [];
  const pledgeResults = pledges.map(id => {
    const pledge = PLEDGES.find(p => p.id === id);
    const achieved = checkAchieved(id, state);
    const progress = calcProgress(id, state);
    return {
      id, name: pledge?.name || id, achieved, progress: Math.round(progress),
      score: achieved ? 10 : -5,
    };
  });

  const kpiTotal = kpis.reduce((s, k) => s + k.score, 0);
  const pledgeTotal = pledgeResults.reduce((s, p) => s + p.score, 0);
  const total = kpiTotal + pledgeTotal;

  const grade = total >= 85 ? 'S' : total >= 70 ? 'A' : total >= 55 ? 'B' : total >= 40 ? 'C' : total >= 25 ? 'D' : 'F';

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
