/**
 * server.ts — MCP Server for AI 마포구청장
 *
 * Tools: start_game (2-phase w/ pledges), advance_turn, get_state, get_policy_catalog, activate_policy, deactivate_policy, choose_event_option
 * UI resource: mcp-app.html (single-file bundle)
 */

import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from '@modelcontextprotocol/ext-apps/server';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createGameState, loadAdjacency, loadPolicies, loadEvents,
  type GameState, type AdjacencyMap, type BudgetAllocation, type PolicyDef, type GameEvent, type ActiveEvent,
} from './engine/game-state.js';
import { tick } from './engine/simulation.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.join(__dirname, '..', 'dist');

// === Session State ===
// For prototype: single game session per server instance
let gameState: GameState | null = null;
let initialState: GameState | null = null;
let adjacency: AdjacencyMap = {};
let policyCatalog: PolicyDef[] = [];
let eventCatalog: GameEvent[] = [];

// Event tracking
let pendingEvent: GameEvent | null = null;  // event awaiting player choice
let eventCooldowns: Record<string, number> = {};  // eventId → turns remaining
let firedOneShots: Set<string> = new Set();

// === Pledge System ===

interface PledgeCandidate {
  id: string;
  name: string;
  description: string;
  difficulty: number; // 1~3
}

const PLEDGE_CANDIDATES: PledgeCandidate[] = [
  { id: 'population_rebound', name: '인구 반등', description: '최종 인구 ≥ 초기값', difficulty: 3 },
  { id: 'fiscal_health', name: '재정 건전', description: '재정자립도 ≥ 초기값+3%p', difficulty: 2 },
  { id: 'tourism_coexist', name: '관광 상생', description: '서교·합정·연남 만족도≥70 & 상권특색≥60', difficulty: 3 },
  { id: 'transport_hub', name: '교통 혁신', description: '구 평균 교통 만족도 ≥ 75', difficulty: 2 },
  { id: 'youth_friendly', name: '청년 친화', description: '청년 인구 비율 ≥ 초기값', difficulty: 2 },
  { id: 'balanced_growth', name: '균형 발전', description: '동간 만족도 표준편차 ≤ 5', difficulty: 2 },
  { id: 'green_mapo', name: '녹색 마포', description: '환경·안전 만족도 평균 ≥ 70', difficulty: 1 },
  { id: 'local_economy', name: '지역 경제', description: '사업체 수 변화 ≥ +5%', difficulty: 3 },
];

function calcPledgeProgress(pledgeId: string, state: GameState, initState: GameState): number {
  const totalPop = state.dongs.reduce((s, d) => s + d.population, 0);
  const initPop = initState.dongs.reduce((s, d) => s + d.population, 0);

  switch (pledgeId) {
    case 'population_rebound':
      return (totalPop / initPop) * 100;

    case 'fiscal_health': {
      const initFiscal = initState.finance.fiscalIndependence || 28;
      const delta = (state.finance.fiscalIndependence || 28) - initFiscal;
      return Math.min(100, (delta / 3) * 100);
    }

    case 'tourism_coexist': {
      const targets = ['seogyo', 'hapjeong', 'yeonnam'];
      const satOk = targets.every(id => (state.dongs.find(d => d.id === id)?.satisfaction || 0) >= 70);
      const charOk = targets.every(id => (state.dongs.find(d => d.id === id)?.commerceCharacter || 0) >= 60);
      const satProg = targets.reduce((s, id) =>
        s + Math.min(100, (state.dongs.find(d => d.id === id)?.satisfaction || 0) / 70 * 100), 0) / 3;
      const charProg = targets.reduce((s, id) =>
        s + Math.min(100, (state.dongs.find(d => d.id === id)?.commerceCharacter || 0) / 60 * 100), 0) / 3;
      return (satOk && charOk) ? 100 : (satProg + charProg) / 2;
    }

    case 'transport_hub': {
      const avg = state.dongs.reduce((s, d) => s + d.satisfactionFactors.transport, 0) / state.dongs.length;
      return Math.min(100, (avg / 75) * 100);
    }

    case 'youth_friendly': {
      const currentYouthRatio = state.dongs.reduce((s, d) => s + d.populationByAge.youth, 0) / totalPop;
      const initYouthRatio = initState.dongs.reduce((s, d) => s + d.populationByAge.youth, 0) / initPop;
      // progress = 100 when current >= initial
      return initYouthRatio > 0 ? Math.min(100, (currentYouthRatio / initYouthRatio) * 100) : 100;
    }

    case 'balanced_growth': {
      const satValues = state.dongs.map(d => d.satisfaction);
      const mean = satValues.reduce((s, v) => s + v, 0) / satValues.length;
      const stdDev = Math.sqrt(satValues.reduce((s, v) => s + (v - mean) ** 2, 0) / satValues.length);
      // σ ≤ 5 = 100%, σ = 15 = 0%, linear between
      if (stdDev <= 5) return 100;
      if (stdDev >= 15) return 0;
      return Math.round((15 - stdDev) / 10 * 100);
    }

    case 'green_mapo': {
      const avg = state.dongs.reduce((s, d) => s + d.satisfactionFactors.safety, 0) / state.dongs.length;
      return Math.min(100, (avg / 70) * 100);
    }

    case 'local_economy': {
      const initBiz = initState.dongs.reduce((s, d) => s + d.businesses, 0);
      const totalBiz = state.dongs.reduce((s, d) => s + d.businesses, 0);
      const changeRate = ((totalBiz - initBiz) / initBiz) * 100;
      // +5% = 100%, 0% = 0%, linear
      return Math.min(100, Math.max(0, (changeRate / 5) * 100));
    }

    default: return 0;
  }
}

