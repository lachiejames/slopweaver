# The golden proposal, as a form

A proposal is a claim a team is asked to act on. The difference between one that can be checked and one
that has to be believed is whether every number links the thing it came from, and whether the reader can
see the ask before they see the workings. A rules document would make every proposal a fresh act of
remembering that shape, so here it is a typed form, a renderer, and a gate.

## The loop

```bash
slopweaver proposal destination set notion-page --parent <page>  # once per install: where proposals go (or local-page, linear-document)
slopweaver proposal intake --brief "what this is about"   # the questions, before the document
slopweaver proposal draft --form-example                  # what the form wants
slopweaver proposal draft --form - --out draft.md         # the house markdown, rendered by code
slopweaver proposal lint draft.md                         # structure, citations, voice
slopweaver proposal publish draft.md --intake <id>
slopweaver proposal teaser --form - --intake <id>         # the Slack form; it never posts
```

Nothing in that loop runs a model. The session composes the FORM; pure code decides what the document looks
like, and a separate gate judges the words. What that composition costs shows up in the session you are
already watching, which is the point.

- [The shape, and why it is a type](./proposals/shape-gate-and-intake.md)
  - [The gate](./proposals/shape-gate-and-intake.md#the-gate)
  - [Where the voice rules live](./proposals/shape-gate-and-intake.md#where-the-voice-rules-live)
  - [Question-first intake](./proposals/shape-gate-and-intake.md#question-first-intake)
- [Publishing](./proposals/publishing-and-teaser.md)
  - [Where a proposal goes is the install's choice](./proposals/publishing-and-teaser.md#where-a-proposal-goes-is-the-installs-choice)
  - [What a local-page destination does](./proposals/publishing-and-teaser.md#what-a-local-page-destination-does)
  - [What a linear-document destination does](./proposals/publishing-and-teaser.md#what-a-linear-document-destination-does)
  - [The hero shot, when it has no URL](./proposals/publishing-and-teaser.md#the-hero-shot-when-it-has-no-url)
  - [The Slack teaser](./proposals/publishing-and-teaser.md#the-slack-teaser)
- [The register — a place to track proposals, not just publish them](./proposals/register-states-and-drift.md)
  - [Nine states, and the one that is derived](./proposals/register-states-and-drift.md#nine-states-and-the-one-that-is-derived)
  - [`proposal drift` — two timestamps, no model](./proposals/register-states-and-drift.md#proposal-drift--two-timestamps-no-model)
- [The feedback ledger, and what "unanswered" checkably means](./proposals/feedback-identity-and-sync.md)
  - [Engagement and adoption are queries, and one of them is manual](./proposals/feedback-identity-and-sync.md#engagement-and-adoption-are-queries-and-one-of-them-is-manual)
  - [What is deliberately not here](./proposals/feedback-identity-and-sync.md#what-is-deliberately-not-here)
  - [Identity, and why it is not just a title](./proposals/feedback-identity-and-sync.md#identity-and-why-it-is-not-just-a-title)
  - [Where a proposal lives is a provider-tagged address](./proposals/feedback-identity-and-sync.md#where-a-proposal-lives-is-a-provider-tagged-address)
  - [`proposal publish` writes the register automatically. Nothing else does.](./proposals/feedback-identity-and-sync.md#proposal-publish-writes-the-register-automatically-nothing-else-does)
  - [`proposal sync` discovers. It never classifies.](./proposals/feedback-identity-and-sync.md#proposal-sync-discovers-it-never-classifies)
