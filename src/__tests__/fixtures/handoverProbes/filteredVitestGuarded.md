---
slug: fixture-filtered-vitest-guarded
status: done
artifact: null
summary: "A fixture, not real work. Its `command:` probe filters vitest by a directory and carries --passWithNoTests=false, so `handover check` must NOT flag it. Never remove the flag here — the doc IS the assertion that a guarded probe passes clean."
doneWhen:
  - command: yarn vitest run --config config/vitest/unit.ts --passWithNoTests=false src/__tests__/unit/doesNotExist
---

# Fixture — a filtered vitest probe correctly guarded

`handover check --doc` on this file must report no findings. See `src/handover/check.ts`'s
`checkFilteredVitestProbes`.
