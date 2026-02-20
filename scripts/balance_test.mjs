#!/usr/bin/env node
/**
 * balance_test.mjs — 48-turn balance simulation test
 *
 * Two scenarios:
 *   A) Baseline (no policy effects)
 *   B) 3-Policy (newBizBonus, rentPressureDelta, workerGrowth)
 *
 * Tracks population %, business %, avg satisfaction,
 * rent pressure trends, and per-turn business deltas.
 */

import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

// ---------- load engine modules via dynamic import ----------
const ROOT = '/Users/jihoon/Projects/ai-mapo';

const { updateEconomy }      = await import(pathToFileURL(path.join(ROOT, 'js/engine/economy.js')).href);
const { updatePopulation }   = await import(pathToFileURL(path.join(ROOT, 'js/engine/population.js')).href);
const { updateSatisfaction } = await import(pathToFileURL(path.join(ROOT, 'js/engine/satisfaction.js')).href);
const { updateFinance, calcBudgetEffects } = await import(pathToFileURL(path.join(ROOT, 'js/engine/finance.js')).href);

// ---------- load data ----------
const initData  = JSON.parse(await readFile(path.join(ROOT, 'data/game/mapo_init.json'), 'utf-8'));
const adjData   = JSON.parse(await readFile(path.join(ROOT, 'data/game/adjacency.json'), 'utf-8'));
const adjacency = adjData.adjacency;

// ---------- helpers ----------
function deepCopy(obj) { return JSON.parse(JSON.stringify(obj)); }

function totals(state) {
  let pop = 0, biz = 0, workers = 0, satSum = 0, rentSum = 0;
  for (const d of state.dongs) {
    pop     += d.population;
    biz     += d.businesses;
    workers += d.workers;
    satSum  += d.satisfaction;
    rentSum += d.rentPressure || 0;
  }
  return {
    pop,
    biz,
    workers,
    avgSat:  satSum / state.dongs.length,
    avgRent: rentSum / state.dongs.length,
  };
}

/** Run one simulation tick (mirrors simulation.js tick order). */
function runTick(state, policyEffects) {
  const budgetAlloc = state.finance.allocation;
  const budgetEffects = calcBudgetEffects(budgetAlloc, state.finance.freeBudget);

  // Set init baselines on first tick
  for (const dong of state.dongs) {
    if (!dong._initPop) dong._initPop = dong.population;
    if (!dong._initBiz) dong._initBiz = dong.businesses;
  }

  // 1. Economy
  for (const dong of state.dongs) {
    updateEconomy(dong, state, adjacency, budgetAlloc, policyEffects);
  }
  // 2. Population
  for (const dong of state.dongs) {
    updatePopulation(dong, state, adjacency, policyEffects);
  }
  // 3. Finance
  state.finance = updateFinance(state, budgetAlloc, policyEffects);
  // 4. Satisfaction
  for (const dong of state.dongs) {
    updateSatisfaction(dong, state, adjacency, budgetEffects, policyEffects);
  }
  // 5. Living population (inline from simulation.js)
  for (const dong of state.dongs) {
    if (!dong.livingPop) continue;
    const wr = dong.workers / Math.max(1, dong.population);
    const vf = Math.min(1.02, 0.85 + dong.commerceVitality * 0.003);
    dong.livingPop.weekdayDay   = Math.round(dong.livingPop.weekdayDay * vf * 0.99 + dong.population * wr * 0.01);
    dong.livingPop.weekdayNight = Math.round(dong.population * 0.9 + dong.livingPop.weekdayNight * 0.1);
    const cf = dong.commerceCharacter / 80;
    dong.livingPop.weekendDay   = Math.round(dong.livingPop.weekdayDay * 0.85 * cf + dong.population * 0.15);
    dong.livingPop.weekendNight = Math.round(dong.livingPop.weekdayNight * 0.95);
  }

  return state;
}

// ---------- scenario definitions ----------
const TURNS = 48;

const NO_POLICY = { global: {}, byDong: {} };

const THREE_POLICY = {
  global: {
    economy: {
      newBizBonus:       0.005,
      rentPressureDelta: -0.001,
      workerGrowth:      0.003,
    },
  },
  byDong: {},
};

// ---------- run scenarios ----------
function runScenario(label, policyEffects) {
  const state = deepCopy(initData);
  state.activePolicies = [];
  if (!state.meta) state.meta = {};
  state.meta.turn = 0;

  const initial = totals(state);
  const history = [];
  const bizPerTurn = [];

  for (let t = 1; t <= TURNS; t++) {
    state.meta.turn = t;
    runTick(state, policyEffects);

    const snap = totals(state);
    history.push(snap);
    bizPerTurn.push(snap.biz);
  }

  const final = totals(state);
  return {
    label,
    initial,
    final,
    history,
    bizPerTurn,
    popChangePct:  ((final.pop - initial.pop) / initial.pop * 100).toFixed(2),
    bizChangePct:  ((final.biz - initial.biz) / initial.biz * 100).toFixed(2),
    avgSatFinal:   final.avgSat.toFixed(1),
    avgRentFinal:  (final.avgRent * 10000).toFixed(1),
  };
}

console.log('=== AI-MAPO Balance Test ===');
console.log(`Simulating ${TURNS} turns (= 12 years)...\n`);

const baseline = runScenario('Baseline (no policy)',  NO_POLICY);
const withPol  = runScenario('3-Policy active',       THREE_POLICY);

// ---------- summary table ----------
function pad(str, len) { return String(str).padStart(len); }

