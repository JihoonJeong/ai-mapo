/**
 * simulation.ts — Simulation engine (ported from js/engine/*.js)
 *
 * Combined: population, economy, finance, satisfaction, event effects
 * Execution order (per numerical-design-v1.md):
 * 1. Budget effects
 * 2. Policy effects
 * 3. Economy (businesses, rent, commerce character)
 * 4. Population (natural, migration, displacement)
 * 5. Finance (revenue, expenditure, fiscal independence)
 * 6. Satisfaction (6 components, decay, spillover)
 * 7. Event effects
 * 8. Living population
 */

import type {
  GameState, PlayerActions, Dong, AdjacencyMap,
  BudgetAllocation, ActivePolicy, PolicyDef, Finance,
} from './game-state.js';

// ==================== Constants ====================

// Population
const NATURAL_RATE = -0.0015;
const ACCEL_MIGRATION = 1.5;
const MAX_CHANGE_RATE = 0.02;
const AGE_MOBILITY: Record<string, number> = {
  child: 0.0, teen: 0.0, youth: 1.5, midAge: 1.0, senior: 0.6, elderly: 0.3,
};
const PULL_WEIGHTS = { jobs: 0.30, housing: 0.25, infra: 0.20, safety: 0.15, education: 0.10 };

// Economy
const BASE_NEW_RATE = 0.022;
const BASE_CLOSE_RATE = 0.016;
const RENT_THRESHOLD = 70;
const RENT_SENSITIVITY = 0.00015;
const RENT_MAX = 0.012;
const FRANCHISE_RATE = 0.015;
const SPILLOVER_RENT = 0.3;

// Finance
const ACCEL_FINANCE = 2.0;
const MANDATORY_RATIO = 0.50;
const BASE_REVENUE = { localTax: 613, grantFromCity: 700, subsidy: 750, otherIncome: 125 };
const BASE_POP = 357232;
const BASE_BIZ = 55516;
const TAX_DECLINE_RATE = -0.005;
const OPTIMAL_PCT: Record<string, number> = {
  economy: 15, transport: 15, culture: 10, environment: 10, education: 15, welfare: 20, renewal: 15,
};

// Satisfaction
const DECAY = -0.6; // 균등 배분이 겨우 유지, 성장하려면 집중 투자 필요
const ACCEL_SAT = 5.0;
const BUDGET_TO_SATISFACTION: Record<string, Record<string, number>> = {
  economy: { economy: 0.8, culture: 0.1, transport: 0.1 },
  transport: { transport: 0.9, housing: 0.1 },
  culture: { culture: 0.7, economy: 0.2, housing: 0.1 },
  environment: { safety: 0.5, housing: 0.4, culture: 0.1 },
  education: { welfare: 0.4, culture: 0.3, housing: 0.3 },
  welfare: { welfare: 0.7, housing: 0.2, safety: 0.1 },
  renewal: { housing: 0.5, economy: 0.2, transport: 0.2, safety: 0.1 },
};
const SPILLOVER_SAT = 0.15;

const AGE_WEIGHTS: Record<string, Record<string, number>> = {
  youth: { economy: 0.30, transport: 0.20, housing: 0.15, safety: 0.10, culture: 0.20, welfare: 0.05 },
  midAge: { economy: 0.25, transport: 0.15, housing: 0.25, safety: 0.15, culture: 0.10, welfare: 0.10 },
  senior: { economy: 0.20, transport: 0.15, housing: 0.20, safety: 0.15, culture: 0.15, welfare: 0.15 },
  elderly: { economy: 0.10, transport: 0.15, housing: 0.15, safety: 0.15, culture: 0.15, welfare: 0.30 },
};

// ==================== Helpers ====================

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function normalize(value: number, center: number, spread: number): number {
  if (spread === 0) return 0;
  return clamp((value - center) / spread, -1, 1);
}

function softCap(ratio: number): number {
  if (ratio <= 0) return 0.1;
  if (ratio <= 1) return ratio;
  return 1.0 + Math.log(ratio);
}

interface PolicyEffects {
  global: Record<string, Record<string, number>>;
  byDong: Record<string, Record<string, Record<string, number>>>;
}

