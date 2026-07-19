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
 * Headless agent CLIs print a single JSON object (compact or pretty-printed —
 * gemini-cli pretty-prints), or JSONL (one event per line), often surrounded
 * by banners and log lines. We want the last `type: "result"` object, falling
 * back to the last parseable object.
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

/** Split text into top-level `{…}` runs, brace-matched and JSON-string-aware. */
function topLevelJsonBlocks(text: string): string[] {
  const blocks: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      if (depth > 0) inString = true;
    } else if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}" && depth > 0) {
      depth--;
      if (depth === 0 && start !== -1) {
        blocks.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return blocks;
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
