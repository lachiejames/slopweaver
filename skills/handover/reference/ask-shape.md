# The shape a recorded ask carries

**A recorded ask the owner has to parse is a defect.**
An ask waiting on the owner's word is not a paragraph to read, it is a decision to take. So every one carries a
shape the VERB enforces, and `handover ask` and `handover register` refuse a row that does not — before
anything reaches a journal.

```bash
slopweaver handover ask <slug> \
  --problem "the base branch is not derivable from the doc" \
  --options "main :: every other run is on it
the release branch :: this doc cites it once" \
  --lean "main — the one citation reads like a typo" \
  --risk "a run starts on the wrong base and its diff is unreviewable" \
  --blast-radius "this one doc and whichever run picks it up" \
  --still-real "re-read the doc just now: it still cites both branches" \
  --example "You open the run's PR between two calls and it sits on the release branch. Should it be on main?" \
  --question "<the ask in full, for the thread and the journal>"
```

The card LEADS with the `--example` scene, the owner's free reaction field ahead of folded options: [ask-examples.md](ask-examples.md).

## The six fields

| Field            | What it holds                                                                                             |
| ---------------- | --------------------------------------------------------------------------------------------------------- |
| `--problem`      | One line: what is actually wrong or undecided. Not the history, not what you tried.                       |
| `--options`      | Two to four LINES, each `<what the owner could do> :: <what that costs> [:: <command>]`.                  |
| `--lean`         | One line: what the owner would most likely pick with infinite time and attention.                         |
| `--risk`         | One line: what goes wrong if the owner picks badly, or says nothing.                                      |
| `--blast-radius` | One line: who and what the decision reaches.                                                              |
| `--still-real`   | One line: how the problem was confirmed to still stand. The three STAKES: [ask-stakes.md](ask-stakes.md). |

All six are **in the owner's voice and concise** — the caps are `src/briefing/caps.ts`, shared with every other
surface that writes as the owner, so an ask is not a second register of length rules.

**Two is the floor because one option is a notification rather than a decision**, and four is the ceiling
because past that the card stops being readable. A fifth is refused by a sentence naming the count, never
by a silent slice.

**`::` separates an option from its trade-off, not an em dash.** An em dash is ordinary inside the owner's prose,
and a separator that also appears in the payload is not a separator. `--options` is ONE flag holding
lines, because an option and its trade-off are one pair and two repeatable flags could fall out of step —
the reasoning is on `parseAskOptions` in `src/handover/askShape.ts`.

**An option the owner takes at a terminal carries its command, or is refused.** An option reading as a sign-in,
or naming a command on the owner-hands register (`src/hand/runnableLiteral.ts`), takes a third part — `sign
plan-3 in again :: one browser sign-in :: slopweaver claude signin --plan plan-3` — drawn as a copy block under
its letter. The command is one line only the owner can run, a fleet-runnable segment refused. The criterion reads
the option's sentence, never its trade-off; reword a false positive (`src/handover/askOptionCommand.ts`).

**Letters are assigned by POSITION.** A caller who types `A`/`B` can type them twice or out of order, and
neither is checkable prose. So a line or `--action` destination label opening with its own label (`C · …`, `C.`,
`C)`, `C:`, `C -`, `C —`, `(C)`) is REFUSED: the card would draw two letters, and a `--lean` naming the typed one
points at the wrong option. Name an option in `--lean` by the letter its position gives it.

## An ask about a MESSAGE carries the message — `--action`

A queue card about a pull request nobody will review should offer the post itself: post into the SDLC channel,
tag these people, with a draft written out that the owner can look at in a Slack platform native view, a preview of
the message in a channel or thread to react to, and an option to hold it for now. A card that sounds like there is
a draft without showing it is not helpful.

So when the decision is about a message, the ask carries the message. `--action` takes one JSON document —
the draft, its `<@Uxxxx>` mentions and one to three destinations, each with its own label and trade-off:

```bash
slopweaver handover ask <slug> --action ./draft.json --problem "…" --lean "…" --risk "…" --blast-radius "…" --still-real "…" --question "…"
slopweaver handover offer <slug> --action - --problem "…" --lean "…" --risk "…" --blast-radius "…" --still-real "…"   # ← already waiting
```

Three spellings, and the grammar closes the ambiguity rather than a flag saying which: `-` reads stdin, a
value beginning with `{` is the document itself, anything else is a path. `src/handover/askActionInput.ts`
is the typed refusal for each way that fails. The document may be an EMAIL instead: [mail-action.md](mail-action.md).

