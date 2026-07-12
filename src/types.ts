/**
 * Core types for the Arena harness.
 *
 * Design constraints that shape these shapes:
 *  - Token fields are NORMALIZED: `input` never includes cache reads. Adapters
 *    are responsible for subtracting cached tokens when a CLI reports them
 *    combined, so cross-agent token comparisons are apples-to-apples.
 *  - Cost is dual-tracked: `computedUsd` comes from one shared pricing table
 *    applied to normalized tokens (null when the model has no pricing entry —
 *    never guessed), and `agentReportedUsd` is whatever the CLI claimed.
 *  - `outcome` distinguishes a real task failure from a harness/invocation
 *    failure ("agent-error"): a run where the agent binary rejected its flags
 *    must never be scored as the agent losing the task.
 */

export type Outcome = "passed" | "failed" | "timeout" | "agent-error";

export interface TaskDef {
  id: string;
  name: string;
  category: "bug-fix" | "feature" | "robustness" | "refactor";
  difficulty: "easy" | "medium" | "hard";
  /** Full behavior contract given to every agent. The held-out tests assert
   * only behavior stated here. */
  prompt: string;
  /** Seconds the verify step may take (default 60). */
  verifyTimeoutSeconds?: number;
  tags: string[];
}

/** A task on disk: tasks/<id>/{task.json, workspace/, verify/, solution/}. */
export interface LoadedTask extends TaskDef {
  dir: string;
}

export interface AgentSpec {
  /** Adapter name, e.g. "claude-code". */
  adapter: string;
  /** Arena-canonical model slug, e.g. "anthropic/claude-sonnet-5". */
  model: string;
  /** Override for the CLI binary path. */
  bin?: string;
}

export interface RunConfig {
  agents: AgentSpec[];
  tasks: LoadedTask[];
  trials: number;
  budgetUsd?: number;
  timeoutSeconds: number;
  seed: number;
  outDir: string;
}

export interface TokenCounts {
  /** Uncached input tokens. */
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** input + output + cacheRead + cacheWrite. */
  total: number;
}

export interface ParsedEnvelope {
  tokens: TokenCounts;
  agentReportedUsd: number | null;
  agentReportedSeconds: number | null;
  toolCalls: number | null;
  iterations: number | null;
}

export interface TrialResult {
  id: string;
  taskId: string;
  /** 1-based trial index. */
  trial: number;
  agent: {
    adapter: string;
    model: string;
    resolvedModel: string;
    version: string;
    bin: string;
  };
  outcome: Outcome;
  verify: {
    passed: boolean;
    /** Trimmed tail of the verify runner output (receipt). */
    output: string;
  };
  timing: {
    wallClockSeconds: number;
    agentReportedSeconds: number | null;
  };
  tokens: TokenCounts;
  cost: {
    computedUsd: number | null;
    agentReportedUsd: number | null;
    pricingModel: string | null;
  };
  activity: {
    toolCalls: number | null;
    iterations: number | null;
    filesTouched: number;
    linesAdded: number;
    linesRemoved: number;
    diffBytes: number;
  };
  provenance: {
    runId: string;
    startedAt: string;
    finishedAt: string;
  };
  /** Relative paths (within the run dir) to full receipts. */
  transcriptPath: string;
  diffPath: string;
  error?: string;
}

export interface RunManifest {
  runId: string;
  createdAt: string;
  harness: { name: string; version: string; gitSha: string };
  host: { platform: string; arch: string; node: string };
  seed: number;
  trials: number;
  budgetUsd: number | null;
  timeoutSeconds: number;
  agents: {
    adapter: string;
    model: string;
    resolvedModel: string;
    version: string;
    bin: string;
  }[];
  taskIds: string[];
  /** True when every agent runs the same canonical model slug. Reports must
   * carry a prominent caveat when false. */
  matchedModels: boolean;
  reproduceCommand: string;
}

export interface PricingEntry {
  /** USD per million tokens. */
  inputPerM: number;
  outputPerM: number;
  cacheReadPerM: number;
  cacheWritePerM?: number;
  note?: string;
}

export type PricingTable = Record<string, PricingEntry>;
