/**
 * Run orchestration.
 *
 * Fairness rules enforced here rather than left to operator discipline:
 *  - Every agent gets the identical prompt, budget, and timeout.
 *  - Agents are interleaved and their order flips on alternate trials, so
 *    time-of-day drift (provider load, rate limits) cannot systematically
 *    favor whichever agent ran first.
 *  - Tasks run sequentially — no resource contention between agents on the
 *    same host skewing wall-clock numbers.
 *  - A run whose agent process could not even be invoked correctly is scored
 *    "agent-error", not "failed": adapter bugs must never read as one agent
 *    beating another.
 */

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { arch, platform, tmpdir } from "node:os";
import { join } from "node:path";

import { type Adapter, createAdapter } from "./adapters/index.js";
import { diffStats, sanitizeSegment } from "./parse.js";
import { computeCost, loadPricing } from "./pricing.js";
import type {
  AgentSpec,
  LoadedTask,
  Outcome,
  PricingTable,
  RunConfig,
  RunManifest,
  TrialResult,
} from "./types.js";
import { buildPrompt, collectDiff, runVerification, seedWorkspace } from "./workspace.js";

export const HARNESS_VERSION = "0.1.0";

export type RunProgress = (message: string) => void;

export async function executeRun(
  config: RunConfig,
  log: RunProgress = () => {},
): Promise<{ runDir: string; manifest: RunManifest; results: TrialResult[] }> {
  const pricing = loadPricing();
  const runId = `run-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}-${randomUUID().slice(0, 8)}`;
  const runDir = join(config.outDir, runId);
  mkdirSync(join(runDir, "trials"), { recursive: true });
  mkdirSync(join(runDir, "transcripts"), { recursive: true });
  mkdirSync(join(runDir, "diffs"), { recursive: true });

  const adapters = config.agents.map((spec) => ({
    spec,
    adapter: createAdapter(spec),
  }));

  for (const { spec, adapter } of adapters) {
    if (!adapter.isAvailable()) {
      throw new Error(
        `Agent "${spec.adapter}" is not available (binary: ${adapter.bin()}). ` +
          `Install it or point ARENA_${spec.adapter.replace(/-/g, "_").toUpperCase()}_BIN at it.`,
      );
    }
  }

  const manifest: RunManifest = {
    runId,
    createdAt: new Date().toISOString(),
    harness: {
      name: "arena",
      version: HARNESS_VERSION,
      gitSha: gitSha(),
    },
    host: { platform: platform(), arch: arch(), node: process.version },
    seed: config.seed,
    trials: config.trials,
    budgetUsd: config.budgetUsd ?? null,
    timeoutSeconds: config.timeoutSeconds,
    agents: adapters.map(({ spec, adapter }) => ({
      adapter: spec.adapter,
      model: spec.model,
      resolvedModel: adapter.resolveModel(spec.model),
      version: adapter.version(),
      bin: adapter.bin(),
    })),
    taskIds: config.tasks.map((t) => t.id),
    matchedModels: new Set(config.agents.map((a) => a.model)).size <= 1,
    reproduceCommand: buildReproduceCommand(config),
  };
  writeFileSync(join(runDir, "manifest.json"), JSON.stringify(manifest, null, 2));

  const results: TrialResult[] = [];

  for (let trial = 1; trial <= config.trials; trial++) {
    // Flip agent order on alternate trials (ABBA) to null out drift.
    const ordered = trial % 2 === 1 ? adapters : [...adapters].reverse();
    for (const task of config.tasks) {
      for (const { spec, adapter } of ordered) {
        log(`▶ trial ${trial}/${config.trials} · ${task.id} · ${spec.adapter} (${spec.model})`);
        const result = await runOne(task, spec, adapter, trial, config, runId, runDir, pricing);
        results.push(result);
        writeFileSync(join(runDir, "trials", `${result.id}.json`), JSON.stringify(result, null, 2));
        const mark =
          result.outcome === "passed" ? "✅" : result.outcome === "agent-error" ? "⚠️" : "❌";
        log(
          `  ${mark} ${result.outcome} · ${result.timing.wallClockSeconds.toFixed(1)}s · ` +
            `${result.tokens.total.toLocaleString()} tokens`,
        );
      }
    }
  }

  writeFileSync(join(runDir, "results.json"), JSON.stringify({ manifest, results }, null, 2));

  return { runDir, manifest, results };
}

