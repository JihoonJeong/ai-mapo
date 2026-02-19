/**
 * population.js — 인구 변동 모델
 * numerical-design-v1.md 1절 구현
 *
 * ΔPop = Natural + Migration + Displacement
 */

// === Constants ===
const NATURAL_RATE = -0.002; // 연간 자연감소율 (서울 평균)
const ACCEL_MIGRATION = 2.0; // 이동 가속 계수 (4.0 → 2.0으로 하향)
const MAX_CHANGE_RATE = 0.03; // 단일 턴 최대 변동 ±3%

// 생애주기별 이동성 계수
const AGE_MOBILITY = {
  child: 0.0,   // 부모 따라감
  teen: 0.0,    // 부모 따라감
  youth: 1.5,   // 일자리, 임대료, 문화
  midAge: 1.0,  // 교육, 주거, 통근
  senior: 0.6,  // 안정성, 의료
  elderly: 0.3, // 의료, 복지, 커뮤니티
};

// Pull factor 가중치
const PULL_WEIGHTS = {
  jobs: 0.30,
  housing: 0.25,
  infra: 0.20,
  safety: 0.15,
  education: 0.10,
};

/**
 * 동 하나의 인구 업데이트 (전체 순서 중 3단계)
 * @param {Object} dong - 동 데이터 (mutated)
 * @param {Object} state - 전체 gameState
 * @param {Object} adjacency - 인접 행렬
 * @returns {Object} dong (수정됨)
 */
export function updatePopulation(dong, state, adjacency, policyEffects = {}) {
  const pop = dong.population;
  if (pop <= 0) return dong;

  // (A) 자연 변동
  const natural = Math.round(pop * NATURAL_RATE * 0.25); // 분기 단위

  // (B) 전입/전출
  let pull = calcMigrationPull(dong, state, adjacency);

  // 정책 효과: 인구 유입 보너스
  const pe = getPolicyEffect(dong.id, policyEffects);
  if (pe.population) {
    for (const [age, bonus] of Object.entries(pe.population)) {
      if (age === 'displacement') continue; // 강제이주는 별도 처리
      // 직접 pull에 반영 (분기 스케일)
      pull += bonus * 0.25;
    }
  }

  // 수용력 한계: 초기 인구 대비 과밀하면 유입 억제
  // _initPop은 simulation.js에서 첫 턴에 설정
  if (dong._initPop && pull > 0) {
    const growthRatio = pop / dong._initPop;
    if (growthRatio > 1.1) { // 초기 대비 10% 이상 증가 시 억제
      pull *= Math.max(0.05, 1.0 - (growthRatio - 1.1) * 2);
    }
  }

  // 연령별 이동 계산
  const ageGroups = ['youth', 'midAge', 'senior', 'elderly'];
  const ageMigration = {};
  let totalMigration = 0;

  for (const age of ageGroups) {
    const agePop = dong.populationByAge[age] || 0;
    if (agePop <= 0) continue;

    const raw = agePop * pull * ACCEL_MIGRATION * AGE_MOBILITY[age];
    const clamped = clamp(raw, -agePop * MAX_CHANGE_RATE, agePop * MAX_CHANGE_RATE);
    ageMigration[age] = Math.round(clamped);
    totalMigration += ageMigration[age];
  }

  // 영유아/청소년은 중장년(midAge) 이동에 비례
  const midAgeRate = dong.populationByAge.midAge > 0
    ? (ageMigration.midAge || 0) / dong.populationByAge.midAge
    : 0;
  ageMigration.child = Math.round((dong.populationByAge.child || 0) * midAgeRate);
  ageMigration.teen = Math.round((dong.populationByAge.teen || 0) * midAgeRate);
  totalMigration += ageMigration.child + ageMigration.teen;

  // 전체 인구 변동 클램프
  const totalDelta = clamp(natural + totalMigration, -pop * MAX_CHANGE_RATE, pop * MAX_CHANGE_RATE);
  const scale = (natural + totalMigration) !== 0
    ? totalDelta / (natural + totalMigration)
    : 1;

  // 연령별 인구 업데이트
  for (const age of Object.keys(dong.populationByAge)) {
    const ageDelta = age in ageMigration
      ? Math.round((ageMigration[age] + natural * (dong.populationByAge[age] / pop)) * scale)
      : Math.round(natural * (dong.populationByAge[age] / pop) * scale);
    dong.populationByAge[age] = Math.max(0, dong.populationByAge[age] + ageDelta);
  }

  // 총 인구 = 연령별 합산
  dong.population = Object.values(dong.populationByAge).reduce((s, v) => s + v, 0);

  // 정책 효과: 강제이주 (재개발 등)
  if (pe.population?.displacement && pe.population.displacement < 0) {
    const displacePct = pe.population.displacement * 0.25; // 분기 스케일
    const displaced = Math.round(dong.population * Math.abs(displacePct));
    for (const age of Object.keys(dong.populationByAge)) {
      const ratio = dong.populationByAge[age] / Math.max(1, dong.population);
      dong.populationByAge[age] = Math.max(0, dong.populationByAge[age] - Math.round(displaced * ratio));
    }
    dong.population = Object.values(dong.populationByAge).reduce((s, v) => s + v, 0);
  }

  // 세대 수: 인구 변화의 30%만 반영 (주택 공급은 느리게 변화)
  if (pop > 0) {
    const popRatio = dong.population / pop;
    dong.households = Math.round(dong.households * (0.7 + 0.3 * popRatio));
  }

  return dong;
}

