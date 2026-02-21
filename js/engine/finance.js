/**
 * finance.js — 재정 모델
 * numerical-design-v1.md 3절 구현
 *
 * 세입: 지방세 + 조정교부금 + 보조금 + 세외수입
 * 세출: 의무지출(50%) + 자유예산(50%) → 7카테고리 배분
 * 재정자립도 업데이트
 */

// === Constants ===
const ACCEL_FINANCE = 2.0; // 재정 변동 가속 계수
const MANDATORY_RATIO = 0.50; // 의무지출 비율

// 기본 세입 (턴당, 억원)
const BASE_REVENUE = {
  localTax: 613,
  grantFromCity: 700,
  subsidy: 750,
  otherIncome: 125,
};

const BASE_POP = 357232; // 초기 인구
const BASE_BIZ = 55516;  // 초기 사업체
const TAX_DECLINE_RATE = -0.004; // 턴당 0.4% 자연 감소 추세
// 원래 -0.5%였으나 48턴에서 세수 악순환이 너무 심해 완화

// 예산 효율 체감감소 (카테고리별 적정 비율)
const OPTIMAL_PCT = {
  economy: 15,
  transport: 15,
  culture: 10,
  environment: 10,
  education: 15,
  welfare: 20,
  renewal: 15,
};

/**
 * 재정 업데이트 (세입, 세출, 자립도)
 * @param {Object} state - 전체 gameState
 * @param {Object} budgetAlloc - 플레이어 예산 배분 (%)
 * @returns {Object} 업데이트된 finance 객체
 */
export function updateFinance(state, budgetAlloc = {}, policyEffects = {}) {
  const finance = { ...state.finance };
  const totalPop = state.dongs.reduce((s, d) => s + d.population, 0);
  const totalBiz = state.dongs.reduce((s, d) => s + d.businesses, 0);
  const totalWorkers = state.dongs.reduce((s, d) => s + d.workers, 0);

  // === 1. 세입 계산 ===

  // 정책 효과: 세수 보너스
  const globalPE = policyEffects.global || {};
  const localTaxBonus = globalPE.finance?.localTaxBonus || 0;

  // 지방세: 사업체/종사자 변동 반영 + 자연 감소 추세 + 정책 보너스
  const bizGrowth = (totalBiz - BASE_BIZ) / BASE_BIZ;
  const taxGrowth = (bizGrowth * 0.3 + TAX_DECLINE_RATE + localTaxBonus) * ACCEL_FINANCE;
  finance.revenue.localTax = Math.round(BASE_REVENUE.localTax * (1 + taxGrowth));

  // 조정교부금: 인구 비례
  const popRatio = totalPop / BASE_POP;
  finance.revenue.grantFromCity = Math.round(BASE_REVENUE.grantFromCity * popRatio);

  // 보조금: 기본 유지 (이벤트/정책에 의한 특별 보조금은 별도)
  finance.revenue.subsidy = BASE_REVENUE.subsidy;

  // 세외수입: 상권활력 평균에 연동
  const avgVitality = state.dongs.reduce((s, d) => s + d.commerceVitality, 0) / state.dongs.length;
  finance.revenue.otherIncome = Math.round(BASE_REVENUE.otherIncome * (0.8 + avgVitality * 0.004));

  // 총예산
  const totalRevenue = finance.revenue.localTax + finance.revenue.grantFromCity
    + finance.revenue.subsidy + finance.revenue.otherIncome;
  finance.totalBudget = totalRevenue;

  // === 2. 세출 구조 ===
  const mandatoryDelta = globalPE.finance?.mandatorySpendDelta || 0;
  finance.mandatorySpend = Math.round(totalRevenue * MANDATORY_RATIO) + mandatoryDelta;
  finance.freeBudget = totalRevenue - finance.mandatorySpend;

  // 정책 비용 차감 (딜레이 중에도 예산 소요)
  const policyCost = (state.activePolicies || [])
    .reduce((s, ap) => s + ap.policy.cost, 0);
  finance.policyCost = policyCost;
  finance.freeBudget = Math.max(0, finance.freeBudget - policyCost);

  // 배분 비율 업데이트
  finance.allocation = { ...budgetAlloc };

  // === 3. 재정자립도 ===
  // 자체수입(지방세+세외수입) / 총세입
  const selfRevenue = finance.revenue.localTax + finance.revenue.otherIncome;
  finance.fiscalIndependence = Math.round((selfRevenue / Math.max(1, totalRevenue)) * 100);

  return finance;
}

/**
 * 예산 효율 체감 감소 계산
 * 같은 카테고리에 집중하면 효율 감소
 * EffectiveSpend = RawSpend × (1 / (1 + 0.3 × (RawSpend / OptimalSpend - 1)))
 * @param {string} category - 카테고리 ID
 * @param {number} rawPct - 배분 비율 (%)
 * @returns {number} 유효 비율 (%)
 */
export function calcEffectiveSpend(category, rawPct) {
  const optimal = OPTIMAL_PCT[category] || 15;
  if (rawPct <= optimal) return rawPct; // 적정 이하면 그대로
  const ratio = rawPct / optimal;
  return rawPct * (1 / (1 + 0.3 * (ratio - 1)));
}

/**
 * 예산 배분 → 동별 효과 계수 계산
 * @param {Object} budgetAlloc - 배분 비율 (%)
 * @param {number} freeBudget - 자유예산 총액 (억원)
 * @returns {Object} 카테고리별 효과 계수
 */
export function calcBudgetEffects(budgetAlloc, freeBudget) {
  const effects = {};
  for (const [cat, pct] of Object.entries(budgetAlloc)) {
    const effectivePct = calcEffectiveSpend(cat, pct);
    const amount = freeBudget * effectivePct / 100;
    // 효과 계수: 적정 금액 대비 투자 비율
    const optimalAmount = freeBudget * (OPTIMAL_PCT[cat] || 15) / 100;
    effects[cat] = amount / Math.max(1, optimalAmount);
  }
  return effects;
}