function linearScore(value: number, low: number, mid: number, high: number, scores: [number, number, number], max: number): number {
  if (value <= low) return scores[0];
  if (value >= high) return scores[2];
  if (value <= mid) {
    const t = (value - low) / (mid - low);
    return Math.round(scores[0] + t * (scores[1] - scores[0]));
  }
  const t = (value - mid) / (high - mid);
  return Math.min(max, Math.round(scores[1] + t * (scores[2] - scores[1])));
}

function calcFinalScore(state: GameState, initState: GameState): {
  total: number; grade: string;
  kpis: Array<{ id: string; label: string; max: number; score: number; detail: string }>;
  pledgeResults: Array<{ id: string; name: string; achieved: boolean; progress: number; score: number }>;
  kpiTotal: number; pledgeTotal: number;
} {
  const initPop = initState.dongs.reduce((s, d) => s + d.population, 0);
  const totalPop = state.dongs.reduce((s, d) => s + d.population, 0);
  const popChangeRate = ((totalPop - initPop) / initPop) * 100;

  const initBiz = initState.dongs.reduce((s, d) => s + d.businesses, 0);
  const totalBiz = state.dongs.reduce((s, d) => s + d.businesses, 0);
  const initWorkers = initState.dongs.reduce((s, d) => s + d.workers, 0);
  const totalWorkers = state.dongs.reduce((s, d) => s + d.workers, 0);
  const econGrowth = ((totalBiz - initBiz) / initBiz * 100 + (totalWorkers - initWorkers) / initWorkers * 100) / 2;

  const initTax = initState.finance.revenue?.localTax || 613;
  const currentTax = state.finance.revenue?.localTax || 613;
  const taxChange = ((currentTax - initTax) / initTax) * 100;

  const initFiscal = initState.finance.fiscalIndependence || 28;
  const currentFiscal = state.finance.fiscalIndependence || 28;
  const fiscalDelta = currentFiscal - initFiscal;

  const avgSat = state.dongs.reduce((s, d) => s + d.satisfaction, 0) / state.dongs.length;

  const satValues = state.dongs.map(d => d.satisfaction);
  const satMean = satValues.reduce((s, v) => s + v, 0) / satValues.length;
  const satStdDev = Math.sqrt(satValues.reduce((s, v) => s + (v - satMean) ** 2, 0) / satValues.length);

  const kpis = [
    { id: 'population', label: '인구 변화', max: 15, score: linearScore(popChangeRate, -12, -2, 5, [-5, 0, 15], 15), detail: `${popChangeRate >= 0 ? '+' : ''}${popChangeRate.toFixed(1)}%` },
    { id: 'economy', label: '경제 성장', max: 5, score: linearScore(econGrowth, -3, 0, 10, [0, 2, 5], 5), detail: `${econGrowth >= 0 ? '+' : ''}${econGrowth.toFixed(1)}%` },
    { id: 'tax', label: '세수 증감', max: 5, score: linearScore(taxChange, -5, 0, 10, [0, 2, 5], 5), detail: `${taxChange >= 0 ? '+' : ''}${taxChange.toFixed(1)}%` },
    { id: 'fiscal', label: '재정 건전성', max: 10, score: linearScore(fiscalDelta, -3, 0, 7, [0, 5, 10], 10), detail: `${fiscalDelta >= 0 ? '+' : ''}${fiscalDelta.toFixed(1)}%p` },
    { id: 'satisfaction', label: '주민 만족도', max: 12, score: linearScore(avgSat, 42, 52, 72, [0, 8, 12], 12), detail: `평균 ${avgSat.toFixed(0)}` },
    { id: 'balance', label: '균형 발전', max: 10, score: satStdDev < 10 ? 10 : satStdDev < 15 ? 5 : satStdDev > 20 ? 0 : Math.round(5 * (20 - satStdDev) / 5), detail: `σ = ${satStdDev.toFixed(1)}` },
  ];

  const pledgeIds = state.meta.pledges || [];
  const pledgeResults = pledgeIds.map(id => {
    const pledge = PLEDGE_CANDIDATES.find(p => p.id === id);
    const progress = calcPledgeProgress(id, state, initState);
    const achieved = progress >= 100;
    return { id, name: pledge?.name || id, achieved, progress: Math.round(progress), score: achieved ? 15 : -20 };
  });

  const kpiTotal = kpis.reduce((s, k) => s + k.score, 0);
  const pledgeTotal = pledgeResults.reduce((s, p) => s + p.score, 0);
  const total = kpiTotal + pledgeTotal;
  const grade = total >= 100 ? 'S' : total >= 80 ? 'A' : total >= 60 ? 'B' : total >= 40 ? 'C' : total >= 20 ? 'D' : 'F';

  return { total, grade, kpis, pledgeResults, kpiTotal, pledgeTotal };
}

// === Helper: Format state for AI context ===