const SEP = '-'.repeat(62);
console.log(SEP);
console.log(`${'Metric'.padEnd(30)} | ${pad('Baseline', 14)} | ${pad('3-Policy', 14)}`);
console.log(SEP);

const rows = [
  ['Init Population',   baseline.initial.pop,          withPol.initial.pop],
  ['Final Population',  baseline.final.pop,            withPol.final.pop],
  ['Population chg %',  baseline.popChangePct + '%',   withPol.popChangePct + '%'],
  ['Init Businesses',   baseline.initial.biz,          withPol.initial.biz],
  ['Final Businesses',  baseline.final.biz,            withPol.final.biz],
  ['Business chg %',    baseline.bizChangePct + '%',   withPol.bizChangePct + '%'],
  ['Avg Satisfaction',  baseline.avgSatFinal,          withPol.avgSatFinal],
  ['Avg Rent (bps)',    baseline.avgRentFinal,         withPol.avgRentFinal],
];

for (const [metric, a, b] of rows) {
  console.log(`${metric.padEnd(30)} | ${pad(a, 14)} | ${pad(b, 14)}`);
}
console.log(SEP);

// ---------- per-turn business counts (3-policy only) ----------
console.log('\n=== Per-Turn Business Count (3-Policy Scenario) ===');
console.log('Turn  | Total Biz | Delta | Delta %');
console.log('-'.repeat(44));

let prevBiz = withPol.initial.biz;
let deathSpiralWarning = false;
let explosionWarning   = false;

for (let t = 0; t < TURNS; t++) {
  const biz   = withPol.bizPerTurn[t];
  const delta  = biz - prevBiz;
  const pct    = ((delta / Math.max(1, prevBiz)) * 100).toFixed(2);
  const pctNum = parseFloat(pct);

  let flag = '';
  if (pctNum < -3)  { flag = ' << DEATH SPIRAL';  deathSpiralWarning = true; }
  if (pctNum >  5)  { flag = ' >> EXPLOSION';      explosionWarning   = true; }

  console.log(
    `${String(t + 1).padStart(4)}  | ${String(biz).padStart(9)} | ${String(delta).padStart(5)} | ${pct.padStart(6)}%${flag}`
  );
  prevBiz = biz;
}

// ---------- rent pressure per-turn (3-policy) ----------
console.log('\n=== Per-Turn Avg Rent Pressure (3-Policy) ===');
console.log('Turn  | Avg Rent (bps)');
console.log('-'.repeat(28));
for (let t = 0; t < TURNS; t++) {
  const rBps = (withPol.history[t].avgRent * 10000).toFixed(1);
  console.log(`${String(t + 1).padStart(4)}  | ${rBps.padStart(14)}`);
}

// ---------- satisfaction trend (both) ----------
console.log('\n=== Per-Turn Avg Satisfaction (Both) ===');
console.log('Turn  | Baseline | 3-Policy');
console.log('-'.repeat(34));
for (let t = 0; t < TURNS; t++) {
  const bSat = baseline.history[t].avgSat.toFixed(1);
  const pSat = withPol.history[t].avgSat.toFixed(1);
  console.log(`${String(t + 1).padStart(4)}  | ${bSat.padStart(8)} | ${pSat.padStart(8)}`);
}

// ---------- diminishing returns check ----------
console.log('\n=== Diminishing Returns Check (3-Policy Biz Delta %) ===');
const firstQuarter = withPol.bizPerTurn.slice(0, 4);
const lastQuarter  = withPol.bizPerTurn.slice(-4);

function avgDeltaPct(arr, startBiz) {
  let prev = startBiz;
  let sum  = 0;
  for (const b of arr) {
    sum += (b - prev) / Math.max(1, prev) * 100;
    prev = b;
  }
  return (sum / arr.length).toFixed(3);
}

const firstAvg = avgDeltaPct(firstQuarter, withPol.initial.biz);
const lastAvg  = avgDeltaPct(lastQuarter, withPol.bizPerTurn[TURNS - 5]);

console.log(`  First 4 turns avg delta: ${firstAvg}%`);
console.log(`  Last  4 turns avg delta: ${lastAvg}%`);

if (parseFloat(lastAvg) < parseFloat(firstAvg)) {
  console.log('  --> Diminishing returns ARE working (growth slows over time).');
} else {
  console.log('  --> WARNING: growth is NOT slowing -- check diminishing-return logic.');
}

// ---------- verdict ----------
console.log('\n=== VERDICT ===');
const issues = [];

if (deathSpiralWarning)
  issues.push('DEATH SPIRAL detected (>3% business drop in a single turn).');
if (explosionWarning)
  issues.push('EXPLOSION detected (>5% business growth in a single turn).');
if (Math.abs(parseFloat(baseline.popChangePct)) > 30)
  issues.push(`Baseline population change (${baseline.popChangePct}%) exceeds 30% over 48 turns.`);
if (Math.abs(parseFloat(withPol.bizChangePct)) > 80)
  issues.push(`3-Policy business change (${withPol.bizChangePct}%) exceeds 80% over 48 turns.`);
if (parseFloat(baseline.avgSatFinal) < 20)
  issues.push(`Baseline satisfaction collapsed to ${baseline.avgSatFinal}.`);
if (parseFloat(withPol.avgSatFinal) > 95)
  issues.push(`3-Policy satisfaction hit ceiling (${withPol.avgSatFinal}).`);

if (issues.length === 0) {
  console.log('PASS -- No runaway dynamics detected. Balance looks reasonable.');
} else {
  console.log('ISSUES FOUND:');
  for (const iss of issues) console.log(`  - ${iss}`);
}

console.log('\nDone.');
