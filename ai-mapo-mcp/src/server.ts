/**
 * server.ts — MCP Server for AI 마포구청장
 *
 * Tools: start_game, advance_turn, get_state
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
  const activePols = state.activePolicies.map(ap => ap.policy.name).join(', ') || '없음';

  let text = `## ${year}년 ${quarterLabel} (${turn}/48턴)

### 핵심 지표
- 총인구: ${totalPop.toLocaleString()}명 (${Number(popDelta) >= 0 ? '+' : ''}${popDelta}%)
- 사업체: ${totalBiz.toLocaleString()}개
- 평균 만족도: ${avgSat}/100
- 재정자립도: ${state.finance.fiscalIndependence}%
- 자유예산: ${state.finance.freeBudget}억원

### 만족도 순위
- 상위: ${top3}
- 하위: ${bottom3}

### 현재 예산 배분
경제 ${state.finance.allocation.economy}% | 교통 ${state.finance.allocation.transport}% | 문화 ${state.finance.allocation.culture}% | 환경 ${state.finance.allocation.environment}% | 교육 ${state.finance.allocation.education}% | 복지 ${state.finance.allocation.welfare}% | 도시재생 ${state.finance.allocation.renewal}%

### 활성 정책: ${activePols}`;

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

      return {
        content: [{
          type: 'text' as const,
          text: `${stateText}\n\n[UI가 업데이트되었습니다. 구청장님의 다음 전략을 조언해주세요.]`,
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
