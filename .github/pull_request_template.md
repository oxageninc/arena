<!-- Thanks for contributing! Keep this PR focused — one adapter, task, or fix. -->

## Summary

<!-- What does this PR change and why? Reference the issue: Closes #N. -->

## Fairness & correctness checklist

Arena's value is defensible, comparable measurement. Confirm what applies:

- [ ] **No behavior change** (docs/chore/refactor only)
- [ ] **New/existing adapter** — `tokens.input` excludes cache reads; an
      un-invokable CLI scores `agent-error` (never counted as a loss)
- [ ] **New/existing task** — passes `pnpm arena verify`: held-out tests
      **fail** on the pristine workspace and **pass** on the solution; runs on
      plain Node with no network and no in-workspace install
- [ ] **Stats / report change** — output is reproducible bit-for-bit from the
      same raw data + seed; a test pins it (see `test/stats.test.ts`)

## Testing

<!-- Which of these did you run? All four is what CI runs. -->

- [ ] `pnpm typecheck`
- [ ] `pnpm lint`
- [ ] `pnpm test`
- [ ] `pnpm arena verify`

## Notes for reviewers

<!-- Anything non-obvious: tradeoffs, follow-ups, why an invariant had to bend. -->
