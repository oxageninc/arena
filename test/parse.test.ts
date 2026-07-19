import { describe, expect, it } from "vitest";

import { countOf, diffStats, num, parseJsonEnvelope, sanitizeSegment } from "../src/parse.js";

describe("parseJsonEnvelope", () => {
  it("returns null for empty/non-JSON output", () => {
    expect(parseJsonEnvelope("")).toBeNull();
    expect(parseJsonEnvelope("plain text banner\nno json here")).toBeNull();
  });

  it("prefers the last type:result object in JSONL", () => {
    const stdout = [
      '{"type":"event","n":1}',
      '{"type":"result","n":2}',
      '{"type":"event","n":3}',
    ].join("\n");
    expect(parseJsonEnvelope(stdout)).toEqual({ type: "result", n: 2 });
  });

  it("falls back to the last parseable object", () => {
    const stdout = ["not json", '{"a":1}', '{"b":2}'].join("\n");
    expect(parseJsonEnvelope(stdout)).toEqual({ b: 2 });
  });

  it("ignores log lines interleaved with JSON", () => {
    const stdout = ["INFO starting", '{"type":"result","ok":true}', "INFO done"].join("\n");
    expect(parseJsonEnvelope(stdout)).toEqual({ type: "result", ok: true });
  });

  it("parses a pretty-printed (multi-line) envelope, as gemini-cli emits", () => {
    const stdout = [
      "Loaded config",
      JSON.stringify(
        { type: "result", stats: { models: { m: { tokens: { prompt: 10 } } } } },
        null,
        2,
      ),
      "done",
    ].join("\n");
    expect(parseJsonEnvelope(stdout)).toEqual({
      type: "result",
      stats: { models: { m: { tokens: { prompt: 10 } } } },
    });
  });

  it("is not fooled by braces inside JSON strings", () => {
    const stdout = JSON.stringify({ type: "result", note: 'a "}" inside {braces}' }, null, 2);
    expect(parseJsonEnvelope(stdout)).toEqual({ type: "result", note: 'a "}" inside {braces}' });
  });
});

describe("num / countOf", () => {
  it("num coerces safely", () => {
    expect(num(5)).toBe(5);
    expect(num(-1)).toBe(0); // negative counts rejected
    expect(num("5")).toBe(0);
    expect(num(NaN, 7)).toBe(7);
  });

  it("countOf handles arrays, numbers, and absence", () => {
    expect(countOf([1, 2, 3])).toBe(3);
    expect(countOf(4)).toBe(4);
    expect(countOf(undefined)).toBeNull();
  });
});

describe("sanitizeSegment", () => {
  it("flattens model slugs into safe filenames", () => {
    expect(sanitizeSegment("anthropic/claude-opus-4.8")).toBe("anthropic_claude-opus-4.8");
  });
});

describe("diffStats", () => {
  it("counts files and +/- lines, excluding headers", () => {
    const diff = [
      "diff --git a/x.mjs b/x.mjs",
      "--- a/x.mjs",
      "+++ b/x.mjs",
      "@@ -1,2 +1,3 @@",
      "-old line",
      "+new line",
      "+another line",
      " context",
    ].join("\n");
    expect(diffStats(diff)).toEqual({
      filesTouched: 1,
      linesAdded: 2,
      linesRemoved: 1,
    });
  });
});
