# Contributing to Arena

Thanks for your interest in making Arena better. Arena is a benchmark harness, so
its contribution rules are a little stricter than a typical app — **correctness
and fairness are the product.** A change that subtly weakens a held-out test, an
adapter that normalizes tokens differently, or a stat that loses determinism
each undermine the one thing the project exists to provide.

## Before you write code

- **Search [open issues](https://github.com/macanderson/arena/issues) first** —
  someone may already be on it.
- For anything non-trivial (new adapter, new task, stat/report change), **open
  an issue** and sketch the approach before investing in code. A 5-minute
  alignment round saves a 2-hour review.
- This project follows the [Code of Conduct](.github/CODE_OF_CONDUCT.md). By
  participating you agree to it.

## Getting set up

Arena needs **Node 22+** and **pnpm** (the CI pins pnpm 11):

```bash
git clone https://github.com/macanderson/arena
cd arena
pnpm install
pnpm typecheck
pnpm test            # unit + end-to-end pipeline, mock agents, no API keys
pnpm arena verify    # audit every task: held-out tests fail-pristine / pass-solution
pnpm lint            # biome
```

Everything runs offline with mock agents — you do **not** need any provider API
keys to develop or test the harness. The Harbor adapter is Python; see
[`harbor/README.md`](harbor/README.md).

## What you can contribute

### Add a task fixture

Tasks live in `tasks/<id>/` and are the most common contribution. A task must
satisfy two invariants that `pnpm arena verify` enforces in CI:

1. Its held-out `verify/` tests **fail** on the pristine `workspace/` (no
   tautology), and
2. They **pass** on the `solution/` (no impossibility).

Copy an existing task directory as a template and read its `task.json` — the
prompt given to agents must state the *entire* behavior contract; the hidden
tests assert only what the prompt states. Verification must run on plain Node
with **no npm install inside the workspace and no network**. Run
`pnpm arena verify <your-task-id>` before pushing.

### Add an agent adapter

One file in `src/adapters/`, registered in `src/adapters/index.ts`. Implement
how to invoke your CLI headlessly in a directory and how to map its output
envelope to normalized tokens. Two hard rules:

- **`tokens.input` must exclude cache reads** (see how the existing adapters
  subtract cached counts). Cross-agent token comparisons are meaningless
  otherwise.
- **Adapters never decide success.** Only the harness's held-out verification
  does. An adapter that can't even be invoked is scored `agent-error` and
  excluded from comparisons — it is never counted as the agent losing.

See `src/adapters/base.ts` for the contract; the built-ins (`claude-code`,
`gemini`, `oxagen`, `stella`, `mock`) are worked examples at ~80–120 lines each.

### Improve the stats / report

Every report must be **reproducible bit-for-bit from the same raw data + seed**,
and **each metric is reported separately** — Arena never emits a blended score.
If you touch `src/stats.ts` or `src/report.ts`, add a test that pins the output
of a fixed input (see `test/stats.test.ts`) so determinism is enforced.

## Code style

- **Biome** enforces formatting and linting (`pnpm lint` / `pnpm format`).
  Don't hand-format; let the tool do it.
- **TypeScript strict** is on (`tsconfig.json`), including
  `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. Don't weaken
  these to make a type error go away — fix the code.
- Node-only: target ES2023, ESM (`"type": "module"`), NodeNext resolution.
  `.js` extensions are required in relative imports.

## Tests

- Add or update tests for any behavior change. The pipeline test
  (`test/pipeline.test.ts`) spawns real `git`/`node` subprocesses per task
  workspace, so keep task workspaces tiny and fast.
- `pnpm arena verify` is part of CI — if your task fails it, CI is red.

## Submitting

1. Fork and branch from `main`.
2. `pnpm typecheck && pnpm lint && pnpm test && pnpm arena verify` must all pass
   locally (this is exactly what CI runs).
3. Commit message format (Conventional Commits):
   `feat(adapter): add codex adapter`, `fix(stats): …`, `docs: …`,
   `test: …`, `chore: …`.
4. Open a PR against `main`. Reference the issue it closes (`Closes #123`).
   Dependency review runs automatically and blocks known-vulnerable deps.

### DCO / sign-off

By submitting, you confirm your contribution is your own and you license it
under the project's [MIT license](LICENSE). We follow the
[Developer Certificate of Origin](https://developercertificate.org/): add a
`Signed-off-by: Your Name <email>` line to your commits (`git commit -s`).
