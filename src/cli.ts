#!/usr/bin/env tsx
/**
 * Arena CLI.
 *
 *   arena list                          — list tasks
 *   arena doctor                        — check which agent CLIs are installed
 *   arena run --agents a,b --model M    — run a benchmark
 *   arena report <runDir>               — (re)generate report.md for a run
 *   arena verify [taskId…]              — prove tasks discriminate: held-out
 *                                         tests FAIL on the pristine workspace
 *                                         and PASS on the reference solution
 *   arena baseline save <runDir>        — snapshot a run as the drift baseline
 *   arena baseline show                 — print the current baseline
 *   arena gate <runDir>                 — fail (exit 1) if a run regressed vs
 *                                         the baseline (the CI drift gate)
 */

import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { adapterNames, createAdapter } from "./adapters/index.js";
import {
  buildBaseline,
  evaluateGate,
  formatGateReport,
  type GateThresholds,
  loadBaseline,
  loadGateConfig,
  saveBaseline,
} from "./baseline.js";
import { executeRun } from "./orchestrator.js";
import { generateReport, loadRun } from "./report.js";
import type { AgentSpec, LoadedTask } from "./types.js";
import { applySolution, loadTasks, runVerification, seedWorkspace } from "./workspace.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const TASK_ROOT = join(HERE, "..", "tasks");

const [command, ...rest] = process.argv.slice(2);

switch (command) {
  case "list":
    cmdList();
    break;
  case "doctor":
    cmdDoctor();
    break;
  case "run":
    await cmdRun(rest);
    break;
  case "report":
    cmdReport(rest);
    break;
  case "verify":
    await cmdVerify(rest);
    break;
  case "baseline":
    cmdBaseline(rest);
    break;
  case "gate":
    cmdGate(rest);
    break;
  default:
    console.log(
      [
        "arena — head-to-head benchmarks for agentic coding CLIs",
        "",
        "Commands:",
        "  list                         List available tasks",
        "  doctor                       Check installed agent CLIs and versions",
        "  run --agents <a,b> [...]     Run a benchmark (see below)",
        "  report <runDir>              Regenerate report.md for a run",
        "  verify [taskId...]           Audit tasks: pristine must fail, solution must pass",
        "  baseline save <runDir>       Snapshot a run's metrics as the drift baseline",
        "  baseline show                Print the current baseline",
        "  gate <runDir>                Fail (exit 1) if a run regressed vs the baseline",
        "",
        "Run options:",
        "  --agents  Comma list; each entry `adapter` or `adapter=model`",
        `            adapters: ${adapterNames().join(", ")}`,
        "  --model   Model slug applied to agents without an explicit =model",
        "  --tasks   Comma list of task ids, or 'all' (default: all)",
        "  --trials  Trials per (task, agent) pair (default: 3)",
        "  --budget  Per-trial USD cap passed to agents that support one",
        "  --timeout Per-trial seconds (default: 600)",
        "  --seed    RNG seed for deterministic statistics (default: 42)",
        "  --out     Results root (default: ./results)",
        "",
        "Gate options (fail CI when your agent drifts):",
        "  --baseline           Baseline file (default: ./arena-baseline.json)",
        "  --config             Gate thresholds JSON (default: ./arena-gate.json if present)",
        "  --agent              Only gate this adapter",
        "  --accuracy-drop      Max allowed resolve-rate drop, points 0-1 (default: 0)",
        "  --tokens-increase    Max allowed median-token increase % (default: 10)",
        "  --cost-increase      Max allowed median-cost increase % (default: 15)",
        "  --speed-increase     Max allowed median wall-clock increase % (default: off)",
        "  --require-significant  Only fail accuracy when the drop clears 95% CI noise",
        "  --allow-task-mismatch  Permit a run over a different task set",
        "",
        "Examples:",
        "  pnpm arena run --agents oxagen,claude-code --model anthropic/claude-sonnet-5 --trials 3",
        "  pnpm arena baseline save results/run-… --agent oxagen",
        "  pnpm arena gate results/run-… --require-significant   # in CI",
      ].join("\n"),
    );
}

function cmdList(): void {
  for (const task of loadTasks(TASK_ROOT)) {
    console.log(`${task.id}`);
    console.log(`  ${task.name} · ${task.category} · ${task.difficulty}`);
  }
}

function cmdDoctor(): void {
  for (const name of adapterNames()) {
    if (name === "mock") continue;
    const adapter = createAdapter({ adapter: name, model: "" });
    const ok = adapter.isAvailable();
    console.log(
      `${ok ? "✅" : "❌"} ${name.padEnd(12)} bin=${adapter.bin()} ${ok ? `version=${adapter.version()}` : "(not found)"}`,
    );
  }
}

