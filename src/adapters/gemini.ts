/**
 * Gemini CLI adapter.
 *
 * Invocation:
 *   gemini -p <prompt> --output-format json -m <model> --approval-mode auto_edit
 *
 * `--approval-mode auto_edit` is the closest autonomy match to Claude Code's
 * `--permission-mode acceptEdits` (edits auto-approved, arbitrary shell not).
 *
 * JSON output shape (gemini-cli ≥ 0.x): { response, stats: { models: {
 *   "<model>": { tokens: { prompt, candidates, cached, total, ... } } } } }
 * Multiple model entries are summed. Gemini's `prompt` count INCLUDES cached
 * tokens, so normalized input = prompt − cached.
 *
 * NOTE: gemini-cli flags/envelope evolve quickly; `arena doctor` surfaces the
 * installed version, and this adapter is covered by unit tests over a captured
 * envelope. Re-verify against your installed version before publishing runs.
 */

import { Adapter, emptyEnvelope, totalize, type AdapterRunArgs } from "./base.js";
import { isRecord, num, parseJsonEnvelope } from "../parse.js";
import type { ParsedEnvelope } from "../types.js";

export class GeminiAdapter extends Adapter {
  readonly name = "gemini";
  protected readonly defaultBinary = "gemini";

  /** `google/gemini-2.5-pro` → `gemini-2.5-pro`; bare ids pass through. */
  override resolveModel(model: string): string {
    return model.replace(/^google\//, "");
  }

  buildArgs(args: AdapterRunArgs): string[] {
    return [
      "-p",
      args.prompt,
      "--output-format",
      "json",
      "-m",
      this.resolveModel(args.model),
      "--approval-mode",
      "auto_edit",
    ];
  }

  parseEnvelope(stdout: string): ParsedEnvelope {
    const env = parseJsonEnvelope(stdout);
    if (!env) return emptyEnvelope();

    const stats = isRecord(env["stats"]) ? env["stats"] : {};
    const models = isRecord(stats["models"]) ? stats["models"] : {};

    let prompt = 0;
    let candidates = 0;
    let cached = 0;
    let toolCalls: number | null = null;
    for (const entry of Object.values(models)) {
      if (!isRecord(entry)) continue;
      const tokens = isRecord(entry["tokens"]) ? entry["tokens"] : {};
      prompt += num(tokens["prompt"]);
      candidates += num(tokens["candidates"]);
      cached += num(tokens["cached"]);
    }
    const tools = isRecord(stats["tools"]) ? stats["tools"] : {};
    const totalCalls = tools["totalCalls"];
    if (typeof totalCalls === "number" && Number.isFinite(totalCalls)) {
      toolCalls = totalCalls;
    }

    const cacheRead = Math.min(cached, prompt);
    return {
      tokens: totalize({
        input: prompt - cacheRead,
        output: candidates,
        cacheRead,
        cacheWrite: 0,
      }),
      agentReportedUsd: null,
      agentReportedSeconds: null,
      toolCalls,
      iterations: null,
    };
  }
}
