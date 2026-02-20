/**
 * economy.js — 경제 변동 모델
 * numerical-design-v1.md 2절 구현
 *
 * ΔBiz = NewBiz - ClosedBiz
 * + 임대료 압력 (젠트리피케이션 메카닉)
 * + 상권특색 감소 (프랜차이즈화)
 * + 동간 파급효과
 */

// === Constants ===
const BASE_NEW_RATE = 0.022;   // 분기 2.2% 신규 창업
const BASE_CLOSE_RATE = 0.016; // 분기 1.6% 자연 폐업 (순 +0.6% 기본 성장)
const ACCEL_BIZ = 1.0;        // 사업체 변동 계수 (가속 제거)

const RENT_THRESHOLD = 70;       // 상권활력이 70 넘으면 임대료 압력 시작
const RENT_SENSITIVITY = 0.00015; // vitality 100 → 30*0.00015=0.0045 → 0.45% 추가 폐업
const RENT_MAX = 0.012;          // 최대 임대료 압력 1.2% (was 2%)
const FRANCHISE_RATE = 0.015;  // 상권특색 감소 속도 (완화)

// 파급 유형별 전파율
const SPILLOVER_RATES = {
  rent: 0.3,
  tourism: 0.2,
  infrastructure: 0.4,
};

/**
 * 동 하나의 경제 업데이트
 * @param {Object} dong - 동 데이터 (mutated)
 * @param {Object} state - 전체 gameState
 * @param {Object} adjacency - 인접 행렬
 * @param {Object} budgetAlloc - 플레이어 예산 배분 (%)
 * @returns {Object} dong (수정됨)
 */
export function updateEconomy(dong, state, adjacency, budgetAlloc = {}, policyEffects = {}) {
  const biz = dong.businesses;
  if (biz <= 0) return dong;

  // === 1. 수요 요인 (DemandFactor) ===
  const demand = calcDemandFactor(dong, state, adjacency);

  // 정책 보너스: 경제·일자리 예산 배분에 따른 사업체 유치 효과
  const econBudgetPct = budgetAlloc.economy || 15;
  const policyBonus = 1.0 + (econBudgetPct - 15) * 0.01; // 기본 15%에서 ±1%당 1% 보너스

  // 정책 효과: 신규 창업률 보너스
  const pe = getPolicyEffect(dong.id, policyEffects);
  const newBizBonus = pe.economy?.newBizBonus || 0;

  // === 2. 신규 창업 (수요 변동은 완화 적용) ===
  // demand=1.0이면 기본 비율, !=1.0이면 차이의 50%만 반영
  const adjustedDemand = 1.0 + (demand - 1.0) * 0.5;

  // 정책 보너스 체감: 사업체가 초기치를 초과하면 보너스 효율 감소
  let effectiveNewBizBonus = newBizBonus;
  if (newBizBonus > 0 && dong._initBiz && biz > dong._initBiz) {
    const overGrowth = biz / dong._initBiz - 1.0;
    effectiveNewBizBonus *= Math.max(0.2, 1.0 - overGrowth * 2);
  }

  const newBiz = Math.round(biz * (BASE_NEW_RATE + effectiveNewBizBonus) * adjustedDemand * policyBonus);

  // === 3. 폐업 (자연 비율) ===
  const rentPressure = dong.rentPressure || 0;
  const competitionPressure = calcCompetition(dong, state);
  const closedBiz = Math.round(biz * (BASE_CLOSE_RATE + rentPressure + competitionPressure));

  // === 4. 사업체 수 업데이트 (순변동에 가속 적용) ===
  const netChange = (newBiz - closedBiz) * ACCEL_BIZ;
  dong.businesses = Math.max(1, biz + Math.round(netChange));

  // 종사자 비례 조정 (사업체당 평균 종사자 유지)
  if (biz > 0) {
    dong.workers = Math.round(dong.workers * (dong.businesses / biz));
  }

  // === 5. 상권활력 업데이트 ===
  dong.commerceVitality = calcCommerceVitality(dong, state);

  // === 6. 임대료 압력 업데이트 ===
  updateRentPressure(dong, adjacency, state);

  // 정책 효과: 임대료 압력 직접 조정
  const rentDelta = pe.economy?.rentPressureDelta || pe.economy_side?.rentPressureDelta || 0;
  if (rentDelta !== 0) {
    dong.rentPressure = Math.round(clamp(dong.rentPressure + rentDelta, 0, RENT_MAX) * 10000) / 10000;
  }

  // === 7. 상권특색 감소 (프랜차이즈화) ===
  updateCommerceCharacter(dong);

  // 정책 효과: 상권특색 보너스
  const charBonus = pe.economy?.commerceCharacterBonus || 0;
  if (charBonus !== 0) {
    dong.commerceCharacter = clamp(dong.commerceCharacter + charBonus * 0.25, 20, 100);
    dong.commerceCharacter = Math.round(dong.commerceCharacter * 10) / 10;
  }

  // 정책 효과: 종사자 성장
  const workerGrowth = pe.economy?.workerGrowth || 0;
  if (workerGrowth > 0) {
    dong.workers = Math.round(dong.workers * (1 + workerGrowth));
  }

  return dong;
}

