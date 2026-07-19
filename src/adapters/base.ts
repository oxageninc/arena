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
  /** Task fixture directory. Only the in-process mock may read it; real CLIs
   * must never see the fixture (it contains the held-out tests). */
  taskDir: string;
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

  private cachedVersion: string | undefined;

  version(): string {
    if (this.cachedVersion === undefined) {
      try {
        this.cachedVersion = execFileSync(this.bin(), ["--version"], {
          encoding: "utf8",
          timeout: 10_000,
        })
          .trim()
          .split("\n")[0] as string;
      } catch {
        this.cachedVersion = "unknown";
      }
    }
    return this.cachedVersion;
  }

  /**
   * Run the agent. Overridable (the mock adapter runs in-process). argv arrays
   * only — nothing is ever interpolated through a shell.
   *
   * On POSIX the child gets its own process group so a timeout (or exit) can
   * kill the agent's whole process tree, not just the direct child: coding
   * agents routinely spawn shells, watchers, and servers, and a surviving
   * grandchild could otherwise hold the stdio pipes open forever (hanging the
   * run past its timeout) or keep mutating the workspace while the held-out
   * verifier runs.
   */
  execute(args: AdapterRunArgs): Promise<ExecOutcome> {
    return new Promise((resolve) => {
      const posix = process.platform !== "win32";
      const child = spawn(this.bin(), this.buildArgs(args), {
        cwd: args.workDir,
        env: { ...process.env, ...this.env(args) },
        stdio: ["ignore", "pipe", "pipe"],
        detached: posix,
      });

      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let settled = false;
      let drainTimer: NodeJS.Timeout | undefined;

      const killTree = (): void => {
        if (posix && child.pid !== undefined) {
          try {
            process.kill(-child.pid, "SIGKILL");
            return;
          } catch {
            // Process group already gone — fall through to the direct kill.
          }
        }
        child.kill("SIGKILL");
      };

      const settle = (outcome: ExecOutcome): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (drainTimer !== undefined) clearTimeout(drainTimer);
        resolve(outcome);
      };

      const timer = setTimeout(() => {
        timedOut = true;
        killTree();
      }, args.timeoutSeconds * 1000);

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => (stdout += chunk));
      child.stderr.on("data", (chunk: string) => (stderr += chunk));

      child.on("error", (err) => {
        settle({
          stdout,
          stderr,
          exitCode: null,
          timedOut: false,
          spawnError: err.message,
        });
      });

      // "close" waits for the stdio pipes to drain, which an orphaned
      // grandchild that inherited them can prevent forever. "exit" is the
      // authoritative signal: reap anything left in the process group, then
      // give the pipes a short grace period to flush before settling.
      child.on("exit", (code) => {
        clearTimeout(timer);
        killTree();
        drainTimer = setTimeout(() => {
          settle({ stdout, stderr, exitCode: code, timedOut });
        }, 2000);
      });
      child.on("close", (code) => {
        settle({ stdout, stderr, exitCode: code, timedOut });
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
