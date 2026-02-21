#!/usr/bin/env node
/**
 * run-compare.mjs — 7개 모델 비교 배치 실행
 *
 * Mock + OpenAI 3모델 + Gemini 3모델을 동일 조건으로 실행하고
 * 결과를 비교 테이블로 출력.
 *
 * Usage:
 *   node sim/run-compare.mjs
 *   node sim/run-compare.mjs --seed 42
 *   node sim/run-compare.mjs --pledge fiscal_health
 */

import path from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { HeadlessGame, PLEDGES } from './headless-game.mjs';
import { createProvider } from './sim-provider.mjs';

// Load .env files (no external dependency)
async function loadEnv() {
  const envFiles = [
    path.resolve(import.meta.dirname, '..', '.env'),
    '/Users/jihoon/Projects/ai-three-kingdoms/.env',
  ];
  for (const f of envFiles) {
    try {
      const text = await readFile(f, 'utf-8');
      for (const line of text.split('\n')) {
        if (line.startsWith('#') || !line.includes('=')) continue;
        const [key, ...rest] = line.split('=');
        const val = rest.join('=').trim();
        if (key.trim() && val && !process.env[key.trim()]) {
          process.env[key.trim()] = val;
        }
      }
    } catch { /* ignore missing */ }
  }
}
await loadEnv();

// === Config ===
const MODELS = [
  { provider: 'mock',      model: 'mock',                   label: 'Mock (균등)' },
  { provider: 'openai',    model: 'gpt-5-mini',             label: 'GPT-5 mini' },
  { provider: 'openai',    model: 'o4-mini',                label: 'o4-mini' },
  { provider: 'anthropic', model: 'claude-sonnet-4-6',      label: 'Sonnet 4.6' },
  { provider: 'gemini',    model: 'gemini-3-flash-preview',  label: 'Gemini 3 Flash' },
  { provider: 'gemini',    model: 'gemini-3-pro-preview',    label: 'Gemini 3 Pro' },
  { provider: 'gemini',    model: 'gemini-3.1-pro-preview',  label: 'Gemini 3.1 Pro' },
];

// === Arg Parsing ===
function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { seed: null, pledge: 'fiscal_health' };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--seed') opts.seed = parseInt(args[++i], 10);
    if (args[i] === '--pledge') opts.pledge = args[++i];
    if (args[i] === '--help' || args[i] === '-h') {
      console.log('Usage: node sim/run-compare.mjs [--seed N] [--pledge PLEDGE_ID]');
      console.log(`Available pledges: ${PLEDGES.map(p => p.id).join(', ')}`);
      process.exit(0);
    }
  }
  opts.seed = opts.seed ?? Math.floor(Math.random() * 2147483647);
  return opts;
}