/**
 * 수요 요인 계산
 * 생활인구(40%), 상주인구(30%), 교통접근성(20%), 인접 파급(10%)
 */
function calcDemandFactor(dong, state, adjacency) {
  const avgLivingPop = state.dongs.reduce((s, d) => s + (d.livingPop?.weekdayDay || d.population), 0) / state.dongs.length;
  const avgPop = state.dongs.reduce((s, d) => s + d.population, 0) / state.dongs.length;
  const avgTransit = state.dongs.reduce((s, d) => s + d.transitScore, 0) / state.dongs.length;

  // 비율 계산 후 로그 스케일로 극단값 완화
  const livingPopScore = softCap((dong.livingPop?.weekdayDay || dong.population) / Math.max(1, avgLivingPop));
  const popScore = softCap(dong.population / Math.max(1, avgPop));
  const transitScore = softCap(dong.transitScore / Math.max(1, avgTransit));

  // 인접 동 파급
  let adjSpill = 0;
  const neighbors = adjacency[dong.id] || {};
  for (const [nId, coeff] of Object.entries(neighbors)) {
    const neighbor = state.dongs.find(d => d.id === nId);
    if (neighbor) {
      const nDemand = (neighbor.livingPop?.weekdayDay || neighbor.population) / Math.max(1, avgLivingPop);
      adjSpill += coeff * 0.2 * (nDemand - 1.0);
    }
  }

  return clamp(
    0.4 * livingPopScore + 0.3 * popScore + 0.2 * transitScore + 0.1 * (1.0 + adjSpill),
    0.8, // 기본 서비스 수요 하한
    1.3  // 과열 방지 상한
  );
}

/**
 * 경쟁 압력: 사업체 밀도가 너무 높으면 폐업 증가
 */
function calcCompetition(dong, state) {
  const avgDensity = state.dongs.reduce((s, d) => s + d.businesses / Math.max(1, d.population), 0) / state.dongs.length;
  const density = dong.businesses / Math.max(1, dong.population);
  const excess = density / Math.max(0.01, avgDensity) - 1.0;
  return excess > 0 ? Math.min(0.005, excess * 0.001) : 0; // max 0.5% additional close rate
}

/**
 * 상권활력: 사업체밀도 기반 정규화 (0~100)
 */
function calcCommerceVitality(dong, state) {
  const maxDensity = Math.max(...state.dongs.map(d => d.businesses / Math.max(1, d.population)));
  const density = dong.businesses / Math.max(1, dong.population);
  return Math.round(clamp((density / Math.max(0.01, maxDensity)) * 100, 0, 100));
}

/**
 * 임대료 압력: 상권활력 > RENT_THRESHOLD이면 시작
 * + 인접 동 임대료 전파
 */
function updateRentPressure(dong, adjacency, state) {
  // 자체 압력
  let pressure = Math.max(0, (dong.commerceVitality - RENT_THRESHOLD) * RENT_SENSITIVITY);

  // 인접 동 전파
  const neighbors = adjacency[dong.id] || {};
  for (const [nId, coeff] of Object.entries(neighbors)) {
    const neighbor = state.dongs.find(d => d.id === nId);
    if (neighbor && neighbor.rentPressure > 0) {
      pressure += coeff * neighbor.rentPressure * SPILLOVER_RATES.rent;
    }
  }

  dong.rentPressure = Math.round(clamp(pressure, 0, RENT_MAX) * 10000) / 10000;
}

/**
 * 상권특색: 임대료 압력이 누적되면 프랜차이즈화 → 특색 감소
 */
function updateCommerceCharacter(dong) {
  if (dong.rentPressure > 0) {
    const decay = dong.rentPressure * FRANCHISE_RATE * 100;
    dong.commerceCharacter = Math.max(20, dong.commerceCharacter - decay);
  }
  // 임대료 압력이 없으면 약간 회복
  if (dong.rentPressure === 0 && dong.commerceCharacter < 80) {
    dong.commerceCharacter = Math.min(80, dong.commerceCharacter + 0.2);
  }
  dong.commerceCharacter = Math.round(dong.commerceCharacter * 10) / 10;
}

/**
 * 동에 적용되는 정책 효과 가져오기 (global + byDong 합산)
 */
function getPolicyEffect(dongId, policyEffects) {
  const result = {};
  const global = policyEffects.global || {};
  const dongSpecific = policyEffects.byDong?.[dongId] || {};

  // 글로벌과 동별 효과 병합
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

// === Helpers ===
function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

/**
 * 비율값의 극단 완화: 1.0 근처에서는 선형, 극단에서 로그 압축
 * ratio=1 → 1, ratio=3 → ~1.6, ratio=0.3 → ~0.6
 */
function softCap(ratio) {
  if (ratio <= 0) return 0.1;
  if (ratio <= 1) return ratio;
  return 1.0 + Math.log(ratio); // ln(1)=0, ln(2)=0.69, ln(3)=1.1
}
