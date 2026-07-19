<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/logo-icon-dark.svg">
  <img src="assets/logo-icon.svg" alt="Arena — two nested stadium shapes" width="76">
</picture>

# Arena

[![CI](https://github.com/oxageninc/arena/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/oxageninc/arena/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/oxageninc/arena/badge)](https://scorecard.dev/viewer/?uri=github.com/oxageninc/arena)

**Head-to-head benchmarks for agentic coding CLIs — built to survive scrutiny.** · [arena.oxagen.sh](https://arena.oxagen.sh)

Arena runs two or more coding agents (Claude Code, Gemini CLI, [Oxagen](https://oxagen.sh), [Stella](https://github.com/oxageninc/stella), or your own) on the **same tasks, same model, same budget, same timeout**, grades them with **held-out tests the agent can never see or author**, and reports each metric separately with real statistics and full receipts.

```bash
git clone https://github.com/oxageninc/arena
cd arena && pnpm install

pnpm arena doctor    # which agent CLIs are installed?
pnpm arena list      # available tasks

# The only comparison that isolates the harness: same model everywhere.
pnpm arena run \
  --agents oxagen,claude-code \
  --model anthropic/claude-sonnet-5 \
  --trials 3 --budget 5

open results/run-*/report.md
```

## Why another benchmark?

Because most agent-vs-agent numbers don't survive five minutes of skeptical reading. Arena is engineered around the specific ways benchmarks get (rightly) torn apart:

| Attack | Arena's defense |
|---|---|
| "The agent graded itself" | Verification tests live **outside** the workspace, are copied in only **after** the agent exits, and anything the agent planted at the verify path is deleted first. CI proves every task's tests **fail on the pristine workspace** and **pass on the reference solution**. |
| "Different models / budgets / timeouts" | One config drives every agent. Runs with unmatched models are stamped `matchedModels: false` and the report leads with a warning banner. |
| "Your harness broke the competitor" | A CLI that can't even be invoked is scored **`agent-error`** and excluded from every comparison — it is never counted as the agent losing. |
| "Token counts aren't comparable" | Adapters normalize usage: `input` never includes cache reads; cache reads/writes are tracked separately. Documented per adapter. |
| "You priced their tokens wrong" | One shared pricing table applied to every agent; models without an entry get **no** computed cost (never a guessed one). Agent-self-reported cost is shown alongside. |
| "n=1" / "no stats" | Multiple trials per (task, agent); Wilson 95% CIs on success rates; **exact McNemar** on paired outcomes; seeded paired-bootstrap CIs on wall-clock/token/cost deltas. Deterministic: same raw data + seed ⇒ same report, bit for bit. |
| "First-mover advantage / time-of-day drift" | Agents interleave and their order flips every trial (ABBA). Tasks run sequentially so agents never contend for the host. |
| "Where's the raw data?" | Every trial writes its full stdout/stderr transcript, workspace diff, and a manifest with CLI versions, models, host, seed, and a one-line reproduce command. |

## Supported agents

| Adapter | Invocation | Status |
|---|---|---|
| `claude-code` | `claude -p --output-format json --permission-mode acceptEdits` | verified |
| `oxagen` | `oxagen --local --output-format json -- <prompt>` | verified |
| `stella` | `stella run <prompt>` + `STELLA_*` env | verified |
| `gemini` | `gemini -p <prompt> --output-format json --approval-mode auto_edit` | envelope-tested; re-verify flags against your installed version |
| `mock` | in-process (CI / smoke) | built-in |

Autonomy levels are matched as closely as each CLI allows (auto-approve edits, no interactive prompts). Binary overrides: `--agents oxagen …` + `ARENA_OXAGEN_BIN=/path/to/oxagen`, etc. API keys come from each CLI's normal environment (`ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `ZAI_API_KEY`, …).

### Adding your agent

Implement one small adapter (see `src/adapters/`): how to invoke your CLI headlessly in a directory, and how to map its output envelope to normalized tokens. ~80 lines; PRs welcome. Your agent must run non-interactively and edit files in the working directory.

## Tasks

Tasks are self-contained fixtures under `tasks/<id>/`:

```
tasks/bug-merge-intervals/
├── task.json      # the full behavior contract given to every agent
├── workspace/     # real starting code (buggy or stubbed)
├── verify/        # held-out node:test suite — never visible to the agent
└── solution/      # reference solution proving the task is solvable
```

Two invariants, enforced by `pnpm arena verify` in CI:

1. The held-out tests **fail** against the pristine workspace (no tautological tasks).
2. They **pass** against the reference solution (no impossible tasks).

The prompt states the complete behavior contract; the hidden tests assert only what the prompt states. Verification needs nothing but Node — no npm installs inside workspaces, no network.

The built-in suite is deliberately small, fast, and cheap — a calibration set, not a research benchmark. For publishable resolve-rate claims, run at scale on SWE-bench Verified with the **Harbor adapter** below.

## Scale up: SWE-bench Verified via Harbor

[`harbor/`](harbor/) is a [Harbor](https://www.harborframework.com/) adapter that runs **your** agent through Harbor's official, containerized SWE-bench / Terminal-Bench verifier — head-to-head against the industry-leading agents Harbor already ships (`claude-code`, `gemini-cli`, `codex`, `cursor-cli`, `aider`, …), all scored by the same repo-native test suite.

Wire up your agent with one spec file — no Python:

```bash
cd harbor && pip install -e .
export ARENA_AGENT_SPEC=$PWD/my-agent.toml    # copy specs/byo.example.toml
harbor run --agent-import-path arena_harbor:ByoAgent \
  --dataset swe-bench/swe-bench-verified -m anthropic/claude-sonnet-5 -n 4
# then the same run with --agent claude-code, and compare resolved counts.
```

Ships with `ByoAgent` (bring your own) plus `OxagenAgent` / `StellaAgent` specs. Same model, same dataset, same official verifier — the harness is the only variable. See [`harbor/README.md`](harbor/README.md) and [METHODOLOGY.md](METHODOLOGY.md#scaling-up).

## Reading the report

`results/<run>/report.md` contains: per-agent success rates with Wilson CIs; head-to-head paired outcomes with the exact McNemar p-value; median wall-clock/token/cost deltas with bootstrap CIs; a per-task, per-trial outcome matrix; excluded `agent-error` trials; and the reproduce command. **Each metric is reported separately — Arena never emits a blended score.**

Before you publish a number, read [METHODOLOGY.md](METHODOLOGY.md). Short version: same model on every agent, pre-committed task set and trial count, p < 0.05 on the metric you're claiming, raw run directory published, and a conflict-of-interest note if you built one of the agents.

## Track drift: the regression gate

Benchmarks aren't only for bragging — they keep your own agent from silently getting worse. Snapshot a run as a **baseline**, then fail CI when a later run regresses past your thresholds:

```bash
# 1. Establish the baseline from a good run and commit it.
pnpm arena run --agents mine --model anthropic/claude-sonnet-5 --trials 5 -o results
pnpm arena baseline save results/run-… --agent mine        # writes arena-baseline.json
git add arena-baseline.json && git commit -m "arena: baseline"

# 2. In CI, re-run and gate. Non-zero exit = regression.
pnpm arena run --agents mine --model anthropic/claude-sonnet-5 --trials 5 -o results
pnpm arena gate results/run-… --require-significant
```

The gate compares the new run to the baseline per agent and fails on:

- **accuracy** — resolve rate dropped past `--accuracy-drop` (default: any drop). With `--require-significant` a drop only fails once it clears 95% CI noise, so small-`n` jitter doesn't red-flag CI.
- **tokens / cost** — median rose past `--tokens-increase` (10%) / `--cost-increase` (15%).
- **speed** — median wall-clock, reported by default, enforced with `--speed-increase`.

It refuses to compare across different task sets (a meaningless resolve-rate diff) unless you pass `--allow-task-mismatch`. Thresholds can also live in an `arena-gate.json` file. A ready-to-copy workflow is in [`examples/regression-gate.yml`](examples/regression-gate.yml).

## Development

```bash
pnpm install
pnpm typecheck
pnpm test            # unit + end-to-end pipeline (mock agents, no API keys)
pnpm arena verify    # audit every task's discrimination invariants
```

Contributions welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) (adding an
adapter or task fixture is a great first PR). We also have a
[Code of Conduct](.github/CODE_OF_CONDUCT.md) and a
[changelog](CHANGELOG.md). Report security issues privately via the repo's
[Security tab](https://github.com/oxageninc/arena/security/advisories/new) — not
as a public issue.

MIT © Mac Anderson
