/**
 * simulation.js — 시뮬레이션 엔진 (턴 틱 오케스트레이션)
 *
 * 실행 순서 (numerical-design-v1.md):
 * 1. 예산 효과 계산
 * 2. 경제 (사업체 변동, 임대료, 상권특색)
 * 3. 인구 (자연변동, 이주, 강제이주)
 * 4. 재정 (세입, 세출, 자립도)
 * 5. 만족도 (6개 구성요소, 감쇠, 파급)
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
 *   - policies: [policyId, ...]
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

  // === 2. 경제 업데이트 (사업체, 임대료, 상권특색) ===
  for (const dong of state.dongs) {
    updateEconomy(dong, state, adjacency, budgetAlloc);
  }

  // === 3. 인구 업데이트 ===
  for (const dong of state.dongs) {
    updatePopulation(dong, state, adjacency);
  }

  // === 4. 재정 업데이트 ===
  state.finance = updateFinance(state, budgetAlloc);

  // === 5. 만족도 업데이트 ===
  for (const dong of state.dongs) {
    updateSatisfaction(dong, state, adjacency, budgetEffects);
  }

  // === 6. 생활인구 업데이트 (인구/사업체 변동에 비례) ===
  updateLivingPopulation(state);

  return state;
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
