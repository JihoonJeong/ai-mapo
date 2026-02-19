/**
 * simulation.js — 시뮬레이션 엔진 (턴 틱 오케스트레이션)
 *
 * 실행 순서 (numerical-design-v1.md):
 * 1. 예산 효과 계산
 * 2. 정책 효과 적용 (delay/duration 관리)
 * 3. 경제 (사업체 변동, 임대료, 상권특색)
 * 4. 인구 (자연변동, 이주, 강제이주)
 * 5. 재정 (세입, 세출, 자립도)
 * 6. 만족도 (6개 구성요소, 감쇠, 파급)
 * 7. 이벤트 효과 적용
 */

import { updatePopulation } from './population.js';
import { updateEconomy } from './economy.js';
import { updateFinance, calcBudgetEffects } from './finance.js';
import { updateSatisfaction } from './satisfaction.js';

let adjacencyData = null;

/**
 * 인접 행렬 로드 (한 번만)
 */
async function loadAdjacency() {
  if (adjacencyData) return adjacencyData;
  try {
    const resp = await fetch('data/game/adjacency.json');
    const data = await resp.json();
    adjacencyData = data.adjacency;
  } catch (err) {
    console.warn('[Engine] Failed to load adjacency.json, using empty:', err);
    adjacencyData = {};
  }
  return adjacencyData;
}

// 초기 로드 시작
loadAdjacency();

/**
 * 메인 시뮬레이션 틱
 * @param {Object} gameState - 전체 게임 상태 (deep copy 후 수정)
 * @param {Object} playerActions - 플레이어 액션
 *   - budget: {economy: 15, transport: 15, ...}
 *   - policies: [policyObj, ...] (새로 활성화할 정책)
 *   - eventChoice: {eventId, choiceId} | null
 * @returns {Object} 업데이트된 gameState
 */
export function tick(gameState, playerActions) {
  // Deep copy to avoid mutation issues
  const state = JSON.parse(JSON.stringify(gameState));
  const adjacency = adjacencyData || {};
  const budgetAlloc = playerActions?.budget || state.finance.allocation;

  console.log(`[Engine] Tick for turn ${state.meta.turn}`, {
    budget: budgetAlloc,
    policies: playerActions?.policies?.length || 0,
  });

  // === 1. 예산 효과 계산 ===
  const budgetEffects = calcBudgetEffects(budgetAlloc, state.finance.freeBudget);

  // === 1.5. 초기 인구 기준값 설정 (첫 틱에서만) ===
  for (const dong of state.dongs) {
    if (!dong._initPop) dong._initPop = dong.population;
    if (!dong._initBiz) dong._initBiz = dong.businesses;
  }

  // === 2. 정책 관리 ===
  // 새로 선택한 정책 활성화
  if (playerActions?.policies?.length > 0) {
    for (const policy of playerActions.policies) {
      // 중복 방지
      if (!state.activePolicies.some(ap => ap.policy.id === policy.id)) {
        state.activePolicies.push({
          policy: policy,
          remainDelay: policy.delay || 0,
          remainDuration: policy.duration || 0,
          turnsActive: 0,
        });
      }
    }
  }

  // 정책 효과 계산 + 타이머 업데이트
  const policyEffects = tickPolicies(state);

  // === 3. 경제 업데이트 (사업체, 임대료, 상권특색) ===
  for (const dong of state.dongs) {
    updateEconomy(dong, state, adjacency, budgetAlloc, policyEffects);
  }

  // === 4. 인구 업데이트 ===
  for (const dong of state.dongs) {
    updatePopulation(dong, state, adjacency, policyEffects);
  }

  // === 5. 재정 업데이트 ===
  state.finance = updateFinance(state, budgetAlloc, policyEffects);

  // === 6. 만족도 업데이트 ===
  for (const dong of state.dongs) {
    updateSatisfaction(dong, state, adjacency, budgetEffects, policyEffects);
  }

  // === 7. 이벤트 효과 적용 ===
  tickEventEffects(state);

  // === 8. 생활인구 업데이트 (인구/사업체 변동에 비례) ===
  updateLivingPopulation(state);

  return state;
}

/**
 * 정책 타이머 관리 + 동별/구 전체 효과 집계
 * @returns {Object} policyEffects { global: {...}, byDong: {dongId: {...}} }
 */
