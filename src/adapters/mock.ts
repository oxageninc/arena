/**
 * Mock adapter — exercises the ENTIRE pipeline (workspace seeding, diff
 * capture, held-out verification, metrics, reporting) without any API key or
 * network access. Used by the test suite and CI.
 *
 *   model "solve" → copies the task's reference solution into the workspace
 *   model "fail"  → touches nothing
 *
 * It reports deterministic fake token counts so report math is testable.
 */

import { cpSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { ParsedEnvelope } from "../types.js";
import { Adapter, type AdapterRunArgs, type ExecOutcome, totalize } from "./base.js";

export class MockAdapter extends Adapter {
  readonly name = "mock";
  protected readonly defaultBinary = "mock";

  override isAvailable(): boolean {
    return true;
  }

  override version(): string {
    return "mock-1.0.0";
  }

  buildArgs(): string[] {
    return [];
  }

  override execute(args: AdapterRunArgs): Promise<ExecOutcome> {
    if (args.model === "solve") {
      const solution = join(args.taskDir, "solution");
      if (existsSync(solution)) {
        cpSync(solution, args.workDir, { recursive: true });
      }
    }
    const envelope = {
      type: "result",
      usage: { inputTokens: 1000, outputTokens: 200, cachedInputTokens: 400 },
      steps: 3,
      durationMs: 1500,
    };
    return Promise.resolve({
      stdout: JSON.stringify(envelope),
      stderr: "",
      exitCode: 0,
      timedOut: false,
    });
  }

  parseEnvelope(): ParsedEnvelope {
    return {
      tokens: totalize({ input: 600, output: 200, cacheRead: 400, cacheWrite: 0 }),
      agentReportedUsd: null,
      agentReportedSeconds: 1.5,
      toolCalls: 3,
      iterations: 3,
    };
  }
}
