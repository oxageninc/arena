# Agent Arena

**Head-to-head benchmarks for agentic coding CLIs — built to survive scrutiny.**

Arena runs two or more coding agents (Claude Code, Gemini CLI, [Oxagen](https://oxagen.sh), [Stella](https://github.com/macanderson/stella), or your own) on the **same tasks, same model, same budget, same timeout**, grades them with **held-out tests the agent can never see or author**, and reports each metric separately with real statistics and full receipts.

```bash
git clone https://github.com/macanderson/agent-arena
cd agent-arena && pnpm install

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

The built-in suite is deliberately small, fast, and cheap — a calibration set, not a research benchmark. For publishable resolve-rate claims, pair Arena's protocol with [SWE-bench Verified](https://github.com/SWE-bench/SWE-bench) under a containerized runner (e.g. [Harbor](https://github.com/laude-institute/harbor)) and use the official evaluator; see [METHODOLOGY.md](METHODOLOGY.md#scaling-up).

## Reading the report

`results/<run>/report.md` contains: per-agent success rates with Wilson CIs; head-to-head paired outcomes with the exact McNemar p-value; median wall-clock/token/cost deltas with bootstrap CIs; a per-task, per-trial outcome matrix; excluded `agent-error` trials; and the reproduce command. **Each metric is reported separately — Arena never emits a blended score.**

Before you publish a number, read [METHODOLOGY.md](METHODOLOGY.md). Short version: same model on every agent, pre-committed task set and trial count, p < 0.05 on the metric you're claiming, raw run directory published, and a conflict-of-interest note if you built one of the agents.

## Development

```bash
pnpm install
pnpm typecheck
pnpm test            # unit + end-to-end pipeline (mock agents, no API keys)
pnpm arena verify    # audit every task's discrimination invariants
```

MIT © Mac Anderson
