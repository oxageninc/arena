import { describe, expect, it } from "vitest";

import {
  mcnemarExact,
  median,
  mulberry32,
  pairedBootstrapDelta,
  wilsonInterval,
} from "../src/stats.js";

describe("wilsonInterval", () => {
  it("is [0,0] for n=0", () => {
    expect(wilsonInterval(0, 0)).toEqual([0, 0]);
  });

  it("brackets the point estimate and stays in [0,1]", () => {
    const [lo, hi] = wilsonInterval(8, 10);
    expect(lo).toBeGreaterThan(0);
    expect(lo).toBeLessThan(0.8);
    expect(hi).toBeGreaterThan(0.8);
    expect(hi).toBeLessThanOrEqual(1);
  });

  it("matches a known reference value (5/10 → ~[0.237, 0.763])", () => {
    const [lo, hi] = wilsonInterval(5, 10);
    expect(lo).toBeCloseTo(0.2366, 3);
    expect(hi).toBeCloseTo(0.7634, 3);
  });

  it("narrows as n grows", () => {
    const [lo10, hi10] = wilsonInterval(5, 10);
    const [lo100, hi100] = wilsonInterval(50, 100);
    expect(hi100 - lo100).toBeLessThan(hi10 - lo10);
  });
});

describe("mcnemarExact", () => {
  it("is null with no discordant pairs", () => {
    expect(mcnemarExact(0, 0)).toBeNull();
  });

  it("is 1 for perfectly balanced discordance", () => {
    // b=1, c=1: two-sided p = 2 * P(X<=1 | n=2) = 2 * 0.75 → capped at 1
    expect(mcnemarExact(1, 1)).toBe(1);
  });

  it("matches exact binomial for a lopsided split", () => {
    // b=8, c=0: p = 2 * P(X<=0 | n=8, 0.5) = 2 * (1/256) = 1/128
    expect(mcnemarExact(8, 0)).toBeCloseTo(2 / 256, 10);
  });

  it("is symmetric in b and c", () => {
    expect(mcnemarExact(6, 2)).toBeCloseTo(mcnemarExact(2, 6) as number, 12);
  });
});

describe("median", () => {
  it("handles odd and even lengths", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });
});

describe("mulberry32", () => {
  it("is deterministic for a given seed", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});

describe("pairedBootstrapDelta", () => {
  it("is null for too-small samples", () => {
    expect(pairedBootstrapDelta([1, 2], [1, 2], 42)).toBeNull();
  });

  it("finds a clear reduction with a CI excluding zero", () => {
    const a = [100, 110, 95, 105, 102, 98, 107, 103];
    const b = a.map((x) => x * 0.7); // 30% less across the board
    const delta = pairedBootstrapDelta(a, b, 42);
    expect(delta).not.toBeNull();
    expect(delta!.relativeDelta).toBeCloseTo(-0.3, 5);
    expect(delta!.ci[1]).toBeLessThan(0);
  });

  it("is deterministic given the same seed", () => {
    const a = [10, 12, 9, 11, 10.5, 9.5];
    const b = [9, 13, 8, 12, 10, 9];
    expect(pairedBootstrapDelta(a, b, 7)).toEqual(pairedBootstrapDelta(a, b, 7));
  });
});
