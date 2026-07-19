# Methodology

This document is the contract behind any number produced with Arena. If a published claim violates it, the claim — not the reader — is wrong.

## What a run measures

One run executes N agents × T tasks × K trials. Every trial:

1. **Seed** — the task's `workspace/` fixture is copied to a fresh temp directory, committed to a fresh git repo. `TASK.md` contains the identical prompt every agent receives.
2. **Agent** — the agent CLI runs headlessly in that directory with the shared model/budget/timeout. Arguments are passed as argv arrays (no shell).
3. **Diff** — `git diff` against the seed commit captures exactly what the agent changed.
4. **Verify** — the harness deletes anything at `.arena-verify/`, copies the task's held-out `verify/` tests in, and runs them with `node --test`. The tests were never on disk while the agent ran.
5. **Score** — `timeout` if the agent hit the wall-clock cap (takes precedence: exceeding the matched budget never scores as a win, even if the tests pass on whatever state the kill left behind). Otherwise `passed` iff the held-out tests pass. `agent-error` if the CLI could not be invoked at all (spawn failure, or non-zero exit with zero diff and zero tokens) — these are harness-side failures, excluded from every comparison and listed separately.

## Fairness controls

- **Matched configuration.** One `--model`, `--budget`, `--timeout` for all agents. Per-agent model overrides are possible (`--agents a=m1,b=m2`) but stamp the manifest `matchedModels: false` and the report leads with a warning: such runs conflate harness quality with model quality and must not back harness-vs-harness claims.
- **Ordering.** Agents interleave within each task and the order reverses on alternate trials (ABBA), so provider load drift cannot systematically favor one agent. Trials run sequentially — wall-clock numbers are never measured under host contention.
- **Autonomy parity.** Each adapter runs its CLI at the closest available autonomy level (auto-approve file edits, non-interactive). The exact flags are in each adapter's header comment and recorded in the manifest via the CLI version.

## Metric definitions

- **Accuracy** — fraction of scored trials (excluding `agent-error`) whose held-out tests pass. Reported with a 95% Wilson interval.
- **Speed** — wall-clock seconds from spawn to exit, measured by the harness clock (the agent's self-reported duration is recorded separately, never used for comparison).
- **Tokens** — normalized: `input` excludes cache reads; `cacheRead`/`cacheWrite` tracked separately; `total = input + output + cacheRead + cacheWrite`. Per-adapter normalization rules are documented in the adapter source (e.g. oxagen and gemini report combined input, so cached tokens are subtracted; Claude Code already reports them separately).
- **Cost** — two numbers, never merged: `computedUsd` (one shared `pricing.json` applied to normalized tokens; null when the model has no entry — Arena never prices one vendor's tokens with another's rate card) and `agentReportedUsd` (whatever the CLI claimed).

## Statistics

- Success rates: **Wilson score intervals** (95%).
- Head-to-head success: **exact McNemar test** on paired (task, trial) outcomes — the correct test when both agents attempt identical work items. Discordant-pair counts are printed so readers can recompute it by hand.
- Continuous metrics (wall clock, tokens, cost): **paired bootstrap** (2000 resamples, seeded PRNG) percentile CIs on the relative difference in medians. Deterministic given the raw trials and the run seed.
- **No blended score.** "X% better" claims must name one metric and carry its CI.

## What it takes to publish "Agent A beats Agent B"

1. Same model on every agent (`matchedModels: true` in the manifest).
2. Task set and trial count committed **before** running (pre-registration — link the commit).
3. Enough trials that the McNemar p-value on success (or the bootstrap CI on your claimed metric) excludes chance at α = 0.05. The report tells you when it doesn't.
4. Publish the entire run directory: manifest, per-trial JSON, transcripts, diffs, report.
5. Disclose conflicts of interest (e.g. "we build Agent A") and pin CLI versions in the text.
6. Invite reruns: the manifest's reproduce command must work for a stranger with their own API keys.

## Known limitations

- The built-in task suite is small and JavaScript-only — a fast, cheap calibration set. Treat its results as directional, not as a research-grade resolve rate.
- Hidden tests can only assert behavior stated in the prompt; prompts therefore fully specify the contract. Agents that guess unstated conventions are neither rewarded nor punished.
- Wall-clock speed depends on provider-side load; ABBA interleaving and multiple trials mitigate but cannot eliminate this. Report medians, not means.
- Budget flags are passed to agents that support them (`claude --max-budget-usd`, `oxagen --budget`); agents without a budget flag are bounded by the timeout only. The manifest records exactly what was passed.

## Scaling up

For headline resolve-rate claims, run this same protocol over [SWE-bench Verified](https://github.com/SWE-bench/SWE-bench) with a containerized runner and the **official** evaluator, with a pre-registered instance list (published random seed over the 500 verified instances, n ≥ 100). Arena's local suite is for harness development, smoke comparisons, and metric plumbing — the statistics and receipt discipline are identical either way.

The [`harbor/`](harbor/) adapter is how you do this: it plugs any agent into [Harbor](https://www.harborframework.com/), whose Docker verifier runs each task's own FAIL_TO_PASS / PASS_TO_PASS suite — the agent never sees the grader. Because Harbor already bundles the industry-leading agents (Claude Code, Gemini, Codex, Cursor, Aider, …), a matched-model run of your agent against those built-ins is a fair, official-scored, receipted comparison — exactly the bar this document sets, at research scale. The adapter's token/cost numbers are annotations; the resolve-rate from Harbor's verifier is the score.

## Tracking drift over time

A comparison is a snapshot; a **baseline** turns it into a tripwire. `arena baseline save` records a run's per-agent resolve rate (with its Wilson interval), median tokens, cost, and wall clock; `arena gate` re-measures a later run and exits non-zero when it regresses past your thresholds. Two rules keep the gate honest, consistent with everything above:

- **Compare like with like.** The gate refuses to run when the new task set differs from the baseline's — a resolve-rate diff across different problems is meaningless — unless you explicitly opt in.
- **Don't cry wolf on noise.** With `--require-significant`, an accuracy drop only fails once it clears the 95% CIs (baseline's lower bound above the new run's upper bound). Point-estimate mode is available for a strict "no drop at all" gate, but with small `n` that flakes; raise `--trials` or require significance.

The baseline is a committed JSON artifact, so a regression shows up as a red check on the PR that caused it — the same day, not months later when someone re-benchmarks.
