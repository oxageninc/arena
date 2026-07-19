/**
 * Workspace lifecycle: seed → agent runs → diff → held-out verify.
 *
 * The anti-self-grading invariant lives here: the `verify/` directory of a
 * task is NEVER present while the agent runs. After the agent finishes, the
 * harness deletes anything at `.arena-verify/` (so an agent cannot pre-plant
 * its own grader there), copies the held-out tests in, and runs them with
 * Node's built-in test runner. Success is decided only by those tests.
 */

import { execFile } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { isRecord } from "./parse.js";
import type { LoadedTask, TaskDef } from "./types.js";

const execFileAsync = promisify(execFile);

const VERIFY_DIR = ".arena-verify";

/** Load tasks/<id>/ directories under a task root (sync: startup-time config read). */
export function loadTasks(taskRoot: string): LoadedTask[] {
  const tasks: LoadedTask[] = [];
  for (const entry of readdirSync(taskRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(taskRoot, entry.name);
    const defPath = join(dir, "task.json");
    if (!existsSync(defPath)) continue;
    const def: unknown = JSON.parse(readFileSync(defPath, "utf8"));
    if (!isRecord(def) || typeof def["id"] !== "string") {
      throw new Error(`Malformed task.json in ${dir}`);
    }
    if (def["id"] !== entry.name) {
      throw new Error(
        `Task id "${String(def["id"])}" must match its directory name "${entry.name}"`,
      );
    }
    tasks.push({ ...(def as unknown as TaskDef), dir });
  }
  return tasks.sort((a, b) => a.id.localeCompare(b.id));
}

/** The exact prompt every agent receives for a task. */
export function buildPrompt(task: TaskDef): string {
  return [
    `# ${task.name}`,
    "",
    task.prompt.trim(),
    "",
    "Work only inside the current directory. Verification is run by the",
    "harness after you finish; it asserts exactly the behavior described",
    "above. Do not create or modify anything under `.arena-verify/`.",
  ].join("\n");
}

/**
 * Materialize the starting workspace: a copy of the task's `workspace/`
 * fixture plus TASK.md, committed to a fresh git repo so `git diff` isolates
 * exactly the agent's changes.
 */
export async function seedWorkspace(task: LoadedTask, workDir: string): Promise<void> {
  await mkdir(workDir, { recursive: true });
  await cp(join(task.dir, "workspace"), workDir, { recursive: true });
  await writeFile(join(workDir, "TASK.md"), `${buildPrompt(task)}\n`);
  await writeFile(
    join(workDir, ".gitignore"),
    `${["node_modules/", "dist/", "coverage/", "*.log", `${VERIFY_DIR}/`].join("\n")}\n`,
  );
  const git = async (args: string[]): Promise<void> => {
    await execFileAsync("git", args, { cwd: workDir });
  };
  await git(["init", "-q"]);
  await git(["config", "user.email", "arena@localhost"]);
  await git(["config", "user.name", "arena"]);
  // Host-level commit.gpgsign=true would make the seed commit prompt or fail.
  await git(["config", "commit.gpgsign", "false"]);
  await git(["add", "-A"]);
  await git(["commit", "-q", "-m", "arena: seed workspace", "--no-verify"]);
}

/** Diff of the agent's changes (tracked + new files) against the seed commit. */
export async function collectDiff(workDir: string): Promise<string> {
  try {
    await execFileAsync("git", ["add", "-A"], { cwd: workDir });
    const { stdout } = await execFileAsync("git", ["diff", "--cached", "HEAD"], {
      cwd: workDir,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    return stdout;
  } catch {
    return "";
  }
}

export interface VerifyResult {
  passed: boolean;
  output: string;
}

/**
 * Run the task's held-out tests inside the workspace with `node --test`.
 * Any pre-existing `.arena-verify/` content (agent-planted or stale) is
 * removed first.
 */
export async function runVerification(task: LoadedTask, workDir: string): Promise<VerifyResult> {
  const target = join(workDir, VERIFY_DIR);
  await rm(target, { recursive: true, force: true });
  await cp(join(task.dir, "verify"), target, { recursive: true });

  const timeoutMs = (task.verifyTimeoutSeconds ?? 60) * 1000;
  // node --test needs a glob, not a bare directory (a directory arg is
  // treated as a module entry point and fails with MODULE_NOT_FOUND).
  // FORCE_COLOR (injected by pnpm) overrides NO_COLOR, so drop it.
  const { FORCE_COLOR: _forceColor, ...baseEnv } = process.env;
  const env = { ...baseEnv, NO_COLOR: "1" };
  try {
    const { stdout } = await execFileAsync(
      process.execPath,
      ["--test", `${VERIFY_DIR}/**/*.test.mjs`],
      {
        cwd: workDir,
        encoding: "utf8",
        timeout: timeoutMs,
        maxBuffer: 16 * 1024 * 1024,
        env,
      },
    );
    return { passed: true, output: tail(stdout) };
  } catch (error) {
    const e = error as { stdout?: string | Buffer; stderr?: string | Buffer; message?: string };
    const out = [
      e.stdout ? e.stdout.toString() : "",
      e.stderr ? e.stderr.toString() : "",
      e.message ?? "",
    ]
      .filter(Boolean)
      .join("\n");
    return { passed: false, output: tail(out) };
  } finally {
    await rm(target, { recursive: true, force: true });
  }
}

/** Copy the reference solution over a workspace (used by `arena verify`). */
export async function applySolution(task: LoadedTask, workDir: string): Promise<void> {
  await cp(join(task.dir, "solution"), workDir, { recursive: true });
}

function tail(text: string, maxChars = 4000): string {
  const trimmed = text.trim();
  return trimmed.length <= maxChars ? trimmed : `…${trimmed.slice(-maxChars)}`;
}
