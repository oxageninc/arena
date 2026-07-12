import { describe, expect, it } from "vitest";

import {
  buildBaseline,
  DEFAULT_THRESHOLDS,
  evaluateGate,
  loadGateConfig,
  type Baseline,
} from "../src/baseline.js";
import { perAgentSummary } from "../src/summary.js";
import type { Outcome, RunManifest, TrialResult } from "../src/types.js";

// ── factories ────────────────────────────────────────────────────────────────

function trial(
  taskId: string,
  trialN: number,
  adapter: string,
  model: string,
  outcome: Outcome,
  over: { tokens?: number; wall?: number; cost?: number | null } = {},
): TrialResult {
  const tokens = over.tokens ?? 1000;
  return {
    id: `${taskId}-${adapter}-${model}-t${trialN}`,
    taskId,
    trial: trialN,
    agent: { adapter, model, resolvedModel: model, version: "1", bin: adapter },
    outcome,
    verify: { passed: outcome === "passed", output: "" },
    timing: { wallClockSeconds: over.wall ?? 10, agentReportedSeconds: null },
    tokens: { input: tokens, output: 0, cacheRead: 0, cacheWrite: 0, total: tokens },
    cost: {
      computedUsd: over.cost === undefined ? 0.05 : over.cost,
      agentReportedUsd: null,
      pricingModel: model,
    },
    activity: {
      toolCalls: null,
      iterations: null,
      filesTouched: 1,
      linesAdded: 1,
      linesRemoved: 0,
      diffBytes: 10,
    },
    provenance: { runId: "run-x", startedAt: "", finishedAt: "" },
    transcriptPath: "t",
    diffPath: "d",
  };
}

/** N trials of one agent over `tasks`, the first `passCount` (per task) passing. */
function agentRun(
  adapter: string,
  model: string,
  tasks: string[],
  passPerTask: number,
  trialsPerTask: number,
  over: { tokens?: number; wall?: number; cost?: number | null } = {},
): TrialResult[] {
  const out: TrialResult[] = [];
  for (const task of tasks) {
    for (let t = 1; t <= trialsPerTask; t++) {
      out.push(trial(task, t, adapter, model, t <= passPerTask ? "passed" : "failed", over));
    }
  }
  return out;
}

function manifest(taskIds: string[], trials: number): RunManifest {
  return {
    runId: "run-test",
    createdAt: "2026-07-12T00:00:00.000Z",
    harness: { name: "arena", version: "0.1.0", gitSha: "abc" },
    host: { platform: "linux", arch: "x64", node: "v24" },
    seed: 42,
    trials,
    budgetUsd: null,
    timeoutSeconds: 600,
    agents: [],
    taskIds,
    matchedModels: true,
    reproduceCommand: "arena run …",
  };
}

const CREATED = "2026-07-12T00:00:00.000Z";

// ── perAgentSummary ──────────────────────────────────────────────────────────

describe("perAgentSummary", () => {
  it("excludes agent-error trials from all figures", () => {
    const results = [
      trial("t1", 1, "mine", "m", "passed"),
      trial("t1", 2, "mine", "m", "agent-error"),
      trial("t2", 1, "mine", "m", "failed"),
    ];
    const row = perAgentSummary(results)[0]!;
    expect(row.scoredTrials).toBe(2);
    expect(row.errorTrials).toBe(1);
    expect(row.passed).toBe(1);
    expect(row.successRate).toBe(0.5);
  });

  it("returns null medians when there is no data", () => {
    const row = perAgentSummary([trial("t", 1, "mine", "m", "agent-error")])[0]!;
    expect(row.medianTotalTokens).toBeNull();
    expect(row.medianComputedCost).toBeNull();
  });
});

// ── baseline build / config ──────────────────────────────────────────────────

describe("buildBaseline", () => {
  it("snapshots per-agent metrics and sorts task ids", () => {
    const results = agentRun("mine", "m", ["t2", "t1"], 2, 2);
    const base = buildBaseline(manifest(["t2", "t1"], 2), results, CREATED);
    expect(base.taskIds).toEqual(["t1", "t2"]);
    expect(base.agents).toHaveLength(1);
    expect(base.agents[0]!.successRate).toBe(1);
  });

  it("can filter to a single adapter", () => {
    const results = [
      ...agentRun("mine", "m", ["t1"], 1, 1),
      ...agentRun("claude-code", "c", ["t1"], 1, 1),
    ];
    const base = buildBaseline(manifest(["t1"], 1), results, CREATED, "mine");
    expect(base.agents.map((a) => a.adapter)).toEqual(["mine"]);
  });

  it("throws when the filtered adapter is absent", () => {
    const results = agentRun("mine", "m", ["t1"], 1, 1);
    expect(() => buildBaseline(manifest(["t1"], 1), results, CREATED, "ghost")).toThrow(/ghost/);
  });
});

describe("loadGateConfig", () => {
  it("returns defaults when no path given", () => {
    expect(loadGateConfig()).toEqual(DEFAULT_THRESHOLDS);
  });
});

// ── the gate ─────────────────────────────────────────────────────────────────

