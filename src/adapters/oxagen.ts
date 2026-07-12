/**
 * Oxagen adapter.
 *
 * Invocation:
 *   oxagen --local --output-format json --model <slug> [--budget N] -- <prompt>
 *
 * Result envelope: { type:"result", steps, usage:{ inputTokens, outputTokens,
 *   cachedInputTokens }, filesTouched:[], commandsRun:[], durationMs }
 *
 * Token normalization: oxagen's `inputTokens` INCLUDES cache reads
 * (`cachedInputTokens` is a subset), so normalized input =
 * inputTokens − cachedInputTokens.
 */

import { Adapter, emptyEnvelope, totalize, type AdapterRunArgs } from "./base.js";
import { countOf, isRecord, num, parseJsonEnvelope } from "../parse.js";
import type { ParsedEnvelope } from "../types.js";

export class OxagenAdapter extends Adapter {
  readonly name = "oxagen";
  protected readonly defaultBinary = "oxagen";

  buildArgs(args: AdapterRunArgs): string[] {
    const argv = ["--local", "--output-format", "json", "--model", args.model];
    if (args.budgetUsd !== undefined) argv.push("--budget", String(args.budgetUsd));
    argv.push("--", args.prompt);
    return argv;
  }

  override env(args: AdapterRunArgs): Record<string, string> {
    return {
      OXAGEN_MODEL_SLUG: args.model,
      ...(args.budgetUsd !== undefined
        ? { OXAGEN_BUDGET: String(args.budgetUsd) }
        : {}),
    };
  }

  parseEnvelope(stdout: string): ParsedEnvelope {
    const env = parseJsonEnvelope(stdout);
    if (!env) return emptyEnvelope();

    const usage = isRecord(env["usage"]) ? env["usage"] : {};
    const rawInput = num(usage["inputTokens"]);
    const cacheRead = Math.min(num(usage["cachedInputTokens"]), rawInput);
    const tokens = totalize({
      input: rawInput - cacheRead,
      output: num(usage["outputTokens"]),
      cacheRead,
      cacheWrite: 0,
    });

    const durationMs = env["durationMs"];

    return {
      tokens,
      agentReportedUsd: null, // envelope carries no cost
      agentReportedSeconds:
        typeof durationMs === "number" && Number.isFinite(durationMs)
          ? durationMs / 1000
          : null,
      toolCalls: countOf(env["commandsRun"]),
      iterations: num(env["steps"], 0) || null,
    };
  }
}
