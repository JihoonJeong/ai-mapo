/**
 * app.ts — MCP App UI entry point
 *
 * Connects to host via App SDK, renders map + dashboard,
 * handles tool results and user interactions.
 */

import { App } from '@modelcontextprotocol/ext-apps';
import { initMap, updateMap } from './map.js';
import { updateDashboard } from './dashboard.js';

// Inline SVG content (will be bundled by Vite)
import mapSvgRaw from './mapo_map.svg?raw';

interface GameState {
  meta: { turn: number; year: number; quarter: number };
  dongs: Array<{
    id: string;
    name: string;
    population: number;
    businesses: number;
    workers: number;
    satisfaction: number;
    satisfactionFactors: Record<string, number>;
    commerceVitality: number;
    rentPressure: number;
    fiscalIndependence?: number;
    populationByAge: Record<string, number>;
  }>;
  finance: {
    totalBudget: number;
    freeBudget: number;
    fiscalIndependence: number;
    allocation: Record<string, number>;
  };
  history: Array<{
    turn: number;
    totalPopulation: number;
    avgSatisfaction: number;
  }>;
}

// === State ===
let gameState: GameState | null = null;
let app: InstanceType<typeof App>;

// === DOM Elements ===
const turnInfoEl = document.getElementById('turn-info')!;
const statusTextEl = document.getElementById('status-text')!;
const btnEndTurn = document.getElementById('btn-end-turn') as HTMLButtonElement;

// === Initialize App SDK ===
app = new App({ name: 'AI 마포구청장', version: '0.1.0' });

// Handle tool results from server (pushed by host after tool calls)
app.ontoolresult = (result) => {
  // Parse state from JSON content if available
  const textContent = result.content?.find((c: { type: string }) => c.type === 'text');
  if (textContent && 'text' in textContent) {
    // The server sends markdown text, not raw JSON
    // We need to call get_state to get the actual data
    refreshState();
  }
};

// === Button Handlers ===
btnEndTurn.addEventListener('click', async () => {
  btnEndTurn.disabled = true;
  statusTextEl.textContent = '시뮬레이션 실행 중...';

  try {
    const result = await app.callServerTool({
      name: 'advance_turn',
      arguments: {},
    });

    // After advancing, refresh the full state
    await refreshState();

    // Check if game ended
    if (gameState && gameState.meta.turn > 48) {
      showGameOver();
    }
  } catch (err) {
    console.error('advance_turn failed:', err);
    statusTextEl.textContent = '오류 발생';
  } finally {
    btnEndTurn.disabled = false;
  }
});

// === Refresh State from Server ===
async function refreshState() {
  try {
    const result = await app.callServerTool({
      name: 'get_state',
      arguments: {},
    });

    // The get_state tool returns formatted text, not JSON
    // For the prototype, we parse what we can from the text
    // In a full implementation, we'd add a get_state_json tool

    // For now, just update the status text
    const textContent = result?.content?.find((c: { type: string }) => c.type === 'text');
    if (textContent && 'text' in textContent) {
      parseAndUpdateState(textContent.text as string);
    }
  } catch (err) {
    console.error('get_state failed:', err);
  }
}