function getPolicyEffect(dongId: string, pe: PolicyEffects): Record<string, Record<string, number>> {
  const result: Record<string, Record<string, number>> = {};
  for (const source of [pe.global, pe.byDong[dongId] || {}]) {
    for (const [cat, vals] of Object.entries(source)) {
      if (!result[cat]) result[cat] = {};
      for (const [key, val] of Object.entries(vals as Record<string, number>)) {
        result[cat][key] = (result[cat][key] || 0) + val;
      }
    }
  }
  return result;
}

// ==================== Main Tick ====================

export function tick(gameState: GameState, playerActions: PlayerActions, adjacency: AdjacencyMap): GameState {
  const state: GameState = JSON.parse(JSON.stringify(gameState));
  const budgetAlloc = playerActions?.budget || state.finance.allocation;

  // 1. Budget effects
  const budgetEffects = calcBudgetEffects(budgetAlloc, state.finance.freeBudget);

  // 1.5. Init tracking
  for (const dong of state.dongs) {
    if (!dong._initPop) dong._initPop = dong.population;
    if (!dong._initBiz) dong._initBiz = dong.businesses;
  }

  // 2. Policy management
  if (playerActions?.policies?.length > 0) {
    for (const policy of playerActions.policies) {
      if (!state.activePolicies.some(ap => ap.policy.id === policy.id)) {
        state.activePolicies.push({
          policy, remainDelay: policy.delay || 0, remainDuration: policy.duration || 0, turnsActive: 0,
        });
      }
    }
  }
  const policyEffects = tickPolicies(state);

  // 3. Economy
  for (const dong of state.dongs) {
    updateEconomy(dong, state, adjacency, budgetAlloc, policyEffects);
  }

  // 4. Population
  for (const dong of state.dongs) {
    updatePopulation(dong, state, adjacency, policyEffects);
  }

  // 5. Finance
  state.finance = updateFinance(state, budgetAlloc, policyEffects);

  // 6. Satisfaction
  for (const dong of state.dongs) {
    updateSatisfaction(dong, state, adjacency, budgetEffects, policyEffects);
  }

  // 7. Event effects
  tickEventEffects(state);

  // 8. Living population
  updateLivingPopulation(state);

  return state;
}

// ==================== Budget Effects ====================

function calcEffectiveSpend(category: string, rawPct: number): number {
  const optimal = OPTIMAL_PCT[category] || 15;
  if (rawPct <= optimal) return rawPct;
  const ratio = rawPct / optimal;
  return rawPct * (1 / (1 + 0.3 * (ratio - 1)));
}

function calcBudgetEffects(budgetAlloc: BudgetAllocation, freeBudget: number): Record<string, number> {
  const effects: Record<string, number> = {};
  for (const [cat, pct] of Object.entries(budgetAlloc)) {
    const effectivePct = calcEffectiveSpend(cat, pct);
    const amount = freeBudget * effectivePct / 100;
    const optimalAmount = freeBudget * (OPTIMAL_PCT[cat] || 15) / 100;
    effects[cat] = amount / Math.max(1, optimalAmount);
  }
  return effects;
}

// ==================== Policy Tick ====================

function tickPolicies(state: GameState): PolicyEffects {
  const effects: PolicyEffects = { global: {}, byDong: {} };

  state.activePolicies = state.activePolicies.filter(ap => {
    if (ap.policy.duration === 0) return true;
    if (ap.remainDelay > 0) return true;
    return ap.remainDuration > 0;
  });

  for (const ap of state.activePolicies) {
    ap.turnsActive++;
    if (ap.remainDelay > 0) { ap.remainDelay--; continue; }
    if (ap.policy.duration > 0 && ap.remainDuration > 0) ap.remainDuration--;

    const policy = ap.policy;
    const targetDongs = getTargetDongs(policy, state);
    for (const dongId of targetDongs) {
      if (!effects.byDong[dongId]) effects.byDong[dongId] = {};
      mergeEffects(effects.byDong[dongId], policy.effects);
    }
    if (!policy.targetDong) mergeEffects(effects.global, policy.effects);
  }
  return effects;
}

function getTargetDongs(policy: PolicyDef, state: GameState): string[] {
  if (!policy.targetDong) return state.dongs.map(d => d.id);
  if (Array.isArray(policy.targetDong)) return policy.targetDong;
  return [policy.targetDong];
}

