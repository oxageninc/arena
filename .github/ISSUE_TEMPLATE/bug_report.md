---
name: Bug report
about: Something in Arena is broken or produces wrong results
title: "[bug] "
labels: ["bug"]
---
## What happened?

<!-- A clear description of what went wrong, including any error output. -->

## What did you expect?

<!-- The behavior you expected instead. -->

## Reproduce

<!--
The smallest reproducer you can manage. Paste the exact command(s), e.g.

  pnpm arena run --agents claude-code,oxagen --model anthropic/claude-sonnet-5 --tasks bug-paginate --trials 1

If a specific task is involved, name it. If a report looks wrong, attach or paste
the run directory's report.md and the relevant trial transcript.
-->

```
# commands here
```

## Environment

- Arena version: <!-- `git rev-parse --short HEAD` or release tag -->
- OS:
- Node version: <!-- `node --version` -->
- Agent CLI(s) and versions: <!-- e.g. `claude --version`, `gemini --version` -->

## Suspected cause (optional)

<!-- If you have a hypothesis — an adapter normalizing tokens differently, a
task whose held-out tests don't discriminate, a stat that lost determinism —
say so. We care a lot about fairness bugs and will prioritize them. -->
