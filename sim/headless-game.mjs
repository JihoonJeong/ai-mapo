/**
 * headless-game.mjs — Headless 게임 루프
 *
 * 브라우저 게임 엔진(simulation.js)을 Node.js에서 재활용.
 * DOM 의존 부분(이벤트 체크, 공약 점수)은 순수 로직으로 재구현.
 */

import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { SimAdvisor } from './sim-advisor.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');

// === Fetch Monkey-Patch ===
// simulation.js의 loadAdjacency()가 fetch('data/game/adjacency.json') 호출
// Node.js에서 파일시스템 읽기로 대체
const _originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  if (typeof url === 'string' && url.endsWith('adjacency.json')) {
    const data = await readFile(path.join(ROOT, 'data/game/adjacency.json'), 'utf-8');
    return { ok: true, json: async () => JSON.parse(data) };
  }
  // Fall through to real fetch for API calls
  return _originalFetch(url, options);
};

// === Engine Import (after fetch patch) ===
const { tick } = await import(pathToFileURL(path.join(ROOT, 'js/engine/simulation.js')).href);

// === Data Loading ===
async function loadGameData() {
  const [initRaw, policiesRaw, eventsRaw] = await Promise.all([
    readFile(path.join(ROOT, 'data/game/mapo_init.json'), 'utf-8'),
    readFile(path.join(ROOT, 'data/game/policies.json'), 'utf-8'),
    readFile(path.join(ROOT, 'data/game/events.json'), 'utf-8'),
  ]);
  return {
    initData: JSON.parse(initRaw),
    policyCatalog: JSON.parse(policiesRaw).policies,
    eventCatalog: JSON.parse(eventsRaw).events,
  };
}

