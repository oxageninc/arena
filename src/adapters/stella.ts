/**
 * Stella adapter.
 *
 * Invocation: `stella run <prompt>` with configuration via STELLA_* env vars
 * (STELLA_MODEL, STELLA_OUTPUT_FORMAT=json, optional STELLA_BUDGET) — the CLI
 * documents env equivalents for its global flags.
 *
 * Envelope: mirrors the oxagen family but field names may drift between
 * camelCase and snake_case across releases, so both spellings are read.
 * Token normalization: cached input is reported separately; when a combined
 * field is detected (inputTokens >= cachedInputTokens > 0) the cached share is
 * subtracted, mirroring the oxagen rule.
 */

import { Adapter, emptyEnvelope, totalize, type AdapterRunArgs } from "./base.js";
import { countOf, isRecord, num, parseJsonEnvelope } from "../parse.js";
import type { ParsedEnvelope } from "../types.js";

export class StellaAdapter extends Adapter {
  readonly name = "stella";
  protected readonly defaultBinary = "stella";

  /** Bare model ids get the zai/ provider prefix; scoped ids pass through. */
  override resolveModel(model: string): string {
    return model.includes("/") ? model : `zai/${model}`;
  }

  buildArgs(args: AdapterRunArgs): string[] {
    return ["run", args.prompt];
  }

  override env(args: AdapterRunArgs): Record<string, string> {
    return {
      STELLA_MODEL: this.resolveModel(args.model),
      STELLA_OUTPUT_FORMAT: "json",
      ...(args.budgetUsd !== undefined
        ? { STELLA_BUDGET: String(args.budgetUsd) }
        : {}),
    };
  }

  parseEnvelope(stdout: string): ParsedEnvelope {
    const env = parseJsonEnvelope(stdout);
    if (!env) return emptyEnvelope();

    const usage = isRecord(env["usage"]) ? env["usage"] : env;
    const rawInput = num(usage["inputTokens"] ?? usage["input_tokens"]);
    const cacheRead = Math.min(
      num(
        usage["cachedInputTokens"] ??
          usage["cacheReadTokens"] ??
          usage["cache_read_tokens"],
      ),
      rawInput,
    );
    const tokens = totalize({
      input: rawInput - cacheRead,
      output: num(usage["outputTokens"] ?? usage["output_tokens"]),
      cacheRead,
      cacheWrite: 0,
    });

    const reportedUsd = num(
      env["costUsd"] ?? env["cost_usd"] ?? usage["costUsd"] ?? usage["cost_usd"],
      -1,
    );
    const durationMs = num(env["durationMs"] ?? env["duration_ms"], -1);

    return {
      tokens,
      agentReportedUsd: reportedUsd >= 0 ? reportedUsd : null,
      agentReportedSeconds: durationMs >= 0 ? durationMs / 1000 : null,
      toolCalls: countOf(env["toolCalls"] ?? env["commandsRun"]),
      iterations: num(env["steps"] ?? env["iterations"], 0) || null,
    };
  }
}
