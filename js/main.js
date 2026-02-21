/**
 * main.js — AI 마포구청장 앱 초기화 + 턴 루프 상태 머신
 */

import { initMap, updateMapColors, updateGameState } from './map.js';
import { initDashboard, updateDashboard } from './dashboard.js';
import { initAdvisor, generateBriefing, addMessage, updateAdvisorState } from './advisor.js';
import { initBudget, getAllocation } from './budget.js';
import { initPolicy, getSelectedPolicies, updatePolicyState } from './policy.js';
import { initEvents, renderNoEvent, renderEvent, getEventChoice, checkEventTriggers } from './event.js';
import { showPledgeSelection, initPledgeBar, renderPledgeBar, calcFinalScore } from './pledge.js';
import { tick } from './engine/simulation.js';
import { initAutoplay } from './autoplay.js';

// === Game State ===
let gameState = null;
let lastTurnActions = null;
let autoplayActive = false;
let turnLog = []; // per-turn action log for result export
let gameStartTime = 0;

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
      month: 1,
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
  await initPolicy(gameState);
  await initEvents(gameState);
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

  // Init autoplay
  initAutoplay({
    getState: () => gameState,
    getPhase: () => currentPhase,
    PHASE,
    triggerEndTurn: () => endTurn(),
    setAutoplayActive: (v) => { autoplayActive = v; },
  });

  // Start first turn
  turnLog = [];
  gameStartTime = Date.now();
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

  // 3. AI briefing (skip during autoplay — autoplay shows its own reasoning)
  updateAdvisorState(gameState);
  if (gameState.meta.turn > 1 && !autoplayActive) {
    generateBriefing(gameState);
  }

  // 4. Update policy UI
  updatePolicyState(gameState);

  // 5. Check event triggers
  const event = checkEventTriggers(gameState);
  if (event) {
    renderEvent(event, gameState);
    addMessage('advisor', `[긴급] ${event.name} 이벤트가 발생했습니다. 이벤트 탭에서 대응 방안을 선택하세요.`);
  } else {
    renderNoEvent();
  }

  // 6. Move to player phase
  currentPhase = PHASE.PLAYER_PHASE;
  updateTurnDisplay();
}

function endTurn() {
  if (currentPhase !== PHASE.PLAYER_PHASE) return;
  currentPhase = PHASE.TURN_END;

  // Collect player actions
  const eventChoice = getEventChoice();
  lastTurnActions = {
    budget: getAllocation(),
    policies: getSelectedPolicies(),
    eventChoice: eventChoice,
  };

  // Add event choice to active events for effect tracking
  if (eventChoice) {
    if (!gameState.activeEvents) gameState.activeEvents = [];
    gameState.activeEvents.push(eventChoice);
  }

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

  // Log turn actions for result export
  turnLog.push({
    turn: gameState.meta.turn,
    aiAction: {
      budget: lastTurnActions.budget,
      policies: {
        activate: lastTurnActions.policies.map(p => p.id),
        deactivate: [],
      },
      eventChoice: eventChoice?.choiceId || null,
    },
    stateSnapshot: {
      totalPop: totalPop,
      avgSat: avgSat,
      fiscalIndependence: gameState.finance.fiscalIndependence,
      freeBudget: gameState.finance.freeBudget,
      activePolicies: (gameState.activePolicies || []).map(ap => ap.policy.id),
    },
    event: eventChoice ? { id: eventChoice.eventId, choiceId: eventChoice.choiceId } : null,
    mode: autoplayActive ? 'auto' : 'manual',
  });

  // Advance turn
  gameState.meta.turn++;
  gameState.meta.month = ((gameState.meta.turn - 1) % 12) + 1;
  gameState.meta.year = 2026 + Math.floor((gameState.meta.turn - 1) / 12);

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
  const month = gameState.meta.month;

  document.getElementById('turn-label').textContent = `턴 ${turn}/48`;
  document.getElementById('turn-date').textContent = `${year}년 ${month}월`;
}

