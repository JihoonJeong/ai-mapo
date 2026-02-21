#!/usr/bin/env node
/**
 * generate_init.js
 * Combines 6 raw data files + mapo_blocks.json → data/game/mapo_init.json
 *
 * Usage: node scripts/generate_init.js
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// --- Load raw data ---
const popBasic = JSON.parse(readFileSync(join(ROOT, 'data/raw/mapo_population_basic.json'), 'utf8'));
const popAge = JSON.parse(readFileSync(join(ROOT, 'data/raw/mapo_population_age.json'), 'utf8'));
const business = JSON.parse(readFileSync(join(ROOT, 'data/raw/mapo_business.json'), 'utf8'));
const livingPop = JSON.parse(readFileSync(join(ROOT, 'data/raw/mapo_living_population.json'), 'utf8'));
const subway = JSON.parse(readFileSync(join(ROOT, 'data/raw/mapo_subway.json'), 'utf8'));
const finance = JSON.parse(readFileSync(join(ROOT, 'data/raw/mapo_finance.json'), 'utf8'));
const blocks = JSON.parse(readFileSync(join(ROOT, 'data/game/mapo_blocks.json'), 'utf8'));

// --- Dong ID mapping (Korean name → English ID) from mapo_blocks.json ---
const DONG_MAP = {};
for (const dong of blocks.dongs) {
  DONG_MAP[dong.name] = dong.id;
}

// Ensure all 16 dongs are mapped
const DONG_NAMES = Object.keys(DONG_MAP);
console.log(`Found ${DONG_NAMES.length} dongs:`, DONG_NAMES.join(', '));

// --- Subway stations grouped by dong ---
const stationsByDong = {};
for (const [stationName, stationData] of Object.entries(subway.stations)) {
  const dongName = stationData.district;
  if (!stationsByDong[dongName]) stationsByDong[dongName] = [];
  stationsByDong[dongName].push({
    name: stationName,
    lines: stationData.lines,
    dailyTotal: stationData.daily_avg_total,
  });
}

// --- Transit score calculation (numerical-design-v1 Section 7.2) ---
function calcTransitScore(dongName) {
  const stations = stationsByDong[dongName] || [];
  let score = 0;
  for (const st of stations) {
    const lineBonus = st.lines.length === 1 ? 1.0
      : st.lines.length === 2 ? 1.3
      : st.lines.length === 3 ? 1.5
      : 1.7; // 4+
    score += (st.dailyTotal / 10000) * lineBonus;
  }
  return Math.round(score * 10) / 10;
}

// --- Compute averages for normalization ---
const allBizDensities = [];
const allWorkerRatios = [];
const allElderlyPcts = [];

for (const dongName of DONG_NAMES) {
  const pop = popBasic.districts[dongName]?.total_population || 0;
  const biz = business.districts[dongName]?.total_establishments || 0;
  const workers = business.districts[dongName]?.total_workers || 0;
  const elderlyCount = popAge.districts[dongName]?.life_stage?.elderly_65_plus?.count || 0;

  if (pop > 0) {
    allBizDensities.push(biz / pop);
    allWorkerRatios.push(workers / pop);
    allElderlyPcts.push(elderlyCount / pop);
  }
}

const avgWorkerRatio = allWorkerRatios.reduce((a, b) => a + b, 0) / allWorkerRatios.length;
const maxBizDensity = Math.max(...allBizDensities);

console.log(`Avg worker ratio: ${avgWorkerRatio.toFixed(3)}, Max biz density: ${maxBizDensity.toFixed(3)}`);

// --- Build each dong ---
const dongs = [];

for (const dongName of DONG_NAMES) {
  const dongId = DONG_MAP[dongName];
  const pb = popBasic.districts[dongName];
  const pa = popAge.districts[dongName];
  const bz = business.districts[dongName];
  const lp = livingPop.districts[dongName];
  const blockDong = blocks.dongs.find(d => d.id === dongId);

  if (!pb || !pa || !bz) {
    console.warn(`Missing data for ${dongName}, skipping`);
    continue;
  }

  const population = pb.total_population;
  const households = pb.households;

  // Population by age (6 life stages)
  // district_total uses "count", per-dong uses "total"
  const ls = pa.life_stage;
  const getCount = (stage) => stage.count ?? stage.total ?? 0;
  const populationByAge = {
    child: getCount(ls.infant_0_9),
    teen: getCount(ls.youth_10_19),
    youth: getCount(ls.young_adult_20_34),
    midAge: getCount(ls.middle_35_49),
    senior: getCount(ls.senior_50_64),
    elderly: getCount(ls.elderly_65_plus),
  };

  // Business
  const businesses = bz.total_establishments;
  const workers = bz.total_workers;
  const avgWorkersPerBiz = bz.workers_per_establishment;

  // Living population (4 quadrants)
  const livingPopData = lp ? {
    weekdayDay: Math.round(lp.weekday.daytime_avg_09_18),
    weekdayNight: Math.round(lp.weekday.nighttime_avg_21_06),
    weekendDay: Math.round(lp.weekend.daytime_avg_09_18),
    weekendNight: Math.round(lp.weekend.nighttime_avg_21_06),
  } : { weekdayDay: population, weekdayNight: population, weekendDay: population, weekendNight: population };

  // --- Derived metrics ---
  const bizDensity = businesses / population;
  const workerRatio = workers / population;
  const elderlyPct = populationByAge.elderly / population;

  // Commerce vitality: normalize biz density to 0~100
  const commerceVitality = Math.round(Math.min(100, (bizDensity / maxBizDensity) * 85 + 15));

  // Rent pressure: initial based on commerce vitality (threshold 70, low sensitivity)
  const rentPressure = Math.round(Math.max(0, (commerceVitality - 70) * 0.0003) * 10000) / 10000;

  // Commerce character: default 80, seogyo gets 70 (already franchised)
  const commerceCharacter = dongId === 'seogyo' ? 70 : 80;

  // Transit score
  const transitScore = calcTransitScore(dongName);

  // --- Initial satisfaction (numerical-design-v1 Section 4.4) ---
  // Base 60 + economic correction + transport correction + housing correction
  const economyAdj = Math.max(-10, Math.min(10, (workerRatio - avgWorkerRatio) * 10));
  const transportAdj = Math.max(-8, Math.min(8, transitScore / 3));
  const housingAdj = elderlyPct < 0.18 ? 3 : -2;
  const satisfaction = Math.round(60 + economyAdj + transportAdj + housingAdj);

  // Satisfaction factors (differentiated starting values)
  const satisfactionFactors = {
    economy: Math.round(Math.min(80, Math.max(40, 55 + (workerRatio - avgWorkerRatio) * 15))),
    transport: Math.round(Math.min(85, Math.max(35, 50 + transitScore * 2))),
    housing: Math.round(Math.min(75, Math.max(40, elderlyPct < 0.18 ? 65 : 55))),
    safety: 60,
    culture: Math.round(Math.min(80, Math.max(40, 50 + bizDensity * 30))),
    welfare: Math.round(Math.min(70, Math.max(40, elderlyPct > 0.20 ? 45 : 55))),
  };

  // Block summary
  const blockCount = blockDong?.blocks?.length || 0;
  const zoningConflicts = blockDong?.blocks?.filter(b => b.zoningConflict).length || 0;

  dongs.push({
    id: dongId,
    name: dongName,
    population,
    populationByAge,
    households,
    businesses,
    workers,
    avgWorkersPerBiz,
    commerceVitality,
    rentPressure,
    commerceCharacter,
    livingPop: livingPopData,
    satisfaction,
    satisfactionFactors,
    transitScore,
    blockSummary: {
      total: blockCount,
      zoningConflicts,
    },
  });
}

// Sort by population descending (same order as design doc)
dongs.sort((a, b) => b.population - a.population);

// --- Finance (gu-level) ---
const financeData = {
  totalBudget: 2188,       // 억원/턴
  mandatorySpend: 1094,    // 50%
  freeBudget: 1094,        // 50%
  allocation: {
    economy: 15,
    transport: 15,
    culture: 10,
    environment: 10,
    education: 15,
    welfare: 20,
    renewal: 15,
  },
  revenue: {
    localTax: 613,
    grantFromCity: 700,
    subsidy: 750,
    otherIncome: 125,
  },
  fiscalIndependence: 28,
};

// --- Industry breakdown (gu-level, for game reference) ---
const industryBreakdown = {};
for (const [key, val] of Object.entries(business.industry_breakdown)) {
  if (val.establishments > 0) {
    industryBreakdown[key] = {
      code: val.ksic_code,
      name: val.name_kr,
      establishments: val.establishments,
      workers: val.workers,
      estPct: val.establishment_pct,
      workerPct: val.worker_pct,
    };
  }
}

// --- Assemble output ---
const output = {
  meta: {
    version: '1.0',
    generatedDate: new Date().toISOString().split('T')[0],
    sources: [
      'mapo_population_basic.json (2026-01)',
      'mapo_population_age.json (2026-01)',
      'mapo_business.json (2020/2022)',
      'mapo_living_population.json (2026-02)',
      'mapo_subway.json (2024)',
      'mapo_finance.json (2024-2026)',
      'mapo_blocks.json (v0.3)',
    ],
    totalPopulation: popBasic.district_total.total_population,
    totalBusinesses: business.district_total.total_establishments,
    totalWorkers: business.district_total.total_workers,
  },
  dongs,
  finance: financeData,
  industryBreakdown,
};

// --- Write output ---
const outPath = join(ROOT, 'data/game/mapo_init.json');
writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf8');
console.log(`\nGenerated ${outPath}`);
console.log(`  ${dongs.length} dongs`);
console.log(`  Total population: ${output.meta.totalPopulation.toLocaleString()}`);
console.log(`  Total businesses: ${output.meta.totalBusinesses.toLocaleString()}`);
