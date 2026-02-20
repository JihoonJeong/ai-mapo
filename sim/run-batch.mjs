#!/usr/bin/env node
/**
 * run-batch.mjs — Headless 시뮬레이션 배치 실행 CLI
 *
 * Usage:
 *   node sim/run-batch.mjs --provider mock --runs 1
 *   node sim/run-batch.mjs --provider openai --model gpt-4o-mini --runs 5
 *   node sim/run-batch.mjs --provider anthropic --model claude-sonnet-4-6 --runs 10
 *   node sim/run-batch.mjs --provider ollama --model llama3.1:8b --runs 3
 *
 * Options:
 *   --provider      mock | anthropic | openai | ollama (default: mock)
 *   --model         Model ID (default: per-provider)
 *   --runs          Number of runs (default: 1)
 *   --pledges       Comma-separated pledge IDs (fixed pledges, skips AI selection)
 *   --pledge-count  Number of pledges AI should choose (default: 2)
 *   --seed          Base RNG seed (default: random, incremented per run)
 *   --out           Output directory (default: sim/results/)
 *   --api-key       API key (overrides env var)
 *   --ollama-url    Ollama URL (default: http://localhost:11434)
 */

import path from 'node:path';
import { HeadlessGame, PLEDGES } from './headless-game.mjs';
import { createProvider, DEFAULT_MODELS } from './sim-provider.mjs';
import { saveRun, saveSummary, printRunResult, printSummary } from './sim-reporter.mjs';

// === Arg Parsing ===
function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    provider: 'mock',
    model: null,
    runs: 1,
    pledges: null,       // null = AI chooses
    pledgeCount: 2,      // how many pledges AI picks
    seed: null,
    out: null,
    apiKey: null,
    ollamaUrl: null,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--provider': opts.provider = args[++i]; break;
      case '--model': opts.model = args[++i]; break;
      case '--runs': opts.runs = parseInt(args[++i], 10) || 1; break;
      case '--pledges': opts.pledges = args[++i].split(',').map(s => s.trim()); break;
      case '--pledge-count': opts.pledgeCount = parseInt(args[++i], 10) || 2; break;
      case '--seed': opts.seed = parseInt(args[++i], 10); break;
      case '--out': opts.out = args[++i]; break;
      case '--api-key': opts.apiKey = args[++i]; break;
      case '--ollama-url': opts.ollamaUrl = args[++i]; break;
      case '--help': case '-h':
        console.log(`Usage: node sim/run-batch.mjs [options]\n`);
        console.log(`  --provider      mock | anthropic | openai | ollama`);
        console.log(`  --model         Model ID`);
        console.log(`  --runs          Number of runs`);
        console.log(`  --pledges       Comma-separated pledge IDs (fixed, skips AI selection)`);
        console.log(`  --pledge-count  Number of pledges AI should choose (default: 2)`);
        console.log(`  --seed          Base RNG seed`);
        console.log(`  --out           Output directory`);
        console.log(`  --api-key       API key`);
        console.log(`  --ollama-url    Ollama URL`);
        console.log(`\nAvailable pledges: ${PLEDGES.map(p => p.id).join(', ')}`);
        process.exit(0);
    }
  }

  // Defaults
  opts.model = opts.model || DEFAULT_MODELS[opts.provider] || 'mock';

  return opts;
}

// === Main ===
async function main() {
  const opts = parseArgs();

  console.log('=== AI 마포구청장 — Headless Simulation ===');
  console.log(`Provider: ${opts.provider} / ${opts.model}`);
  console.log(`Runs: ${opts.runs}`);

  // Create provider
  const providerConfig = {
    apiKey: opts.apiKey,
    model: opts.model,
    ollamaUrl: opts.ollamaUrl,
  };
  const provider = createProvider(opts.provider, providerConfig);

  // History window
  const historyWindow = opts.provider === 'ollama' ? 2 : 4;

  // Base seed
  const baseSeed = opts.seed ?? Math.floor(Math.random() * 2147483647);

  // Pledges
  let pledges = null; // null = AI chooses each run
  if (opts.pledges) {
    // Validate explicitly specified pledges
    pledges = opts.pledges.filter(id => PLEDGES.some(p => p.id === id));
    if (pledges.length === 0) {
      console.warn('Warning: no valid pledge IDs specified. AI will choose.');
      pledges = null;
    }
  }
  const pledgeMode = pledges ? 'fixed' : 'ai-chosen';
  console.log(`Pledges: ${pledges ? pledges.join(', ') : `AI selects ${opts.pledgeCount} per run`}`);
  console.log(`Base seed: ${baseSeed}`);

  // Output dir
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const modelShort = opts.model.replace(/[^a-zA-Z0-9.-]/g, '_');
  const outDir = opts.out || path.join('sim', 'results', `${opts.provider}-${modelShort}-${timestamp}`);

  console.log(`Output: ${outDir}`);
  console.log('');

  // === Batch Loop ===
  const results = [];

  for (let i = 0; i < opts.runs; i++) {
    const runSeed = baseSeed + i;
    const runId = `${timestamp}-${String(i + 1).padStart(3, '0')}`;

    console.log(`  Starting run #${i + 1}/${opts.runs} (seed: ${runSeed})...`);

    const game = new HeadlessGame({
      provider,
      pledges,           // null = AI chooses, array = fixed
      pledgeCount: opts.pledgeCount,
      seed: runSeed,
      historyWindow,
    });

    const result = await game.play();
    result.runId = runId;
    result.provider = opts.provider;
    result.model = opts.model;

    // Save individual run
    await saveRun(result, outDir);
    printRunResult(result, i);

    results.push(result);
  }

  // === Summary ===
  const summary = await saveSummary(results, { provider: opts.provider, model: opts.model, pledgeMode, pledgeCount: opts.pledgeCount }, outDir);
  printSummary(summary);

  console.log(`\nResults saved to: ${outDir}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
