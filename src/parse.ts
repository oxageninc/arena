/**
 * Envelope-parsing helpers shared by all adapters. Pure functions, unit-tested
 * without spawning any agent binary.
 */

/** Coerce an unknown JSON value into a finite non-negative number, else fallback. */
export function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : fallback;
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
 * Headless agent CLIs print either a single JSON object or JSONL (one event
 * per line). We want the last `type: "result"` object, falling back to the
 * last parseable object. Banners and log lines are ignored.
 */
export function parseJsonEnvelope(
  stdout: string,
): Record<string, unknown> | null {
  if (!stdout) return null;

  const lines = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("{"));

  let fallback: Record<string, unknown> | null = null;

  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const obj: unknown = JSON.parse(lines[i] as string);
      if (!isRecord(obj)) continue;
      if (fallback === null) fallback = obj;
      if (obj["type"] === "result") return obj;
    } catch {
      // Not a complete JSON object line — skip.
    }
  }

  return fallback;
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