function mergeEffects(target: Record<string, Record<string, number>>, source: Record<string, Record<string, number>>) {
  for (const [category, values] of Object.entries(source)) {
    if (!target[category]) target[category] = {};
    for (const [key, val] of Object.entries(values)) {
      if (typeof val === 'object') continue;
      target[category][key] = (target[category][key] || 0) + val;
    }
  }
}

// ==================== Economy ====================

function updateEconomy(dong: Dong, state: GameState, adjacency: AdjacencyMap, budgetAlloc: BudgetAllocation, policyEffects: PolicyEffects) {
  const biz = dong.businesses;
  if (biz <= 0) return;

  const demand = calcDemandFactor(dong, state, adjacency);
  const econBudgetPct = budgetAlloc.economy || 15;
  const policyBonus = 1.0 + (econBudgetPct - 15) * 0.01;
  const pe = getPolicyEffect(dong.id, policyEffects);
  const newBizBonus = pe.economy?.newBizBonus || 0;
  const adjustedDemand = 1.0 + (demand - 1.0) * 0.5;

  let effectiveNewBizBonus = newBizBonus;
  if (newBizBonus > 0 && dong._initBiz && biz > dong._initBiz) {
    const overGrowth = biz / dong._initBiz - 1.0;
    effectiveNewBizBonus *= Math.max(0.2, 1.0 - overGrowth * 2);
  }

  const newBiz = Math.round(biz * (BASE_NEW_RATE + effectiveNewBizBonus) * adjustedDemand * policyBonus);
  const rentPressure = dong.rentPressure || 0;
  const competitionPressure = calcCompetition(dong, state);
  const closedBiz = Math.round(biz * (BASE_CLOSE_RATE + rentPressure + competitionPressure));
  const netChange = newBiz - closedBiz;
  dong.businesses = Math.max(1, biz + Math.round(netChange));
  if (biz > 0) dong.workers = Math.round(dong.workers * (dong.businesses / biz));

  dong.commerceVitality = calcCommerceVitality(dong, state);
  updateRentPressure(dong, adjacency, state);

  const rentDelta = pe.economy?.rentPressureDelta || pe.economy_side?.rentPressureDelta || 0;
  if (rentDelta !== 0) dong.rentPressure = Math.round(clamp(dong.rentPressure + rentDelta, 0, RENT_MAX) * 10000) / 10000;

  updateCommerceCharacter(dong);
  const charBonus = pe.economy?.commerceCharacterBonus || 0;
  if (charBonus !== 0) {
    dong.commerceCharacter = clamp(dong.commerceCharacter + charBonus * 0.25, 20, 100);
    dong.commerceCharacter = Math.round(dong.commerceCharacter * 10) / 10;
  }
  const workerGrowth = pe.economy?.workerGrowth || 0;
  if (workerGrowth > 0) dong.workers = Math.round(dong.workers * (1 + workerGrowth));
}

function calcDemandFactor(dong: Dong, state: GameState, adjacency: AdjacencyMap): number {
  const avgLivingPop = state.dongs.reduce((s, d) => s + (d.livingPop?.weekdayDay || d.population), 0) / state.dongs.length;
  const avgPop = state.dongs.reduce((s, d) => s + d.population, 0) / state.dongs.length;
  const avgTransit = state.dongs.reduce((s, d) => s + d.transitScore, 0) / state.dongs.length;

  const livingPopScore = softCap((dong.livingPop?.weekdayDay || dong.population) / Math.max(1, avgLivingPop));
  const popScore = softCap(dong.population / Math.max(1, avgPop));
  const transitScore = softCap(dong.transitScore / Math.max(1, avgTransit));

  let adjSpill = 0;
  const neighbors = adjacency[dong.id] || {};
  for (const [nId, coeff] of Object.entries(neighbors)) {
    const neighbor = state.dongs.find(d => d.id === nId);
    if (neighbor) {
      const nDemand = (neighbor.livingPop?.weekdayDay || neighbor.population) / Math.max(1, avgLivingPop);
      adjSpill += coeff * 0.2 * (nDemand - 1.0);
    }
  }

  return clamp(0.4 * livingPopScore + 0.3 * popScore + 0.2 * transitScore + 0.1 * (1.0 + adjSpill), 0.8, 1.3);
}

function calcCompetition(dong: Dong, state: GameState): number {
  const avgDensity = state.dongs.reduce((s, d) => s + d.businesses / Math.max(1, d.population), 0) / state.dongs.length;
  const density = dong.businesses / Math.max(1, dong.population);
  const excess = density / Math.max(0.01, avgDensity) - 1.0;
  return excess > 0 ? Math.min(0.005, excess * 0.001) : 0;
}