function formatStateForAI(state: GameState): string {
  const totalPop = state.dongs.reduce((s, d) => s + d.population, 0);
  const totalBiz = state.dongs.reduce((s, d) => s + d.businesses, 0);
  const avgSat = Math.round(state.dongs.reduce((s, d) => s + d.satisfaction, 0) / state.dongs.length);
  const year = state.meta.year;
  const month = state.meta.month;
  const turn = state.meta.turn;

  // Population delta from initial
  const initPop = initialState ? initialState.dongs.reduce((s, d) => s + d.population, 0) : totalPop;
  const popDelta = ((totalPop - initPop) / initPop * 100).toFixed(1);

  // Top/bottom dongs by satisfaction
  const sorted = [...state.dongs].sort((a, b) => b.satisfaction - a.satisfaction);
  const top3 = sorted.slice(0, 3).map(d => `${d.name}(${d.satisfaction})`).join(', ');
  const bottom3 = sorted.slice(-3).reverse().map(d => `${d.name}(${d.satisfaction})`).join(', ');

  // Active policies
  const policyCost = state.activePolicies.reduce((s, ap) => s + ap.policy.cost, 0);

  let text = `## ${year}년 ${month}월 (${turn}/48턴)

### 핵심 지표
- 총인구: ${totalPop.toLocaleString()}명 (${Number(popDelta) >= 0 ? '+' : ''}${popDelta}%)
- 사업체: ${totalBiz.toLocaleString()}개
- 평균 만족도: ${avgSat}/100
- 재정자립도: ${state.finance.fiscalIndependence}%
- 자유예산: ${state.finance.freeBudget}억원 (정책비용 ${policyCost}억원 차감 후)

### 만족도 순위
- 상위: ${top3}
- 하위: ${bottom3}

### 현재 예산 배분
경제 ${state.finance.allocation.economy}% | 교통 ${state.finance.allocation.transport}% | 문화 ${state.finance.allocation.culture}% | 환경 ${state.finance.allocation.environment}% | 교육 ${state.finance.allocation.education}% | 복지 ${state.finance.allocation.welfare}% | 도시재생 ${state.finance.allocation.renewal}%

### 활성 정책 (${state.activePolicies.length}/3)`;

  if (state.activePolicies.length === 0) {
    text += '\n없음 (get_policy_catalog으로 정책 확인, activate_policy로 활성화)';
  } else {
    for (const ap of state.activePolicies) {
      const statusParts = [];
      if (ap.remainDelay > 0) statusParts.push(`대기 ${ap.remainDelay}턴`);
      else if (ap.policy.duration > 0) statusParts.push(`잔여 ${ap.remainDuration}턴`);
      else statusParts.push('효과 적용중');
      text += `\n- ${ap.policy.name} (${ap.policy.cost}억/월, ${statusParts.join(', ')})`;
    }
  }

  // Active events
  if (state.activeEvents.length > 0) {
    text += `\n\n### 진행중 이벤트 효과`;
    for (const ae of state.activeEvents) {
      const event = eventCatalog.find(e => e.id === ae.eventId);
      const eventName = event?.name || ae.eventId;
      const choiceName = ae.choice.name || ae.choice.text || ae.choiceId;
      text += `\n- ${eventName} → ${choiceName} (잔여 ${ae.remainDuration}턴)`;
    }
  }

  // Pending event
  if (pendingEvent) {
    text += `\n\n### ⚠ 대응 필요: ${pendingEvent.name}`;
  }

  // Previous turn changes
  if (state.history.length > 1) {
    const prev = state.history[state.history.length - 2];
    const curr = state.history[state.history.length - 1];
    if (prev && curr) {
      const popChange = curr.totalPopulation - prev.totalPopulation;
      const satChange = curr.avgSatisfaction - prev.avgSatisfaction;
      text += `\n\n### 전턴 대비 변화
- 인구: ${popChange >= 0 ? '+' : ''}${popChange.toLocaleString()}명
- 만족도: ${satChange >= 0 ? '+' : ''}${satChange}`;
    }
  }

  // Pledge progress
  if (state.meta.pledges?.length > 0 && initialState) {
    text += `\n\n### 공약 달성도`;
    for (const id of state.meta.pledges) {
      const pledge = PLEDGE_CANDIDATES.find(p => p.id === id);
      if (!pledge) continue;
      const progress = Math.round(calcPledgeProgress(id, state, initialState));
      const bar = progress >= 100 ? '달성' : `${progress}%`;
      text += `\n- ${pledge.name}: ${bar}`;
    }
  }

  return text;
}

// === Event Trigger Logic (ported from js/event.js) ===

function checkEventTriggers(state: GameState): GameEvent | null {
  const turn = state.meta.turn;

  // Decrement cooldowns
  for (const id of Object.keys(eventCooldowns)) {
    eventCooldowns[id]--;
    if (eventCooldowns[id] <= 0) delete eventCooldowns[id];
  }

  // Collect candidates
  const candidates: GameEvent[] = [];
  for (const event of eventCatalog) {
    if (eventCooldowns[event.id]) continue;
    if (event.oneShot && firedOneShots.has(event.id)) continue;
    if (checkTrigger(event, state, turn)) candidates.push(event);
  }

  if (candidates.length === 0) return null;

  // Probability check
  const triggered: GameEvent[] = [];
  for (const event of candidates) {
    if (Math.random() < (event.probability || 1.0)) triggered.push(event);
  }
  if (triggered.length === 0) return null;

  // Pick one
  const selected = triggered[Math.floor(Math.random() * triggered.length)];

  // Record cooldown + oneShot
  if (selected.cooldown && selected.cooldown > 0) eventCooldowns[selected.id] = selected.cooldown;
  if (selected.oneShot) firedOneShots.add(selected.id);

  return selected;
}

function checkTrigger(event: GameEvent, state: GameState, turn: number): boolean {
  const trigger = event.trigger;
  if (!trigger) return false;

  switch (trigger.type as string) {
    case 'periodic': {
      const startTurn = (trigger.startTurn as number) || 1;
      const interval = (trigger.interval as number) || 4;
      return turn >= startTurn && (turn - startTurn) % interval === 0;
    }

    case 'threshold': {
      const cond = trigger.condition as Record<string, unknown> | undefined;
      if (!cond) return false;

      if (cond.dong) {
        const dong = state.dongs.find(d => d.id === cond.dong);
        if (!dong) return false;
        return checkCondition(
          getMetricValue(dong, cond.metric as string),
          cond.operator as string,
          cond.value as number,
        );
      } else if (cond.minDongCount) {
        const count = state.dongs.filter(d =>
          checkCondition(getMetricValue(d, cond.metric as string), cond.operator as string, cond.value as number)
        ).length;
        return count >= (cond.minDongCount as number);
      }
      return false;
    }

    case 'random': {
      const minTurn = (trigger.minTurn as number) || 1;
      const prob = (trigger.probabilityPerTurn as number) || 0.1;
      return turn >= minTurn && Math.random() < prob;
    }

    case 'turn': {
      const minTurn = (trigger.minTurn as number) || 1;
      if (turn < minTurn) return false;
      const addCond = trigger.additionalCondition as Record<string, unknown> | undefined;
      if (addCond) {
        const dong = state.dongs.find(d => d.id === addCond.dong);
        if (!dong) return false;
        return checkCondition(
          getMetricValue(dong, addCond.metric as string),
          addCond.operator as string,
          addCond.value as number,
        );
      }
      return true;
    }

    default:
      return false;
  }
}

