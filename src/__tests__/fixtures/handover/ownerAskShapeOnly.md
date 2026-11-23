---
slug: fixture-owner-ask-shape-only
status: done
artifact: null
statusSummary: "A fixture, not real work. It exists so the behavioural-probe gate can be exercised through the real `handover check` door rather than only through its own unit tests."
summary: "OWNER ASK: a fixture doc whose only probe checks a shape, so the behavioural-probe gate must refuse it. Never edit this to add a behavioural probe — the doc IS the assertion."
doneWhen:
  - command: "test -f README.md"
---

# Fixture — an owner ask held up by a shape-only probe

`handover check --doc` on this file must print `records an owner ask`. See
`src/handover/behaviouralProbe.ts` for the rule.