function calcCommerceVitality(dong: Dong, state: GameState): number {
  const maxDensity = Math.max(...state.dongs.map(d => d.businesses / Math.max(1, d.population)));
  const density = dong.businesses / Math.max(1, dong.population);
  return Math.round(clamp((density / Math.max(0.01, maxDensity)) * 100, 0, 100));
}

function updateRentPressure(dong: Dong, adjacency: AdjacencyMap, state: GameState) {
  let pressure = Math.max(0, (dong.commerceVitality - RENT_THRESHOLD) * RENT_SENSITIVITY);
  const neighbors = adjacency[dong.id] || {};
  for (const [nId, coeff] of Object.entries(neighbors)) {
    const neighbor = state.dongs.find(d => d.id === nId);
    if (neighbor && neighbor.rentPressure > 0) pressure += coeff * neighbor.rentPressure * SPILLOVER_RENT;
  }
  dong.rentPressure = Math.round(clamp(pressure, 0, RENT_MAX) * 10000) / 10000;
}

function updateCommerceCharacter(dong: Dong) {
  if (dong.rentPressure > 0) {
    const decay = dong.rentPressure * FRANCHISE_RATE * 100;
    dong.commerceCharacter = Math.max(20, dong.commerceCharacter - decay);
  }
  if (dong.rentPressure === 0 && dong.commerceCharacter < 80) {
    dong.commerceCharacter = Math.min(80, dong.commerceCharacter + 0.2);
  }
  dong.commerceCharacter = Math.round(dong.commerceCharacter * 10) / 10;
}

// ==================== Population ====================

function updatePopulation(dong: Dong, state: GameState, adjacency: AdjacencyMap, policyEffects: PolicyEffects) {
  const pop = dong.population;
  if (pop <= 0) return;

  const natural = Math.round(pop * NATURAL_RATE * 0.25);
  let pull = calcMigrationPull(dong, state, adjacency);

  const pe = getPolicyEffect(dong.id, policyEffects);
  if (pe.population) {
    for (const [age, bonus] of Object.entries(pe.population)) {
      if (age === 'displacement') continue;
      pull += bonus * 0.25;
    }
  }

  if (dong._initPop) {
    const growthRatio = pop / dong._initPop;
    if (pull > 0 && growthRatio > 1.15) pull *= Math.max(0.1, 1.0 - (growthRatio - 1.15) * 2);
    else if (pull < 0 && growthRatio < 0.85) pull *= Math.max(0.1, 1.0 - (0.85 - growthRatio) * 2);
  }

  const ageGroups = ['youth', 'midAge', 'senior', 'elderly'] as const;
  const ageMigration: Record<string, number> = {};
  let totalMigration = 0;

  for (const age of ageGroups) {
    const agePop = (dong.populationByAge as Record<string, number>)[age] || 0;
    if (agePop <= 0) continue;
    const raw = agePop * pull * ACCEL_MIGRATION * (AGE_MOBILITY[age] || 0);
    const clamped = clamp(raw, -agePop * MAX_CHANGE_RATE, agePop * MAX_CHANGE_RATE);
    ageMigration[age] = Math.round(clamped);
    totalMigration += ageMigration[age];
  }

  const midAgeRate = dong.populationByAge.midAge > 0 ? (ageMigration.midAge || 0) / dong.populationByAge.midAge : 0;
  ageMigration.child = Math.round((dong.populationByAge.child || 0) * midAgeRate);
  ageMigration.teen = Math.round((dong.populationByAge.teen || 0) * midAgeRate);
  totalMigration += ageMigration.child + ageMigration.teen;

  const totalDelta = clamp(natural + totalMigration, -pop * MAX_CHANGE_RATE, pop * MAX_CHANGE_RATE);
  const scale = (natural + totalMigration) !== 0 ? totalDelta / (natural + totalMigration) : 1;

  const byAge = dong.populationByAge as Record<string, number>;
  for (const age of Object.keys(byAge)) {
    const ageDelta = age in ageMigration
      ? Math.round((ageMigration[age] + natural * (byAge[age] / pop)) * scale)
      : Math.round(natural * (byAge[age] / pop) * scale);
    byAge[age] = Math.max(0, byAge[age] + ageDelta);
  }

  dong.population = Object.values(byAge).reduce((s, v) => s + v, 0);

  if (pe.population?.displacement && pe.population.displacement < 0) {
    const displacePct = pe.population.displacement * 0.25;
    const displaced = Math.round(dong.population * Math.abs(displacePct));
    for (const age of Object.keys(byAge)) {
      const ratio = byAge[age] / Math.max(1, dong.population);
      byAge[age] = Math.max(0, byAge[age] - Math.round(displaced * ratio));
    }
    dong.population = Object.values(byAge).reduce((s, v) => s + v, 0);
  }

  if (pop > 0) {
    const popRatio = dong.population / pop;
    dong.households = Math.round(dong.households * (0.7 + 0.3 * popRatio));
  }
}

