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

[Unreleased]: https://github.com/oxageninc/arena/compare/5122005...HEAD
[0.1.0]: https://github.com/oxageninc/arena/releases/tag/v0.1.0