function tickPolicies(state) {
  const effects = {
    global: {}, // 구 전체 효과 합산
    byDong: {}, // 특정 동 효과 합산
  };

  // 만료된 정책 제거
  state.activePolicies = state.activePolicies.filter(ap => {
    // duration=0은 영구 (해제 전까지)
    if (ap.policy.duration === 0) return true;
    // delay가 남아있으면 아직 시작 안 됨
    if (ap.remainDelay > 0) return true;
    // duration이 남아있으면 유지
    return ap.remainDuration > 0;
  });

  for (const ap of state.activePolicies) {
    ap.turnsActive++;

    // 딜레이 카운트다운
    if (ap.remainDelay > 0) {
      ap.remainDelay--;
      continue; // 딜레이 중이면 효과 없음
    }

    // 지속 시간 카운트다운 (0=영구)
    if (ap.policy.duration > 0 && ap.remainDuration > 0) {
      ap.remainDuration--;
    }

    // 효과 적용
    const policy = ap.policy;
    const targetDongs = getTargetDongs(policy, state);

    for (const dongId of targetDongs) {
      if (!effects.byDong[dongId]) effects.byDong[dongId] = {};
      mergeEffects(effects.byDong[dongId], policy.effects);
    }

    // null targetDong = 구 전체
    if (!policy.targetDong) {
      mergeEffects(effects.global, policy.effects);
    }
  }

  return effects;
}

/**
 * 정책 대상 동 목록 반환
 */
function getTargetDongs(policy, state) {
  if (!policy.targetDong) {
    return state.dongs.map(d => d.id);
  }
  if (Array.isArray(policy.targetDong)) {
    return policy.targetDong;
  }
  return [policy.targetDong];
}

/**
 * 효과 병합 (누적)
 */
function mergeEffects(target, source) {
  for (const [category, values] of Object.entries(source)) {
    if (!target[category]) target[category] = {};
    for (const [key, val] of Object.entries(values)) {
      if (typeof val === 'object') {
        // delayed_completion 같은 중첩 객체는 스킵
        continue;
      }
      target[category][key] = (target[category][key] || 0) + val;
    }
  }
}

/**
 * 이벤트 효과 타이머 관리
 */
function tickEventEffects(state) {
  if (!state.activeEvents) return;

  state.activeEvents = state.activeEvents.filter(ae => {
    ae.remainDuration--;
    if (ae.remainDuration <= 0) return false;

    // 효과 적용
    const choice = ae.choice;
    if (!choice?.effects) return true;

    for (const dong of state.dongs) {
      const isAffected = ae.affectedDongs?.includes(dong.id) || !ae.affectedDongs;
      if (!isAffected) continue;

      // 만족도 효과
      if (choice.effects.satisfaction) {
        for (const [comp, val] of Object.entries(choice.effects.satisfaction)) {
          if (dong.satisfactionFactors[comp] !== undefined) {
            // 이벤트 효과는 duration에 걸쳐 분산
            dong.satisfactionFactors[comp] += val / (ae.totalDuration || 1);
          }
        }
      }
    }

    return true;
  });
}

/**
 * 생활인구 업데이트
 * 평일 낮: 사업체/종사자 변동에 비례
 * 밤: 상주인구 변동에 비례
 */
function updateLivingPopulation(state) {
  for (const dong of state.dongs) {
    if (!dong.livingPop) continue;

    // 낮 생활인구: 종사자 + 관광 연동
    const workerRatio = dong.workers / Math.max(1, dong.population);
    const vitalityFactor = 0.8 + dong.commerceVitality * 0.004;
    dong.livingPop.weekdayDay = Math.round(dong.livingPop.weekdayDay * vitalityFactor * 0.99 + dong.population * workerRatio * 0.01);

    // 밤 생활인구: 상주인구에 수렴
    dong.livingPop.weekdayNight = Math.round(dong.population * 0.9 + dong.livingPop.weekdayNight * 0.1);

    // 주말: 상권 특색에 연동
    const charFactor = dong.commerceCharacter / 80;
    dong.livingPop.weekendDay = Math.round(dong.livingPop.weekdayDay * 0.85 * charFactor + dong.population * 0.15);
    dong.livingPop.weekendNight = Math.round(dong.livingPop.weekdayNight * 0.95);
  }
}