async function cmdRun(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      agents: { type: "string" },
      model: { type: "string" },
      tasks: { type: "string" },
      trials: { type: "string" },
      budget: { type: "string" },
      timeout: { type: "string" },
      seed: { type: "string" },
      out: { type: "string" },
    },
  });

  if (!values.agents) {
    console.error("--agents is required, e.g. --agents oxagen,claude-code");
    process.exit(1);
  }

  const defaultModel = values.model;
  const agents: AgentSpec[] = values.agents.split(",").map((entry) => {
    const [adapter, model] = entry.split("=") as [string, string | undefined];
    const resolved = model ?? defaultModel;
    if (!resolved) {
      console.error(`No model for agent "${adapter}". Pass --model or use ${adapter}=<model>.`);
      process.exit(1);
    }
    return { adapter: adapter.trim(), model: resolved.trim() };
  });

  const allTasks = loadTasks(TASK_ROOT);
  let tasks: LoadedTask[] = allTasks;
  if (values.tasks && values.tasks !== "all") {
    const wanted = new Set(values.tasks.split(",").map((t) => t.trim()));
    tasks = allTasks.filter((t) => wanted.has(t.id));
    const missing = [...wanted].filter((id) => !tasks.some((t) => t.id === id));
    if (missing.length > 0) {
      console.error(`Unknown task ids: ${missing.join(", ")}`);
      process.exit(1);
    }
  }

  const budgetUsd = values.budget !== undefined ? numFlag("budget", values.budget) : undefined;
  const config = {
    agents,
    tasks,
    trials: intFlag("trials", values.trials, 3),
    ...(budgetUsd !== undefined ? { budgetUsd } : {}),
    timeoutSeconds: intFlag("timeout", values.timeout, 600),
    seed: intFlag("seed", values.seed, 42, 0),
    outDir: resolve(values.out ?? "results"),
  };

  const { runDir } = await executeRun(config, (msg) => console.log(msg));
  const report = generateReport(runDir);
  writeFileSync(join(runDir, "report.md"), report);
  console.log(`\nRun complete. Report: ${join(runDir, "report.md")}`);
}

/** Parse an integer CLI flag; reject garbage instead of silently running with NaN. */
function intFlag(name: string, raw: string | undefined, fallback: number, min = 1): number {
  if (raw === undefined) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < min || String(n) !== raw.trim()) {
    console.error(`--${name} must be an integer ≥ ${String(min)}, got "${raw}"`);
    process.exit(1);
  }
  return n;
}

/** Parse a positive numeric CLI flag. */
function numFlag(name: string, raw: string): number {
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n) || n <= 0) {
    console.error(`--${name} must be a positive number, got "${raw}"`);
    process.exit(1);
  }
  return n;
}

function cmdReport(argv: string[]): void {
  const runDir = argv[0];
  if (!runDir) {
    console.error("Usage: arena report <runDir>");
    process.exit(1);
  }
  const report = generateReport(resolve(runDir));
  writeFileSync(join(resolve(runDir), "report.md"), report);
  console.log(report);
}

/**
 * Task audit: for each task, the held-out tests must FAIL against the pristine
 * workspace (no tautological tests) and PASS against the reference solution
 * (the task is actually solvable). CI runs this on every push.
 */
async function cmdVerify(argv: string[]): Promise<void> {
  const all = loadTasks(TASK_ROOT);
  const tasks = argv.length > 0 ? all.filter((t) => argv.includes(t.id)) : all;
  let failures = 0;

  for (const task of tasks) {
    const pristineDir = mkdtempSync(join(tmpdir(), "arena-audit-"));
    const solvedDir = mkdtempSync(join(tmpdir(), "arena-audit-"));
    try {
      await seedWorkspace(task, pristineDir);
      const pristine = await runVerification(task, pristineDir);

      await seedWorkspace(task, solvedDir);
      await applySolution(task, solvedDir);
      const solved = await runVerification(task, solvedDir);

      const ok = !pristine.passed && solved.passed;
      if (!ok) failures++;
      console.log(
        `${ok ? "✅" : "❌"} ${task.id}: pristine ${pristine.passed ? "PASSED (bad — tests don't discriminate)" : "fails (good)"}, solution ${solved.passed ? "passes (good)" : "FAILED (bad — task unsolvable)"}`,
      );
      if (!solved.passed) {
        console.log(solved.output.split("\n").slice(-15).join("\n"));
      }
    } finally {
      rmSync(pristineDir, { recursive: true, force: true });
      rmSync(solvedDir, { recursive: true, force: true });
    }
  }

  if (failures > 0) {
    console.error(`\n${String(failures)} task(s) failed the audit.`);
    process.exit(1);
  }
  console.log(`\nAll ${String(tasks.length)} task(s) discriminate correctly.`);
}

