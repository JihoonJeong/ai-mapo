/**
 * sim-reporter.mjs — 결과 로깅 (JSON)
 *
 * Per-run JSON + batch summary.
 * architecture-decision.md 결과 포맷 준수.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * 단일 실행 결과 저장
 */
export async function saveRun(result, outDir) {
  await mkdir(outDir, { recursive: true });
  const filename = `run-${result.runId}.json`;
  await writeFile(
    path.join(outDir, filename),
    JSON.stringify(result, null, 2),
    'utf-8',
  );
  return filename;
}

/**
 * 배치 결과 요약 저장
 */
export async function saveSummary(results, config, outDir) {
  await mkdir(outDir, { recursive: true });

  const grades = results.map(r => r.finalGrade);
  const scores = results.map(r => r.totalScore);

  const gradeCount = {};
  for (const g of grades) gradeCount[g] = (gradeCount[g] || 0) + 1;

  const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
  const minScore = Math.min(...scores);
  const maxScore = Math.max(...scores);

  // KPI averages
  const kpiAvg = {};
  if (results.length > 0 && results[0].kpis) {
    for (const kpi of results[0].kpis) {
      const vals = results.map(r => r.kpis.find(k => k.id === kpi.id)?.score || 0);
      kpiAvg[kpi.id] = {
        label: kpi.label,
        avg: +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1),
        max: kpi.max,
      };
    }
  }

  // Pledge selection frequency (when AI-chosen)
  const pledgeFreq = {};
  for (const r of results) {
    for (const pid of (r.pledges || [])) {
      pledgeFreq[pid] = (pledgeFreq[pid] || 0) + 1;
    }
  }

  // Policy frequency across all runs
  const policyFreq = {};
  for (const r of results) {
    if (!r.turnLog) continue;
    for (const tl of r.turnLog) {
      const activated = tl.aiAction?.policies?.activate || [];
      for (const pid of activated) {
        policyFreq[pid] = (policyFreq[pid] || 0) + 1;
      }
    }
  }

  // Total token usage
  const totalTokens = results.reduce(
    (acc, r) => ({
      input: acc.input + (r.tokenUsage?.input || 0),
      output: acc.output + (r.tokenUsage?.output || 0),
    }),
    { input: 0, output: 0 },
  );

  const summary = {
    timestamp: new Date().toISOString(),
    config: {
      provider: config.provider,
      model: config.model,
      runs: results.length,
      pledgeMode: config.pledgeMode || 'fixed',
      pledgeCount: config.pledgeCount || 2,
    },
    gradeDistribution: gradeCount,
    scores: {
      avg: +avgScore.toFixed(1),
      min: minScore,
      max: maxScore,
    },
    kpiAverages: kpiAvg,
    pledgeSelections: Object.entries(pledgeFreq)
      .sort((a, b) => b[1] - a[1])
      .map(([id, count]) => ({ id, count })),
    topPolicies: Object.entries(policyFreq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([id, count]) => ({ id, count })),
    totalTokens,
    totalDuration: results.reduce((s, r) => s + (r.durationMs || 0), 0),
  };

  await writeFile(
    path.join(outDir, 'summary.json'),
    JSON.stringify(summary, null, 2),
    'utf-8',
  );

  return summary;
}

/**
 * 실행 결과 콘솔 출력
 */
export function printRunResult(result, runIndex) {
  const kpiStr = result.kpis
    .map(k => `${k.label}: ${k.score}/${k.max}`)
    .join(', ');
  const pledgeStr = result.pledgeResults
    .map(p => `${p.name}:${p.achieved ? '달성' : '미달'}`)
    .join(', ');

  console.log(`  Run #${runIndex + 1}: ${result.finalGrade} (${result.totalScore}점) | ${kpiStr} | 공약: ${pledgeStr} | ${formatDuration(result.durationMs)}`);
}

/**
 * 배치 요약 콘솔 출력
 */
export function printSummary(summary) {
  console.log('\n=== Batch Summary ===');
  console.log(`Provider: ${summary.config.provider} / ${summary.config.model}`);
  console.log(`Runs: ${summary.config.runs}`);
  console.log(`Grades: ${JSON.stringify(summary.gradeDistribution)}`);
  console.log(`Scores: avg=${summary.scores.avg} min=${summary.scores.min} max=${summary.scores.max}`);

  if (Object.keys(summary.kpiAverages).length > 0) {
    const kpiStr = Object.values(summary.kpiAverages)
      .map(k => `${k.label}: ${k.avg}/${k.max}`)
      .join(', ');
    console.log(`KPI avg: ${kpiStr}`);
  }

  if (summary.topPolicies.length > 0) {
    console.log(`Top policies: ${summary.topPolicies.map(p => `${p.id}(${p.count})`).join(', ')}`);
  }

  console.log(`Tokens: ${summary.totalTokens.input} in / ${summary.totalTokens.output} out`);
  console.log(`Total time: ${formatDuration(summary.totalDuration)}`);
}

function formatDuration(ms) {
  if (!ms) return '0s';
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return `${min}m ${rem}s`;
}