**`--options` is REFUSED beside `--action`, and that is the load-bearing rule.** The options ARE the
destinations, so a caller allowed to author both could record "post it to #delivery" beside a draft addressed
somewhere else and the card would print the owner's choice over the wrong message.
`src/handover/askActionOptions.ts` derives them instead: one per destination, in the action's own order,
then HOLD last. The hold is a real option rather than an implied absence — silence the owner did not choose is the
state the card exists to make visible (`AGENTS.md` rule 6) — and its trade-off says what holding costs.

The arithmetic that makes the two caps fit: three destinations (`ACTION_MAX_DESTINATIONS`) plus the hold is
exactly `src/briefing/caps.ts`'s `MAX_OPTIONS` of four, and `actionOptionsFitCap` is the witness that they
still agree.

**The verb's refusal is half the guarantee; the DECODER is the other half.** A write-side refusal binds the
verbs, and the journal is a hand-editable file every checkout on the machine shares — a line carrying an
action beside an unrelated option list parses perfectly and reads as a card offering to DM someone over a
draft addressed to a channel. `src/handover/questionLineDecode.ts` therefore derives the options on the way
IN, for both `question` and `question-offered`, and never reads the list a line stored. The same idea at the
console boundary: a destination that will not read invalidates the WHOLE action
(`site/components/live/readAction.ts`), because a surviving subset offers the owner two places for a message the
row says goes to three and reads exactly as complete.

**A draft that is PRESENT and will not read is the third arm, and it carries NO options.** It is not an ask
with no draft: the stored list was written to describe destinations, so handing it back prints a takeable
"DM Tobias" over a draft the surface is simultaneously reporting as malformed. Both sides drop it —
`questionLineDecode.ts`'s `optionsOf` and `site/lib/queueRows.ts`'s `askedOptions` — so no option DESCRIBING A
DESTINATION survives a draft that will not read: the card says the draft is broken (`SlackActionPreview`),
carries no option at all, and the owner reacts in its free reaction field, in the owner's own words.

**Dropping it is not enough — the state has to be PUBLISHED, or the next reader restores what was dropped.**
A decoder that only erases the bad action leaves a row indistinguishable from one that never offered a draft,
and `handover list --json` would fill the gap from the doc's own front-matter `options:` for the console to
draw: the exact "DM Tobias" card. So the bit travels as a field of its own.
`ledger.ts`'s `question` event carries `actionUnreadable: true`, `openQuestion.ts` and `boardTypes.ts`'s
`waiting-on-owner` carry it forward, `listJson.ts` publishes it, and `readAction.ts` reads it to answer
`invalid` for a row whose `action` is absent because the publisher could not read it either.

**What `shapeOf` suppresses the doc on is the OFFER, not the defect** — `offeredADraft`, which is true for a
readable action and for an unreadable one alike. Narrowed to the broken case, the same wrong card is one hand
edit away: a PERFECTLY readable draft whose journal line carries no `lean` has no journalled shape either, so
the row would fall through to the doc's front matter and publish the #delivery action beside "DM Tobias". A run that offered a draft has its own options, derived from what it actually recorded; the front
matter was written before any draft existed and has nothing true to say about them.

**Suppressing the doc is only half of THAT, and the other half is where the options then come from.** They
come from the ACTION, not from the shape — `optionsFor` in `listJsonAsk.ts` derives them with the same
`actionOptions` the verb and the decoder call, so the three agree by construction. Read off the shape, they
would be an EMPTY list beside that same perfectly good draft: an ask offering a message and no way to send
it. `lean` and `problem` stay absent there, honestly, and the card draws its "needs rewriting" mark off
exactly that.

**The body is bounded where it is RECORDED, not folded where it is drawn.** A fold on the console would hide
half of a message about to be posted at full length, so the caps bite in `src/handover/askAction.ts`:
`ACTION_BODY_MAX_WORDS` is `caps.ts`'s `WHAT_MAX_WORDS` plus 80 percent (a tighter cap left a draft missing critical
context), with a character and a line cap as the axis a word count cannot see: one trace id, 200 characters. A destination's own rules (a real conversation id, a thread root that is a `ts`, a DM
conversation that is already OPEN) are `src/handover/askActionDestination.ts`; a preview must never be what
creates a conversation, so `slopweaver slack dm open --with <people>` is what opens one. A message in parts: [message-in-parts.md](message-in-parts.md).

### `handover offer` — the same card, for a question already waiting

A question already waiting on the owner is still a decision the owner has to take. Answering a question to re-ask it fabricates a ruling the owner never gave, and `handover correct` restates the
TEXT and its still-real check and deliberately keeps everything else — so an offer is its own event, bound to the question it names,
replacing the action and the shape TOGETHER and touching neither the question's text nor its clock. It does
**not** re-deliver: the question was posted when it was asked, and the console reads the journal, so the card
changes where the owner is already looking. A question with NO shape and NO draft takes `handover ask` again instead:
`question-shaped` records text and shape, keeps the asked instant, and never replaces a shaped one (`reshapeBinds`).
A correction, a reshape and an offer each RESTATE the question: only a ruling journalled after the latest of them answers it, so the row is the owner's again (`rulingsAfterRestatement`, by position, never stamp) — a ruling you fold into a correction is its input, not its answer.

