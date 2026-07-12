/**
 * Regression / drift gate.
 *
 * `arena baseline save` snapshots a run's per-agent headline metrics into a
 * committed `arena-baseline.json`. Later, `arena gate` re-summarizes a fresh
 * run and fails (exit 1) when an agent has drifted past the configured
 * thresholds — a resolve-rate drop, or a token/cost/latency blow-up. This is
 * how you keep your own agent honest over time: CI catches a regression the
 * same day it lands.
 *
 * The gate compares like with like. A run over a different task set than the
 * baseline is a hard error by default — you cannot compare resolve rates on
 * different problems. And with `--require-significant`, an accuracy drop only
 * fails when it clears statistical noise (baseline's lower 95% bound above the
 * new run's upper bound), matching Arena's no-noise-theatre ethos.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { isRecord } from "./parse.js";
import { perAgentSummary, type AgentSummary } from "./summary.js";
import type { RunManifest, TrialResult } from "./types.js";

export const BASELINE_SCHEMA = "arena-baseline/v1";

export interface BaselineAgent {
  key: string;
  adapter: string;
  model: string;
  scoredTrials: number;
  passed: number;
  successRate: number;
  successCI: [number, number];
  medianTotalTokens: number | null;
  medianWallClockSeconds: number | null;
  medianComputedCost: number | null;
}

export interface Baseline {
  schema: typeof BASELINE_SCHEMA;
  createdAt: string;
  sourceRunId: string;
  harnessVersion: string;
  /** Sorted task ids the baseline was measured on. */
  taskIds: string[];
  trials: number;
  agents: BaselineAgent[];
}

export interface GateThresholds {
  /** Fail if success rate dropped by more than this many points (0–1). */
  accuracyMaxDropPoints: number;
  /** Only fail accuracy when the drop is statistically real (CIs disjoint). */
  accuracyRequireSignificant: boolean;
  /** Fail if median tokens rose more than this %, or null to not check. */
  tokensMaxIncreasePct: number | null;
  /** Fail if median computed cost rose more than this %, or null. */
  costMaxIncreasePct: number | null;
  /** Fail if median wall-clock rose more than this %, or null (default: report
   * only — wall clock is environment-dependent and noisy). */
  speedMaxIncreasePct: number | null;
  /** Allow a run whose task set differs from the baseline's. */
  allowTaskMismatch: boolean;
}

export const DEFAULT_THRESHOLDS: GateThresholds = {
  accuracyMaxDropPoints: 0,
  accuracyRequireSignificant: false,
  tokensMaxIncreasePct: 10,
  costMaxIncreasePct: 15,
  speedMaxIncreasePct: null,
  allowTaskMismatch: false,
};

function toBaselineAgent(a: AgentSummary): BaselineAgent {
  return {
    key: a.key,
    adapter: a.adapter,
    model: a.model,
    scoredTrials: a.scoredTrials,
    passed: a.passed,
    successRate: a.successRate,
    successCI: a.successCI,
    medianTotalTokens: a.medianTotalTokens,
    medianWallClockSeconds: a.medianWallClockSeconds,
    medianComputedCost: a.medianComputedCost,
  };
}

/**
 * Build a baseline from a run. `createdAt` is passed in (not read from the
 * clock) so the function stays deterministic and unit-testable.
 */
export function buildBaseline(
  manifest: RunManifest,
  results: TrialResult[],
  createdAt: string,
  filterAdapter?: string,
): Baseline {
  let agents = perAgentSummary(results);
  if (filterAdapter) {
    agents = agents.filter((a) => a.adapter === filterAdapter);
  }
  if (agents.length === 0) {
    throw new Error(
      filterAdapter
        ? `no agent "${filterAdapter}" found in the run`
        : "run has no agents to baseline",
    );
  }
  return {
    schema: BASELINE_SCHEMA,
    createdAt,
    sourceRunId: manifest.runId,
    harnessVersion: manifest.harness.version,
    taskIds: [...manifest.taskIds].sort(),
    trials: manifest.trials,
    agents: agents.map(toBaselineAgent),
  };
}

export function saveBaseline(path: string, baseline: Baseline): void {
  writeFileSync(path, JSON.stringify(baseline, null, 2) + "\n");
}

export function loadBaseline(path: string): Baseline {
  if (!existsSync(path)) {
    throw new Error(`baseline not found at ${path} (run \`arena baseline save\` first)`);
  }
  const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!isRecord(raw) || raw["schema"] !== BASELINE_SCHEMA || !Array.isArray(raw["agents"])) {
    throw new Error(`${path} is not a valid ${BASELINE_SCHEMA} baseline`);
  }
  return raw as unknown as Baseline;
}

