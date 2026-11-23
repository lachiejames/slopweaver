---
slug: fixture-filtered-vitest-false-green
status: done
artifact: null
summary: "A fixture, not real work. Its `command:` probe filters vitest by a directory with no --passWithNoTests=false, so `handover check` must flag it. Never add the flag here — the doc IS the assertion that the check catches its absence."
doneWhen:
  - command: yarn vitest run --config config/vitest/unit.ts src/__tests__/unit/doesNotExist
---

# Fixture — a filtered vitest probe with no --passWithNoTests=false

`handover check --doc` on this file must report that the probe names a path filter with no
`--passWithNoTests=false`. See `src/handover/check.ts`'s `checkFilteredVitestProbes`.
