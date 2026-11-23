---
name: compliance
description: Work one compliance control from failing to passing — read what a Vanta control's own tests say is wrong, name which system actually enforces the behaviour, and say what would close the gap, evidence and policy included. Use when the ask is about a compliance control, a failing or passing Vanta test, an ISO 27001 or SOC 2 obligation, the distance to an audit fieldwork gate, a security policy document, a policy acceptance, an evidence request, an audit gap, or the organisation's compliance posture. Phrases like "what would it take to get that control passing", "why is this control failing", "what evidence does that need", "are we compliant on X", "who still owes a policy acceptance", "how far are we off the ISO gate".
argument-hint: "<control id or the question> [--entity-sample <1..10>]"
---

**This is a JOB skill, not a platform skill.** There is no `vanta` skill, because the
reach and the honesty contract are identical across every provider and only the estate facts differ. Those
contracts are [atlas](../atlas/SKILL.md)'s, and this skill defers to them rather than restating them. What it
owns is the job that spans four separate verb nouns and no single atlas: taking a control from failing to
passing, and saying truthfully what that would take.

## The one thing this skill exists to stop you doing

**Answering "what would it take" out of the control's own DESCRIPTION.** A control's description says what the
framework requires. Only its TESTS say what is wrong here, how many items are failing, by when, and which
integration reported it. An answer built from the description is fluent, plausible and worth nothing.

Measured — the finding this skill was written for. A dogfood prompt asked what
it would take to get a password policy control passing in Vanta. The turn reached the right verbs and
loaded **no skill at all** (`grounding.provenance.skillsLoaded` empty), and its answer also DECLINED two
atlases it could have read. Ranking the live catalogue against that question put the best candidate at 1.00,
under `CLEAR_OWNER_SCORE` — so the skill-load gate was right not to fire and the hole was the catalogue's.
Reproduce the hole's absence — `catalog` enumerates VERBS, so it is `ls skills/` that answers whether one
exists, and the witness test that answers whether the ask actually routes to it:

```bash
ls skills/ | grep compliance
yarn vitest run --config config/vitest/unit.ts src/__tests__/unit/canon/complianceSkillRoutes.test.ts
```

## Read the knowledge register BEFORE you read a control

Estate facts — the gotchas, the caveats, which id addresses what — are STATE and are never checked in here.
Two of the rows waiting there decide whether your answer is even addressable, so this is a step
rather than a suggestion:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" knowledge recall "<the words this ask mentions>" --domain vanta
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" knowledge list --domain vanta --tier 1
```

**The id trap, in one line, because it silently produces a wrong answer rather than an error:** a control is
PRINTED as its human `externalId` and ADDRESSED by its `providerId`, and nothing in the printed text relates
the two. Never construct one from the other — resolve it with a read (step 1). The measured evidence, and the
transient-401 race that makes a permanent-sounding Vanta failure a lie, are register rows.

## The procedure

**1 · Resolve the control, from the words the ask used.**

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" atlas vanta read --kind control --query "<words>"
```

Local, no network. Each row leads with the name Vanta gives it, carries its `providerId` on the id line, and
prints one `matched "<token>" at <path>` witness per token. **Read the witnesses before you trust a hit** — a
word buried in a boilerplate description is not the control the ask is about.

**2 · Ask the control's own tests what is wrong.** This is the spine of the whole answer.

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" atlas vanta control-evidence --control <providerId> --entity-sample 3
```

Live through the Manage API, and it FILES the evidence document it read, so the answer has something durable
behind it. Per failing test it gives you `failureDescription`, `remediationDescription`,
`remediation.itemCount`, `remediation.remediateBy`, `integrations`, `lastRunAt`, and a bounded sample of the
failing entities with `hasMore` and `reportedItemCount`. **That is the answer** — "what would it take" is the
union of those remediations, and the item counts are what makes it a size rather than a gesture.

Four things to carry into what you write, each of which an answer has already got wrong:

- **a test's status is not the control's.** A control sits IN_PROGRESS while some of its tests pass; quote
  `passing/total` and never collapse it to "failing";
- **an OVERDUE `remediateBy` is a fact worth leading with**, and a `DUE_SOON` one is a different sentence;
- **`entities.sample` is a SAMPLE.** Say `reportedItemCount`, never the length of the array you got;
- **`screenshot` is `unavailable` on every document this verb files** — it reads the API only. A picture needs
  `atlas vanta shot --control <providerId>` or a `walk`, and saying "no evidence" instead of "no screenshot"
  is a false claim.

**3 · Name the system that ENFORCES it, not just the one that observes it.** Vanta reports; something else
does the enforcing, and "what would it take" is a change THERE. The failing test's `integrations` field names
it. Then go and read that atlas — and if you cannot, name the KIND you could not see rather than the atlas:
a blind spot naming an atlas this install can read is a door refusal (`ANSWER_DECLINES_READABLE_ATLAS`), and
it fired on exactly this question. The detail is [atlas](../atlas/SKILL.md) § "Never DECLINE an atlas you have
not graded".

**4 · If the control turns on a policy DOCUMENT, read its text rather than guessing at its contents.**

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" atlas vanta read --kind policy-document --query <words>   # the body, extracted
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" atlas vanta policy-versions --policy <id>
```

**5 · For a posture question rather than one control**, read the live posture rather than hand-computing it:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" atlas vanta controls-evidence --json   # every control's completion and evidence
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" atlas vanta control-evidence --control <id>
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" atlas vanta vulnerabilities --severity HIGH
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" atlas vanta changes            # what each sync changed that no session has judged yet
```

"What changed in Vanta" is that last read, never an email: [Vanta changes](../automation/reference/vanta-changes.md).

Every verb, across all four nouns, is in [the verb map](reference/the-verb-map.md) — the ISO access review
(`access-review`) included. How an ISO item reaches the owner
(one per card, counted in failing controls), where a policy change goes, and why it ships on the owner's review with
the team as witness rather than gate: [reaching the owner](reference/reaching-the-owner.md).

## Changing something at Vanta

A write NEVER goes through the atlas — an atlas only reads, and several declare `refuse-every-write`. It goes
through `write vanta`, which previews, digests and then applies. The categories, the `--dry-run`/`--approve
<digest>` flow and what still needs the owner's own hand are in [the write side](reference/the-write-side.md). Rule 3:
a doored provider is reached only this way, and never by a hand-driven browser.

## What this skill does NOT own

- **The atlas honesty contract** — exit-3 semantics, the claim boundary, "a zero is not a none". That is
  [atlas](../atlas/SKILL.md), and reading it is part of this job rather than an alternative to it.
- **Which sources an investigation should span at all** — that is [route](../route/SKILL.md), which already
  returns `vanta-atlas` as REQUIRED for a control question.
- **Any estate fact.** No count, no tenant, no control id and no caveat about this organisation's setup lives
  in this file or its references; they are [knowledge](../knowledge/SKILL.md) rows and atlas generations.
- **A dependency vulnerability**, which is [vulnerability-fix](../vulnerability-fix/SKILL.md) — `atlas vanta
vulnerabilities` is Vanta's own view of host findings, a different object.

## Running this from Codex

This skill runs on both hosts. In Claude Code, `${CLAUDE_PLUGIN_ROOT}` above is substituted for you. In Codex
it is not: resolve this `SKILL.md` on disk, take the plugin root two directories above it, and invoke
`<plugin-root>/bin/slopweaver` by absolute path for every CLI call. Never run bare `slopweaver` on either
host, because an ambient `PATH` may point at another checkout.