### Every ask links its own work

`handover list --json` publishes `prUrls` and `anchor` beside the action, and the card draws them as links, so the owner never navigates to a pull request or a Slack thread alone. So `--question` leads with its ask and links each PR
it names ([card-alignment.md](card-alignment.md)); an `sd-` draft it names is drawn, and held ([named-drafts.md](named-drafts.md)); the owner's quoted words lead it, then the owner's further steers oldest first, then one `--bears-on` line saying why it is in front of the owner ([bears-on.md](bears-on.md)).

## The lean is the SESSION's recommendation, never the owner's word

The card says so where it draws it. A lean is what this session thinks the owner would pick — a starting point the
owner can accept in one word or reject — and recording one is not a claim that the owner has decided anything. The
owner's own decision arrives as a `ruling`, which is a different event entirely
([derived-row-state.md](derived-row-state.md)).

## Two rows carry no shape, and neither is an omission

The shape is mandatory on exactly the rows that WAIT ON THE OWNER'S WORD — and one reaches the owner's Queue as it stands, with
no run ([registered-ask-queue.md](registered-ask-queue.md)). Two kinds do not, each saying so with its own flag:

- **`--finding`** — `handover register --ask "…" --finding --evidence <ref,...>` is a session's own
  observation. There is no decision of the owner's in it, so there is nothing to give options about. It carries
  its PROVENANCE, and a team-facing door holds on it until `handover rule` records the owner's word.
- **`--dispatch`** — `handover register --ask "…" --dispatch [--branch <head>]` is WORK a seat picks up: an
  already-team-facing pull request of the owner's needing a rebase, red CI cleared or threads answered. It
  carries no provenance and **no door holds on it**, because clearing the owner's own pull requests is what `AGENTS.md`
  rule 10 tells the fleet to do. So is a `automation seat` row, with no `--branch`: `cmux spawn` cuts the slug.

**The two are different properties, and conflating them is a measured defect.** Read as "is not a finding",
"needs a shape" refused `github landing --register` — which composes neither flag, correctly — with exit 2 on
every row, so the landing register never put a row on the board. `--dispatch` makes the second property declarable.

**`--dispatch` is refused beside `--finding`, and beside any of the six shape flags**, empty values
included: it DECLARES that nothing on the row waits on the owner, so it cannot ride alongside something saying the
opposite. Both are failures of FACT, so neither takes the hatch below and neither can be opened by it.

**A shape reaches a row's front-matter through the six flags and through nothing else**, and that is a
property of the WRITER rather than of any flag check. Two counterexamples ran: a `--branch` holding `feature/one\nproblem: …\nlean: …\noptions:\n  - option: …`
wrote a complete, well-formed shape in as real keys, and so did a session id carrying the same text, which
reaches `observedBy` from the environment when `--observed-by` is absent and so passes no flag check at all.
`flatScalarCodec.ts`'s `encodeFlatScalar` quotes any value that would not survive as one line, so no source can
author a second key, and the flat reader decodes it back exactly — `parseHandoverDoc` then holds every
field but `summary` to one line, because its readers print rows; `askRowArgs.ts`'s `multilineRawFields`
additionally refuses such a value by FLAG NAME, because none of those fields has a legitimate multi-line value
and one reaches the board as a branch the finding gate can never match.

## The escape hatch, and when it is the right call

`SLOPWEAVER_ALLOW_UNSHAPED_ASK=1` records an ask with no shape at all. The refusal names its own legitimate
exceptions: the session is mid-incident, has to park on the owner NOW, and genuinely has one course of action
rather than a choice. Use it there and nowhere else — a board of free-text asks is the state the ruling
exists to end.

## What an unshaped row looks like on the console

The queue card draws no `problem`, `lean` or stakes row at all, so no junk lands on the owner's cards, and `site/lib/briefingCardForm.ts` refuses a card that would draw one its row does not hold. The whole
question stays on the card, under its example, with the free reaction field and no option invented for it. An ask carrying an `action` draws the draft above that field, Slack-native — the
avatar, the destination, the mention chips and the mrkdwn body as the channel would render it — and an ask
carrying none draws no preview at all rather than an empty frame. **Nothing backfills a shape out of the
prose** — composing a problem statement
in the owner's voice from a paragraph is what `AGENTS.md` rule 2 bans, and doing it invisibly would be worse than
the paragraph. MEASURED: of 2,700 board rows, 43 carried an open recorded question and every
one was free text.
