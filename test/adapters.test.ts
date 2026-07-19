import { describe, expect, it } from "vitest";
import type { AdapterRunArgs } from "../src/adapters/base.js";
import { ClaudeCodeAdapter } from "../src/adapters/claude-code.js";
import { GeminiAdapter } from "../src/adapters/gemini.js";
import { adapterNames, createAdapter } from "../src/adapters/index.js";
import { OxagenAdapter } from "../src/adapters/oxagen.js";
import { StellaAdapter } from "../src/adapters/stella.js";

const baseArgs: AdapterRunArgs = {
  prompt: "fix the bug",
  model: "anthropic/claude-sonnet-5",
  budgetUsd: 5,
  timeoutSeconds: 600,
  workDir: "/tmp/x",
  taskDir: "/tmp/task",
};

describe("registry", () => {
  it("creates every registered adapter and rejects unknown ones", () => {
    for (const name of adapterNames()) {
      expect(createAdapter({ adapter: name, model: "m" }).name).toBe(name);
    }
    expect(() => createAdapter({ adapter: "nope", model: "m" })).toThrow(/Unknown adapter/);
  });
});

describe("claude-code", () => {
  const adapter = new ClaudeCodeAdapter();

  it("maps slugs to family aliases", () => {
    expect(adapter.resolveModel("anthropic/claude-sonnet-5")).toBe("sonnet");
    expect(adapter.resolveModel("anthropic/claude-opus-4.8")).toBe("opus");
    expect(adapter.resolveModel("weird-model")).toBe("weird-model");
  });

  it("builds print-mode argv with budget", () => {
    expect(adapter.buildArgs(baseArgs)).toEqual([
      "-p",
      "--output-format",
      "json",
      "--model",
      "sonnet",
      "--permission-mode",
      "acceptEdits",
      "--max-budget-usd",
      "5",
      "fix the bug",
    ]);
  });

  it("normalizes the result envelope (input already excludes cache reads)", () => {
    const stdout = JSON.stringify({
      type: "result",
      total_cost_usd: 0.12,
      duration_ms: 30000,
      num_turns: 6,
      usage: {
        input_tokens: 1000,
        output_tokens: 400,
        cache_read_input_tokens: 9000,
        cache_creation_input_tokens: 500,
      },
    });
    const parsed = adapter.parseEnvelope(stdout);
    expect(parsed.tokens).toEqual({
      input: 1000,
      output: 400,
      cacheRead: 9000,
      cacheWrite: 500,
      total: 10900,
    });
    expect(parsed.agentReportedUsd).toBe(0.12);
    expect(parsed.agentReportedSeconds).toBe(30);
    expect(parsed.iterations).toBe(6);
  });
});

describe("oxagen", () => {
  const adapter = new OxagenAdapter();

  it("builds one-shot argv with -- separator", () => {
    expect(adapter.buildArgs(baseArgs)).toEqual([
      "--local",
      "--output-format",
      "json",
      "--model",
      "anthropic/claude-sonnet-5",
      "--budget",
      "5",
      "--",
      "fix the bug",
    ]);
  });

  it("subtracts cached tokens from combined input (normalization)", () => {
    const stdout = JSON.stringify({
      type: "result",
      steps: 24,
      durationMs: 94918,
      usage: { inputTokens: 277032, outputTokens: 8432, cachedInputTokens: 244884 },
      commandsRun: ["a", "b", "c"],
    });
    const parsed = adapter.parseEnvelope(stdout);
    expect(parsed.tokens.input).toBe(277032 - 244884);
    expect(parsed.tokens.cacheRead).toBe(244884);
    expect(parsed.tokens.total).toBe(277032 + 8432);
    expect(parsed.toolCalls).toBe(3);
    expect(parsed.iterations).toBe(24);
  });
});

describe("stella", () => {
  const adapter = new StellaAdapter();

  it("prefixes bare model ids with zai/", () => {
    expect(adapter.resolveModel("glm-5.2")).toBe("zai/glm-5.2");
    expect(adapter.resolveModel("anthropic/claude-sonnet-5")).toBe("anthropic/claude-sonnet-5");
  });

  it("passes config via env, prompt via `run`", () => {
    expect(adapter.buildArgs(baseArgs)).toEqual(["run", "fix the bug"]);
    const env = adapter.env(baseArgs);
    expect(env.STELLA_OUTPUT_FORMAT).toBe("json");
    expect(env.STELLA_MODEL).toBe("anthropic/claude-sonnet-5");
    expect(env.STELLA_BUDGET).toBe("5");
  });

  it("reads both camelCase and snake_case envelopes", () => {
    const parsed = adapter.parseEnvelope(
      JSON.stringify({
        type: "result",
        usage: { input_tokens: 900, output_tokens: 100, cache_read_tokens: 400 },
        cost_usd: 0.05,
      }),
    );
    expect(parsed.tokens.input).toBe(500);
    expect(parsed.tokens.cacheRead).toBe(400);
    expect(parsed.agentReportedUsd).toBe(0.05);
  });
});

describe("gemini", () => {
  const adapter = new GeminiAdapter();

  it("strips the google/ prefix and uses auto_edit approval", () => {
    const argv = adapter.buildArgs({ ...baseArgs, model: "google/gemini-2.5-pro" });
    expect(argv).toContain("gemini-2.5-pro");
    expect(argv).toContain("auto_edit");
  });

  it("sums per-model token stats and subtracts cached from prompt", () => {
    const stdout = JSON.stringify({
      response: "done",
      stats: {
        models: {
          "gemini-2.5-pro": {
            tokens: { prompt: 5000, candidates: 700, cached: 2000, total: 5700 },
          },
          "gemini-2.5-flash": { tokens: { prompt: 100, candidates: 20, cached: 0, total: 120 } },
        },
        tools: { totalCalls: 9 },
      },
    });
    const parsed = adapter.parseEnvelope(stdout);
    expect(parsed.tokens.input).toBe(5100 - 2000);
    expect(parsed.tokens.cacheRead).toBe(2000);
    expect(parsed.tokens.output).toBe(720);
    expect(parsed.toolCalls).toBe(9);
  });
});