function getMetricValue(dong: GameState['dongs'][0], metric: string): number {
  if (metric === 'elderlyRatio') {
    return (dong.populationByAge?.elderly || 0) / Math.max(1, dong.population);
  }
  return (dong as unknown as Record<string, number>)[metric] ?? 0;
}

function checkCondition(value: number, operator: string, threshold: number): boolean {
  switch (operator) {
    case '>': return value > threshold;
    case '<': return value < threshold;
    case '>=': return value >= threshold;
    case '<=': return value <= threshold;
    case '==': return value === threshold;
    default: return false;
  }
}

function formatEventForAI(event: GameEvent, state: GameState): string {
  const dongNames = (event.affectedDongs || []).map(id => {
    const dong = state.dongs.find(d => d.id === id);
    return dong ? dong.name : id;
  });

  let text = `\n\n### 이벤트 발생: ${event.name}\n\n`;
  text += `${event.description}\n\n`;
  text += `영향 동: ${dongNames.join(', ')}\n\n`;
  text += `**선택지** (choose_event_option 도구로 선택하세요):\n\n`;

  for (const choice of event.choices) {
    const costStr = choice.cost && choice.cost > 0 ? ` (${choice.cost}억원)` : ' (무료)';
    text += `**${choice.name || choice.text}** (id: \`${choice.id}\`)${costStr}\n`;
    text += `${choice.description || choice.text}\n`;
    if (choice.advisorComment) text += `> 자문: ${choice.advisorComment}\n`;
    text += '\n';
  }

  text += `이벤트에 대응하려면 choose_event_option을 호출하세요. 이벤트 대응 전까지 턴을 진행할 수 없습니다.`;

  return text;
}

// === Server Creation ===