// === Parse State from Markdown Text ===
// Extracts key numbers from the formatted markdown state
function parseAndUpdateState(text: string) {
  // Extract turn info
  const turnMatch = text.match(/(\d+)\/48턴/);
  const yearMatch = text.match(/(\d{4})년\s+(\d)분기/);
  if (turnMatch && yearMatch) {
    const turn = parseInt(turnMatch[1]);
    const year = parseInt(yearMatch[1]);
    const quarter = parseInt(yearMatch[2]);
    const quarterLabel = ['1분기', '2분기', '3분기', '4분기'][quarter - 1];
    turnInfoEl.textContent = `${year}년 ${quarterLabel} (${turn}/48턴)`;
  }

  // Extract summary numbers
  const popMatch = text.match(/총인구:\s*([\d,]+)명/);
  const bizMatch = text.match(/사업체:\s*([\d,]+)개/);
  const satMatch = text.match(/평균 만족도:\s*(\d+)/);
  const fiscalMatch = text.match(/재정자립도:\s*(\d+)%/);
  const budgetMatch = text.match(/자유예산:\s*([\d,]+)억원/);

  updateDashboard({
    totalPop: popMatch ? parseInt(popMatch[1].replace(/,/g, '')) : 0,
    totalBiz: bizMatch ? parseInt(bizMatch[1].replace(/,/g, '')) : 0,
    avgSat: satMatch ? parseInt(satMatch[1]) : 0,
    fiscal: fiscalMatch ? parseInt(fiscalMatch[1]) : 0,
    freeBudget: budgetMatch ? parseInt(budgetMatch[1].replace(/,/g, '')) : 0,
  });

  // Extract budget allocation
  const budgetLine = text.match(/경제\s+(\d+)%\s*\|\s*교통\s+(\d+)%\s*\|\s*문화\s+(\d+)%\s*\|\s*환경\s+(\d+)%\s*\|\s*교육\s+(\d+)%\s*\|\s*복지\s+(\d+)%\s*\|\s*도시재생\s+(\d+)%/);
  if (budgetLine) {
    updateBudgetDisplay({
      economy: parseInt(budgetLine[1]),
      transport: parseInt(budgetLine[2]),
      culture: parseInt(budgetLine[3]),
      environment: parseInt(budgetLine[4]),
      education: parseInt(budgetLine[5]),
      welfare: parseInt(budgetLine[6]),
      renewal: parseInt(budgetLine[7]),
    });
  }

  // Extract dong table if present
  const dongRows = text.matchAll(/\|\s*(\S+동)\s*\|\s*([\d,]+)\s*\|\s*(\d+)\s*\|\s*([\d,]+)\s*\|\s*(\d+)\s*\|/g);
  const dongs: Array<{ name: string; population: number; satisfaction: number; businesses: number; vitality: number }> = [];
  for (const row of dongRows) {
    dongs.push({
      name: row[1],
      population: parseInt(row[2].replace(/,/g, '')),
      satisfaction: parseInt(row[3]),
      businesses: parseInt(row[4].replace(/,/g, '')),
      vitality: parseInt(row[5]),
    });
  }
  if (dongs.length > 0) {
    updateDongList(dongs);
    updateMap(dongs);
  }

  statusTextEl.textContent = `상태 업데이트 완료`;
}

// === Budget Display ===
function updateBudgetDisplay(alloc: Record<string, number>) {
  const el = document.getElementById('budget-display')!;
  const labels: Record<string, string> = {
    economy: '경제', transport: '교통', culture: '문화',
    environment: '환경', education: '교육', welfare: '복지', renewal: '재생',
  };
  el.innerHTML = Object.entries(alloc)
    .map(([k, v]) => `<span class="budget-tag">${labels[k] || k} ${v}%</span>`)
    .join('');
}

// === Dong List ===
function updateDongList(dongs: Array<{ name: string; population: number; satisfaction: number; businesses: number; vitality: number }>) {
  const el = document.getElementById('dong-list')!;
  const rows = dongs.map(d => {
    const barWidth = Math.round(d.satisfaction * 0.8);
    const barColor = d.satisfaction >= 65 ? '#22c55e' : d.satisfaction >= 50 ? '#3b82f6' : d.satisfaction >= 40 ? '#eab308' : '#ef4444';
    return `<tr>
      <td>${d.name}</td>
      <td>${d.population.toLocaleString()}</td>
      <td><span class="sat-bar" style="width:${barWidth}px;background:${barColor}"></span> ${d.satisfaction}</td>
      <td>${d.businesses.toLocaleString()}</td>
    </tr>`;
  }).join('');

  el.innerHTML = `<table>
    <thead><tr><th>동</th><th>인구</th><th>만족도</th><th>사업체</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

// === Game Over ===
function showGameOver() {
  const overlay = document.getElementById('game-over')!;
  const text = document.getElementById('game-over-text')!;
  text.textContent = '48턴이 완료되었습니다. 호스트 AI에게 최종 결과를 물어보세요.';
  overlay.classList.add('visible');
  btnEndTurn.disabled = true;
}

// === Initialize ===
async function init() {
  // Initialize map with inline SVG
  initMap(document.getElementById('map-panel')!, mapSvgRaw);

  // Connect to host
  app.connect();

  // Initial state fetch
  statusTextEl.textContent = '게임 데이터 로딩 중...';
  setTimeout(() => refreshState(), 500);
}

init();
