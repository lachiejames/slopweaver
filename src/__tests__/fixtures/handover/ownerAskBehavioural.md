---
slug: fixture-owner-ask-behavioural
status: done
artifact: null
statusSummary: "A fixture, not real work. It is the half that must PASS: without it a gate refusing everything would be indistinguishable from a gate that works."
summary: "OWNER ASK: a fixture doc carrying a probe that runs a verb, so the behavioural-probe gate must stand down. Never edit this to remove the command probe — the doc IS the assertion."
doneWhen:
  - command: "slopweaver doctor | grep -q main-checkout"
---

# Fixture — an owner ask held up by nothing, because its probe runs the product

`handover check --doc` on this file must NOT print `records an owner ask`. See
`src/handover/behaviouralProbe.ts` for the rule.