export function createServer(): McpServer {
  const server = new McpServer({
    name: 'ai-mapo',
    version: '0.1.0',
  });

  const resourceUri = 'ui://start-game/mcp-app.html';

  // === Tool: start_game ===
  registerAppTool(
    server,
    'start_game',
    {
      title: '마포구청장 게임 시작',
      description: `마포구청장 도시 경영 시뮬레이션을 시작합니다.
당신은 마포구 도시계획 자문관 역할입니다. 구청장(사용자)에게 데이터 기반 분석과 전략 조언을 제공하세요.
게임은 48턴(4년)으로 구성되며, 매 턴 예산 배분과 정책을 통해 마포구를 발전시킵니다.

**2단계 시작:**
1. pledges 없이 호출 → 공약 후보 8개 반환 (구청장에게 1~4개 선택 요청)
2. pledges에 선택된 공약 ID 배열로 재호출 → 게임 시작

공약은 임기 말 달성 여부로 점수에 반영됩니다. 난이도가 높을수록 도전적이지만 성취감도 큽니다.`,
      inputSchema: z.object({
        pledges: z.array(z.string()).min(1).max(4)
          .describe('선택한 공약 ID 배열 (1~4개). 생략하면 후보 목록 반환.')
          .optional(),
      }),
      _meta: { ui: { resourceUri } },
    },
    async (args) => {
      const pledgeIds = args.pledges as string[] | undefined;

      // Phase 1: No pledges → return candidate list
      if (!pledgeIds || pledgeIds.length === 0) {
        // Pre-load data for fast phase 2
        adjacency = await loadAdjacency();
        policyCatalog = await loadPolicies();
        eventCatalog = await loadEvents();

        const difficultyStars: Record<number, string> = { 1: '★☆☆', 2: '★★☆', 3: '★★★' };
        let text = `# 마포구청장 취임 — 공약 선택\n\n`;
        text += `구청장님, 취임을 축하합니다! 임기를 시작하기 전에 구민에게 약속할 공약을 선택해주세요.\n\n`;
        text += `**1~4개의 공약**을 선택하세요. 달성하면 +15점, 미달성 시 -20점입니다.\n\n`;
        text += `| ID | 공약명 | 조건 | 난이도 |\n`;
        text += `|---|---|---|---|\n`;
        for (const p of PLEDGE_CANDIDATES) {
          text += `| \`${p.id}\` | ${p.name} | ${p.description} | ${difficultyStars[p.difficulty]} |\n`;
        }
        text += `\n구청장님의 선택을 듣고, start_game에 pledges 배열을 전달하여 게임을 시작하세요.`;

        return { content: [{ type: 'text' as const, text }] };
      }

      // Phase 2: Validate pledges and start game
      const invalidIds = pledgeIds.filter(id => !PLEDGE_CANDIDATES.find(p => p.id === id));
      if (invalidIds.length > 0) {
        const validIds = PLEDGE_CANDIDATES.map(p => p.id).join(', ');
        return { content: [{ type: 'text' as const, text: `잘못된 공약 ID: ${invalidIds.join(', ')}\n사용 가능: ${validIds}` }] };
      }

      // Initialize game
      gameState = await createGameState();
      gameState.meta.pledges = pledgeIds;
      initialState = JSON.parse(JSON.stringify(gameState));
      adjacency = await loadAdjacency();
      policyCatalog = await loadPolicies();
      eventCatalog = await loadEvents();

      // Reset event state
      pendingEvent = null;
      eventCooldowns = {};
      firedOneShots = new Set();

      const stateText = formatStateForAI(gameState);

      // Format selected pledges
      const selectedPledges = pledgeIds.map(id => {
        const p = PLEDGE_CANDIDATES.find(c => c.id === id)!;
        return `- **${p.name}**: ${p.description}`;
      }).join('\n');

      return {
        content: [{
          type: 'text' as const,
          text: `# 마포구청장 게임 시작

구청장님, 취임을 축하합니다! 마포구의 미래가 당신의 손에 달려있습니다.

### 선택한 공약
${selectedPledges}

${stateText}

### 게임 안내
- 48턴(4년) 동안 마포구를 운영합니다
- 매 턴: 예산 배분(7개 분야) → 턴 종료 → 시뮬레이션 결과
- UI에서 예산 조정 후 "턴 종료"를 누르거나, 저에게 전략을 물어보세요
- 공약 달성과 핵심 KPI로 최종 성적이 결정됩니다

[게임 UI가 표시되었습니다. 자문이 필요하면 말씀하세요.]`,
        }],
      };
    },
  );

  // === Tool: advance_turn ===
  registerAppTool(
    server,
    'advance_turn',
    {
      title: '턴 진행',
      description: '현재 예산 배분으로 1턴을 진행합니다. 시뮬레이션이 실행되고 결과를 반환합니다.',
      inputSchema: z.object({
        budget: z.object({
          economy: z.number().describe('경제·일자리 예산 %'),
          transport: z.number().describe('교통 예산 %'),
          culture: z.number().describe('문화·관광 예산 %'),
          environment: z.number().describe('환경·안전 예산 %'),
          education: z.number().describe('교육 예산 %'),
          welfare: z.number().describe('복지 예산 %'),
          renewal: z.number().describe('도시재생 예산 %'),
        }).describe('예산 배분 (합계 100). 생략시 현재 배분 유지.').optional(),
      }),
      _meta: { ui: { resourceUri } },
    },
    async (args) => {
      if (!gameState) {
        return { content: [{ type: 'text' as const, text: '게임이 시작되지 않았습니다. start_game을 먼저 호출하세요.' }] };
      }

      if (gameState.meta.turn > 48) {
        return { content: [{ type: 'text' as const, text: '게임이 이미 종료되었습니다. (48턴 완료)' }] };
      }

      // Block if pending event not resolved
      if (pendingEvent) {
        return { content: [{ type: 'text' as const, text: `이벤트 대응이 필요합니다: ${pendingEvent.name}\nchoose_event_option으로 선택지를 결정한 후 턴을 진행하세요.` }] };
      }

      // Apply budget if provided
      const budget = args.budget as BudgetAllocation | undefined;
      if (budget) {
        const sum = Object.values(budget).reduce((s, v) => s + (v || 0), 0);
        if (Math.abs(sum - 100) > 1) {
          return { content: [{ type: 'text' as const, text: `예산 합계가 100이 아닙니다 (현재: ${sum}). 다시 시도하세요.` }] };
        }
        gameState.finance.allocation = { ...gameState.finance.allocation, ...budget };
      }

      // Save history snapshot before tick
      const totalPop = gameState.dongs.reduce((s, d) => s + d.population, 0);
      const avgSat = Math.round(gameState.dongs.reduce((s, d) => s + d.satisfaction, 0) / gameState.dongs.length);
      gameState.history.push({
        turn: gameState.meta.turn,
        totalPopulation: totalPop,
        avgSatisfaction: avgSat,
        fiscalIndependence: gameState.finance.fiscalIndependence,
        dongs: gameState.dongs.map(d => ({
          id: d.id, population: d.population, satisfaction: d.satisfaction, businesses: d.businesses,
        })),
      });

      // Run simulation tick
      gameState = tick(gameState, {
        budget: gameState.finance.allocation,
        policies: [],
        eventChoice: null,
      }, adjacency);

      // Advance turn counter
      gameState.meta.turn++;
      gameState.meta.month = ((gameState.meta.turn - 1) % 12) + 1;
      gameState.meta.year = 2026 + Math.floor((gameState.meta.turn - 1) / 12);

      // Update pledge progress on state (for AI context)
      if (gameState.meta.pledges?.length > 0 && initialState) {
        gameState._pledgeProgress = {};
        for (const id of gameState.meta.pledges) {
          gameState._pledgeProgress[id] = calcPledgeProgress(id, gameState, initialState);
        }
      }

      const stateText = formatStateForAI(gameState);

      // Check game end
      if (gameState.meta.turn > 48) {
        let endText = `# 게임 종료 — 임기 완료!\n\n${stateText}\n\n`;

        if (initialState) {
          const result = calcFinalScore(gameState, initialState);

          endText += `## 최종 성적: ${result.grade}등급 (${result.total}점)\n\n`;

          endText += `### KPI 평가 (${result.kpiTotal}/70)\n`;
          endText += `| 항목 | 결과 | 점수 |\n|---|---|---|\n`;
          for (const kpi of result.kpis) {
            endText += `| ${kpi.label} | ${kpi.detail} | ${kpi.score}/${kpi.max} |\n`;
          }

          if (result.pledgeResults.length > 0) {
            endText += `\n### 공약 평가 (${result.pledgeTotal}점)\n`;
            endText += `| 공약 | 진행도 | 결과 | 점수 |\n|---|---|---|---|\n`;
            for (const p of result.pledgeResults) {
              endText += `| ${p.name} | ${p.progress}% | ${p.achieved ? '달성' : '미달성'} | ${p.score >= 0 ? '+' : ''}${p.score} |\n`;
            }
          }

          endText += `\n---\n총점: KPI ${result.kpiTotal} + 공약 ${result.pledgeTotal} = **${result.total}점 (${result.grade}등급)**`;
          endText += `\n\n4년간의 마포구 운영을 종합 분석해주세요.`;
        }

        return {
          content: [{
            type: 'text' as const,
            text: endText,
          }],
        };
      }

      // Check for new event
      const event = checkEventTriggers(gameState);
      let eventText = '';
      if (event) {
        pendingEvent = event;
        eventText = formatEventForAI(event, gameState);
      }

      return {
        content: [{
          type: 'text' as const,
          text: `${stateText}${eventText}\n\n[UI가 업데이트되었습니다. ${event ? '이벤트에 대응하세요!' : '구청장님의 다음 전략을 조언해주세요.'}]`,
        }],
      };
    },
  );

  // === Tool: get_state ===
  registerAppTool(
    server,
    'get_state',
    {
      title: '현재 게임 상태 조회',
      description: '현재 게임 상태를 상세하게 조회합니다. 동별 데이터, 재정, 인구 구조 등을 확인할 수 있습니다.',
      inputSchema: z.object({
        dongId: z.string().describe('특정 동 ID (선택). 생략시 전체 요약.').optional(),
      }),
      _meta: { ui: { resourceUri } },
    },
    async (args) => {
      if (!gameState) {
        return { content: [{ type: 'text' as const, text: '게임이 시작되지 않았습니다.' }] };
      }

      const dongId = args.dongId as string | undefined;

      if (dongId) {
        const dong = gameState.dongs.find(d => d.id === dongId);
        if (!dong) {
          const available = gameState.dongs.map(d => `${d.id}(${d.name})`).join(', ');
          return { content: [{ type: 'text' as const, text: `동을 찾을 수 없습니다: ${dongId}\n사용 가능: ${available}` }] };
        }
        return {
          content: [{
            type: 'text' as const,
            text: formatDongDetail(dong),
          }],
        };
      }

      // Full state summary
      return {
        content: [{
          type: 'text' as const,
          text: formatStateForAI(gameState) + '\n\n' + formatAllDongs(gameState),
        }],
      };
    },
  );

  // === Tool: get_policy_catalog ===
  registerAppTool(
    server,
    'get_policy_catalog',
    {
      title: '정책 카탈로그 조회',
      description: '활성화 가능한 정책 목록을 카테고리별로 반환합니다. 비용, 효과, 대상 동, 딜레이 등을 확인할 수 있습니다.',
      inputSchema: z.object({
        category: z.string().describe('카테고리 필터 (economy, transport, culture, environment, education, welfare, renewal). 생략시 전체.').optional(),
      }),
      _meta: { ui: { resourceUri } },
    },
    async (args) => {
      if (!gameState) {
        return { content: [{ type: 'text' as const, text: '게임이 시작되지 않았습니다.' }] };
      }

      const category = args.category as string | undefined;
      const filtered = category
        ? policyCatalog.filter(p => p.category === category)
        : policyCatalog;

      const activeIds = new Set(gameState.activePolicies.map(ap => ap.policy.id));

      const categoryNames: Record<string, string> = {
        economy: '경제·일자리', transport: '교통', culture: '문화·관광',
        environment: '환경·안전', education: '교육', welfare: '복지', renewal: '도시재생',
      };

      const grouped: Record<string, PolicyDef[]> = {};
      for (const p of filtered) {
        if (!grouped[p.category]) grouped[p.category] = [];
        grouped[p.category].push(p);
      }

      let text = `## 정책 카탈로그\n\n`;
      text += `현재 자유예산: ${gameState.finance.freeBudget}억원\n`;
      text += `활성 정책 비용: ${gameState.activePolicies.reduce((s, ap) => s + ap.policy.cost, 0)}억원/월\n\n`;

      for (const [cat, policies] of Object.entries(grouped)) {
        text += `### ${categoryNames[cat] || cat}\n\n`;
        for (const p of policies) {
          const status = activeIds.has(p.id) ? ' [활성]' : '';
          const target = p.targetDong
            ? (Array.isArray(p.targetDong) ? p.targetDong.join(', ') : p.targetDong)
            : '구 전체';
          const incompatStr = p.incompatible?.length ? ` | 상충: ${p.incompatible.join(', ')}` : '';

          text += `- **${p.name}**${status} (id: \`${p.id}\`)\n`;
          text += `  비용: ${p.cost}억/월 | 딜레이: ${p.delay}턴 | 지속: ${p.duration === 0 ? '영구' : p.duration + '턴'} | 대상: ${target}${incompatStr}\n`;
          text += `  ${p.description || ''}\n\n`;
        }
      }

      return { content: [{ type: 'text' as const, text }] };
    },
  );

  // === Tool: activate_policy ===
  registerAppTool(
    server,
    'activate_policy',
    {
      title: '정책 활성화',
      description: `정책을 활성화합니다. 정책 비용은 매 턴 자유예산에서 차감됩니다.
get_policy_catalog으로 정책 목록을 확인한 후 policyId를 지정하세요.
최대 3개 정책을 동시 운영할 수 있습니다.`,
      inputSchema: z.object({
        policyId: z.string().describe('활성화할 정책 ID (예: "econ_startup_hub")'),
      }),
      _meta: { ui: { resourceUri } },
    },
    async (args) => {
      if (!gameState) {
        return { content: [{ type: 'text' as const, text: '게임이 시작되지 않았습니다.' }] };
      }

      const policyId = args.policyId as string;
      const policy = policyCatalog.find(p => p.id === policyId);

      if (!policy) {
        const available = policyCatalog.map(p => p.id).join(', ');
        return { content: [{ type: 'text' as const, text: `정책을 찾을 수 없습니다: ${policyId}\n사용 가능: ${available}` }] };
      }

      // Check if already active
      if (gameState.activePolicies.some(ap => ap.policy.id === policyId)) {
        return { content: [{ type: 'text' as const, text: `이미 활성화된 정책입니다: ${policy.name}` }] };
      }

      // Check max 3 policies
      if (gameState.activePolicies.length >= 3) {
        const active = gameState.activePolicies.map(ap => `${ap.policy.name}(${ap.policy.id})`).join(', ');
        return { content: [{ type: 'text' as const, text: `최대 3개 정책만 동시 운영 가능합니다.\n현재 활성: ${active}\n먼저 deactivate_policy로 기존 정책을 해제하세요.` }] };
      }

      // Check incompatible policies
      if (policy.incompatible?.length) {
        const conflict = gameState.activePolicies.find(ap =>
          policy.incompatible!.includes(ap.policy.id)
        );
        if (conflict) {
          return { content: [{ type: 'text' as const, text: `상충 정책이 활성화되어 있습니다: ${conflict.policy.name}(${conflict.policy.id})\n먼저 해제하거나, 다른 정책을 선택하세요.` }] };
        }
      }

      // Check budget
      const currentPolicyCost = gameState.activePolicies.reduce((s, ap) => s + ap.policy.cost, 0);
      const newTotalCost = currentPolicyCost + policy.cost;
      const freeBudgetBeforePolicies = gameState.finance.freeBudget + currentPolicyCost;
      if (newTotalCost > freeBudgetBeforePolicies) {
        return { content: [{ type: 'text' as const, text: `예산이 부족합니다.\n자유예산: ${freeBudgetBeforePolicies}억원\n현재 정책비용: ${currentPolicyCost}억원\n추가 비용: ${policy.cost}억원\n필요: ${newTotalCost}억원` }] };
      }

      // Activate
      gameState.activePolicies.push({
        policy,
        remainDelay: policy.delay || 0,
        remainDuration: policy.duration || 0,
        turnsActive: 0,
      });

      // Update finance
      gameState.finance.policyCost = newTotalCost;
      gameState.finance.freeBudget = freeBudgetBeforePolicies - newTotalCost;

      const delayText = policy.delay > 0 ? `${policy.delay}턴 후 효과 발현` : '즉시 효과 발현';
      const durationText = policy.duration === 0 ? '영구 지속 (해제 가능)' : `${policy.duration}턴 지속`;

      let text = `## 정책 활성화: ${policy.name}\n\n`;
      text += `- 비용: ${policy.cost}억원/월\n`;
      text += `- ${delayText}\n`;
      text += `- ${durationText}\n`;
      text += `- 잔여 자유예산: ${gameState.finance.freeBudget}억원\n\n`;
      text += `${policy.description}\n\n`;

      // Show all active policies
      text += `### 현재 활성 정책 (${gameState.activePolicies.length}/3)\n`;
      for (const ap of gameState.activePolicies) {
        const statusParts = [];
        if (ap.remainDelay > 0) statusParts.push(`대기 ${ap.remainDelay}턴`);
        else if (ap.policy.duration > 0) statusParts.push(`잔여 ${ap.remainDuration}턴`);
        else statusParts.push('영구');
        text += `- ${ap.policy.name} (${ap.policy.cost}억/월, ${statusParts.join(', ')})\n`;
      }

      return { content: [{ type: 'text' as const, text }] };
    },
  );

  // === Tool: deactivate_policy ===
  registerAppTool(
    server,
    'deactivate_policy',
    {
      title: '정책 해제',
      description: '활성화된 정책을 해제합니다. 해제하면 비용 차감이 중지되고 효과도 사라집니다.',
      inputSchema: z.object({
        policyId: z.string().describe('해제할 정책 ID'),
      }),
      _meta: { ui: { resourceUri } },
    },
    async (args) => {
      if (!gameState) {
        return { content: [{ type: 'text' as const, text: '게임이 시작되지 않았습니다.' }] };
      }

      const policyId = args.policyId as string;
      const idx = gameState.activePolicies.findIndex(ap => ap.policy.id === policyId);

      if (idx === -1) {
        if (gameState.activePolicies.length === 0) {
          return { content: [{ type: 'text' as const, text: '활성화된 정책이 없습니다.' }] };
        }
        const active = gameState.activePolicies.map(ap => `${ap.policy.name}(${ap.policy.id})`).join(', ');
        return { content: [{ type: 'text' as const, text: `활성 정책에서 찾을 수 없습니다: ${policyId}\n현재 활성: ${active}` }] };
      }

      const removed = gameState.activePolicies.splice(idx, 1)[0];

      // Update finance
      const newPolicyCost = gameState.activePolicies.reduce((s, ap) => s + ap.policy.cost, 0);
      const freeBudgetBeforePolicies = gameState.finance.freeBudget + (gameState.finance.policyCost || 0);
      gameState.finance.policyCost = newPolicyCost;
      gameState.finance.freeBudget = freeBudgetBeforePolicies - newPolicyCost;

      let text = `## 정책 해제: ${removed.policy.name}\n\n`;
      text += `- 절감 비용: ${removed.policy.cost}억원/월\n`;
      text += `- 잔여 자유예산: ${gameState.finance.freeBudget}억원\n\n`;

      if (gameState.activePolicies.length > 0) {
        text += `### 남은 활성 정책 (${gameState.activePolicies.length}/3)\n`;
        for (const ap of gameState.activePolicies) {
          text += `- ${ap.policy.name} (${ap.policy.cost}억/월)\n`;
        }
      } else {
        text += `활성 정책이 없습니다. get_policy_catalog으로 정책을 확인하세요.\n`;
      }

      return { content: [{ type: 'text' as const, text }] };
    },
  );

  // === Tool: choose_event_option ===
  registerAppTool(
    server,
    'choose_event_option',
    {
      title: '이벤트 선택지 결정',
      description: `발생한 이벤트에 대한 대응을 선택합니다.
이벤트가 발생하면 advance_turn 결과에 선택지가 표시됩니다.
구청장의 의향을 파악한 후 적절한 선택지를 결정하세요.
이벤트 대응 전까지 다음 턴을 진행할 수 없습니다.`,
      inputSchema: z.object({
        choiceId: z.string().describe('선택지 ID (이벤트 결과에 표시된 id 값)'),
      }),
      _meta: { ui: { resourceUri } },
    },
    async (args) => {
      if (!gameState) {
        return { content: [{ type: 'text' as const, text: '게임이 시작되지 않았습니다.' }] };
      }

      if (!pendingEvent) {
        return { content: [{ type: 'text' as const, text: '현재 대응할 이벤트가 없습니다.' }] };
      }

      const choiceId = args.choiceId as string;
      const choice = pendingEvent.choices.find(c => c.id === choiceId);

      if (!choice) {
        const available = pendingEvent.choices.map(c =>
          `${c.id} (${c.name || c.text})`
        ).join(', ');
        return { content: [{ type: 'text' as const, text: `선택지를 찾을 수 없습니다: ${choiceId}\n사용 가능: ${available}` }] };
      }

      // Add to activeEvents for ongoing effects
      const activeEvent: ActiveEvent = {
        eventId: pendingEvent.id,
        choiceId: choiceId,
        choice: choice,
        affectedDongs: pendingEvent.affectedDongs || [],
        totalDuration: choice.duration || 1,
        remainDuration: choice.duration || 1,
      };

      gameState.activeEvents.push(activeEvent);

      // Build response
      const choiceName = choice.name || choice.text;
      const choiceCost = choice.cost || 0;
      const advisorComment = choice.advisorComment || '';
      const dongNames = (pendingEvent.affectedDongs || []).map(id => {
        const dong = gameState!.dongs.find(d => d.id === id);
        return dong ? dong.name : id;
      });

      let text = `## 이벤트 대응: ${pendingEvent.name}\n\n`;
      text += `선택: **${choiceName}**\n`;
      if (choiceCost > 0) text += `비용: ${choiceCost}억원\n`;
      text += `효과 지속: ${choice.duration || 1}턴\n`;
      text += `영향 동: ${dongNames.join(', ')}\n\n`;

      // Show effects summary
      if (choice.effects && Object.keys(choice.effects).length > 0) {
        text += `### 예상 효과\n`;
        for (const [category, vals] of Object.entries(choice.effects)) {
          if (category === 'delayed_completion') continue;
          const effects = Object.entries(vals as Record<string, number>)
            .map(([k, v]) => `${k}: ${v >= 0 ? '+' : ''}${v}`)
            .join(', ');
          text += `- ${category}: ${effects}\n`;
        }
        text += '\n';
      }

      if (advisorComment) {
        text += `> 자문관 의견: ${advisorComment}\n\n`;
      }

      text += `이벤트가 처리되었습니다. 다음 턴을 진행할 수 있습니다.`;

      // Clear pending event
      pendingEvent = null;

      return { content: [{ type: 'text' as const, text }] };
    },
  );

  // === UI Resource ===
  registerAppResource(
    server,
    resourceUri,
    resourceUri,
    { mimeType: RESOURCE_MIME_TYPE },
    async () => {
      const html = await fs.readFile(
        path.join(DIST_DIR, 'mcp-app.html'),
        'utf-8',
      );
      return {
        contents: [{ uri: resourceUri, mimeType: RESOURCE_MIME_TYPE, text: html }],
      };
    },
  );

  return server;
}

