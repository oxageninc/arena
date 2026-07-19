/**
 * End-to-end pipeline test with the mock adapter: no API keys, no network.
 * Exercises workspace seeding, held-out verification, agent-error detection,
 * result persistence, and report generation.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

import { executeRun } from "../src/orchestrator.js";
import { generateReport } from "../src/report.js";
import { applySolution, loadTasks, runVerification, seedWorkspace } from "../src/workspace.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const TASK_ROOT = join(HERE, "..", "tasks");

const scratchDirs: string[] = [];
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "arena-test-"));
  scratchDirs.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true });
});

describe("task fixtures", () => {
  const tasks = loadTasks(TASK_ROOT);

  it("loads all tasks with matching ids", () => {
    expect(tasks.length).toBeGreaterThanOrEqual(6);
    for (const task of tasks) {
      expect(task.dir.endsWith(task.id)).toBe(true);
    }
  });

  it("every task discriminates: pristine fails, solution passes", async () => {
    for (const task of tasks) {
      const pristineDir = scratch();
      await seedWorkspace(task, pristineDir);
      const pristine = await runVerification(task, pristineDir);
      expect(
        pristine.passed,
        `${task.id}: held-out tests must FAIL on the pristine workspace`,
      ).toBe(false);

      const solvedDir = scratch();
      await seedWorkspace(task, solvedDir);
      await applySolution(task, solvedDir);
      const solved = await runVerification(task, solvedDir);
      expect(solved.passed, `${task.id}: reference solution must pass:\n${solved.output}`).toBe(
        true,
      );
    }
  }, 300_000);

  it("verification removes agent-planted .arena-verify content", async () => {
    const task = loadTasks(TASK_ROOT)[0]!;
    const dir = scratch();
    await seedWorkspace(task, dir);
    // Simulate an adversarial agent planting a trivially-green test suite.
    const planted = join(dir, ".arena-verify");
    mkdirSync(planted, { recursive: true });
    writeFileSync(
      join(planted, "fake.test.mjs"),
      'import { test } from "node:test"; test("ok", () => {});',
    );
    const result = await runVerification(task, dir);
    expect(result.passed).toBe(false);
  });
});

describe("full run with mock agents", () => {
  it("scores solve vs fail correctly and generates a defensible report", async () => {
    const outDir = scratch();
    const tasks = loadTasks(TASK_ROOT).slice(0, 2);

    const { runDir, manifest, results } = await executeRun({
      agents: [
        { adapter: "mock", model: "solve" },
        { adapter: "mock", model: "fail" },
      ],
      tasks,
      trials: 2,
      timeoutSeconds: 60,
      seed: 42,
      outDir,
    });

    expect(results).toHaveLength(2 * 2 * 2); // tasks × agents × trials

    const solved = results.filter((r) => r.agent.model === "solve");
    const failed = results.filter((r) => r.agent.model === "fail");
    expect(solved.every((r) => r.outcome === "passed")).toBe(true);
    expect(failed.every((r) => r.outcome === "failed")).toBe(true);

    // Receipts exist for every trial.
    for (const r of results) {
      expect(existsSync(join(runDir, r.transcriptPath))).toBe(true);
      expect(existsSync(join(runDir, r.diffPath))).toBe(true);
    }
    // The solving agent produced a real diff; the failing agent produced none.
    expect(solved[0]!.activity.filesTouched).toBeGreaterThan(0);
    expect(failed[0]!.activity.filesTouched).toBe(0);

    // Manifest flags the unmatched "models" (solve vs fail differ).
    expect(manifest.matchedModels).toBe(false);
    expect(manifest.reproduceCommand).toContain("--seed 42");

    const report = generateReport(runDir);
    expect(report).toContain("Unmatched models");
    expect(report).toContain("McNemar");
    expect(report).toContain(manifest.reproduceCommand);

    const persisted = JSON.parse(readFileSync(join(runDir, "results.json"), "utf8"));
    expect(persisted.results).toHaveLength(results.length);
  }, 300_000);

  it("surfaces a spawn failure as spawnError (classified agent-error, never a loss)", async () => {
    const { StellaAdapter } = await import("../src/adapters/stella.js");
    const adapter = new StellaAdapter({ bin: "/nonexistent/definitely-missing" });
    const outcome = await adapter.execute({
      prompt: "x",
      model: "zai/glm-5.2",
      budgetUsd: undefined,
      timeoutSeconds: 5,
      workDir: scratch(),
      taskDir: scratch(),
    });
    expect(outcome.spawnError).toBeDefined();
  });
});