function calcMigrationPull(dong: Dong, state: GameState, adjacency: AdjacencyMap): number {
  const avgWorkerRatio = state.dongs.reduce((s, d) => s + d.workers / Math.max(1, d.population), 0) / state.dongs.length;
  const avgTransit = state.dongs.reduce((s, d) => s + d.transitScore, 0) / state.dongs.length;
  const avgHousing = state.dongs.reduce((s, d) => s + d.satisfactionFactors.housing, 0) / state.dongs.length;
  const avgCulture = state.dongs.reduce((s, d) => s + d.satisfactionFactors.culture, 0) / state.dongs.length;
  const avgSafety = state.dongs.reduce((s, d) => s + d.satisfactionFactors.safety, 0) / state.dongs.length;
  const avgWelfare = state.dongs.reduce((s, d) => s + d.satisfactionFactors.welfare, 0) / state.dongs.length;
  const avgVitality = state.dongs.reduce((s, d) => s + d.commerceVitality, 0) / state.dongs.length;
  const avgRent = state.dongs.reduce((s, d) => s + (d.rentPressure || 0), 0) / state.dongs.length;

  const workerRatio = dong.workers / Math.max(1, dong.population);
  const jobScore = normalize(workerRatio, avgWorkerRatio, 0.5);
  let adjJobBonus = 0;
  const neighbors = adjacency[dong.id] || {};
  for (const [nId, coeff] of Object.entries(neighbors)) {
    const neighbor = state.dongs.find(d => d.id === nId);
    if (neighbor) adjJobBonus += coeff * 0.3 * (neighbor.workers / Math.max(1, neighbor.population) - avgWorkerRatio);
  }

  const housingScore = normalize(dong.satisfactionFactors.housing, avgHousing, 15) - (dong.rentPressure - avgRent) * 1.5;
  const infraScore = normalize(dong.transitScore, avgTransit, Math.max(1, avgTransit)) * 0.5
    + normalize(dong.commerceVitality, avgVitality, Math.max(1, avgVitality)) * 0.3
    + normalize(dong.satisfactionFactors.culture, avgCulture, 15) * 0.2;
  const safetyScore = normalize(dong.satisfactionFactors.safety, avgSafety, 15);
  const eduScore = normalize(dong.satisfactionFactors.welfare, avgWelfare, 15);

  let pull = PULL_WEIGHTS.jobs * (jobScore + adjJobBonus)
    + PULL_WEIGHTS.housing * housingScore
    + PULL_WEIGHTS.infra * infraScore
    + PULL_WEIGHTS.safety * safetyScore
    + PULL_WEIGHTS.education * eduScore;

  if (dong.satisfaction > 58) pull += (dong.satisfaction - 58) * 0.001;
  else if (dong.satisfaction < 40) pull -= (40 - dong.satisfaction) * 0.001;

  pull -= (dong.rentPressure - avgRent) * 0.3;
  const livingPopRatio = (dong.livingPop?.weekdayDay || dong.population) / Math.max(1, dong.population);
  const avgLivingPopRatio = state.dongs.reduce((s, d) => s + (d.livingPop?.weekdayDay || d.population) / Math.max(1, d.population), 0) / state.dongs.length;
  pull -= (livingPopRatio / Math.max(0.1, avgLivingPopRatio) - 1.0) * 0.005;

  return clamp(pull, -0.03, 0.03);
}

// ==================== Finance ====================

