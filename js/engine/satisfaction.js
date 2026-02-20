/**
 * satisfaction.js — 만족도 모델
 * numerical-design-v1.md 4절 구현
 *
 * 6개 구성요소 × 생애주기별 가중치 → 종합 만족도
 * + 자연 감쇠 + 예산 효과 + 파급효과
 */

// === Constants ===
const DECAY = -0.6; // 자연 감쇠/턴 — 균등 배분이 겨우 유지, 성장하려면 집중 투자 필요
const ACCEL_SAT = 5.0; // 만족도 변동 가속 계수

// 생애주기별 만족도 구성요소 가중치
const AGE_WEIGHTS = {
  youth:   { economy: 0.30, transport: 0.20, housing: 0.15, safety: 0.10, culture: 0.20, welfare: 0.05 },
  midAge:  { economy: 0.25, transport: 0.15, housing: 0.25, safety: 0.15, culture: 0.10, welfare: 0.10 },
  senior:  { economy: 0.20, transport: 0.15, housing: 0.20, safety: 0.15, culture: 0.15, welfare: 0.15 },
  elderly: { economy: 0.10, transport: 0.15, housing: 0.15, safety: 0.15, culture: 0.15, welfare: 0.30 },
};

// 예산 카테고리 → 만족도 구성요소 매핑
const BUDGET_TO_SATISFACTION = {
  economy:     { economy: 0.8, culture: 0.1, transport: 0.1 },
  transport:   { transport: 0.9, housing: 0.1 },
  culture:     { culture: 0.7, economy: 0.2, housing: 0.1 },
  environment: { safety: 0.5, housing: 0.4, culture: 0.1 },
  education:   { welfare: 0.4, culture: 0.3, housing: 0.3 },
  welfare:     { welfare: 0.7, housing: 0.2, safety: 0.1 },
  renewal:     { housing: 0.5, economy: 0.2, transport: 0.2, safety: 0.1 },
};

// 파급 유형별 전파율
const SPILLOVER_RATE = 0.15;

/**
 * 동 하나의 만족도 업데이트
 * @param {Object} dong - 동 데이터 (mutated)
 * @param {Object} state - 전체 gameState
 * @param {Object} adjacency - 인접 행렬
 * @param {Object} budgetEffects - 카테고리별 예산 효과 계수
 * @returns {Object} dong (수정됨)
 */
