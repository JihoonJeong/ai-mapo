/**
 * autoplay.js — AI 자동 플레이 컨트롤러
 *
 * 드롭다운(4/8/12/끝까지)으로 AI가 예산·정책·이벤트를 자동 결정.
 * sim/sim-advisor.mjs의 action 프롬프트 + JSON 파서를 브라우저용으로 적용.
 */

import { callAIRaw, getCurrentBackendName, buildAdvisorContext, addMessage } from './advisor.js';
import { setAllocation } from './budget.js';
import { setPolicies, cancelActivePolicy, getPolicyCatalog } from './policy.js';
import { setEventChoice, getCurrentEvent } from './event.js';

// === State ===
let autoplayState = 'idle'; // 'idle' | 'running'
let remainingTurns = 0;
let turnsPlayed = 0;
let totalTurns = 0;
let gameAccessor = null; // { getState, getPhase, PHASE, triggerEndTurn, setAutoplayActive }

// === Action System Prompt (adapted from sim/sim-advisor.mjs) ===
const ACTION_SYSTEM_PROMPT = `당신은 서울특별시 마포구의 AI 구청장입니다. 48개월(4년) 임기 동안 마포구를 운영합니다.

## 역할
- 매달 예산 배분, 정책 선택, 이벤트 대응을 직접 결정합니다.
- 모든 결정은 지정된 JSON 형식으로 응답해야 합니다.

## 마포구 개요
- 16개 행정동, 인구 약 35만 명
- 홍대·연남 관광 상권, 상암 DMC 업무지구, 공덕 교통허브, 성산 주거단지 공존
- 재정자립도 약 28%. 세수를 늘리려면 사업체를 늘리고, 부동산 가치를 올려야 합니다.
- 핵심 딜레마: 관광 활성화 ↔ 주민 삶의 질, 개발 ↔ 보존, 성장 ↔ 형평

## 판단 프레임워크
1. **변화**: 전월 대비 무엇이 달라졌는가?
2. **원인**: 왜 달라졌는가? (정책 효과? 외부 요인?)
3. **영향**: 이 변화가 다른 지표에 어떤 파급을 줄 것인가?
4. **대응**: 어떤 행동이 최선인가?

## 규칙
- 결정을 반드시 지정된 JSON 형식으로 응답하세요. JSON 외 텍스트는 reasoning 필드에 넣으세요.
- budget 합계는 반드시 100이어야 합니다.
- 정책은 최대 3개 동시 활성화 가능합니다.
- 공약 달성을 항상 고려하되, KPI 전체 균형도 유지하세요.`;

const DEFAULT_BUDGET = {
  economy: 15, transport: 15, culture: 10,
  environment: 15, education: 15, welfare: 15, renewal: 15,
};

// === Init ===
export function initAutoplay(accessor) {
  gameAccessor = accessor;

  const btnStart = document.getElementById('btn-autoplay');
  const btnStop = document.getElementById('btn-autoplay-stop');

  if (btnStart) {
    btnStart.addEventListener('click', () => {
      const select = document.getElementById('autoplay-turns');
      const turns = parseInt(select?.value || '4', 10);
      startAutoplay(turns);
    });
  }

  if (btnStop) {
    btnStop.addEventListener('click', () => stopAutoplay());
  }
}

// === Start / Stop ===
function startAutoplay(numTurns) {
  if (autoplayState === 'running') return;
  if (!gameAccessor) return;

  const state = gameAccessor.getState();
  const currentTurn = state.meta.turn;

  // numTurns=0 means "play to end"
  if (numTurns === 0) {
    totalTurns = Math.max(0, 49 - currentTurn); // turns until turn > 48
  } else {
    totalTurns = Math.min(numTurns, 49 - currentTurn);
  }

  if (totalTurns <= 0) return;

  remainingTurns = totalTurns;
  turnsPlayed = 0;
  autoplayState = 'running';

  gameAccessor.setAutoplayActive(true);
  updateUI(true);

  addMessage('advisor', `[AI 자동] ${totalTurns}턴 자동 플레이를 시작합니다.`);

  autoplayLoop();
}

