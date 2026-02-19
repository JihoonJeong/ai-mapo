/**
 * main.js — AI 마포구청장 앱 초기화 + 턴 루프 상태 머신
 */

import { initMap, updateMapColors, updateGameState } from './map.js';
import { initDashboard, updateDashboard } from './dashboard.js';
import { initAdvisor, generateBriefing, addMessage } from './advisor.js';
import { initBudget, getAllocation } from './budget.js';
import { initPolicy, getSelectedPolicies } from './policy.js';
import { initEvents, renderNoEvent, getEventChoice } from './event.js';
import { showPledgeSelection, initPledgeBar, renderPledgeBar } from './pledge.js';
import { tick } from './engine/simulation.js';

// === Game State ===
let gameState = null;
let lastTurnActions = null;

// === Phases ===
const PHASE = {
  GAME_START: 'game_start',
  TURN_START: 'turn_start',
  PLAYER_PHASE: 'player_phase',
  TURN_END: 'turn_end',
  GAME_END: 'game_end',
};
let currentPhase = PHASE.GAME_START;

// === App Init ===
async function init() {
  try {
    const resp = await fetch('data/game/mapo_init.json');
    const initData = await resp.json();
    gameState = createGameState(initData);

    // Show game start modal
    showGameStart();
  } catch (err) {
    console.error('Failed to load game data:', err);
    document.body.innerHTML = `<div style="padding:40px;text-align:center;color:#dc2626">
      게임 데이터 로딩 실패: ${err.message}<br>
      <small>data/game/mapo_init.json 파일을 확인하세요.</small>
    </div>`;
  }
}

function createGameState(initData) {
  return {
    meta: {
      turn: 1,
      year: 2026,
      quarter: 1,
      playerName: '',
      pledges: [],
    },
    dongs: initData.dongs.map(d => ({ ...d })),
    finance: { ...initData.finance },
    industryBreakdown: initData.industryBreakdown || {},
    activePolicies: [],
    activeEvents: [],
    history: [],
  };
}

// === Game Start ===
function showGameStart() {
  currentPhase = PHASE.GAME_START;

  const modal = document.getElementById('modal-overlay');
  const content = document.getElementById('modal-content');

  content.innerHTML = `
    <div class="modal-title">AI 마포구청장</div>
    <div class="modal-subtitle">마포구 16개 동, 357,232명의 구청장이 되어보세요</div>
    <input type="text" class="modal-input" id="player-name-input"
           placeholder="구청장님 성함을 입력하세요" maxlength="10" autofocus>
    <button class="modal-btn" id="btn-start">시작하기</button>
  `;

  modal.classList.add('active');

  document.getElementById('btn-start').addEventListener('click', () => {
    const name = document.getElementById('player-name-input')?.value.trim() || '시민';
    gameState.meta.playerName = name;
    modal.classList.remove('active');

    // Move to pledge selection
    showPledgeSelection((pledges) => {
      gameState.meta.pledges = pledges;
      startGame();
    });
  });

  // Enter key shortcut
  document.getElementById('player-name-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('btn-start')?.click();
  });
}