function updateFinance(state: GameState, budgetAlloc: BudgetAllocation, policyEffects: PolicyEffects): Finance {
  const finance: Finance = { ...state.finance };
  const totalPop = state.dongs.reduce((s, d) => s + d.population, 0);
  const totalBiz = state.dongs.reduce((s, d) => s + d.businesses, 0);

  const globalPE = policyEffects.global || {};
  const localTaxBonus = (globalPE as Record<string, Record<string, number>>).finance?.localTaxBonus || 0;

  const bizGrowth = (totalBiz - BASE_BIZ) / BASE_BIZ;
  const taxGrowth = (bizGrowth * 0.3 + TAX_DECLINE_RATE + localTaxBonus) * ACCEL_FINANCE;
  finance.revenue = { ...finance.revenue };
  finance.revenue.localTax = Math.round(BASE_REVENUE.localTax * (1 + taxGrowth));
  finance.revenue.grantFromCity = Math.round(BASE_REVENUE.grantFromCity * (totalPop / BASE_POP));
  finance.revenue.subsidy = BASE_REVENUE.subsidy;

  const avgVitality = state.dongs.reduce((s, d) => s + d.commerceVitality, 0) / state.dongs.length;
  finance.revenue.otherIncome = Math.round(BASE_REVENUE.otherIncome * (0.8 + avgVitality * 0.004));

  const totalRevenue = finance.revenue.localTax + finance.revenue.grantFromCity + finance.revenue.subsidy + finance.revenue.otherIncome;
  finance.totalBudget = totalRevenue;

  const mandatoryDelta = (globalPE as Record<string, Record<string, number>>).finance?.mandatorySpendDelta || 0;
  finance.mandatorySpend = Math.round(totalRevenue * MANDATORY_RATIO) + mandatoryDelta;
  finance.freeBudget = totalRevenue - finance.mandatorySpend;

  const policyCost = (state.activePolicies || []).reduce((s, ap) => s + ap.policy.cost, 0);
  finance.policyCost = policyCost;
  finance.freeBudget = Math.max(0, finance.freeBudget - policyCost);
  finance.allocation = { ...budgetAlloc };

  const selfRevenue = finance.revenue.localTax + finance.revenue.otherIncome;
  finance.fiscalIndependence = Math.round((selfRevenue / Math.max(1, totalRevenue)) * 100);

  return finance;
}

// ==================== Satisfaction ====================

function updateSatisfaction(dong: Dong, state: GameState, adjacency: AdjacencyMap, budgetEffects: Record<string, number>, policyEffects: PolicyEffects) {
  const factors = dong.satisfactionFactors as Record<string, number>;

  // 1. Natural decay
  for (const key of Object.keys(factors)) factors[key] += DECAY;

  // 2. Budget effects
  for (const [budgetCat, effect] of Object.entries(budgetEffects)) {
    const mapping = BUDGET_TO_SATISFACTION[budgetCat];
    if (!mapping) continue;
    const baseEffect = 0.5 * effect;
    const bonusEffect = effect > 1.0 ? (effect - 1.0) * ACCEL_SAT * 0.3 : 0;
    const delta = baseEffect + bonusEffect;
    for (const [satComponent, weight] of Object.entries(mapping)) {
      if (factors[satComponent] !== undefined) factors[satComponent] += delta * weight;
    }
  }

  // 2.5. Policy direct satisfaction
  const pe = getPolicyEffect(dong.id, policyEffects);
  if (pe.satisfaction) {
    for (const [comp, val] of Object.entries(pe.satisfaction)) {
      if (factors[comp] !== undefined) factors[comp] += val * 0.25;
    }
  }

  // 3. Economic situation
  const avgBizDensity = state.dongs.reduce((s, d) => s + d.businesses / Math.max(1, d.population), 0) / state.dongs.length;
  const bizDensity = dong.businesses / Math.max(1, dong.population);
  const econDelta = (bizDensity / Math.max(0.01, avgBizDensity) - 1.0) * 2.0;
  factors.economy += clamp(econDelta, -3, 3);

  // Patch C: absolute economy decline penalty
  if (dong._initBiz) {
    const bizDecline = (dong._initBiz - dong.businesses) / dong._initBiz;
    if (bizDecline > 0.05) {
      factors.economy -= bizDecline * 15;
    }
  }

  // Patch C: absolute population decline penalty
  if (dong._initPop) {
    const popDecline = (dong._initPop - dong.population) / dong._initPop;
    if (popDecline > 0.03) {
      factors.welfare -= popDecline * 10;
      factors.housing -= popDecline * 5;
    }
  }

  if (dong.rentPressure > 0) factors.housing -= dong.rentPressure * 10;

  const livingPopRatio = (dong.livingPop?.weekdayDay || dong.population) / Math.max(1, dong.population);
  if (livingPopRatio > 2.0) {
    const overcrowdPenalty = (livingPopRatio - 2.0) * 2.0;
    factors.safety -= overcrowdPenalty;
    factors.housing -= overcrowdPenalty * 0.5;
  }

  const avgTransit = state.dongs.reduce((s, d) => s + d.transitScore, 0) / state.dongs.length;
  const transitDelta = (dong.transitScore / Math.max(0.1, avgTransit) - 1.0) * 1.5;
  factors.transport += clamp(transitDelta, -2, 2);

  // 4. Adjacency spillover
  const neighbors = adjacency[dong.id] || {};
  for (const [nId, coeff] of Object.entries(neighbors)) {
    const neighbor = state.dongs.find(d => d.id === nId);
    if (!neighbor) continue;
    for (const key of Object.keys(factors)) {
      const neighborVal = (neighbor.satisfactionFactors as Record<string, number>)[key] ?? 60;
      const diff = neighborVal - factors[key];
      factors[key] += diff * coeff * SPILLOVER_SAT * 0.1;
    }
  }

  // 5. Clamp
  for (const key of Object.keys(factors)) {
    factors[key] = clamp(Math.round(factors[key] * 10) / 10, 0, 100);
  }

  // 6. Weighted satisfaction
  dong.satisfaction = calcWeightedSatisfaction(dong);
}

