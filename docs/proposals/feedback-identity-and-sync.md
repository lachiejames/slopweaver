# The feedback ledger, and what "unanswered" checkably means

Part of [The golden proposal, as a form](../proposals.md).

**Recording feedback is not adopting it.** While the
[propose-then-react phase rule](../doctrine-rationale/phase-rule.md) stands, a piece of
outside feedback that argues for a change to what we are building goes into an artifact as a proposal and
waits for the owner's reaction before anything acts on it — `record-feedback` and `answer-feedback` move a
debt, never a decision. That rule carries the owner's words, the phase it binds and the one thing that ends it.

Slack holds the words; Linear holds state but cannot say "this was an objection to a proposal". Nothing else
in the stack has a place to put a piece of pushback and whether it has been answered — the named failure being
feedback on a proposal that never gets a reply, so the whole thing stalls.

`record-feedback` takes a `--kind`, because the owner asked for both halves of a tension: see pushback first, but
still record the positive replies, since positive information is sometimes useful, while tracking everything
would get noisy.

**Only `pushback` and `question` ever count as unanswered.** All four kinds are recorded and all four are
listed; an acknowledgement with no reply is not a debt, and a query that lists one has invented work. So:

> unanswered feedback is a `feedback-recorded` event of one of those two kinds with no `feedback-answered`
> event carrying its id.

That is the whole definition. Nothing infers an objection from a Slack thread — the door's send ledger holds
no content and no coordinates, so a best-effort join would silently attach the wrong thread, and an inferred
objection is a guess wearing a fact's clothes. Recording it is deliberate, and in practice it is a session
that reads the thread and calls the verb, which is exactly the intended workflow.

`--where` is REQUIRED for the two kinds that owe an answer, because answering means going back to where it was
raised, and a recorded objection with nowhere to go back to is a debt with no address. Each item gets an id
(`f1`, `f2`, …) allocated from the raw journal and STORED in the event, so a line a future build cannot decode
can never renumber the rest. Allocation REFUSES while any line is undecodable, for the same reason. One
residual race stays: allocation is read-count-append with no lock, so two writers hitting the same proposal at
the same instant could mint the same id — nothing in this program does that today, and `answer-feedback`
refuses an ambiguous id rather than silently closing both.

## Engagement and adoption are queries, and one of them is manual

"How is this tracking" splits into what the register knows and what it must not pretend to.

The register answers **engagement** only in the sense of what was recorded into it: the feedback ledger, the
Slack permalinks `record-slack` holds, and the follow-ups. That is recorded interactions — not a complete
picture of who engaged, which nothing here measures.

**Adoption is never a stored number.** The owner's ruling: adoption changes over time, so a stored number
would not make sense, and it does not apply to some proposals (a CI validation that merges and becomes part
of CI/CD is not "adopted"). So there is no adoption field and no adoption verb. The signal
differs per proposal kind and is answered on the day it is asked, by hand, against the corpus. "Addressed
messages per channel per week against the responder roster" is not the metric: the owner did not follow what
it measured, and a metric the owner cannot read is not a metric.

## What is deliberately not here

- **Parent/child proposal edges.** A workstream-sized proposal gets a sequence of verdicts rather than one, so
  its status wants deriving from children rather than declaring. The owner's ruling was to wait until it can be
  seen in practice and used. Flat first, then a real example
  on a real parent, then the edge type — not a speculative one now.
- **Auto-detecting pushback from Slack replies**, **stored adoption metrics**, and **a milestone tracker**.
  Each turns this into a second board, and there is one board already.

## Identity, and why it is not just a title

A register slug is the SAME string as the proposal's intake id when one exists — `ProposalIntake.id` is
already the stable local identity no destination can provide, and reusing it verbatim is what lets `proposal
publish` join the two for free. A proposal with no intake (published with no `--intake`, or discovered by
`sync` from a page this tooling never drafted) gets a slug derived from a bounded title stem plus the FULL
compact id of its address, so two proposals can never collide on this axis and a later `sync` re-matches the
same page to the same slug even if its title changed. A Notion id is used bare, byte-for-byte the slug every
entry filed before addresses were provider-tagged carries; any other provider's id is prefixed with the
provider (`linear-<id>`), because two providers can mint the same id.

## Where a proposal lives is a provider-tagged address

The intake and the register hold one shape whichever destination published: `address: { provider, id, url? }`,
`provider` one of `notion`, `linear`, `local`. `url` is optional because not every destination hands one back,
and a reader is shown `provider:id` where it is absent. A record written before this shape carried
`pageId`/`pageUrl`, and every one was a Notion page, so a record with no `address` key is read as that Notion
address: an explicit branch on which keys are present, not a default. A record that carries `address` is read
strictly from it, and never rescued from legacy keys beside it; both together is refused as ambiguous. A legacy
intake holding only `pageUrl` can still lead a teaser, but a re-publish from it refuses, because it can neither
update that page nor safely create a second one. An old `page-linked` journal line decodes as the
`destination-linked` event every new link writes.

## `proposal publish` writes the register automatically. Nothing else does.

A non-dry-run publish that reported an address creates (or updates) this proposal's register entry as a side effect —
the same address and title the destination just wrote back, keyed by the intake id when there is one. A
re-publish whose recorded address is on a different provider from the install's destination refuses rather than
leaving the first copy behind as a stale second one. That is
the ONE automatic write into the register.

Everything else is deliberate, not automatic — including the Slack side. The obvious wish is "record the
teaser's permalink the moment it is posted," but that turns out not to be sound: the door's own send ledger
records only that a send happened, never its content or coordinates, by design (`src/admit/ledger.ts`'s own
module doc explains why — "audit without dumping the artifact"). `slack post --as me` is the owner's own act
under the owner's own name, with no proposal identity attached to the message at all. So `proposal record-slack` is
manual, on purpose, rather than a best-effort match that could silently attach the wrong permalink.

## `proposal sync` discovers. It never classifies.

`proposal sync --source <notion-page-id-or-url>` reads the direct `child_page` blocks under a Notion page
and registers any not already tracked under that Notion address — keyed by provider and id, so a Linear or
local entry sharing the id is never mistaken for it. It is a Notion child-page IMPORT, not a sync of whatever
destination the install publishes to: no other provider has a bounded discovery read to compose. Mechanical, and bounded to what a single page's block
list can answer. What it CANNOT do is decide a discovered page's status, decision, successor, audience or
Slack link: those are prose inside each child page, not structured Notion properties, so assigning them
unattended would be inventing a fact rather than reading one. A freshly synced entry starts at `strawman`
and stays there until a human — or the session driving this CLI, having actually read the page — calls
`status`/`decide`/`supersede`/`audience`/`record-slack`/`follow-up` to say what it really is. `sync` reports a slug
collision (the same derived slug already used by a different address) rather than overwriting either side,
and reports when a source has more top-level blocks than `--limit` covered rather than silently truncating.
