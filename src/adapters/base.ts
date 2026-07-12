/**
 * Adapter contract.
 *
 * An adapter knows how to invoke one agent CLI in non-interactive ("headless")
 * mode inside a prepared workspace and how to normalize its stdout envelope
 * into Arena metrics. Adapters never decide success — the harness's held-out
 * verification does. Adapters must normalize token counts so `tokens.input`
 * excludes cache reads (see types.ts).
 */

import { execFileSync, spawn } from "node:child_process";

import type { AgentSpec, ParsedEnvelope } from "../types.js";

export interface AdapterRunArgs {
  prompt: string;
  /** Arena-canonical model slug (e.g. "anthropic/claude-sonnet-5"). */
  model: string;
  budgetUsd: number | undefined;
  timeoutSeconds: number;
  workDir: string;
}

export interface ExecOutcome {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  /** Set when the process could not be spawned at all. */
  spawnError?: string;
}

export abstract class Adapter {
  abstract readonly name: string;
  protected abstract readonly defaultBinary: string;

  protected binOverride: string | undefined;

  constructor(spec?: Pick<AgentSpec, "bin">) {
    this.binOverride = spec?.bin;
  }

  bin(): string {
    return (
      this.binOverride ??
      process.env[`ARENA_${this.name.replace(/-/g, "_").toUpperCase()}_BIN`] ??
      this.defaultBinary
    );
  }

  /** Map the canonical model slug to what this CLI expects. */
  resolveModel(model: string): string {
    return model;
  }

  abstract buildArgs(args: AdapterRunArgs): string[];

  /** Extra environment merged over process.env for the spawned agent. */
  env(_args: AdapterRunArgs): Record<string, string> {
    return {};
  }

  abstract parseEnvelope(stdout: string): ParsedEnvelope;

  isAvailable(): boolean {
    try {
      execFileSync(this.bin(), ["--version"], { stdio: "ignore", timeout: 10_000 });
      return true;
    } catch {
      return false;
    }
  }

  version(): string {
    try {
      return execFileSync(this.bin(), ["--version"], {
        encoding: "utf8",
        timeout: 10_000,
      })
        .trim()
        .split("\n")[0] as string;
    } catch {
      return "unknown";
    }
  }

  /**
   * Run the agent. Overridable (the mock adapter runs in-process). argv arrays
   * only — nothing is ever interpolated through a shell.
   */
  execute(args: AdapterRunArgs): Promise<ExecOutcome> {
    return new Promise((resolve) => {
      const child = spawn(this.bin(), this.buildArgs(args), {
        cwd: args.workDir,
        env: { ...process.env, ...this.env(args) },
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, args.timeoutSeconds * 1000);

      child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
      child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));

      child.on("error", (err) => {
        clearTimeout(timer);
        resolve({
          stdout,
          stderr,
          exitCode: null,
          timedOut: false,
          spawnError: err.message,
        });
      });

      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ stdout, stderr, exitCode: code, timedOut });
      });
    });
  }
}

export function emptyEnvelope(): ParsedEnvelope {
  return {
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    agentReportedUsd: null,
    agentReportedSeconds: null,
    toolCalls: null,
    iterations: null,
  };
}

export function totalize(tokens: {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}): { input: number; output: number; cacheRead: number; cacheWrite: number; total: number } {
  return {
    ...tokens,
    total: tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite,
  };
}
