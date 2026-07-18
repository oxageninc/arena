---
name: Feature request
about: Suggest a new adapter, task, metric, or workflow
title: "[feat] "
labels: ["enhancement"]
---
## What and why

<!-- What do you want to add or change, and what problem does it solve? -->

## Kind

<!-- Check one -->

- [ ] New agent adapter (`src/adapters/`)
- [ ] New task fixture (`tasks/`)
- [ ] New metric or report output
- [ ] CLI / workflow improvement
- [ ] Harbor adapter (`harbor/`)
- [ ] Other

## Fairness impact (important)

Arena's value is defensible, comparable measurement. Could this change affect
fairness — token normalization, what counts as success, matched configs,
determinism? If so, how do we keep it fair by construction?

<!--
Example: a new adapter must normalize tokens.input to exclude cache reads;
a new task must pass `pnpm arena verify` (held-out tests fail-pristine and
pass-solution); a new stat must be reproducible bit-for-bit from raw data + seed.
-->

## Out of scope

<!-- What this feature explicitly does NOT include, to keep the change focused. -->