const DEFAULT_BASELINE_PATH = "arena-baseline.json";

function cmdBaseline(argv: string[]): void {
  const [sub, ...subArgs] = argv;
  if (sub === "save") {
    const { values, positionals } = parseArgs({
      args: subArgs,
      allowPositionals: true,
      options: { out: { type: "string" }, agent: { type: "string" } },
    });
    const runDir = positionals[0];
    if (!runDir) {
      console.error(
        "Usage: arena baseline save <runDir> [--out arena-baseline.json] [--agent <adapter>]",
      );
      process.exit(1);
    }
    const { manifest, results } = loadRun(resolve(runDir));
    const baseline = buildBaseline(manifest, results, new Date().toISOString(), values.agent);
    const outPath = resolve(values.out ?? DEFAULT_BASELINE_PATH);
    saveBaseline(outPath, baseline);
    console.log(
      `Baseline saved to ${outPath}\n` +
        `  source run: ${baseline.sourceRunId} · tasks: ${String(baseline.taskIds.length)} · trials: ${String(baseline.trials)}\n` +
        baseline.agents
          .map(
            (a) =>
              `  ${a.key}: ${(a.successRate * 100).toFixed(1)}% resolved` +
              (a.medianTotalTokens !== null
                ? ` · ${Math.round(a.medianTotalTokens).toLocaleString()} tok`
                : "") +
              (a.medianComputedCost !== null ? ` · $${a.medianComputedCost.toFixed(4)}` : ""),
          )
          .join("\n"),
    );
    return;
  }
  if (sub === "show") {
    const { values } = parseArgs({ args: subArgs, options: { file: { type: "string" } } });
    const baseline = loadBaseline(resolve(values.file ?? DEFAULT_BASELINE_PATH));
    console.log(JSON.stringify(baseline, null, 2));
    return;
  }
  console.error("Usage: arena baseline <save|show> …");
  process.exit(1);
}

function cmdGate(argv: string[]): void {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      baseline: { type: "string" },
      config: { type: "string" },
      agent: { type: "string" },
      "accuracy-drop": { type: "string" },
      "tokens-increase": { type: "string" },
      "cost-increase": { type: "string" },
      "speed-increase": { type: "string" },
      "require-significant": { type: "boolean" },
      "allow-task-mismatch": { type: "boolean" },
    },
  });
  const runDir = positionals[0];
  if (!runDir) {
    console.error(
      "Usage: arena gate <runDir> [--baseline arena-baseline.json] [--config arena-gate.json] [flags]",
    );
    process.exit(1);
  }

  const baseline = loadBaseline(resolve(values.baseline ?? DEFAULT_BASELINE_PATH));

  // Config file (or built-in defaults), then CLI flag overrides on top.
  const configPath =
    values.config ?? (existsSync(resolve("arena-gate.json")) ? "arena-gate.json" : undefined);
  const thresholds: GateThresholds = loadGateConfig(configPath ? resolve(configPath) : undefined);
  // A finite number, or null (a non-numeric flag value disables the check).
  const num = (v: string | undefined): number | null => {
    if (v === undefined) return null;
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  };
  if (values["accuracy-drop"] !== undefined)
    thresholds.accuracyMaxDropPoints = num(values["accuracy-drop"]) ?? 0;
  if (values["tokens-increase"] !== undefined)
    thresholds.tokensMaxIncreasePct = num(values["tokens-increase"]);
  if (values["cost-increase"] !== undefined)
    thresholds.costMaxIncreasePct = num(values["cost-increase"]);
  if (values["speed-increase"] !== undefined)
    thresholds.speedMaxIncreasePct = num(values["speed-increase"]);
  if (values["require-significant"]) thresholds.accuracyRequireSignificant = true;
  if (values["allow-task-mismatch"]) thresholds.allowTaskMismatch = true;

  const { manifest, results } = loadRun(resolve(runDir));
  const result = evaluateGate(baseline, manifest, results, thresholds, values.agent);
  console.log(formatGateReport(result, baseline));
  process.exit(result.passed ? 0 : 1);
}
