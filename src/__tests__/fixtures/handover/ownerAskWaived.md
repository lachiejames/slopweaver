---
slug: fixture-owner-ask-waived
status: done
artifact: null
probeWaiver: "the work landed on the private work repository; no probe runnable from this checkout can falsify it — see docs/constraints/partition.md"
statusSummary: "A fixture, not real work. It is the owner's escape hatch made checkable: a waiver must be reported, never silently pass."
summary: "OWNER ASK: a fixture doc that genuinely cannot carry a behavioural probe, so it records why instead. Never edit this to remove the probeWaiver — the doc IS the assertion."
doneWhen:
  - command: "test -f README.md"
---

# Fixture — an owner ask whose waiver is on the record

`handover check --doc` on this file must print `WAIVED` and the reason, and must still exit 0. See
`src/handover/behaviouralProbe.ts` for the rule.