function baselineFrom(results: TrialResult[], tasks: string[], trials: number): Baseline {
  return buildBaseline(manifest(tasks, trials), results, CREATED);
}

describe("evaluateGate", () => {
  const tasks = ["t1", "t2"];

  it("passes when the run matches the baseline", () => {
    const base = baselineFrom(agentRun("mine", "m", tasks, 2, 2), tasks, 2);
    const run = agentRun("mine", "m", tasks, 2, 2);
    const res = evaluateGate(base, manifest(tasks, 2), run, DEFAULT_THRESHOLDS);
    expect(res.passed).toBe(true);
    expect(res.agents[0]!.regressed).toBe(false);
  });

  it("fails on a resolve-rate regression", () => {
    const base = baselineFrom(agentRun("mine", "m", tasks, 10, 10), tasks, 10);
    const run = agentRun("mine", "m", tasks, 0, 10); // 100% → 0%
    const res = evaluateGate(base, manifest(tasks, 10), run, DEFAULT_THRESHOLDS);
    expect(res.passed).toBe(false);
    const acc = res.agents[0]!.checks.find((c) => c.metric === "accuracy");
    expect(acc?.status).toBe("fail");
  });

  it("require-significant downgrades a noisy small-n drop to a warning", () => {
    // 2/2 → 1/2: a drop, but the 95% CIs overlap heavily.
    const base = baselineFrom(agentRun("mine", "m", ["t1"], 2, 2), ["t1"], 2);
    const run = agentRun("mine", "m", ["t1"], 1, 2);
    const strict = evaluateGate(base, manifest(["t1"], 2), run, DEFAULT_THRESHOLDS);
    expect(strict.passed).toBe(false); // point-estimate drop fails by default

    const lenient = evaluateGate(base, manifest(["t1"], 2), run, {
      ...DEFAULT_THRESHOLDS,
      accuracyRequireSignificant: true,
    });
    expect(lenient.passed).toBe(true);
    expect(lenient.agents[0]!.checks.find((c) => c.metric === "accuracy")?.status).toBe("warn");
  });

  it("fails on a token blow-up beyond the threshold", () => {
    const base = baselineFrom(agentRun("mine", "m", tasks, 2, 2, { tokens: 1000 }), tasks, 2);
    const run = agentRun("mine", "m", tasks, 2, 2, { tokens: 2000 }); // +100%
    const res = evaluateGate(base, manifest(tasks, 2), run, DEFAULT_THRESHOLDS);
    expect(res.passed).toBe(false);
    expect(res.agents[0]!.checks.find((c) => c.metric === "tokens")?.status).toBe("fail");
  });

  it("does not fail on a token increase within tolerance", () => {
    const base = baselineFrom(agentRun("mine", "m", tasks, 2, 2, { tokens: 1000 }), tasks, 2);
    const run = agentRun("mine", "m", tasks, 2, 2, { tokens: 1050 }); // +5% < 10%
    const res = evaluateGate(base, manifest(tasks, 2), run, DEFAULT_THRESHOLDS);
    expect(res.passed).toBe(true);
  });

  it("blocks on a task-set mismatch unless allowed", () => {
    const base = baselineFrom(agentRun("mine", "m", ["t1", "t2"], 1, 1), ["t1", "t2"], 1);
    const run = agentRun("mine", "m", ["t1", "t3"], 1, 1);
    const strict = evaluateGate(base, manifest(["t1", "t3"], 1), run, DEFAULT_THRESHOLDS);
    expect(strict.passed).toBe(false);
    expect(strict.taskMismatch).not.toBeNull();
    expect(strict.blockers.length).toBeGreaterThan(0);

    const allowed = evaluateGate(base, manifest(["t1", "t3"], 1), run, {
      ...DEFAULT_THRESHOLDS,
      allowTaskMismatch: true,
    });
    // task mismatch reported but not a blocker; accuracy on shared agent is fine
    expect(allowed.blockers).toHaveLength(0);
  });

  it("blocks when no baseline agent appears in the run", () => {
    const base = baselineFrom(agentRun("mine", "m", tasks, 2, 2), tasks, 2);
    const run = agentRun("other", "x", tasks, 2, 2);
    const res = evaluateGate(base, manifest(tasks, 2), run, DEFAULT_THRESHOLDS);
    expect(res.passed).toBe(false);
    expect(res.unmatchedBaseline).toContain("mine (m)");
    expect(res.blockers.length).toBeGreaterThan(0);
  });

  it("gates only the requested adapter", () => {
    const baseResults = [
      ...agentRun("mine", "m", tasks, 2, 2),
      ...agentRun("claude-code", "c", tasks, 2, 2),
    ];
    const base = baselineFrom(baseResults, tasks, 2);
    // claude-code regresses, mine holds steady; gating "mine" should pass.
    const run = [
      ...agentRun("mine", "m", tasks, 2, 2),
      ...agentRun("claude-code", "c", tasks, 0, 2),
    ];
    const res = evaluateGate(base, manifest(tasks, 2), run, DEFAULT_THRESHOLDS, "mine");
    expect(res.passed).toBe(true);
    expect(res.agents.map((a) => a.key)).toEqual(["mine (m)"]);
  });
});
