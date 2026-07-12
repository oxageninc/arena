/**
 * Claude Code adapter.
 *
 * Invocation (verified against claude CLI ≥ 2.x):
 *   claude -p --output-format json --model <alias|full-id>
 *          --permission-mode acceptEdits [--max-budget-usd N] <prompt>
 *
 * Result envelope: { type:"result", total_cost_usd, duration_ms, num_turns,
 *   usage:{ input_tokens, output_tokens, cache_read_input_tokens,
 *           cache_creation_input_tokens } }
 *
 * Token normalization: Claude's `input_tokens` already EXCLUDES cache reads,
 * so counts map through directly.
 */

import { Adapter, emptyEnvelope, totalize, type AdapterRunArgs } from "./base.js";
import { isRecord, num, parseJsonEnvelope } from "../parse.js";
import type { ParsedEnvelope } from "../types.js";

export class ClaudeCodeAdapter extends Adapter {
  readonly name = "claude-code";
  protected readonly defaultBinary = "claude";

  /** `anthropic/claude-sonnet-5` → `sonnet`; unrecognized slugs pass through. */
  override resolveModel(model: string): string {
    const bare = model.replace(/^anthropic\//, "");
    const family = bare.match(/^claude-(opus|sonnet|haiku|fable)/)?.[1];
    return family ?? bare;
  }

  buildArgs(args: AdapterRunArgs): string[] {
    const argv = [
      "-p",
      "--output-format",
      "json",
      "--model",
      this.resolveModel(args.model),
      "--permission-mode",
      "acceptEdits",
    ];
    if (args.budgetUsd !== undefined) {
      argv.push("--max-budget-usd", String(args.budgetUsd));
    }
    argv.push(args.prompt);
    return argv;
  }

  parseEnvelope(stdout: string): ParsedEnvelope {
    const env = parseJsonEnvelope(stdout);
    if (!env) return emptyEnvelope();

    const usage = isRecord(env["usage"]) ? env["usage"] : {};
    const tokens = totalize({
      input: num(usage["input_tokens"]),
      output: num(usage["output_tokens"]),
      cacheRead: num(usage["cache_read_input_tokens"]),
      cacheWrite: num(usage["cache_creation_input_tokens"]),
    });

    const reportedUsd = env["total_cost_usd"];
    const durationMs = env["duration_ms"];

    return {
      tokens,
      agentReportedUsd:
        typeof reportedUsd === "number" && Number.isFinite(reportedUsd)
          ? reportedUsd
          : null,
      agentReportedSeconds:
        typeof durationMs === "number" && Number.isFinite(durationMs)
          ? durationMs / 1000
          : null,
      toolCalls: null, // Claude's json envelope does not report tool calls.
      iterations: num(env["num_turns"], 0) || null,
    };
  }
}
