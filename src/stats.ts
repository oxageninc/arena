/**
 * Statistics for paired agent comparisons.
 *
 * Everything here is deterministic: the bootstrap uses a seeded PRNG so a
 * published report can be regenerated bit-for-bit from the raw trial data.
 */

/** 95% Wilson score interval for a binomial proportion. */
export function wilsonInterval(successes: number, n: number, z = 1.96): [number, number] {
  // No observations → maximal uncertainty, not false certainty. Returning [0,0]
  // reads as "provably 0% success" and makes the regression gate certify a
  // "100% drop" when a run has zero scored trials (e.g. every trial was an
  // excluded agent-error) — the exact case the gate must NOT fail on.
  if (n === 0) return [0, 1];
  const p = successes / n;
  const denom = 1 + (z * z) / n;
  const center = p + (z * z) / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (center - margin) / denom), Math.min(1, (center + margin) / denom)];
}

/**
 * Exact McNemar test (two-sided) on paired pass/fail outcomes.
 *
 * `b` = pairs where A passed and B failed; `c` = pairs where B passed and A
 * failed. Under H0 (no difference), discordant pairs are Binomial(b+c, 0.5).
 * Returns the two-sided exact p-value, or null when there are no discordant
 * pairs (the test is undefined; the agents never disagreed).
 */
export function mcnemarExact(b: number, c: number): number | null {
  const n = b + c;
  if (n === 0) return null;
  const k = Math.min(b, c);
  // P(X <= k) for X ~ Binomial(n, 0.5), computed in log space for stability.
  let tail = 0;
  for (let i = 0; i <= k; i++) {
    tail += Math.exp(logChoose(n, i) - n * Math.LN2);
  }
  return Math.min(1, 2 * tail);
}

function logChoose(n: number, k: number): number {
  return logFactorial(n) - logFactorial(k) - logFactorial(n - k);
}

const logFactCache: number[] = [0, 0];
function logFactorial(n: number): number {
  for (let i = logFactCache.length; i <= n; i++) {
    logFactCache.push((logFactCache[i - 1] as number) + Math.log(i));
  }
  return logFactCache[n] as number;
}

/** Deterministic 32-bit PRNG (mulberry32). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

export function mean(values: number[]): number {
  if (values.length === 0) return NaN;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

export interface PairedDeltaCI {
  /** Point estimate: (median(b) - median(a)) / median(a). */
  relativeDelta: number;
  /** 95% percentile bootstrap CI on the relative delta. */
  ci: [number, number];
  n: number;
}

/**
 * Paired bootstrap CI for the relative difference in medians between two
 * agents measured on the SAME (task, trial) pairs. Resampling is over pairs,
 * preserving the pairing structure. Returns null when fewer than 3 pairs or
 * when the baseline median is 0 (relative delta undefined).
 */
export function pairedBootstrapDelta(
  a: number[],
  b: number[],
  seed: number,
  iterations = 2000,
): PairedDeltaCI | null {
  const n = Math.min(a.length, b.length);
  if (n < 3) return null;
  const baseMedian = median(a.slice(0, n));
  if (baseMedian === 0 || Number.isNaN(baseMedian)) return null;

  const point = (median(b.slice(0, n)) - baseMedian) / baseMedian;
  const rng = mulberry32(seed);
  const deltas: number[] = [];

  for (let it = 0; it < iterations; it++) {
    const sa: number[] = [];
    const sb: number[] = [];
    for (let i = 0; i < n; i++) {
      const idx = Math.floor(rng() * n);
      sa.push(a[idx] as number);
      sb.push(b[idx] as number);
    }
    const ma = median(sa);
    if (ma === 0) continue;
    deltas.push((median(sb) - ma) / ma);
  }
  if (deltas.length < iterations / 2) return null;

  deltas.sort((x, y) => x - y);
  // Type-1 empirical quantile (index ceil(q·N)-1), symmetric on both tails.
  // The previous floor/ceil pair trimmed 2.5% below but only 2.45% above,
  // biasing the interval — the kind of asymmetry a hostile reviewer diffs.
  const quantileIdx = (q: number): number =>
    Math.min(deltas.length - 1, Math.max(0, Math.ceil(q * deltas.length) - 1));
  const lo = deltas[quantileIdx(0.025)] as number;
  const hi = deltas[quantileIdx(0.975)] as number;
  return { relativeDelta: point, ci: [lo, hi], n };
}