// === Start Game ===
async function startGame() {
  // Update header
  document.getElementById('player-info').textContent = `${gameState.meta.playerName} 구청장`;

  // Init all modules
  await initMap(document.getElementById('map-container'), gameState);
  initDashboard(gameState);
  initAdvisor(gameState);
  initBudget(gameState);
  initPolicy(gameState);
  initEvents(gameState);
  initPledgeBar(gameState.meta.pledges, gameState);

  // Tab switching
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${btn.dataset.tab}`)?.classList.add('active');
    });
  });

  // End turn button
  document.getElementById('btn-end-turn')?.addEventListener('click', endTurn);

  // Start first turn
  updateTurnDisplay();
  currentPhase = PHASE.PLAYER_PHASE;
}

// === Turn Loop ===
function startTurn() {
  currentPhase = PHASE.TURN_START;

  // 1. Simulation tick (apply last turn's actions)
  if (gameState.meta.turn > 1 && lastTurnActions) {
    gameState = tick(gameState, lastTurnActions);
  }

  // 2. Update all UIs
  updateGameState(gameState);
  updateMapColors(gameState.dongs);
  updateDashboard(gameState);
  renderPledgeBar(gameState.meta.pledges, gameState);

  // 3. AI briefing
  if (gameState.meta.turn > 1) {
    generateBriefing(gameState);
  }

  // 4. Reset events
  renderNoEvent();

  // 5. Move to player phase
  currentPhase = PHASE.PLAYER_PHASE;
  updateTurnDisplay();
}

function endTurn() {
  if (currentPhase !== PHASE.PLAYER_PHASE) return;
  currentPhase = PHASE.TURN_END;

  // Collect player actions
  lastTurnActions = {
    budget: getAllocation(),
    policies: getSelectedPolicies(),
    eventChoice: getEventChoice(),
  };

  // Save history snapshot
  const totalPop = gameState.dongs.reduce((s, d) => s + d.population, 0);
  const avgSat = Math.round(gameState.dongs.reduce((s, d) => s + d.satisfaction, 0) / gameState.dongs.length);
  gameState.history.push({
    turn: gameState.meta.turn,
    totalPopulation: totalPop,
    avgSatisfaction: avgSat,
    fiscalIndependence: gameState.finance.fiscalIndependence,
    dongs: gameState.dongs.map(d => ({
      id: d.id,
      population: d.population,
      satisfaction: d.satisfaction,
      businesses: d.businesses,
    })),
  });

  // Advance turn
  gameState.meta.turn++;
  gameState.meta.quarter = ((gameState.meta.turn - 1) % 4) + 1;
  gameState.meta.year = 2026 + Math.floor((gameState.meta.turn - 1) / 4);

  // Check game end
  if (gameState.meta.turn > 48) {
    showGameEnd();
    return;
  }

  // Next turn
  startTurn();
}

function updateTurnDisplay() {
  const turn = gameState.meta.turn;
  const year = gameState.meta.year;
  const quarter = gameState.meta.quarter;

  document.getElementById('turn-label').textContent = `턴 ${turn}/48`;
  document.getElementById('turn-date').textContent = `${year}년 ${quarter}분기`;
}

// === Game End ===
function showGameEnd() {
  currentPhase = PHASE.GAME_END;

  const modal = document.getElementById('modal-overlay');
  const content = document.getElementById('modal-content');

  const first = gameState.history[0];
  const totalPop = gameState.dongs.reduce((s, d) => s + d.population, 0);
  const initialPop = first?.totalPopulation || totalPop;
  const avgSat = Math.round(gameState.dongs.reduce((s, d) => s + d.satisfaction, 0) / gameState.dongs.length);
  const totalBiz = gameState.dongs.reduce((s, d) => s + d.businesses, 0);
  const fiscal = gameState.finance.fiscalIndependence;

  // Count achieved pledges
  const achieved = gameState.meta.pledges.filter(id => {
    // Simplified check — Sprint 4 will have proper logic
    return false; // Placeholder
  }).length;

  const grade = achieved >= 4 ? 'S' : achieved >= 3 ? 'A' : achieved >= 2 ? 'B' : achieved >= 1 ? 'C' : 'D';
  const gradeLabels = { S: '재선 확정', A: '유능한 구청장', B: '무난한 임기', C: '아쉬운 성과', D: '위기의 마포구' };

  content.innerHTML = `
    <div class="modal-title">마포구 4년 성적표</div>
    <div class="modal-subtitle">${gameState.meta.playerName} 구청장님의 임기가 끝났습니다</div>

    <div class="grade-display">
      <div class="grade-letter">${grade}</div>
      <div class="grade-label">${gradeLabels[grade]}</div>
    </div>

    <div class="report-grid">
      <div class="report-item">
        <div class="report-label">인구</div>
        <div class="report-value">${(totalPop / 10000).toFixed(1)}만</div>
        <div class="report-delta ${totalPop >= initialPop ? 'delta-up' : 'delta-down'}">
          ${totalPop >= initialPop ? '+' : ''}${(totalPop - initialPop).toLocaleString()}명
        </div>
      </div>
      <div class="report-item">
        <div class="report-label">사업체</div>
        <div class="report-value">${totalBiz.toLocaleString()}</div>
        <div class="report-delta delta-flat">개</div>
      </div>
      <div class="report-item">
        <div class="report-label">만족도</div>
        <div class="report-value">${avgSat}</div>
        <div class="report-delta delta-flat">/ 100</div>
      </div>
      <div class="report-item">
        <div class="report-label">재정자립도</div>
        <div class="report-value">${fiscal}%</div>
        <div class="report-delta delta-flat">목표 30%</div>
      </div>
    </div>

    <button class="modal-btn" onclick="location.reload()">다시 플레이</button>
  `;

  modal.classList.add('active');
}

// === Boot ===
document.addEventListener('DOMContentLoaded', init);