// === Seeded PRNG (mulberry32) ===
function createRng(seed) {
  let t = seed | 0;
  return () => {
    t = (t + 0x6D2B79F5) | 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

// === Pledges (pledge.js 순수 로직 재구현) ===
const PLEDGES = [
  { id: 'population_rebound', name: '인구 반등', desc: '48턴 후 총인구 >= 초기값', difficulty: 3 },
  { id: 'youth_settlement', name: '청년 정착', desc: '청년(20-34) 비율 2%p 상승', difficulty: 2 },
  { id: 'tourism_coexist', name: '관광 상생', desc: '서교·합정·연남 만족도 >= 65 AND 상권활력 >= 60', difficulty: 3 },
  { id: 'elderly_care', name: '고령 돌봄', desc: '65+ 만족도 구 평균 >= 70', difficulty: 2 },
  { id: 'fiscal_health', name: '재정 건전', desc: '재정자립도 30% 달성', difficulty: 3 },
  { id: 'commerce_diversity', name: '상권 다양성', desc: '상권특색 구 평균 >= 75', difficulty: 2 },
  { id: 'transport_improve', name: '교통 개선', desc: '교통 만족도 구 평균 >= 70', difficulty: 1 },
  { id: 'green_mapo', name: '녹색 마포', desc: '환경 만족도 구 평균 >= 70', difficulty: 1 },
];

function calcProgress(pledgeId, state, initialState) {
  if (!initialState) return 0;

  const totalPop = state.dongs.reduce((s, d) => s + d.population, 0);
  const initialPop = initialState.dongs.reduce((s, d) => s + d.population, 0);

  switch (pledgeId) {
    case 'population_rebound':
      return (totalPop / initialPop) * 100;

    case 'youth_settlement': {
      const currentYouth = state.dongs.reduce((s, d) => s + d.populationByAge.youth, 0) / totalPop * 100;
      const initialYouth = initialState.dongs.reduce((s, d) => s + d.populationByAge.youth, 0) / initialPop * 100;
      return Math.min(100, ((currentYouth - initialYouth) / 2.0) * 100);
    }

    case 'tourism_coexist': {
      const targets = ['seogyo', 'hapjeong', 'yeonnam'];
      const satOk = targets.every(id => (state.dongs.find(d => d.id === id)?.satisfaction || 0) >= 65);
      const vitOk = targets.every(id => (state.dongs.find(d => d.id === id)?.commerceVitality || 0) >= 60);
      const satProg = targets.reduce((s, id) => s + Math.min(100, (state.dongs.find(d => d.id === id)?.satisfaction || 0) / 65 * 100), 0) / 3;
      const vitProg = targets.reduce((s, id) => s + Math.min(100, (state.dongs.find(d => d.id === id)?.commerceVitality || 0) / 60 * 100), 0) / 3;
      return (satOk && vitOk) ? 100 : (satProg + vitProg) / 2;
    }

    case 'elderly_care': {
      const avgElderlySat = state.dongs.reduce((s, d) => {
        const elderlyPct = d.populationByAge.elderly / d.population;
        return s + d.satisfactionFactors.welfare * elderlyPct;
      }, 0) / state.dongs.reduce((s, d) => s + d.populationByAge.elderly / d.population, 0);
      return Math.min(100, (avgElderlySat / 70) * 100);
    }

    case 'fiscal_health':
      return Math.min(100, (state.finance.fiscalIndependence / 30) * 100);

    case 'commerce_diversity': {
      const avg = state.dongs.reduce((s, d) => s + d.commerceCharacter, 0) / state.dongs.length;
      return Math.min(100, (avg / 75) * 100);
    }

    case 'transport_improve': {
      const avg = state.dongs.reduce((s, d) => s + d.satisfactionFactors.transport, 0) / state.dongs.length;
      return Math.min(100, (avg / 70) * 100);
    }

    case 'green_mapo': {
      const avg = state.dongs.reduce((s, d) => s + (d.satisfactionFactors.environment || d.satisfactionFactors.safety), 0) / state.dongs.length;
      return Math.min(100, (avg / 70) * 100);
    }

    default: return 0;
  }
}

function linearScore(value, low, mid, high, scores, max) {
  if (value <= low) return scores[0];
  if (value >= high) return scores[2];
  if (value <= mid) {
    const t = (value - low) / (mid - low);
    return Math.round(scores[0] + t * (scores[1] - scores[0]));
  }
  const t = (value - mid) / (high - mid);
  return Math.min(max, Math.round(scores[1] + t * (scores[2] - scores[1])));
}

function calcFinalScore(state, initialState) {
  if (!initialState) return { total: 0, grade: 'F', kpis: [], pledgeResults: [], kpiTotal: 0, pledgeTotal: 0 };

  const initialPop = initialState.dongs.reduce((s, d) => s + d.population, 0);
  const totalPop = state.dongs.reduce((s, d) => s + d.population, 0);
  const popChangeRate = ((totalPop - initialPop) / initialPop) * 100;

  const initialBiz = initialState.dongs.reduce((s, d) => s + d.businesses, 0);
  const totalBiz = state.dongs.reduce((s, d) => s + d.businesses, 0);
  const initialWorkers = initialState.dongs.reduce((s, d) => s + d.workers, 0);
  const totalWorkers = state.dongs.reduce((s, d) => s + d.workers, 0);
  const econGrowth = ((totalBiz - initialBiz) / initialBiz * 100 + (totalWorkers - initialWorkers) / initialWorkers * 100) / 2;

  const initialTax = initialState.finance.revenue?.localTax || 613;
  const currentTax = state.finance.revenue?.localTax || 613;
  const taxChange = ((currentTax - initialTax) / initialTax) * 100;

  const initialFiscal = initialState.finance.fiscalIndependence || 28;
  const currentFiscal = state.finance.fiscalIndependence || 28;
  const fiscalDelta = currentFiscal - initialFiscal;

  const avgSat = state.dongs.reduce((s, d) => s + d.satisfaction, 0) / state.dongs.length;

  const satValues = state.dongs.map(d => d.satisfaction);
  const satMean = satValues.reduce((s, v) => s + v, 0) / satValues.length;
  const satStdDev = Math.sqrt(satValues.reduce((s, v) => s + (v - satMean) ** 2, 0) / satValues.length);

  const kpis = [
    { id: 'population', label: '인구 변화', max: 15, score: linearScore(popChangeRate, -2, 0, 5, [0, 3, 15], 15), detail: `${popChangeRate >= 0 ? '+' : ''}${popChangeRate.toFixed(1)}%` },
    { id: 'economy', label: '경제 성장', max: 10, score: linearScore(econGrowth, -3, 0, 5, [0, 5, 10], 10), detail: `${econGrowth >= 0 ? '+' : ''}${econGrowth.toFixed(1)}%` },
    { id: 'tax', label: '세수 증감', max: 10, score: linearScore(taxChange, -5, 0, 10, [0, 5, 10], 10), detail: `${taxChange >= 0 ? '+' : ''}${taxChange.toFixed(1)}%` },
    { id: 'fiscal', label: '재정 건전성', max: 10, score: linearScore(fiscalDelta, -3, 0, 3, [0, 5, 10], 10), detail: `${fiscalDelta >= 0 ? '+' : ''}${fiscalDelta.toFixed(1)}%p` },
    { id: 'satisfaction', label: '주민 만족도', max: 15, score: linearScore(avgSat, 50, 60, 70, [0, 8, 15], 15), detail: `평균 ${avgSat.toFixed(0)}` },
    { id: 'balance', label: '균형 발전', max: 10, score: satStdDev < 10 ? 10 : satStdDev < 15 ? 5 : satStdDev > 20 ? 0 : Math.round(5 * (20 - satStdDev) / 5), detail: `σ = ${satStdDev.toFixed(1)}` },
  ];

  const pledgeIds = state.meta.pledges || [];
  const pledgeResults = pledgeIds.map(id => {
    const pledge = PLEDGES.find(p => p.id === id);
    const progress = calcProgress(id, state, initialState);
    const achieved = progress >= 100;
    return { id, name: pledge?.name || id, achieved, progress: Math.round(progress), score: achieved ? 15 : -20 };
  });

  const kpiTotal = kpis.reduce((s, k) => s + k.score, 0);
  const pledgeTotal = pledgeResults.reduce((s, p) => s + p.score, 0);
  const total = kpiTotal + pledgeTotal;
  const grade = total >= 100 ? 'S' : total >= 80 ? 'A' : total >= 60 ? 'B' : total >= 40 ? 'C' : total >= 20 ? 'D' : 'F';

  return { total, grade, kpis, pledgeResults, kpiTotal, pledgeTotal };
}

// === Event System (event.js 순수 로직 재구현) ===
class EventSystem {
  constructor(catalog, rng) {
    this.catalog = catalog;
    this.cooldowns = {};
    this.firedOneShots = new Set();
    this.rng = rng;
  }

  checkTriggers(state) {
    const turn = state.meta.turn;

    // Decrease cooldowns
    for (const id of Object.keys(this.cooldowns)) {
      this.cooldowns[id]--;
      if (this.cooldowns[id] <= 0) delete this.cooldowns[id];
    }

    // Collect candidates
    const candidates = [];
    for (const event of this.catalog) {
      if (this.cooldowns[event.id]) continue;
      if (event.oneShot && this.firedOneShots.has(event.id)) continue;
      if (this._checkTrigger(event, state, turn)) candidates.push(event);
    }

    if (candidates.length === 0) return null;

    // Probability check
    const triggered = candidates.filter(e => this.rng() < (e.probability || 1.0));
    if (triggered.length === 0) return null;

    // Pick one
    const selected = triggered[Math.floor(this.rng() * triggered.length)];

    // Record cooldown + oneshot
    if (selected.cooldown > 0) this.cooldowns[selected.id] = selected.cooldown;
    if (selected.oneShot) this.firedOneShots.add(selected.id);

    return selected;
  }

  _checkTrigger(event, state, turn) {
    const trigger = event.trigger;
    if (!trigger) return false;

    switch (trigger.type) {
      case 'periodic':
        return turn >= (trigger.startTurn || 1) && (turn - (trigger.startTurn || 1)) % (trigger.interval || 4) === 0;

      case 'threshold': {
        const cond = trigger.condition;
        if (!cond) return false;
        if (cond.dong) {
          const dong = state.dongs.find(d => d.id === cond.dong);
          if (!dong) return false;
          return this._checkCondition(this._getMetric(dong, cond.metric), cond.operator, cond.value);
        } else if (cond.minDongCount) {
          const count = state.dongs.filter(d => this._checkCondition(this._getMetric(d, cond.metric), cond.operator, cond.value)).length;
          return count >= cond.minDongCount;
        }
        return false;
      }

      case 'random':
        return turn >= (trigger.minTurn || 1) && this.rng() < (trigger.probabilityPerTurn || 0.1);

      case 'turn': {
        if (turn < (trigger.minTurn || 1)) return false;
        if (trigger.additionalCondition) {
          const cond = trigger.additionalCondition;
          const dong = state.dongs.find(d => d.id === cond.dong);
          if (!dong) return false;
          return this._checkCondition(this._getMetric(dong, cond.metric), cond.operator, cond.value);
        }
        return true;
      }

      default: return false;
    }
  }

  _getMetric(dong, metric) {
    if (metric === 'elderlyRatio') return (dong.populationByAge?.elderly || 0) / Math.max(1, dong.population);
    return dong[metric] ?? 0;
  }

  _checkCondition(value, operator, threshold) {
    switch (operator) {
      case '>': return value > threshold;
      case '<': return value < threshold;
      case '>=': return value >= threshold;
      case '<=': return value <= threshold;
      case '==': return value === threshold;
      default: return false;
    }
  }
}

// === HeadlessGame ===
export class HeadlessGame {
  /**
   * @param {Object} config
   * @param {Function} config.provider - AI provider function
   * @param {string[]} config.pledges - pledge IDs (null = AI chooses)
   * @param {number} config.pledgeCount - number of pledges AI should choose (default 2)
   * @param {number} config.seed - RNG seed
   * @param {number} config.historyWindow - AI context window (turns)
   */
  constructor(config) {
    this.provider = config.provider;
    this.pledgeIds = config.pledges || null; // null = AI decides
    this.pledgeCount = config.pledgeCount || 2;
    this.seed = config.seed || Date.now();
    this.historyWindow = config.historyWindow || 4;
    this.turnLog = [];
  }

  async play() {
    const startTime = Date.now();
    const rng = createRng(this.seed);

    // Patch Math.random for deterministic events
    const origRandom = Math.random;
    Math.random = rng;

    try {
      return await this._run(rng, startTime);
    } finally {
      Math.random = origRandom;
    }
  }

  async _run(rng, startTime) {
    // Load data
    const { initData, policyCatalog, eventCatalog } = await loadGameData();

    // Create game state (mirrors main.js createGameState)
    let state = {
      meta: { turn: 1, year: 2026, quarter: 1, playerName: 'AI', pledges: [] },
      dongs: initData.dongs.map(d => ({ ...d })),
      finance: { ...initData.finance },
      industryBreakdown: initData.industryBreakdown || {},
      activePolicies: [],
      activeEvents: [],
      history: [],
    };

    const advisor = new SimAdvisor(this.provider, { historyWindow: this.historyWindow });

    // === Pledge Selection ===
    if (this.pledgeIds) {
      // Explicitly specified pledges
      state.meta.pledges = this.pledgeIds;
    } else {
      // AI chooses pledges
      console.log(`    AI selecting ${this.pledgeCount} pledges...`);
      const aiPledges = await advisor.choosePledges(PLEDGES, this.pledgeCount, state);
      if (aiPledges && aiPledges.length > 0) {
        state.meta.pledges = aiPledges;
        console.log(`    AI chose: ${aiPledges.map(id => PLEDGES.find(p => p.id === id)?.name || id).join(', ')}`);
      } else {
        // Fallback: random selection using seeded RNG
        console.log(`    AI pledge selection failed, using random ${this.pledgeCount} pledges`);
        const shuffled = [...PLEDGES];
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = Math.floor(rng() * (i + 1));
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        state.meta.pledges = shuffled.slice(0, this.pledgeCount).map(p => p.id);
        console.log(`    Random pledges: ${state.meta.pledges.map(id => PLEDGES.find(p => p.id === id)?.name || id).join(', ')}`);
      }
    }

    // Store for result
    this.pledgeIds = state.meta.pledges;

    const initialState = JSON.parse(JSON.stringify(state));
    const pledgeObjs = state.meta.pledges.map(id => PLEDGES.find(p => p.id === id)).filter(Boolean);

    const eventSystem = new EventSystem(eventCatalog, rng);

    let lastActions = null;

    // === 48-Turn Loop ===
    for (let turn = 1; turn <= 48; turn++) {
      state.meta.turn = turn;
      state.meta.quarter = ((turn - 1) % 4) + 1;
      state.meta.year = 2026 + Math.floor((turn - 1) / 4);

      // 1. Simulation tick (apply last turn's actions) — skip turn 1
      if (turn > 1 && lastActions) {
        state = tick(state, lastActions);
      }

      // 2. Compute pledge progress (attach to state for advisor context)
      state._pledgeProgress = {};
      for (const id of this.pledgeIds) {
        state._pledgeProgress[id] = calcProgress(id, state, initialState);
      }

      // 3. Check event triggers
      const event = eventSystem.checkTriggers(state);

      // 4. AI decision
      const { action, reasoning, raw } = await advisor.decide(state, event, policyCatalog, pledgeObjs);

      // 5. Build player actions (mirrors main.js endTurn)
      const newPolicies = action.policies.activate
        .map(id => policyCatalog.find(p => p.id === id))
        .filter(Boolean);

      // Handle deactivation
      for (const id of action.policies.deactivate) {
        const idx = state.activePolicies.findIndex(ap => ap.policy.id === id);
        if (idx >= 0) state.activePolicies.splice(idx, 1);
      }

      // Build event choice
      let eventChoice = null;
      if (event && action.eventChoice) {
        const choice = event.choices.find(c => c.id === action.eventChoice);
        if (choice) {
          eventChoice = {
            eventId: event.id,
            choiceId: action.eventChoice,
            choice,
            affectedDongs: event.affectedDongs || [],
            totalDuration: choice.duration || 1,
            remainDuration: choice.duration || 1,
          };
        }
      }

      // Push event to active events
      if (eventChoice) {
        if (!state.activeEvents) state.activeEvents = [];
        state.activeEvents.push(eventChoice);
      }

      lastActions = {
        budget: action.budget,
        policies: newPolicies,
        eventChoice,
      };

      // 6. Save history snapshot (mirrors main.js endTurn)
      const totalPop = state.dongs.reduce((s, d) => s + d.population, 0);
      const avgSat = Math.round(state.dongs.reduce((s, d) => s + d.satisfaction, 0) / state.dongs.length);
      state.history.push({
        turn,
        totalPopulation: totalPop,
        avgSatisfaction: avgSat,
        fiscalIndependence: state.finance.fiscalIndependence,
        dongs: state.dongs.map(d => ({
          id: d.id, population: d.population, satisfaction: d.satisfaction, businesses: d.businesses,
        })),
      });

      // 7. Turn log
      this.turnLog.push({
        turn,
        aiAction: { budget: action.budget, policies: action.policies, eventChoice: action.eventChoice },
        aiReasoning: reasoning,
        stateSnapshot: {
          totalPop, avgSat,
          fiscalIndependence: state.finance.fiscalIndependence,
          freeBudget: state.finance.freeBudget,
          activePolicies: state.activePolicies.map(ap => ap.policy.id),
        },
        event: event ? { id: event.id, choice: action.eventChoice } : null,
        parseSuccess: raw !== '' && raw !== undefined,
      });

      // Progress indicator
      if (turn % 12 === 0) {
        const year = state.meta.year;
        console.log(`    Turn ${turn}/48 (${year}년) — pop: ${totalPop.toLocaleString()}, sat: ${avgSat}, fiscal: ${state.finance.fiscalIndependence}%`);
      }
    }

    // === Final Score ===
    const result = calcFinalScore(state, initialState);
    const durationMs = Date.now() - startTime;

    return {
      finalGrade: result.grade,
      totalScore: result.total,
      kpis: result.kpis,
      kpiTotal: result.kpiTotal,
      pledgeResults: result.pledgeResults,
      pledgeTotal: result.pledgeTotal,
      turnLog: this.turnLog,
      tokenUsage: advisor.getUsage(),
      durationMs,
      seed: this.seed,
      pledges: this.pledgeIds,
    };
  }
}

export { PLEDGES };