async function runOne(
  task: LoadedTask,
  spec: AgentSpec,
  adapter: Adapter,
  trial: number,
  config: RunConfig,
  runId: string,
  runDir: string,
  pricing: PricingTable,
): Promise<TrialResult> {
  const workDir = join(tmpdir(), `arena-${sanitizeSegment(task.id)}-${randomUUID()}`);
  const startedAt = new Date();
  const id = `${task.id}-${spec.adapter}-${sanitizeSegment(spec.model)}-t${trial}`;

  try {
    await seedWorkspace(task, workDir);

    const exec = await adapter.execute({
      prompt: buildPrompt(task),
      model: spec.model,
      budgetUsd: config.budgetUsd,
      timeoutSeconds: config.timeoutSeconds,
      workDir,
      taskDir: task.dir,
    });

    const finishedAt = new Date();
    const wallClockSeconds = (finishedAt.getTime() - startedAt.getTime()) / 1000;

    const diff = await collectDiff(workDir);
    const envelope = adapter.parseEnvelope(exec.stdout);

    // Invocation-level failure: the agent never actually ran (bad flags,
    // missing binary, immediate non-zero exit with no work product).
    const invocationFailure =
      exec.spawnError !== undefined ||
      (exec.exitCode !== 0 && !exec.timedOut && diff.length === 0 && envelope.tokens.total === 0);

    let outcome: Outcome;
    let verify = { passed: false, output: "" };
    if (invocationFailure) {
      outcome = "agent-error";
    } else {
      verify = await runVerification(task, workDir);
      // A trial that blew the wall-clock cap is a timeout even if the tests
      // happen to pass on whatever state the kill left behind — exceeding the
      // matched budget must never score as a win (see METHODOLOGY.md).
      if (exec.timedOut) outcome = "timeout";
      else if (verify.passed) outcome = "passed";
      else outcome = "failed";
    }

    const transcriptPath = join("transcripts", `${id}.txt`);
    writeFileSync(
      join(runDir, transcriptPath),
      [
        `# ${id}`,
        `# exit=${String(exec.exitCode)} timedOut=${String(exec.timedOut)} spawnError=${exec.spawnError ?? "none"}`,
        "",
        "## stdout",
        exec.stdout,
        "",
        "## stderr",
        exec.stderr,
      ].join("\n"),
    );
    const diffPath = join("diffs", `${id}.patch`);
    writeFileSync(join(runDir, diffPath), diff);

    const stats = diffStats(diff);
    const errorText =
      exec.spawnError ??
      (exec.timedOut
        ? `timed out after ${config.timeoutSeconds}s`
        : exec.exitCode !== 0
          ? `agent exited ${String(exec.exitCode)}: ${exec.stderr.trim().slice(0, 500)}`
          : undefined);

    return {
      id,
      taskId: task.id,
      trial,
      agent: {
        adapter: spec.adapter,
        model: spec.model,
        resolvedModel: adapter.resolveModel(spec.model),
        version: adapter.version(),
        bin: adapter.bin(),
      },
      outcome,
      verify,
      timing: {
        wallClockSeconds,
        agentReportedSeconds: envelope.agentReportedSeconds,
      },
      tokens: envelope.tokens,
      cost: {
        computedUsd: computeCost(envelope.tokens, spec.model, pricing),
        agentReportedUsd: envelope.agentReportedUsd,
        pricingModel: pricing[spec.model] ? spec.model : null,
      },
      activity: {
        toolCalls: envelope.toolCalls,
        iterations: envelope.iterations,
        filesTouched: stats.filesTouched,
        linesAdded: stats.linesAdded,
        linesRemoved: stats.linesRemoved,
        diffBytes: Buffer.byteLength(diff),
      },
      provenance: {
        runId,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
      },
      transcriptPath,
      diffPath,
      ...(errorText !== undefined ? { error: errorText } : {}),
    };
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

function gitSha(): string {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown";
  }
}

function buildReproduceCommand(config: RunConfig): string {
  const agents = config.agents.map((a) => `${a.adapter}=${a.model}`).join(",");
  const parts = [
    "pnpm arena run",
    `--agents ${agents}`,
    `--tasks ${config.tasks.map((t) => t.id).join(",")}`,
    `--trials ${String(config.trials)}`,
    `--timeout ${String(config.timeoutSeconds)}`,
    `--seed ${String(config.seed)}`,
  ];
  if (config.budgetUsd !== undefined) parts.push(`--budget ${String(config.budgetUsd)}`);
  return parts.join(" ");
}
