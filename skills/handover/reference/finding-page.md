# A finding reaches the owner as a rendered page, never as its markdown doc

Bundled reference for the `handover` skill, linked from [one-board.md](one-board.md) § A finding is a row too.
The card side of the same rule is the supervisor's [open-page-cards.md](../../supervisor/reference/open-page-cards.md).

## Before any of that: `register --finding` refuses evidence the trunk has already rewritten

A seat runs its OWN worktree's CLI against a shared, always-current `$SLOPWEAVER_HOME`, so a stale one
diagnoses a repository that no longer exists. MEASURED: one seat, 258 commits behind,
registered three rows off defects fixed upstream days earlier, relayed one to the pinned chair as a p0, took
two repair acts on live state that needed no repair, and published a page to the owner asserting all of it.

So `slopweaver handover register --finding` compares this seat to `origin/HEAD` **scoped to the row's own
`evidence:` paths**, and refuses when one of them moved. The criterion is the evidence, never the seat's
distance: a seat far behind can still observe a true defect in a file nobody touched, while the question that
actually matters is whether the thing being diagnosed was rewritten under the diagnostician. Non-code evidence
is outside it by construction — a `state:` item, an `owner/repo#<n>` ref and a permalink are not paths, so
they are never its subject (`src/cli/commands/handover/staleEvidenceGate.ts`).

The hatch is `SLOPWEAVER_ALLOW_STALE_SEAT_FINDING=1`, and taking it prints what moved rather than going quiet.
Reach for it only when the defect is in this seat's own uncommitted work, or when the finding is ABOUT the
upstream commit itself. Otherwise the refusal is asking for one act — confirm the defect against the trunk —
and that act is the whole point.

**Silence is a LOWER BOUND, never a clearance.** The check is depth-one against the already-fetched ref: it
sees the evidence paths and their directories, not what a changed module three hops away means for them, and
it cannot see commits this checkout has never fetched. Its sibling advisory (`src/cli/staleSeat.ts`, printed
before every verb whose own modules moved) carries the same limit for the same reason.

## Why a page and not the doc

A finding card whose subject url is the finding's own `$SLOPWEAVER_HOME/handovers/<slug>.md` puts a markdown file in
front of the owner, which is not easy to react to. A proper artifact to react to is preferable, because with extra
details the owner's answer need not fall into A, B or C.

A handover doc is written for a SESSION — the ask, the probes, the journal. It opens in the owner's browser as
raw text, and what a finding needs the owner to weigh is buried in it. MEASURED, from `$SLOPWEAVER_HOME/supervisor-scratch`
(reproduce with `grep -rlE 'file:///[^"]+handovers/[^"]+[.]md' --include='*.html' . | wc -l`): 361 rendered
briefings carried a link to one of 15 such docs, and 5 entries of one chair's live `open-pages.json`
still did. Every one went the same way — a supervisor with a finding row and no page put the row's doc where a
page's address goes.

## The rule, and what enforces it

**Every finding seat ends in a page before it cards.** The seat that observed the finding publishes it with
`slopweaver page publish <slug> --page <fragment>.html --review <id>`, after the review `page review-prepare` prints
([page](../../page/SKILL.md)), and THAT address is what
goes into `open-pages.json` as the entry's `url`, or into an authored card's `subject.url`. A finding with no
page yet stays a board row — `slopweaver handover list` prints it under its `origin: finding` line — and is not
put in front of the owner as a card at all.

Three refusals hold it, one criterion (`src/briefing/markdownSubject.ts`: the url's path ends in `.md`, any
scheme, any directory — the reason is the raw-text tab, not the `handovers/` directory):

- **`briefing render`'s `--open-artifacts` reader** refuses an entry whose `url` is a markdown document, every
  offender named with its index and url in one pass. This is where the measured card came from, and it takes
  the render red until the entries are re-pointed or dropped — the intended act, since a finding without a page
  is not an open page.
- **The briefing form** refuses a card in EITHER grouping whose `subject.url` is one, at the card's own path.
  The owner is the reader of both groupings, so team-facing is not exempt.
- **`briefing check`** refuses a hand-written page carrying such a link on a card's subject line.

The refusal names the page verb and the four things below, so a composer reading it knows the fix.

## What the page carries

The four things the owner's answer actually turns on, in this order, each its own heading:

1. **What was measured** — the observation with its repro command and the instant it was read, never a
   paraphrase of the row's summary.
2. **Why it matters** — what is wrong for the owner or the team while it stands, in the owner's vocabulary.
3. **The candidate causes** — every cause the seat considered, with what was checked against each and what
   that check found. A card without them leaves the owner unable to tell whether it is rate limiting or a
   bug in the fleet's code.
4. **The options with their cost** — the same A/B/C the card offers, each with what it costs and what it
   leaves undone, so an answer that is not one of the letters is one the owner can give from the page.

Mark the page's own question and lean — `data-card="question"` and `data-card="lean"`, one card-sized
sentence each ([page](../../page/SKILL.md)) — because the card reads those two from the page, never from the
entry. The fold, the caps and the voice rules on the CARD are unchanged; the page is where the depth lives. A page
the owner can react to is one that lets the owner's answer fall outside A, B and C when the detail warrants it — that is the
whole difference between it and the doc.

It should read like a Claude artifact, not a bare webpage: write semantic HTML in the house vocabulary — an
`eyebrow`, the hero `h1` and lede, `stats` for the headline numbers, a `callout` for the answer, tables and
figures as they come ([house-style](../../page/reference/house-style.md)) — or design the whole page yourself.
Every chart sits beside the page under `pages/<slug>/` and is linked relatively; `page publish` refuses a
`file:` address or a path outside it, because the owner would see a broken image where the evidence was.
