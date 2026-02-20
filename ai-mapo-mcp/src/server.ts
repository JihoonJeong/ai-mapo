/**
 * server.ts — MCP Server for AI 마포구청장
 *
 * Tools: start_game, advance_turn, get_state, get_policy_catalog, activate_policy, deactivate_policy, choose_event_option
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

// === Helper: Format state for AI context ===

function formatStateForAI(state: GameState): string {
  const totalPop = state.dongs.reduce((s, d) => s + d.population, 0);
  const totalBiz = state.dongs.reduce((s, d) => s + d.businesses, 0);
  const avgSat = Math.round(state.dongs.reduce((s, d) => s + d.satisfaction, 0) / state.dongs.length);
  const year = state.meta.year;
  const quarter = state.meta.quarter;
  const turn = state.meta.turn;

  const quarterLabel = ['1분기', '2분기', '3분기', '4분기'][quarter - 1];

  // Population delta from initial
  const initPop = initialState ? initialState.dongs.reduce((s, d) => s + d.population, 0) : totalPop;
  const popDelta = ((totalPop - initPop) / initPop * 100).toFixed(1);

  // Top/bottom dongs by satisfaction
  const sorted = [...state.dongs].sort((a, b) => b.satisfaction - a.satisfaction);
  const top3 = sorted.slice(0, 3).map(d => `${d.name}(${d.satisfaction})`).join(', ');
  const bottom3 = sorted.slice(-3).reverse().map(d => `${d.name}(${d.satisfaction})`).join(', ');

  // Active policies
  const policyCost = state.activePolicies.reduce((s, ap) => s + ap.policy.cost, 0);

  let text = `## ${year}년 ${quarterLabel} (${turn}/48턴)

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
      text += `\n- ${ap.policy.name} (${ap.policy.cost}억/분기, ${statusParts.join(', ')})`;
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
게임은 48턴(12년)으로 구성되며, 매 턴 예산 배분과 정책을 통해 마포구를 발전시킵니다.
게임이 시작되면 현 상황을 브리핑하고, 첫 턴 전략을 제안하세요.`,
      inputSchema: {},
      _meta: { ui: { resourceUri } },
    },
    async () => {
      // Initialize game
      gameState = await createGameState();
      initialState = JSON.parse(JSON.stringify(gameState));
      adjacency = await loadAdjacency();
      policyCatalog = await loadPolicies();
      eventCatalog = await loadEvents();

      // Reset event state
      pendingEvent = null;
      eventCooldowns = {};
      firedOneShots = new Set();

      const stateText = formatStateForAI(gameState);

      return {
        content: [{
          type: 'text' as const,
          text: `# 마포구청장 게임 시작

구청장님, 취임을 축하합니다! 마포구의 미래가 당신의 손에 달려있습니다.

${stateText}

### 게임 안내
- 48턴(12년) 동안 마포구를 운영합니다
- 매 턴: 예산 배분(7개 분야) → 턴 종료 → 시뮬레이션 결과
- UI에서 예산 조정 후 "턴 종료"를 누르거나, 저에게 전략을 물어보세요
- 16개 동의 인구, 경제, 만족도를 균형있게 발전시키는 것이 목표입니다

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
      gameState.meta.quarter = ((gameState.meta.turn - 1) % 4) + 1;
      gameState.meta.year = 2026 + Math.floor((gameState.meta.turn - 1) / 4);

      const stateText = formatStateForAI(gameState);

      // Check game end
      if (gameState.meta.turn > 48) {
        return {
          content: [{
            type: 'text' as const,
            text: `# 게임 종료!\n\n${stateText}\n\n임기가 끝났습니다. 12년간의 마포구 운영 결과를 분석해주세요.`,
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
      text += `활성 정책 비용: ${gameState.activePolicies.reduce((s, ap) => s + ap.policy.cost, 0)}억원/분기\n\n`;

      for (const [cat, policies] of Object.entries(grouped)) {
        text += `### ${categoryNames[cat] || cat}\n\n`;
        for (const p of policies) {
          const status = activeIds.has(p.id) ? ' [활성]' : '';
          const target = p.targetDong
            ? (Array.isArray(p.targetDong) ? p.targetDong.join(', ') : p.targetDong)
            : '구 전체';
          const incompatStr = p.incompatible?.length ? ` | 상충: ${p.incompatible.join(', ')}` : '';

          text += `- **${p.name}**${status} (id: \`${p.id}\`)\n`;
          text += `  비용: ${p.cost}억/분기 | 딜레이: ${p.delay}턴 | 지속: ${p.duration === 0 ? '영구' : p.duration + '턴'} | 대상: ${target}${incompatStr}\n`;
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
      text += `- 비용: ${policy.cost}억원/분기\n`;
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
        text += `- ${ap.policy.name} (${ap.policy.cost}억/분기, ${statusParts.join(', ')})\n`;
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
      text += `- 절감 비용: ${removed.policy.cost}억원/분기\n`;
      text += `- 잔여 자유예산: ${gameState.finance.freeBudget}억원\n\n`;

      if (gameState.activePolicies.length > 0) {
        text += `### 남은 활성 정책 (${gameState.activePolicies.length}/3)\n`;
        for (const ap of gameState.activePolicies) {
          text += `- ${ap.policy.name} (${ap.policy.cost}억/분기)\n`;
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
