/**
 * Envelope-parsing helpers shared by all adapters. Pure functions, unit-tested
 * without spawning any agent binary.
 */

/** Coerce an unknown JSON value into a finite non-negative number, else fallback. */
export function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

/** A count that may arrive as an array (length) or a number. Null when absent. */
export function countOf(value: unknown): number | null {
  if (Array.isArray(value)) return value.length;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Extract the machine-readable JSON envelope from an agent's stdout.
 *
 * Headless agent CLIs print either a single JSON object, JSONL (one event per
 * line), or a pretty-printed (multi-line) object. We want the last
 * `type: "result"` object, falling back to the last parseable object. Banners
 * and log lines are ignored.
 */
export function parseJsonEnvelope(stdout: string): Record<string, unknown> | null {
  if (!stdout) return null;

  // Pass 1 — line-oriented JSONL scan. Robust to banner text because only
  // whole lines that are complete JSON objects are considered.
  let lineFallback: Record<string, unknown> | null = null;
  const lines = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("{"));
  for (let i = lines.length - 1; i >= 0; i--) {
    const obj = tryParseRecord(lines[i] as string);
    if (!obj) continue;
    if (obj["type"] === "result") return obj;
    lineFallback ??= obj;
  }

  // Pass 2 — brace-matched scan, needed for multi-line (pretty-printed)
  // objects the line scan cannot see.
  let blockFallback: Record<string, unknown> | null = null;
  for (const block of topLevelJsonBlocks(stdout).reverse()) {
    const obj = tryParseRecord(block);
    if (!obj) continue;
    if (obj["type"] === "result") return obj;
    blockFallback ??= obj;
  }

  return lineFallback ?? blockFallback;
}

function tryParseRecord(text: string): Record<string, unknown> | null {
  try {
    const obj: unknown = JSON.parse(text);
    return isRecord(obj) ? obj : null;
  } catch {
    return null;
  }
}

  // No single-line result envelope. Pretty-printed envelopes span lines, so
  // fall back to a string-aware brace scan over the whole output.
  const scanned = scanJsonObjects(stdout);
  for (let i = scanned.length - 1; i >= 0; i--) {
    const obj = scanned[i] as Record<string, unknown>;
    if (obj["type"] === "result") return obj;
  }

  return fallback ?? scanned[scanned.length - 1] ?? null;
}

/**
 * Find every top-level JSON object in a text that may also contain non-JSON
 * noise. Candidates are anchored at lines that START with `{` (a
 * pretty-printed envelope's opening line), so a stray brace mid-way through a
 * log line can never derail the scan. From each anchor, string-aware brace
 * matching finds the balanced end; spans that fail `JSON.parse` are skipped.
 */
function scanJsonObjects(text: string): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  let offset = 0;
  let consumedUpTo = -1;
  for (const line of text.split("\n")) {
    const lineStart = offset;
    offset += line.length + 1;
    if (lineStart < consumedUpTo) continue; // inside an already-parsed object
    const firstNonSpace = line.search(/\S/);
    if (firstNonSpace === -1 || line[firstNonSpace] !== "{") continue;
    const start = lineStart + firstNonSpace;
    const end = balancedObjectEnd(text, start);
    if (end === -1) continue;
    try {
      const obj: unknown = JSON.parse(text.slice(start, end + 1));
      if (isRecord(obj)) {
        found.push(obj);
        consumedUpTo = end + 1;
      }
    } catch {
      // Balanced braces but not JSON — skip this anchor.
    }
  }
  return found;
}

/** Index of the `}` closing the object opened at `start`, or -1. */
function balancedObjectEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Make a string safe as a single path segment (model slugs contain "/"). */
export function sanitizeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
}

/** Count +/- lines and files touched from a unified diff. */
export function diffStats(diff: string): {
  filesTouched: number;
  linesAdded: number;
  linesRemoved: number;
} {
  let filesTouched = 0;
  let linesAdded = 0;
  let linesRemoved = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) filesTouched += 1;
    else if (line.startsWith("+") && !line.startsWith("+++")) linesAdded += 1;
    else if (line.startsWith("-") && !line.startsWith("---")) linesRemoved += 1;
  }
  return { filesTouched, linesAdded, linesRemoved };
}