export function stopAutoplay() {
  if (autoplayState !== 'running') return;
  autoplayState = 'idle';
  gameAccessor?.setAutoplayActive(false);
  updateUI(false);

  addMessage('advisor', `[AI 자동] 자동 플레이를 중지했습니다. (${turnsPlayed}턴 완료)`);
}

// === Core Loop ===
async function autoplayLoop() {
  while (remainingTurns > 0 && autoplayState === 'running') {
    const phase = gameAccessor.getPhase();
    if (phase === gameAccessor.PHASE.GAME_END) break;
    if (phase !== gameAccessor.PHASE.PLAYER_PHASE) break;

    const state = gameAccessor.getState();
    const event = getCurrentEvent();
    const catalog = getPolicyCatalog();

    // 1. Update status
    updateStatus(`AI 결정 중... (${turnsPlayed + 1}/${totalTurns}턴)`);

    // 2. Get AI action
    let action;
    try {
      const prompt = buildActionPrompt(state, event, catalog);
      const messages = [
        { role: 'system', content: buildSystemMessage(state) },
        { role: 'user', content: prompt },
      ];
      const raw = await callAIRaw(messages, 800);
      action = parseAction(raw, state, event, catalog);
    } catch (err) {
      console.warn('[Autoplay] AI call failed:', err);
      action = getDefaultAction();
    }

    // Check if stopped during AI call
    if (autoplayState !== 'running') break;

    // 3. Show reasoning
    if (action.reasoning) {
      addMessage('advisor', `[AI 자동] ${action.reasoning}`);
    }

    // 4. Apply actions to UI
    applyAction(action, state, event);

    // 5. Visual delay (let user see changes)
    await sleep(1500);
    if (autoplayState !== 'running') break;

    // 6. End turn
    gameAccessor.triggerEndTurn();

    // 7. Update counters
    remainingTurns--;
    turnsPlayed++;
    updateStatus(`${turnsPlayed}/${totalTurns}턴 완료`);

    // Post-turn delay
    await sleep(500);
  }

  // Auto-play finished
  if (autoplayState === 'running') {
    autoplayState = 'idle';
    gameAccessor.setAutoplayActive(false);
    updateUI(false);

    const phase = gameAccessor.getPhase();
    if (phase !== gameAccessor.PHASE.GAME_END) {
      addMessage('advisor', `[AI 자동] ${turnsPlayed}턴 자동 플레이가 완료되었습니다.`);
    }
  }
}

// === Action Application ===
function applyAction(action, state, event) {
  // Budget
  setAllocation(action.budget, state.finance.freeBudget);

  // Policy deactivation
  for (const id of action.policies.deactivate) {
    cancelActivePolicy(id);
  }

  // Policy activation
  setPolicies(action.policies.activate);

  // Event choice
  if (event && action.eventChoice) {
    setEventChoice(action.eventChoice);
  }
}

// === Prompt Builder ===
function buildSystemMessage(state) {
  let sys = ACTION_SYSTEM_PROMPT;
  if (state.meta.pledges?.length > 0) {
    sys += `\n\n선택한 공약: ${state.meta.pledges.join(', ')}`;
  }
  return sys;
}

