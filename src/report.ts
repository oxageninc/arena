/**
 * Markdown report generation from a run directory.
 *
 * Reporting rules:
 *  - "agent-error" trials (the harness failed to invoke the CLI) are excluded
 *    from every headline number and listed separately — an adapter bug must
 *    never be presented as an agent losing.
 *  - Success rates carry 95% Wilson intervals; head-to-head success uses the
 *    exact McNemar test on paired (task, trial) outcomes; latency/token/cost
 *    deltas use a seeded paired bootstrap. Each metric is reported separately —
 *    no blended score.
 *  - The report embeds the reproduce command and per-trial receipt paths.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isRecord } from "./parse.js";
import { mcnemarExact, median, pairedBootstrapDelta } from "./stats.js";
import { agentKey, perAgentSummary } from "./summary.js";
import type { RunManifest, TrialResult } from "./types.js";

export function loadRun(runDir: string): {
  manifest: RunManifest;
  results: TrialResult[];
} {
  const raw: unknown = JSON.parse(readFileSync(join(runDir, "results.json"), "utf8"));
  if (!isRecord(raw) || !isRecord(raw["manifest"]) || !Array.isArray(raw["results"])) {
    throw new Error(`Malformed results.json in ${runDir}`);
  }
  return {
    manifest: raw["manifest"] as unknown as RunManifest,
    results: raw["results"] as unknown as TrialResult[],
  };
}

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

function fmtUsd(x: number | null): string {
  return x === null ? "—" : `$${x.toFixed(4)}`;
}

function fmtDelta(x: number): string {
  const sign = x > 0 ? "+" : "";
  return `${sign}${(x * 100).toFixed(1)}%`;
}

export function generateReport(runDir: string): string {
  const { manifest, results } = loadRun(runDir);

  // Aggregation lives in perAgentSummary so the report, the baseline snapshot,
  // and the regression gate always agree exactly.
  const summaries = perAgentSummary(results);
  const keys = summaries.map((s) => s.key);
  const byAgent = new Map<string, TrialResult[]>(
    keys.map((k) => [k, results.filter((r) => agentKey(r) === k)]),
  );

  const lines: string[] = [];
  lines.push(`# Arena run report — \`${manifest.runId}\``, "");
  lines.push(
    `- Harness: ${manifest.harness.name} v${manifest.harness.version} (git ${manifest.harness.gitSha})`,
  );
  lines.push(`- Host: ${manifest.host.platform}/${manifest.host.arch}, node ${manifest.host.node}`);
  lines.push(`- Created: ${manifest.createdAt}`);
  lines.push(
    `- Trials per (task, agent): ${String(manifest.trials)} · timeout ${String(manifest.timeoutSeconds)}s · budget ${manifest.budgetUsd === null ? "none" : `$${String(manifest.budgetUsd)}`} · seed ${String(manifest.seed)}`,
  );
  lines.push(`- Tasks (${String(manifest.taskIds.length)}): ${manifest.taskIds.join(", ")}`);
  lines.push("");
  lines.push("Agents:");
  for (const a of manifest.agents) {
    lines.push(
      `- **${a.adapter}** · model \`${a.model}\` (resolved \`${a.resolvedModel}\`) · version \`${a.version}\``,
    );
  }
  lines.push("");

  if (!manifest.matchedModels) {
    lines.push(
      "> ⚠️ **Unmatched models.** Agents in this run used different models, so",
      "> differences conflate harness and model quality. For harness-vs-harness",
      "> claims, rerun with the same model on every agent.",
      "",
    );
  }

  const errorTrials = results.filter((r) => r.outcome === "agent-error");
  if (errorTrials.length > 0) {
    lines.push(
      `> ⚠️ **${String(errorTrials.length)} trial(s) excluded as \`agent-error\`** — the CLI could not be`,
      "> invoked (bad flags / missing binary). These are harness-side failures and",
      "> are excluded from all comparisons below. See “Excluded trials”.",
      "",
    );
  }

  // ── Per-agent summary ──
  lines.push("## Results by agent", "");
  lines.push(
    "| Agent | Scored trials | Passed | Success rate (95% CI) | Median wall clock | Median tokens (billed) | Median computed cost | Self-reported cost |",
    "|---|---|---|---|---|---|---|---|",
  );
  for (const s of summaries) {
    const [lo, hi] = s.successCI;
    const wall =
      s.medianWallClockSeconds === null ? "—" : `${s.medianWallClockSeconds.toFixed(1)}s`;
    const toks =
      s.medianTotalTokens === null ? "—" : Math.round(s.medianTotalTokens).toLocaleString();
    lines.push(
      `| ${s.key} | ${String(s.scoredTrials)} | ${String(s.passed)} | ${pct(s.successRate)} (${pct(lo)}–${pct(hi)}) | ${wall} | ${toks} | ${fmtUsd(s.medianComputedCost)} | ${fmtUsd(s.medianAgentReportedCost)} |`,
    );
  }
  lines.push("");
  lines.push(
    "Token counts are normalized (input excludes cache reads; cache reads and writes tracked separately). Computed cost applies one shared pricing table to every agent; “—” means the model has no pricing entry (cost is never guessed).",
    "",
  );

  // ── Pairwise comparisons ──
  if (keys.length >= 2) {
    lines.push("## Head-to-head (paired)", "");
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) {
        const a = keys[i] as string;
        const b = keys[j] as string;
        lines.push(...pairwiseSection(a, b, byAgent, manifest));
      }
    }
  }

  // ── Per-task matrix ──
  lines.push("## Per-task outcomes", "");
  lines.push(`| Task | ${keys.join(" | ")} |`);
  lines.push(`|---|${keys.map(() => "---").join("|")}|`);
  for (const taskId of manifest.taskIds) {
    const cells = keys.map((key) => {
      const trials = (byAgent.get(key) ?? []).filter((r) => r.taskId === taskId);
      if (trials.length === 0) return "—";
      return trials
        .map((r) =>
          r.outcome === "passed"
            ? "✅"
            : r.outcome === "agent-error"
              ? "⚠️"
              : r.outcome === "timeout"
                ? "⏱"
                : "❌",
        )
        .join("");
    });
    lines.push(`| ${taskId} | ${cells.join(" | ")} |`);
  }
  lines.push(
    "",
    "One symbol per trial: ✅ passed · ❌ failed · ⏱ timeout · ⚠️ agent-error (excluded).",
    "",
  );

  // ── Excluded trials ──
  if (errorTrials.length > 0) {
    lines.push("## Excluded trials (agent-error)", "");
    for (const r of errorTrials) {
      lines.push(`- \`${r.id}\`: ${r.error ?? "unknown"} (transcript: \`${r.transcriptPath}\`)`);
    }
    lines.push("");
  }

  // ── Receipts ──
  lines.push("## Receipts", "");
  lines.push("```");
  lines.push(manifest.reproduceCommand);
  lines.push("```");
  lines.push(
    "",
    "Every trial's full stdout/stderr transcript and workspace diff are stored under `transcripts/` and `diffs/` in this run directory. Statistics are deterministic given the raw trials (seeded bootstrap).",
    "",
  );

  return lines.join("\n");
}

function pairwiseSection(
  aKey: string,
  bKey: string,
  byAgent: Map<string, TrialResult[]>,
  manifest: RunManifest,
): string[] {
  const lines: string[] = [`### ${aKey} vs ${bKey}`, ""];

  const aTrials = (byAgent.get(aKey) ?? []).filter((r) => r.outcome !== "agent-error");
  const bTrials = (byAgent.get(bKey) ?? []).filter((r) => r.outcome !== "agent-error");
  const index = (rs: TrialResult[]): Map<string, TrialResult> =>
    new Map(rs.map((r) => [`${r.taskId}#${String(r.trial)}`, r]));
  const ai = index(aTrials);
  const bi = index(bTrials);
  const pairKeys = [...ai.keys()].filter((k) => bi.has(k)).sort();

  if (pairKeys.length === 0) {
    lines.push("No shared (task, trial) pairs with both agents scored — nothing to compare.", "");
    return lines;
  }

  let aOnly = 0;
  let bOnly = 0;
  let both = 0;
  let neither = 0;
  for (const k of pairKeys) {
    const ap = (ai.get(k) as TrialResult).outcome === "passed";
    const bp = (bi.get(k) as TrialResult).outcome === "passed";
    if (ap && bp) both++;
    else if (ap) aOnly++;
    else if (bp) bOnly++;
    else neither++;
  }
  const p = mcnemarExact(aOnly, bOnly);
  lines.push(
    `Paired (task, trial) outcomes over ${String(pairKeys.length)} pairs: both passed ${String(both)}, only ${aKey} ${String(aOnly)}, only ${bKey} ${String(bOnly)}, neither ${String(neither)}.`,
  );
  lines.push(
    p === null
      ? "McNemar test: not applicable (no discordant pairs)."
      : `Exact McNemar (two-sided): p = ${p.toFixed(4)}${p < 0.05 ? " — statistically significant at α=0.05" : " — not significant at α=0.05; collect more trials before claiming a success-rate difference"}.`,
    "",
  );

  const metrics: { label: string; get: (r: TrialResult) => number | null }[] = [
    { label: "Wall clock (s)", get: (r) => r.timing.wallClockSeconds },
    { label: "Total tokens", get: (r) => r.tokens.total },
    { label: "Output tokens", get: (r) => r.tokens.output },
    { label: "Computed cost (USD)", get: (r) => r.cost.computedUsd },
  ];
  lines.push(`| Metric | ${aKey} (median) | ${bKey} (median) | Δ relative to ${aKey} (95% CI) |`);
  lines.push("|---|---|---|---|");
  for (const metric of metrics) {
    const av: number[] = [];
    const bv: number[] = [];
    for (const k of pairKeys) {
      const x = metric.get(ai.get(k) as TrialResult);
      const y = metric.get(bi.get(k) as TrialResult);
      if (x === null || y === null) continue;
      av.push(x);
      bv.push(y);
    }
    if (av.length === 0) {
      lines.push(`| ${metric.label} | — | — | — |`);
      continue;
    }
    const delta = pairedBootstrapDelta(av, bv, manifest.seed);
    lines.push(
      `| ${metric.label} | ${median(av).toFixed(2)} | ${median(bv).toFixed(2)} | ${delta ? `${fmtDelta(delta.relativeDelta)} (${fmtDelta(delta.ci[0])} to ${fmtDelta(delta.ci[1])})` : "n too small"} |`,
    );
  }
  lines.push(
    "",
    `Negative Δ means ${bKey} used less (faster / fewer tokens / cheaper). CIs from a seeded paired bootstrap over (task, trial) pairs.`,
    "",
  );
  return lines;
}