// === Game End ===
function showGameEnd() {
  currentPhase = PHASE.GAME_END;

  const modal = document.getElementById('modal-overlay');
  const content = document.getElementById('modal-content');

  const result = calcFinalScore(gameState);
  const gradeLabels = {
    S: '재선 확정', A: '유능한 구청장', B: '무난한 임기',
    C: '아쉬운 성과', D: '위기의 마포구', F: '주민소환',
  };

  // KPI score bars
  const kpiHtml = result.kpis.map(k => `
    <div class="score-row">
      <span class="score-row-label">${k.label}</span>
      <div class="score-row-bar">
        <div class="score-row-fill" style="width:${Math.max(0, k.score / k.max * 100)}%"></div>
      </div>
      <span class="score-row-value">${k.score}/${k.max}</span>
    </div>
  `).join('');

  // Pledge results
  const pledgeHtml = result.pledgeResults.map(p => `
    <div class="pledge-result-item ${p.achieved ? 'achieved' : 'failed'}">
      <span>${p.achieved ? '✓' : '✗'} ${p.name}</span>
      <span class="pledge-score">${p.score > 0 ? '+' : ''}${p.score}</span>
    </div>
  `).join('');

  content.innerHTML = `
    <div class="modal-title">마포구 4년 성적표</div>
    <div class="modal-subtitle">${gameState.meta.playerName} 구청장님의 임기가 끝났습니다</div>

    <div class="grade-display">
      <div class="grade-letter grade-${result.grade}">${result.grade}</div>
      <div class="grade-label">${gradeLabels[result.grade]}</div>
    </div>

    <div class="score-summary">
      총점 <strong>${result.total}</strong>점
      <span class="score-breakdown-label">(KPI ${result.kpiTotal} + 공약 ${result.pledgeTotal >= 0 ? '+' : ''}${result.pledgeTotal})</span>
    </div>

    <div class="report-section">
      <div class="report-section-title">KPI 평가</div>
      <div class="score-breakdown">${kpiHtml}</div>
    </div>

    ${result.pledgeResults.length > 0 ? `
    <div class="report-section">
      <div class="report-section-title">공약 달성</div>
      <div class="pledge-results">${pledgeHtml}</div>
    </div>` : ''}

    <div class="report-section">
      <div class="report-section-title">AI 자문관 리뷰</div>
      <div class="ai-review" id="ai-review-content">리뷰 생성 중...</div>
    </div>

    <div style="display:flex;gap:8px;margin-top:8px">
      <button class="modal-btn" id="btn-download-result" style="background:var(--success);flex:1">결과 JSON 다운로드</button>
      <button class="modal-btn" onclick="location.reload()" style="flex:1">다시 플레이</button>
    </div>
  `;

  modal.classList.add('active');

  // Download result button
  document.getElementById('btn-download-result')?.addEventListener('click', () => {
    downloadResult(gameState, result);
  });

  // Generate AI review asynchronously
  generateGameReview(gameState, result);
}

async function generateGameReview(state, result) {
  const reviewEl = document.getElementById('ai-review-content');
  if (!reviewEl) return;

  try {
    const { callAdvisorForReview } = await import('./advisor.js');

    const pledgeText = result.pledgeResults.map(p =>
      `${p.name}: ${p.achieved ? '달성' : '미달성'} (${p.progress}%)`
    ).join(', ');
    const kpiText = result.kpis.map(k => `${k.label}: ${k.score}/${k.max} (${k.detail})`).join(', ');

    const { buildAdvisorContext } = await import('./advisor.js');
    const context = typeof buildAdvisorContext === 'function' ? buildAdvisorContext(state) : '';

    const prompt = `구청장님의 4년 임기가 끝났습니다. 아래 결과를 바탕으로 총평을 작성하세요.

${context}

[최종 결과]
등급: ${result.grade}
총점: ${result.total}/130
KPI: ${kpiText}
공약: ${pledgeText}

3~4문장으로 구청장님의 강점, 아쉬운 점, 그리고 "다음 임기에는..." 제안을 써 주세요.`;

    const review = await callAdvisorForReview(prompt);
    reviewEl.textContent = review || getDefaultReview(result);
  } catch {
    reviewEl.textContent = getDefaultReview(result);
  }
}

function getDefaultReview(result) {
  const gradeText = {
    S: '탁월한 성과입니다! 모든 공약을 달성하시고 마포구를 크게 발전시키셨습니다.',
    A: '훌륭한 임기였습니다. 대부분의 지표가 개선되었고 구민들의 신뢰를 얻었습니다.',
    B: '무난한 임기를 보내셨습니다. 일부 분야에서 성과가 있었지만, 아쉬운 부분도 있습니다.',
    C: '아쉬운 성과입니다. 몇 가지 과제가 미해결로 남았습니다.',
    D: '어려운 임기였습니다. 구조적 문제에 대한 근본적인 대응이 필요했습니다.',
    F: '마포구의 상황이 크게 악화되었습니다. 주민들의 불만이 높습니다.',
  };

  let review = gradeText[result.grade] || '';

  // Add specific insights
  const bestKpi = result.kpis.reduce((a, b) => (a.score / a.max) > (b.score / b.max) ? a : b);
  const worstKpi = result.kpis.reduce((a, b) => (a.score / a.max) < (b.score / b.max) ? a : b);

  review += ` ${bestKpi.label} 분야에서 가장 좋은 성과를 보이셨습니다.`;
  if (worstKpi.id !== bestKpi.id) {
    review += ` 반면 ${worstKpi.label}은 개선의 여지가 있습니다.`;
  }

  return review;
}

// === Result Export ===
function downloadResult(state, result) {
  const durationMs = Date.now() - gameStartTime;
  const autoTurns = turnLog.filter(t => t.mode === 'auto').length;
  const manualTurns = turnLog.filter(t => t.mode === 'manual').length;

  const exportData = {
    runId: `browser-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`,
    source: 'browser',
    provider: localStorage.getItem('ai-mapo-backend') || 'mock',
    playerName: state.meta.playerName,
    pledges: state.meta.pledges,
    mode: autoTurns > 0 && manualTurns > 0 ? 'mixed' : autoTurns > 0 ? 'auto' : 'manual',
    autoTurns,
    manualTurns,
    finalGrade: result.grade,
    totalScore: result.total,
    kpis: result.kpis,
    kpiTotal: result.kpiTotal,
    pledgeResults: result.pledgeResults,
    pledgeTotal: result.pledgeTotal,
    turnLog,
    durationMs,
  };

  const json = JSON.stringify(exportData, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${exportData.runId}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// === Boot ===
document.addEventListener('DOMContentLoaded', init);