function buildActionPrompt(state, event, policyCatalog) {
  const context = buildAdvisorContext(state);
  const activePolicyIds = (state.activePolicies || []).map(ap => ap.policy.id);

  // Available policies (not already active)
  const available = policyCatalog
    .filter(p => !activePolicyIds.includes(p.id))
    .map(p => `${p.id}: ${p.name} (${p.cost}억/턴, ${p.category})`)
    .join('\n');

  let prompt = `${context}\n\n`;

  // Event info
  if (event) {
    const choicesStr = event.choices.map(c =>
      `${c.id}: ${c.name} — ${c.description} (비용: ${c.cost}억원)`
    ).join('\n');
    prompt += `[긴급 이벤트]\n${event.name}: ${event.description}\n선택지:\n${choicesStr}\n\n`;
  }

  prompt += `이번 달 행동을 결정하세요. 아래 JSON 형식으로만 응답하세요:

{
  "reasoning": "이번 달 판단 근거 — 현재 지표 분석 + 전략적 이유",
  "budget": {
    "economy": <0~40>, "transport": <0~40>, "culture": <0~40>,
    "environment": <0~40>, "education": <0~40>, "welfare": <0~40>, "renewal": <0~40>
  },
  "policies": {
    "activate": ["정책ID"],
    "deactivate": ["정책ID"]
  }${event ? `,\n  "eventChoice": "선택지ID"` : ''}
}

전략 가이드:
- 균등 배분(모두 14%)은 최악의 전략입니다. 2~3개 분야에 집중 투자(20~35%)하고 나머지는 줄이세요.
- 만족도가 낮은 요소에 관련 예산을 집중하면 효과적입니다.
- 정책을 적극 활용하세요! 3개 슬롯을 채우면 큰 차이가 납니다.
- 인구 감소 시: welfare/housing 관련 예산 강화. 경제 침체 시: economy/renewal 예산 강화.

규칙:
- budget 7개 항목 합계 = 반드시 100
- 각 항목 최소 5, 최대 40
- 활성 정책 최대 3개 (현재 ${activePolicyIds.length}개: ${activePolicyIds.join(', ') || '없음'})
- activate: 새로 활성화할 정책 ID (비용 고려)
- deactivate: 해제할 기존 정책 ID${event ? `\n- eventChoice: 이벤트 선택지 ID (${event.choices.map(c => c.id).join(' / ')})` : ''}

사용 가능 정책:
${available}`;

  return prompt;
}

// === JSON Parser (3-level fallback, adapted from sim/sim-advisor.mjs) ===

function parseAction(raw, state, event, policyCatalog) {
  if (!raw || raw.trim() === '') {
    return getDefaultAction();
  }

  let parsed = null;

  // Level 1: Direct JSON parse
  try {
    parsed = JSON.parse(raw.trim());
  } catch {
    // Level 2: Extract from code block
    const codeBlockMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (codeBlockMatch) {
      try { parsed = JSON.parse(codeBlockMatch[1].trim()); } catch { /* fall through */ }
    }
  }

  // Level 3: Regex extraction
  if (!parsed) {
    parsed = regexExtract(raw);
  }

  return validateAction(parsed, state, event, policyCatalog);
}

function regexExtract(raw) {
  const result = { reasoning: '', budget: null, policies: { activate: [], deactivate: [] }, eventChoice: null };

  const reasonMatch = raw.match(/"reasoning"\s*:\s*"([^"]+)"/);
  if (reasonMatch) result.reasoning = reasonMatch[1];

  const budgetMatch = raw.match(/"budget"\s*:\s*\{([^}]+)\}/);
  if (budgetMatch) {
    try { result.budget = JSON.parse(`{${budgetMatch[1]}}`); } catch { /* default */ }
  }

  const activateMatch = raw.match(/"activate"\s*:\s*\[([^\]]*)\]/);
  if (activateMatch) {
    const ids = activateMatch[1].match(/"([^"]+)"/g);
    result.policies.activate = ids ? ids.map(s => s.replace(/"/g, '')) : [];
  }

  const deactivateMatch = raw.match(/"deactivate"\s*:\s*\[([^\]]*)\]/);
  if (deactivateMatch) {
    const ids = deactivateMatch[1].match(/"([^"]+)"/g);
    result.policies.deactivate = ids ? ids.map(s => s.replace(/"/g, '')) : [];
  }

  const eventMatch = raw.match(/"eventChoice"\s*:\s*"([^"]+)"/);
  if (eventMatch) result.eventChoice = eventMatch[1];

  return result;
}