/** Merge a partial JSON config file over the defaults. Unknown keys ignored. */
export function loadGateConfig(path?: string): GateThresholds {
  if (!path) return { ...DEFAULT_THRESHOLDS };
  if (!existsSync(path)) {
    throw new Error(`gate config not found at ${path}`);
  }
  const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!isRecord(raw)) throw new Error(`${path} is not a JSON object`);
  const cfg: GateThresholds = { ...DEFAULT_THRESHOLDS };
  const numOrNull = (v: unknown, fallback: number | null): number | null => {
    if (v === null) return null;
    return typeof v === "number" && Number.isFinite(v) ? v : fallback;
  };
  if ("accuracyMaxDropPoints" in raw)
    cfg.accuracyMaxDropPoints = numOrNull(raw["accuracyMaxDropPoints"], cfg.accuracyMaxDropPoints) ?? 0;
  if ("accuracyRequireSignificant" in raw)
    cfg.accuracyRequireSignificant = raw["accuracyRequireSignificant"] === true;
  if ("tokensMaxIncreasePct" in raw)
    cfg.tokensMaxIncreasePct = numOrNull(raw["tokensMaxIncreasePct"], cfg.tokensMaxIncreasePct);
  if ("costMaxIncreasePct" in raw)
    cfg.costMaxIncreasePct = numOrNull(raw["costMaxIncreasePct"], cfg.costMaxIncreasePct);
  if ("speedMaxIncreasePct" in raw)
    cfg.speedMaxIncreasePct = numOrNull(raw["speedMaxIncreasePct"], cfg.speedMaxIncreasePct);
  if ("allowTaskMismatch" in raw)
    cfg.allowTaskMismatch = raw["allowTaskMismatch"] === true;
  return cfg;
}

export type CheckStatus = "pass" | "fail" | "warn" | "skip";

export interface GateCheck {
  metric: "accuracy" | "tokens" | "cost" | "speed";
  status: CheckStatus;
  baseline: number | null;
  current: number | null;
  detail: string;
}

export interface GateAgentResult {
  key: string;
  regressed: boolean;
  checks: GateCheck[];
}

export interface GateResult {
  passed: boolean;
  /** Non-null when the run's task set differs from the baseline's. */
  taskMismatch: { baselineOnly: string[]; runOnly: string[] } | null;
  agents: GateAgentResult[];
  /** Baseline agents with no counterpart in the run (can't be checked). */
  unmatchedBaseline: string[];
  /** Fatal reasons unrelated to a specific metric (empty when clean). */
  blockers: string[];
}

function pctIncrease(base: number, current: number): number {
  return ((current - base) / base) * 100;
}

function checkIncrease(
  metric: GateCheck["metric"],
  base: number | null,
  current: number | null,
  maxPct: number | null,
  unit: string,
): GateCheck {
  if (base === null || current === null || base === 0) {
    return { metric, status: "skip", baseline: base, current, detail: "no comparable data" };
  }
  const delta = pctIncrease(base, current);
  const sign = delta >= 0 ? "+" : "";
  const summary = `${base.toFixed(2)}${unit} → ${current.toFixed(2)}${unit} (${sign}${delta.toFixed(1)}%)`;
  if (maxPct === null) {
    return { metric, status: "warn", baseline: base, current, detail: `${summary} — not enforced` };
  }
  if (delta > maxPct) {
    return { metric, status: "fail", baseline: base, current, detail: `${summary} exceeds +${String(maxPct)}%` };
  }
  return { metric, status: "pass", baseline: base, current, detail: `${summary} within +${String(maxPct)}%` };
}

function checkAccuracy(
  base: BaselineAgent,
  current: AgentSummary,
  thresholds: GateThresholds,
): GateCheck {
  const drop = base.successRate - current.successRate;
  const pts = (x: number): string => `${(x * 100).toFixed(1)}%`;
  const summary = `${pts(base.successRate)} → ${pts(current.successRate)}`;
  if (drop <= thresholds.accuracyMaxDropPoints) {
    const gained = current.successRate - base.successRate;
    const detail = gained > 0 ? `${summary} (improved +${pts(gained)})` : `${summary} (within tolerance)`;
    return { metric: "accuracy", status: "pass", baseline: base.successRate, current: current.successRate, detail };
  }
  // Regressed beyond tolerance. Optionally demand statistical significance:
  // baseline's lower 95% bound must sit above the new run's upper bound.
  if (thresholds.accuracyRequireSignificant) {
    const significant = base.successCI[0] > current.successCI[1];
    if (!significant) {
      return {
        metric: "accuracy",
        status: "warn",
        baseline: base.successRate,
        current: current.successRate,
        detail: `${summary} down ${pts(drop)} but within 95% CI noise — collect more trials`,
      };
    }
  }
  return {
    metric: "accuracy",
    status: "fail",
    baseline: base.successRate,
    current: current.successRate,
    detail: `${summary} — resolve rate dropped ${pts(drop)}`,
  };
}

