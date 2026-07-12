/**
 * Per-agent aggregation — the single source of truth for a run's headline
 * numbers, shared by the report, the baseline snapshot, and the regression
 * gate so all three agree exactly.
 *
 * `agent-error` trials (the CLI could not be invoked) are excluded from every
 * figure, matching the report: a harness-side failure is never scored as the
 * agent losing.
 */

import { median, wilsonInterval } from "./stats.js";
import type { TrialResult } from "./types.js";

export interface AgentSummary {
  /** Stable identity: `"adapter (model)"`. */
  key: string;
  adapter: string;
  model: string;
  /** Trials excluding `agent-error`. */
  scoredTrials: number;
  errorTrials: number;
  passed: number;
  /** passed / scoredTrials (0 when nothing scored). */
  successRate: number;
  /** 95% Wilson interval on the success rate. */
  successCI: [number, number];
  medianWallClockSeconds: number | null;
  medianTotalTokens: number | null;
  medianComputedCost: number | null;
  medianAgentReportedCost: number | null;
}

export function agentKey(r: TrialResult): string {
  return `${r.agent.adapter} (${r.agent.model})`;
}

function medianOrNull(values: number[]): number | null {
  if (values.length === 0) return null;
  const m = median(values);
  return Number.isNaN(m) ? null : m;
}

/** Aggregate raw trials into one summary row per agent, in first-seen order. */
export function perAgentSummary(results: TrialResult[]): AgentSummary[] {
  const order: string[] = [];
  const byKey = new Map<string, TrialResult[]>();
  for (const r of results) {
    const key = agentKey(r);
    if (!byKey.has(key)) {
      byKey.set(key, []);
      order.push(key);
    }
    (byKey.get(key) as TrialResult[]).push(r);
  }

  return order.map((key) => {
    const all = byKey.get(key) as TrialResult[];
    const scored = all.filter((r) => r.outcome !== "agent-error");
    const passed = scored.filter((r) => r.outcome === "passed").length;
    const first = all[0] as TrialResult;
    const costs = scored
      .map((r) => r.cost.computedUsd)
      .filter((c): c is number => c !== null);
    const selfCosts = scored
      .map((r) => r.cost.agentReportedUsd)
      .filter((c): c is number => c !== null);
    return {
      key,
      adapter: first.agent.adapter,
      model: first.agent.model,
      scoredTrials: scored.length,
      errorTrials: all.length - scored.length,
      passed,
      successRate: scored.length ? passed / scored.length : 0,
      successCI: wilsonInterval(passed, scored.length),
      medianWallClockSeconds: medianOrNull(
        scored.map((r) => r.timing.wallClockSeconds),
      ),
      medianTotalTokens: medianOrNull(scored.map((r) => r.tokens.total)),
      medianComputedCost: medianOrNull(costs),
      medianAgentReportedCost: medianOrNull(selfCosts),
    };
  });
}