function validateAction(parsed, state, event, policyCatalog) {
  const action = {
    reasoning: parsed?.reasoning || '',
    budget: { ...DEFAULT_BUDGET },
    policies: { activate: [], deactivate: [] },
    eventChoice: null,
  };

  // Budget validation + normalization
  if (parsed?.budget && typeof parsed.budget === 'object') {
    const keys = ['economy', 'transport', 'culture', 'environment', 'education', 'welfare', 'renewal'];
    const rawBudget = {};
    let sum = 0;
    for (const k of keys) {
      const v = Number(parsed.budget[k]) || 0;
      rawBudget[k] = Math.max(0, v);
      sum += rawBudget[k];
    }
    if (sum > 0) {
      for (const k of keys) {
        action.budget[k] = Math.round(rawBudget[k] / sum * 100);
      }
      const roundedSum = Object.values(action.budget).reduce((a, b) => a + b, 0);
      if (roundedSum !== 100) {
        const maxKey = keys.reduce((a, b) => action.budget[a] >= action.budget[b] ? a : b);
        action.budget[maxKey] += 100 - roundedSum;
      }
    }
  }

  // Policy validation
  if (parsed?.policies) {
    const activePolicyIds = (state.activePolicies || []).map(ap => ap.policy.id);
    const catalogIds = new Set(policyCatalog.map(p => p.id));

    if (Array.isArray(parsed.policies.deactivate)) {
      action.policies.deactivate = parsed.policies.deactivate
        .filter(id => activePolicyIds.includes(id));
    }

    const afterDeactivate = activePolicyIds.length - action.policies.deactivate.length;
    const slotsAvailable = 3 - afterDeactivate;

    if (Array.isArray(parsed.policies.activate)) {
      action.policies.activate = parsed.policies.activate
        .filter(id => catalogIds.has(id) && !activePolicyIds.includes(id))
        .slice(0, Math.max(0, slotsAvailable));
    }
  }

  // Event choice validation
  if (event && parsed?.eventChoice) {
    const validChoices = event.choices.map(c => c.id);
    action.eventChoice = validChoices.includes(parsed.eventChoice)
      ? parsed.eventChoice
      : event.choices[0]?.id || null;
  } else if (event) {
    action.eventChoice = event.choices[0]?.id || null;
  }

  return action;
}

function getDefaultAction() {
  return {
    reasoning: '',
    budget: { ...DEFAULT_BUDGET },
    policies: { activate: [], deactivate: [] },
    eventChoice: null,
  };
}

// === UI ===
function updateUI(playing) {
  const btnStart = document.getElementById('btn-autoplay');
  const btnStop = document.getElementById('btn-autoplay-stop');
  const select = document.getElementById('autoplay-turns');
  const statusEl = document.getElementById('autoplay-status');
  const endTurnBtn = document.getElementById('btn-end-turn');
  const actionPanel = document.getElementById('action-panel');

  if (playing) {
    if (btnStart) btnStart.style.display = 'none';
    if (select) select.style.display = 'none';
    if (btnStop) btnStop.style.display = '';
    if (statusEl) { statusEl.style.display = ''; statusEl.textContent = '시작 중...'; }
    if (endTurnBtn) endTurnBtn.style.display = 'none';
    actionPanel?.classList.add('autoplay-active');
  } else {
    if (btnStart) btnStart.style.display = '';
    if (select) select.style.display = '';
    if (btnStop) btnStop.style.display = 'none';
    if (statusEl) statusEl.style.display = 'none';
    if (endTurnBtn) endTurnBtn.style.display = '';
    actionPanel?.classList.remove('autoplay-active');
  }
}

function updateStatus(text) {
  const statusEl = document.getElementById('autoplay-status');
  if (statusEl) statusEl.textContent = text;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
