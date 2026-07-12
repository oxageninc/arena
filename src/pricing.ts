/**
 * Uniform cost accounting.
 *
 * One pricing table (pricing.json, USD per million tokens) is applied to every
 * agent's NORMALIZED token counts. If a model has no entry, computed cost is
 * null — the harness never silently prices one vendor's tokens with another
 * vendor's rate card. Agent-self-reported cost is recorded separately and the
 * report shows both.
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import type { PricingTable, TokenCounts } from "./types.js";
import { isRecord, num } from "./parse.js";

const HERE = dirname(fileURLToPath(import.meta.url));

export function loadPricing(path?: string): PricingTable {
  const file = path ?? join(HERE, "..", "pricing.json");
  const raw: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (!isRecord(raw)) return {};
  const table: PricingTable = {};
  for (const [model, entry] of Object.entries(raw)) {
    if (!isRecord(entry)) continue;
    table[model] = {
      inputPerM: num(entry["inputPerM"]),
      outputPerM: num(entry["outputPerM"]),
      cacheReadPerM: num(entry["cacheReadPerM"]),
      ...(entry["cacheWritePerM"] !== undefined
        ? { cacheWritePerM: num(entry["cacheWritePerM"]) }
        : {}),
      ...(typeof entry["note"] === "string" ? { note: entry["note"] } : {}),
    };
  }
  return table;
}

/** Compute USD cost from normalized tokens, or null if the model is unpriced. */
export function computeCost(
  tokens: TokenCounts,
  model: string,
  pricing: PricingTable,
): number | null {
  const rate = pricing[model];
  if (!rate) return null;
  const cacheWriteRate = rate.cacheWritePerM ?? rate.inputPerM;
  return (
    (tokens.input / 1e6) * rate.inputPerM +
    (tokens.output / 1e6) * rate.outputPerM +
    (tokens.cacheRead / 1e6) * rate.cacheReadPerM +
    (tokens.cacheWrite / 1e6) * cacheWriteRate
  );
}