/**
 * Migration pull 계산 (-1 ~ +1 범위)
 */
function calcMigrationPull(dong, state, adjacency) {
  const avgSat = state.dongs.reduce((s, d) => s + d.satisfaction, 0) / state.dongs.length;
  const avgBizDensity = state.dongs.reduce((s, d) => s + d.businesses / Math.max(1, d.population), 0) / state.dongs.length;
  const avgTransit = state.dongs.reduce((s, d) => s + d.transitScore, 0) / state.dongs.length;

  // (1) 일자리 접근성: 종사자 비율 + 인접 동 가중
  const workerRatio = dong.workers / Math.max(1, dong.population);
  const avgWorkerRatio = state.dongs.reduce((s, d) => s + d.workers / Math.max(1, d.population), 0) / state.dongs.length;
  const jobScore = normalize(workerRatio, avgWorkerRatio, 0.5);

  // 인접 동 일자리 가중
  let adjJobBonus = 0;
  const neighbors = adjacency[dong.id] || {};
  for (const [nId, coeff] of Object.entries(neighbors)) {
    const neighbor = state.dongs.find(d => d.id === nId);
    if (neighbor) {
      adjJobBonus += coeff * 0.3 * (neighbor.workers / Math.max(1, neighbor.population) - avgWorkerRatio);
    }
  }

  // Use current averages as center (relative migration — some gain, some lose)
  const avgHousing = state.dongs.reduce((s, d) => s + d.satisfactionFactors.housing, 0) / state.dongs.length;
  const avgCulture = state.dongs.reduce((s, d) => s + d.satisfactionFactors.culture, 0) / state.dongs.length;
  const avgSafety = state.dongs.reduce((s, d) => s + d.satisfactionFactors.safety, 0) / state.dongs.length;
  const avgWelfare = state.dongs.reduce((s, d) => s + d.satisfactionFactors.welfare, 0) / state.dongs.length;
  const avgVitality = state.dongs.reduce((s, d) => s + d.commerceVitality, 0) / state.dongs.length;

  // (2) 주거 매력도: 주거 만족도 vs 구 평균 - 임대료 부담
  const housingScore = normalize(dong.satisfactionFactors.housing, avgHousing, 15) - dong.rentPressure * 2;

  // (3) 생활 인프라: 교통 + 상업 + 문화
  const infraScore = (
    normalize(dong.transitScore, avgTransit, Math.max(1, avgTransit)) * 0.5 +
    normalize(dong.commerceVitality, avgVitality, Math.max(1, avgVitality)) * 0.3 +
    normalize(dong.satisfactionFactors.culture, avgCulture, 15) * 0.2
  );

  // (4) 안전·환경
  const safetyScore = normalize(dong.satisfactionFactors.safety, avgSafety, 15);

  // (5) 교육
  const eduScore = normalize(dong.satisfactionFactors.welfare, avgWelfare, 15);

  // 가중합 (동간 상대 이동)
  let pull = PULL_WEIGHTS.jobs * (jobScore + adjJobBonus)
    + PULL_WEIGHTS.housing * housingScore
    + PULL_WEIGHTS.infra * infraScore
    + PULL_WEIGHTS.safety * safetyScore
    + PULL_WEIGHTS.education * eduScore;

  // 외부 유입/유출 (설계서: 40-70 안정, >70 유입, <40 유출)
  if (dong.satisfaction > 70) {
    pull += (dong.satisfaction - 70) * 0.0005;
  } else if (dong.satisfaction < 40) {
    pull -= (40 - dong.satisfaction) * 0.0008;
  }
  // 40-70 구간: 중립 (자연감소만 작용)

  // Push factors
  // 임대료 유출
  if (dong.rentPressure > 0) {
    pull -= dong.rentPressure * 0.3;
  }

  // 생활인구/상주인구 비율이 높으면 혼잡 불만
  const livingPopRatio = (dong.livingPop?.weekdayDay || dong.population) / Math.max(1, dong.population);
  if (livingPopRatio > 2.0) {
    pull -= (livingPopRatio - 2.0) * 0.05;
  }

  // 만족도 < 40이면 유출 가속
  if (dong.satisfaction < 40) {
    pull -= (40 - dong.satisfaction) * 0.005;
  }

  return clamp(pull, -0.03, 0.03);
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

// === Helpers ===
function normalize(value, center, spread) {
  if (spread === 0) return 0;
  return clamp((value - center) / spread, -1, 1);
}

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}