function calcWeightedSatisfaction(dong: Dong): number {
  const pop = dong.population;
  if (pop <= 0) return 50;
  const factors = dong.satisfactionFactors as Record<string, number>;
  const byAge = dong.populationByAge as Record<string, number>;
  const childTeenPop = (byAge.child || 0) + (byAge.teen || 0);

  let totalWeightedSat = 0;
  let totalPop = 0;
  for (const [age, weights] of Object.entries(AGE_WEIGHTS)) {
    let agePop = byAge[age] || 0;
    if (age === 'midAge') agePop += childTeenPop;
    if (agePop <= 0) continue;
    let ageSat = 0;
    for (const [comp, w] of Object.entries(weights)) ageSat += (factors[comp] || 50) * w;
    totalWeightedSat += ageSat * agePop;
    totalPop += agePop;
  }
  return Math.round(totalWeightedSat / Math.max(1, totalPop));
}

// ==================== Event Effects ====================

function tickEventEffects(state: GameState) {
  if (!state.activeEvents) return;
  state.activeEvents = state.activeEvents.filter(ae => {
    ae.remainDuration--;
    if (ae.remainDuration <= 0) return false;
    const choice = ae.choice;
    if (!choice?.effects) return true;
    for (const dong of state.dongs) {
      const isAffected = ae.affectedDongs?.includes(dong.id) || !ae.affectedDongs;
      if (!isAffected) continue;
      if (choice.effects.satisfaction) {
        const factors = dong.satisfactionFactors as Record<string, number>;
        for (const [comp, val] of Object.entries(choice.effects.satisfaction as Record<string, number>)) {
          if (factors[comp] !== undefined) factors[comp] += val / (ae.totalDuration || 1);
        }
      }
    }
    return true;
  });
}

// ==================== Living Population ====================

function updateLivingPopulation(state: GameState) {
  for (const dong of state.dongs) {
    if (!dong.livingPop) continue;
    const workerRatio = dong.workers / Math.max(1, dong.population);
    const vitalityFactor = Math.min(1.02, 0.85 + dong.commerceVitality * 0.003);
    dong.livingPop.weekdayDay = Math.round(dong.livingPop.weekdayDay * vitalityFactor * 0.99 + dong.population * workerRatio * 0.01);
    dong.livingPop.weekdayNight = Math.round(dong.population * 0.9 + dong.livingPop.weekdayNight * 0.1);
    const charFactor = dong.commerceCharacter / 80;
    dong.livingPop.weekendDay = Math.round(dong.livingPop.weekdayDay * 0.85 * charFactor + dong.population * 0.15);
    dong.livingPop.weekendNight = Math.round(dong.livingPop.weekdayNight * 0.95);
  }
}