// === Main ===
async function main() {
  const opts = parseArgs();
  const pledges = [opts.pledge];
  const seed = opts.seed;

  console.log('=== AI 마포구청장 — 모델 비교 시뮬레이션 ===');
  console.log(`공약: ${opts.pledge}`);
  console.log(`Seed: ${seed}`);
  console.log(`모델: ${MODELS.length}개`);
  console.log('');

  const results = [];

  for (const m of MODELS) {
    console.log(`▶ ${m.label} (${m.provider}/${m.model})...`);

    // Check API keys
    if (m.provider === 'openai' && !process.env.OPENAI_API_KEY) {
      console.log('  ⚠ OPENAI_API_KEY 없음, 건너뜀');
      continue;
    }
    if (m.provider === 'anthropic' && !process.env.ANTHROPIC_API_KEY) {
      console.log('  ⚠ ANTHROPIC_API_KEY 없음, 건너뜀');
      continue;
    }
    if (m.provider === 'gemini' && !process.env.GEMINI_API_KEY) {
      console.log('  ⚠ GEMINI_API_KEY 없음, 건너뜀');
      continue;
    }

    try {
      const provider = createProvider(m.provider, { model: m.model });
      const game = new HeadlessGame({
        provider,
        pledges,
        seed,
        historyWindow: 4,
      });

      const result = await game.play();
      result.provider = m.provider;
      result.model = m.model;
      result.label = m.label;
      results.push(result);

      // Quick summary
      const pop = result.kpis.find(k => k.id === 'population');
      const sat = result.kpis.find(k => k.id === 'satisfaction');
      const econ = result.kpis.find(k => k.id === 'economy');
      console.log(`  → ${result.finalGrade} (${result.totalScore}점) | 인구${pop.detail} 만족${sat.detail} 경제${econ.detail}`);

      // Check if budget varied across turns
      const budgets = result.turnLog.map(t => JSON.stringify(t.aiAction.budget));
      const uniqueBudgets = new Set(budgets).size;
      const policiesUsed = result.turnLog.some(t =>
        t.aiAction.policies.activate.length > 0 || t.aiAction.policies.deactivate.length > 0
      );
      console.log(`  → 예산 변화: ${uniqueBudgets > 1 ? `${uniqueBudgets}가지` : '없음(균등)'} | 정책 사용: ${policiesUsed ? '있음' : '없음'}`);

    } catch (err) {
      console.log(`  ✗ 오류: ${err.message}`);
    }

    console.log('');
  }

  // === Comparison Table ===
  if (results.length > 0) {
    console.log('=== 비교 결과 ===');
    console.log('');

    // Header
    const header = ['모델', '등급', '점수', 'KPI', '공약', '인구', '경제', '세수', '재정', '만족', '균형', '예산변화', '정책'];
    console.log(header.join('\t'));
    console.log('-'.repeat(130));

    for (const r of results) {
      const kpiMap = {};
      for (const k of r.kpis) kpiMap[k.id] = k;

      const budgets = r.turnLog.map(t => JSON.stringify(t.aiAction.budget));
      const uniqueBudgets = new Set(budgets).size;
      const policiesUsed = r.turnLog.filter(t =>
        t.aiAction.policies.activate.length > 0
      ).length;

      const row = [
        (r.label || r.model).padEnd(16),
        r.finalGrade,
        String(r.totalScore).padStart(3),
        String(r.kpiTotal).padStart(2),
        String(r.pledgeTotal).padStart(3),
        kpiMap.population?.detail || '',
        kpiMap.economy?.detail || '',
        kpiMap.tax?.detail || '',
        kpiMap.fiscal?.detail || '',
        kpiMap.satisfaction?.detail || '',
        kpiMap.balance?.detail || '',
        uniqueBudgets > 1 ? `${uniqueBudgets}가지` : '균등',
        policiesUsed > 0 ? `${policiesUsed}턴` : '없음',
      ];
      console.log(row.join('\t'));
    }

    // Save results
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const outDir = path.join('sim', 'results', `compare-${timestamp}`);
    await mkdir(outDir, { recursive: true });

    const summary = {
      timestamp,
      seed,
      pledge: opts.pledge,
      results: results.map(r => ({
        label: r.label,
        provider: r.provider,
        model: r.model,
        grade: r.finalGrade,
        totalScore: r.totalScore,
        kpiTotal: r.kpiTotal,
        pledgeTotal: r.pledgeTotal,
        kpis: r.kpis,
        pledgeResults: r.pledgeResults,
        budgetVariation: new Set(r.turnLog.map(t => JSON.stringify(t.aiAction.budget))).size,
        policiesUsedTurns: r.turnLog.filter(t => t.aiAction.policies.activate.length > 0).length,
        durationMs: r.durationMs,
      })),
    };

    await writeFile(path.join(outDir, 'compare-summary.json'), JSON.stringify(summary, null, 2));

    // Save individual turn logs
    for (const r of results) {
      const fname = `${r.provider}-${r.model.replace(/[^a-zA-Z0-9.-]/g, '_')}.json`;
      await writeFile(path.join(outDir, fname), JSON.stringify({
        label: r.label,
        provider: r.provider,
        model: r.model,
        grade: r.finalGrade,
        totalScore: r.totalScore,
        kpis: r.kpis,
        pledgeResults: r.pledgeResults,
        turnLog: r.turnLog,
        seed,
      }, null, 2));
    }

    console.log(`\n결과 저장: ${outDir}`);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
