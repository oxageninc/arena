# Changelog

All notable changes to Arena are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html) (pre-1.0:
minor bumps may include breaking changes).

## [Unreleased]

### Added
- Open-source launch artifacts: `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, issue
  and PR templates, and this changelog.
- `.stella/` agent caches are now gitignored.
- **Site** (`site/`) — arena.oxagen.sh: landing page, the research paper
  *The State of Agent Benchmarking*, and the draft **Agent Benchmark Protocol**
  spec (`docs/agent-benchmark-protocol.md`,
  `docs/agent-engine-benchmarks-2026.md`).
- Pretty-printed (multi-line) JSON envelopes are now parsed — both in the TS
  harness (`parseJsonEnvelope`) and the Harbor adapter (`last_json_object`).
- `arena run -o <dir>` short flag (the form the README documents).

### Fixed
- **Timeouts kill the agent's whole process tree** (POSIX process groups), and
  a trial can no longer hang on stdio pipes held open by orphaned
  grandchildren — which could previously also outlive the agent and tamper
  with verification.
- **Zero-token trials no longer poison medians or the gate**: scored trials
  whose envelope had no parseable usage are excluded from token/cost medians
  and deltas (reported separately), instead of dragging them toward zero.
- **claude-code model pinning**: `anthropic/claude-sonnet-5` now resolves to
  `claude-sonnet-5` instead of the floating `sonnet` alias, preserving version
  pinning, `matchedModels`, and pricing lookups.
- **Gemini token normalization** counts `thoughts` (reasoning) and `tool`
  tokens; both were previously dropped, understating Gemini usage.
- Per-trial error containment: a harness-side failure (git/FS error) scores
  that one trial `agent-error` instead of aborting the run; `results.json` is
  rewritten after every trial so a crash never loses completed trials.
- Wall clock now measures spawn-to-exit only (workspace seeding excluded),
  matching METHODOLOGY.md.
- `arena verify <unknown-id>` errors instead of vacuously passing; numeric
  CLI flags are validated (`--timeout 10m` errors instead of parsing as 10);
  a typo'd gate threshold errors instead of silently disabling the check;
  duplicate `--agents` specs are rejected (their trial ids would collide).
- `git diff` failures are now distinguished from an empty diff, so a trial
  with real changes can no longer be misclassified `agent-error`.
- Cache-write tokens with no `cacheWritePerM` price now yield a null cost
  (never guessed with the input rate).
- Report per-agent table shares `perAgentSummary` with the baseline/gate (no
  more NaN rows when every trial of an agent errored).
- Harbor adapter: non-integer `ARENA_TIMEOUT` falls back to 1800s with a
  warning instead of silently disabling the container timeout; an empty
  `{budget}` in a run template fails loudly; unknown `metrics.kind` values are
  rejected at spec load.

## [0.1.0] — initial release

The first public release: a head-to-head benchmark harness for agentic coding
CLIs, engineered to survive scrutiny.

### Added
- **Core harness** — orchestrates two or more agents on the same task, model,
  budget, and timeout, with interleaved (ABBA) ordering that flips every trial.
  Tasks run sequentially so agents never contend for the host.
- **Held-out verification** — verification tests live outside the workspace,
  are copied in only after the agent exits, and anything the agent planted at the
  verify path is deleted first. `arena verify` proves every task's tests
  **fail on the pristine workspace** and **pass on the reference solution**.
- **Adapters** — `claude-code`, `gemini`, `oxagen`, `stella`, and an in-process
  `mock` for CI. Token usage is normalized so `tokens.input` never includes cache
  reads; cache reads/writes tracked separately. A CLI that can't be invoked is
  scored `agent-error` and excluded from every comparison.
- **Statistics** — multiple trials per (task, agent); Wilson 95% CIs on success
  rates; **exact McNemar** on paired outcomes; seeded paired-bootstrap CIs on
  wall-clock / token / cost deltas. Deterministic: same raw data + seed ⇒ same
  report, bit for bit. Each metric reported separately — never a blended score.
- **Pricing** — one shared pricing table (`pricing.json`) applied to every agent;
  models without an entry get **no** computed cost (never a guessed one).
- **Receipts** — every trial writes full stdout/stderr transcripts, a workspace
  diff, and a manifest with CLI versions, models, host, seed, and a one-line
  reproduce command.
- **Regression gate** — `arena baseline save` snapshots a run; `arena gate`
  fails CI when accuracy drops (with `--require-significant` to clear CI noise),
  or tokens/cost/speed drift past configurable thresholds.
- **CLI** — `arena list | doctor | run | report | verify | baseline | gate`.
- **Harbor adapter** (`harbor/`) — run **your** agent through Harbor's official,
  containerized SWE-bench / Terminal-Bench verifier head-to-head against the
  built-ins. Ships with `ByoAgent` (bring your own) plus `OxagenAgent` /
  `StellaAgent` specs. No Python required to add an agent.

### Security & supply chain
- Least-privilege CI, pinned GitHub Actions, [OpenSSF Scorecard](https://github.com/ossf/scorecard-action),
  Dependabot, and a dependency-review gate that blocks known-vulnerable PRs.
- `SECURITY.md` with a private vulnerability reporting channel.

[Unreleased]: https://github.com/macanderson/arena/compare/5122005...HEAD
[0.1.0]: https://github.com/macanderson/arena/releases/tag/v0.1.0