export function updateSatisfaction(dong, state, adjacency, budgetEffects = {}, policyEffects = {}) {
  const factors = dong.satisfactionFactors;

  // === 1. 자연 감쇠 ===
  for (const key of Object.keys(factors)) {
    factors[key] += DECAY;
  }

  // === 2. 예산 효과 ===
  // 예산 투자가 감쇠를 상쇄: 적정 수준이면 감쇠와 균형, 초과면 개선, 부족하면 악화
  for (const [budgetCat, effect] of Object.entries(budgetEffects)) {
    const mapping = BUDGET_TO_SATISFACTION[budgetCat];
    if (!mapping) continue;

    // effect = 투자/적정 비율 (1.0 = 적정, >1 = 초과투자, <1 = 부족)
    // 적정 투자 시 감쇠를 상쇄하는 +0.5 효과, 초과 시 추가 개선 (체감감소)
    const baseEffect = 0.5 * effect; // 적정 시 0.5 (감쇠 상쇄)
    const bonusEffect = effect > 1.0 ? (effect - 1.0) * ACCEL_SAT * 0.3 : 0;
    const delta = baseEffect + bonusEffect;

    for (const [satComponent, weight] of Object.entries(mapping)) {
      if (factors[satComponent] !== undefined) {
        factors[satComponent] += delta * weight;
      }
    }
  }

  // === 2.5. 정책 직접 만족도 효과 ===
  const pe = getPolicyEffect(dong.id, policyEffects);
  if (pe.satisfaction) {
    for (const [comp, val] of Object.entries(pe.satisfaction)) {
      if (factors[comp] !== undefined) {
        // 정책 효과는 분기당 적용 (절대값 × 0.25로 분기 스케일)
        factors[comp] += val * 0.25;
      }
    }
  }

  // === 3. 경제 상황 반영 ===
  // 사업체 밀도가 평균보다 높으면 경제 만족도 상승
  const avgBizDensity = state.dongs.reduce((s, d) => s + d.businesses / Math.max(1, d.population), 0) / state.dongs.length;
  const bizDensity = dong.businesses / Math.max(1, dong.population);
  const econDelta = (bizDensity / Math.max(0.01, avgBizDensity) - 1.0) * 2.0;
  factors.economy += clamp(econDelta, -3, 3);

  // 패치 C: 초기값 대비 사업체 감소 → 경제 만족도 절대 페널티
  if (dong._initBiz) {
    const bizDecline = (dong._initBiz - dong.businesses) / dong._initBiz;
    if (bizDecline > 0.05) {
      factors.economy -= bizDecline * 15;
    }
  }

  // 패치 C: 초기값 대비 인구 감소 → 복지/주거 만족도 절대 페널티
  if (dong._initPop) {
    const popDecline = (dong._initPop - dong.population) / dong._initPop;
    if (popDecline > 0.03) {
      factors.welfare -= popDecline * 10;
      factors.housing -= popDecline * 5;
    }
  }

  // 임대료 압력 → 주거 만족도 하락
  if (dong.rentPressure > 0) {
    factors.housing -= dong.rentPressure * 10;
  }

  // 생활인구 과밀 → 안전, 주거 만족도 하락
  const livingPopRatio = (dong.livingPop?.weekdayDay || dong.population) / Math.max(1, dong.population);
  if (livingPopRatio > 2.0) {
    const overcrowdPenalty = (livingPopRatio - 2.0) * 2.0;
    factors.safety -= overcrowdPenalty;
    factors.housing -= overcrowdPenalty * 0.5;
  }

  // 교통 점수 반영
  const avgTransit = state.dongs.reduce((s, d) => s + d.transitScore, 0) / state.dongs.length;
  const transitDelta = (dong.transitScore / Math.max(0.1, avgTransit) - 1.0) * 1.5;
  factors.transport += clamp(transitDelta, -2, 2);

  // === 4. 인접 동 파급효과 ===
  const neighbors = adjacency[dong.id] || {};
  for (const [nId, coeff] of Object.entries(neighbors)) {
    const neighbor = state.dongs.find(d => d.id === nId);
    if (!neighbor) continue;

    for (const key of Object.keys(factors)) {
      const neighborVal = neighbor.satisfactionFactors?.[key] ?? 60;
      const diff = neighborVal - factors[key];
      // 인접 동과의 차이가 크면 약간 수렴
      factors[key] += diff * coeff * SPILLOVER_RATE * 0.1;
    }
  }

  // === 5. 클램프 모든 구성요소 (0~100) ===
  for (const key of Object.keys(factors)) {
    factors[key] = clamp(Math.round(factors[key] * 10) / 10, 0, 100);
  }

  // === 6. 종합 만족도 계산 (인구 가중 평균) ===
  dong.satisfaction = calcWeightedSatisfaction(dong);

  return dong;
}

/**
 * 종합 만족도: 연령별 가중 평균
 */
function calcWeightedSatisfaction(dong) {
  const pop = dong.population;
  if (pop <= 0) return 50;

  const factors = dong.satisfactionFactors;
  const byAge = dong.populationByAge;

  // 각 연령대의 만족도 계산
  let totalWeightedSat = 0;
  let totalPop = 0;

  // 영유아/청소년은 부모(midAge) 만족도 공유
  const childTeenPop = (byAge.child || 0) + (byAge.teen || 0);

  for (const [age, weights] of Object.entries(AGE_WEIGHTS)) {
    let agePop = byAge[age] || 0;
    if (age === 'midAge') agePop += childTeenPop; // 부모 가중

    if (agePop <= 0) continue;

    let ageSat = 0;
    for (const [comp, w] of Object.entries(weights)) {
      ageSat += (factors[comp] || 50) * w;
    }

    totalWeightedSat += ageSat * agePop;
    totalPop += agePop;
  }

  return Math.round(totalWeightedSat / Math.max(1, totalPop));
}

function getPolicyEffect(dongId, policyEffects) {
  const result = {};
  const global = policyEffects.global || {};
  const dongSpecific = policyEffects.byDong?.[dongId] || {};
  for (const source of [global, dongSpecific]) {
    for (const [cat, vals] of Object.entries(source)) {
      if (!result[cat]) result[cat] = {};
      for (const [key, val] of Object.entries(vals)) {
        result[cat][key] = (result[cat][key] || 0) + val;
      }
    }
  }
  return result;
}

// === Helper ===
function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}