// === Formatting Helpers ===

function formatDongDetail(dong: GameState['dongs'][0]): string {
  const chars: Record<string, string> = {
    seogyo: '관광·문화·스타트업', hapjeong: '미디어·카페문화',
    yeonnam: '트렌디·경의선숲길', mangwon1: '로컬브랜드·전통시장',
    mangwon2: '주거·한강접근', gongdeok: '교통허브·업무지구',
    ahyeon: '뉴타운·고급주거', dohwa: '주거·경공업',
    yonggang: '업무·상업', daeheung: '대학가·상권',
    yeomni: '주거·소금길마을', sinsu: '주거·경의선숲길',
    seogang: '대학가·문화', seongsan1: '주거·월드컵공원',
    seongsan2: '대단지·교육', sangam: 'DMC·미디어',
  };

  return `## ${dong.name} (${chars[dong.id] || ''})

### 인구
- 총인구: ${dong.population.toLocaleString()}명
- 세대수: ${dong.households.toLocaleString()}
- 청년(20-34): ${dong.populationByAge.youth.toLocaleString()}명 (${(dong.populationByAge.youth / dong.population * 100).toFixed(1)}%)
- 고령(65+): ${dong.populationByAge.elderly.toLocaleString()}명 (${(dong.populationByAge.elderly / dong.population * 100).toFixed(1)}%)

### 경제
- 사업체: ${dong.businesses.toLocaleString()}개
- 종사자: ${dong.workers.toLocaleString()}명
- 상권활력: ${dong.commerceVitality}
- 임대료압력: ${dong.rentPressure.toFixed(4)}
- 상권특색: ${dong.commerceCharacter}

### 만족도: ${dong.satisfaction}
- 경제: ${dong.satisfactionFactors.economy} | 교통: ${dong.satisfactionFactors.transport}
- 주거: ${dong.satisfactionFactors.housing} | 안전: ${dong.satisfactionFactors.safety}
- 문화: ${dong.satisfactionFactors.culture} | 복지: ${dong.satisfactionFactors.welfare}`;
}

function formatAllDongs(state: GameState): string {
  const lines = ['### 16개 동 현황', '| 동 | 인구 | 만족도 | 사업체 | 상권활력 |', '|---|---|---|---|---|'];
  for (const d of [...state.dongs].sort((a, b) => b.satisfaction - a.satisfaction)) {
    lines.push(`| ${d.name} | ${d.population.toLocaleString()} | ${d.satisfaction} | ${d.businesses.toLocaleString()} | ${d.commerceVitality} |`);
  }
  return lines.join('\n');
}
