# A card naming a Slack draft draws the draft, and names only a held one

A queue card that asks the owner to react to a Slack draft must show that draft on the card, for every existing and
future queue card regarding a Slack draft or draft DM. The owner reads Slack draft DMs in the native Slack UI.

## The console draws every named draft on the card itself

A parked as-me draft is named by its id: `sd-` and eight lowercase hex digits, matched whole in the text as the
card's mrkdwn renderer can draw it — link labels in place, and a `*`, `_`, `~` or `` ` `` allowed anywhere inside
(`src/handover/namedDraftGate.ts`'s `draftIdsNamed`, restated in `site/lib/slackDraftIds.ts`). Every ask row and
every hand row resolves the ids its own texts name — its slug, the question, summary, problem, options and
trade-offs, lean, risk, blast radius, still-real line, reason and every text its `--action` preview draws; a hand
step's what, where, unblocks and witness — against
`slack draft list --json` (`namedDrafts`), and the card's **draft** slot draws each one Slack-native
(`site/components/console/NamedDrafts.tsx`), above the options, never folded into the record lines:

| The register says  | The card draws                                                                                                                                       |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| held               | the draft, stamped with where it lands (_in thread_ or _top level_), with its send line                                                              |
| released           | the draft, stamped _sent_ and when, and that it is no longer the owner's                                                                             |
| dropped and re-cut | a line naming the LIVE cut's id, the live cut drawn as its own state, each dropped cut folded — the last cut too, when it was dropped with no re-cut |
| dropped, no re-cut | that there is nothing to send, and the draft FOLDED behind its drop note                                                                             |
| no such id         | a warning naming the id — a card that cannot show its draft is a defect, said plainly                                                                |
| not read yet       | that the register is being read, never an empty slot                                                                                                 |

**A dropped draft's words are never what the card leads with.** A hand card once named a draft dropped as "re-cut as
sd-…", drew that first cut whole, and the owner approved it on words that were no longer the draft. The re-cut link is the drop note: the first whole id a DROPPED row's
`--note` names that the register holds is its successor, followed to the cut that stands
(`src/outbound/slack/draftLiveCut.ts`, restated as `liveCutOf` in `site/lib/slackDraftIds.ts`). Forward only — a
later draft's why saying "PROOF copy of sd-…" is not a re-cut. So **a drop that re-cuts names the new id in its
note** (`slack draft drop <id> --note "re-cut as sd-…"`), or no card can follow it.

**Each draft is drawn once.** A card once ran far too long with duplicate stuff in it: its
question named the live cut and its still-real line the dropped first cut, and each id drew the live draft whole.
`namedDrafts` keeps one resolution per live cut: the live id named directly wins and the re-cut line goes; two
dropped ids on one chain fold into one re-cut. `drawnOnceForm` refuses any card that would still draw an id twice.

The same slot carries an `--action` draft (`SlackActionPreview`), a held bot reply's thread and read-only draft, and a
posts-as-you row's draft, so no Slack message the owner is asked about sits behind a fold.

## Six verbs refuse to record a card naming a draft the register does not hold

`handover ask`, `handover correct`, `handover offer`, `handover reconfirm`, a decision `handover register` and
`hand post` read the register the moment their texts name an id
(`src/cli/commands/handover/namedDraftAdmission.ts`), before anything is journalled, and refuse with the four-line
hatch when one is sent, dropped or never recorded on this home — naming the live cut's id when a dropped one was
re-cut. The row's slug and summary are checked beside its
texts, since a card draws them as its subject and a linked hand card's what. `ask` and `offer` also check every
text an `--action` draws: a Slack message's body, names and destinations, a mail's addresses, subject and body.
`correct` checks only its new question and `reconfirm` only its new still-real line; a `--finding` or `--dispatch`
row asks the owner to send nothing and is not checked. A card naming no id is never read, and a register that will not
parse is a refusal of FACT, never an empty register.

The fix is nearly always to re-record the draft (`slopweaver slack draft record`) or name the id
`slopweaver slack draft list` shows held. The hatch, `SLOPWEAVER_ALLOW_UNHELD_DRAFT=1`, covers a text citing a
spent draft as history, or a draft recorded on a different state home.

## What no gate can see

A drawn draft's own message is not read for ids: the card asks about THAT draft and draws it whole, so an id its
body quotes is content the owner reads there, not a second draft the card asks the owner to act on.

A doc edited by hand — its summary rewritten outside any verb — reaches the card with no verb in the path; the
console still draws what it names, and an absent id says so on the card.

A card asking the owner to send a message in words outside the one criterion below — "send this", "post the reply as
you" — passes unseen: there is no guess at "send this", deliberately. Park the message first (`slack draft
record`, top-level) and name its id, or carry it as `handover offer --action` (a thread reply); a card asking
about a message it does not carry is the defect this page exists for, whatever the gate says.

## A Queue card saying a message was drafted as the owner must carry it

The hand step's criterion below, run on every Queue card too: `handover ask` (and its reshape), `correct`,
`reconfirm` and a decision `register` refuse a card whose question, shape or still-real line says a message was
"drafted, written, worded or composed as you" unless the card names a parked draft by id — the slug or summary
counts — or its ask offers the message (`--action` on this `ask`, or one the run's waiting ask already carries;
a `register` row has none yet) (`src/handover/undrawnAskDraftGate.ts`, through `undrawnAskDraftExit` in
`namedDraftAdmission.ts`). The phrase is never read in the slug or summary, so a row ABOUT drafts does not refuse
itself. Unlike the held-draft check above, `correct` and `reconfirm` read the question, shape and reconfirmed line the card KEEPS
too: the card goes on drawing them, and the fix (`handover offer`, or naming the id) is always to hand. MEASURED: two recorded asks said a post was "drafted as you" in a DM thread or on a page and
their cards drew nothing; the third such ask named its draft by id and passes. The hatch,
`SLOPWEAVER_ALLOW_UNDRAWN_ASK_DRAFT=1`, covers a draft cited as history or one on a surface no card draws.

## A hand step talking about a draft as the owner must carry it

A step asking the owner to read replies drafted as the owner, whose ask carried the reply and whose card drew none
of it, must show the drafted replies. A hand step is the one card with a
narrow prose check, because its sentence is the whole ask. When its `what` or `where` says a message was
"drafted, written, worded or composed as you" — followed by the end, punctuation, a preposition or an "and" naming
its send state ("and unsent", "and not yet sent", "and parked"), though a comma opening a list of people ("as you,
Seth, and I discussed") does not count — never "your draft reply" or "drafted under your name", which read the same as a policy or a contract
(`src/hand/draftAsOwner.ts`, restated in `site/lib/draftAsOwner.ts` and held to one corpus by
`src/__tests__/unit/hand/draftAsOwner.test.ts`), it must name a parked draft by id or open an ask whose run is
waiting on the owner with an `--action`. `hand post` refuses otherwise, `--open` and a hand-typed `--url` alike, with
`SLOPWEAVER_ALLOW_UNDRAWN_DRAFT=1` for a draft cited as history or one on a surface no card draws.

The console draws the opened ask's action on EVERY step card that opens it, whether or not the
step's words name a draft — read off the ask's board row raw, shaped or not — and refuse, in one sentence, a step whose ask has since lost it. So the promise is "the draft
is on the card, or the card says it is missing", never a card that asks about a message and shows none.

Until the board holding that ask has been read, what it offers is UNKNOWN, not absent: the card says it is reading the
ask, or that the board did not read, and never that the draft is missing. A first live open once
drew the missing-draft refusal for the seconds the board took to arrive, then the draft.
A board whose scan began before the step was posted has not read that ask either: the page reads the board once while
hands poll, so the card says the reading predates the step and reads the board again, once. `handover list --json`
stamps `scanStartedIso` for this, because `observedAtIso` is taken when the scan ends and a doc written mid-scan can
be missed. While the board's `unreadable` list is not empty, a missing ask is unknown too, since a doc's slug need not be its
filename, and the card names the files.