/** Compare a fresh run against the baseline and decide pass/fail. */
export function evaluateGate(
  baseline: Baseline,
  manifest: RunManifest,
  results: TrialResult[],
  thresholds: GateThresholds,
  filterAdapter?: string,
): GateResult {
  const blockers: string[] = [];

  // Task-set parity: comparing resolve rates on different tasks is meaningless.
  const runTasks = [...manifest.taskIds].sort();
  const baselineOnly = baseline.taskIds.filter((t) => !runTasks.includes(t));
  const runOnly = runTasks.filter((t) => !baseline.taskIds.includes(t));
  const taskMismatch =
    baselineOnly.length > 0 || runOnly.length > 0 ? { baselineOnly, runOnly } : null;
  if (taskMismatch && !thresholds.allowTaskMismatch) {
    blockers.push(
      "run task set differs from the baseline; resolve-rate comparison is invalid " +
        "(pass --allow-task-mismatch to override)",
    );
  }

  const current = perAgentSummary(results);
  const currentByKey = new Map(current.map((a) => [a.key, a]));

  let baselineAgents = baseline.agents;
  if (filterAdapter) {
    baselineAgents = baselineAgents.filter((a) => a.adapter === filterAdapter);
    if (baselineAgents.length === 0) {
      blockers.push(`baseline has no agent "${filterAdapter}"`);
    }
  }

  const agents: GateAgentResult[] = [];
  const unmatchedBaseline: string[] = [];

  for (const base of baselineAgents) {
    const cur = currentByKey.get(base.key);
    if (!cur) {
      unmatchedBaseline.push(base.key);
      continue;
    }
    const checks: GateCheck[] = [
      checkAccuracy(base, cur, thresholds),
      checkIncrease("tokens", base.medianTotalTokens, cur.medianTotalTokens, thresholds.tokensMaxIncreasePct, ""),
      checkIncrease("cost", base.medianComputedCost, cur.medianComputedCost, thresholds.costMaxIncreasePct, ""),
      checkIncrease("speed", base.medianWallClockSeconds, cur.medianWallClockSeconds, thresholds.speedMaxIncreasePct, "s"),
    ];
    agents.push({ key: base.key, regressed: checks.some((c) => c.status === "fail"), checks });
  }

  if (agents.length === 0 && blockers.length === 0) {
    blockers.push("no baseline agent had a counterpart in the run — nothing to gate");
  }

  const passed = blockers.length === 0 && agents.every((a) => !a.regressed);
  return { passed, taskMismatch, agents, unmatchedBaseline, blockers };
}

const ICON: Record<CheckStatus, string> = { pass: "✅", fail: "❌", warn: "⚠️", skip: "·" };

/** Render a gate result as a human-readable console report. */
export function formatGateReport(result: GateResult, baseline: Baseline): string {
  const lines: string[] = [];
  lines.push(
    `Regression gate vs baseline \`${baseline.sourceRunId}\` (${baseline.createdAt}, harness ${baseline.harnessVersion})`,
    "",
  );

  for (const blocker of result.blockers) lines.push(`❌ ${blocker}`);
  if (result.blockers.length) lines.push("");

  if (result.taskMismatch) {
    const { baselineOnly, runOnly } = result.taskMismatch;
    lines.push("⚠️  Task set differs from baseline:");
    if (baselineOnly.length) lines.push(`    only in baseline: ${baselineOnly.join(", ")}`);
    if (runOnly.length) lines.push(`    only in this run: ${runOnly.join(", ")}`);
    lines.push("");
  }

  for (const agent of result.agents) {
    lines.push(`${agent.regressed ? "❌" : "✅"} ${agent.key}`);
    for (const c of agent.checks) {
      lines.push(`    ${ICON[c.status]} ${c.metric.padEnd(9)} ${c.detail}`);
    }
    lines.push("");
  }

  for (const key of result.unmatchedBaseline) {
    lines.push(`⚠️  ${key}: in baseline but not in this run — not checked`);
  }
  if (result.unmatchedBaseline.length) lines.push("");

  lines.push(result.passed ? "PASS — no regression beyond thresholds." : "FAIL — regression detected.");
  return lines.join("\n");
}
