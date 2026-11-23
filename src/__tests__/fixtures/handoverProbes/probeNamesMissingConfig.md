---
slug: fixture-probe-names-missing-config
status: done
artifact: null
summary: "A fixture, not real work. Its `command:` probe names a `--config` path that does not exist on disk, so `handover check` must flag it. Never edit this to point at a real config — the doc IS the assertion."
doneWhen:
  - command: "yarn vitest run --config vitest.unit.config.ts --passWithNoTests=false src/__tests__/unit/handover/check.test.ts"
---

# Fixture — a probe naming a `--config` path that moved

`handover check --doc` on this file must report that `vitest.unit.config.ts` does not exist. See
`src/handover/check.ts`'s `checkProbeConfigPaths`.
