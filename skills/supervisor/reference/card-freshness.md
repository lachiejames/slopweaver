# A card's premise, re-read live

Every other half of the briefing gate measures the card's own text. This one asks whether the world the card
describes still exists.

MEASURED: of five react-now cards the owner ruled on in one afternoon, TWO were stale at the moment the owner read
them. One asked whether to resolve a colleague's review thread on a pull request already sitting Queued with that
feedback addressed, and one asked whether to post a proof on a pull request that had merged fifteen hours earlier.
Both cards were correct when the sweep composed them, which is
exactly why nothing on the page could have caught it.

## The rule

Both doors — `briefing render` over its own output, and `briefing check <html>` over a page it did not
render — ask GitHub about the pull request each react-now card rests on, and REFUSE the page when its state
is `MERGED`, `CLOSED`, or in the merge queue. The refusal names the state, and for a queued pull request the
entry state and position too, so the fix is obvious without a second lookup: drop the card, or re-render
from a fresh sweep.

A queued pull request is stale for the same reason a merged one is. GitHub lands it without the owner, so a
question about what to do to it before it merges has already been answered by the queue.

## Which pull request is the premise

The card's `subject.url`, which is what the shape defines a subject to BE — what the card is about — and
what every projected open-pull-request card carries. A subject naming no pull request — none at all, a
non-GitHub link, or a `no page` subject carrying no link — falls back to the first pull-request link in the
card's fold, as a card with no subject line does.

A pull request merely CITED inside a cell is deliberately not the premise and is not checked. "The fix
landed in that pull request, so should we now do X" is a live question about X whose background happens to
be merged, and refusing it would make the gate punish a card for citing its own evidence.

## An unread premise is not a fresh one

A pull request the read could not answer for is reported as UNVERIFIED and refuses the page, rather than
passing. A run with no GitHub credential at all is refused for the same reason: "the read did not happen"
and "the premise holds" are different facts, and publishing on the first while claiming the second is the
failure this half exists to stop.

## The other half of freshness: the card's own AGE, and the part that is NOT decidable

A card served to the owner 23 hours old reads as stale, and the owner has been served stale react-now cards
repeatedly.

MEASURED. Reproduce:

```
yarn tsx src/measurement/briefingCardAge.entry.ts \
  --open-pages ~/.slopweaver/supervisor-scratch/handoff-<n>/open-pages.json \
  --briefings '~/.slopweaver/supervisor-scratch/handoff-<n>/briefing-t*.html'
```

On the version the owner read: 28 cards, 21 with a datable premise, **all 21 over 12 hours old**, 18 over
24, the oldest 261.3 hours. Over the last twenty renders: 534 card-appearances, 420 datable, **418 over 12
hours**, and 114 — every hand-written card — with no age source at all, because the projection took a ranked
page's `landedIso` and dropped it.

**What the gate does, and it is three things:** every card carries a `premise` instant and the renderer prints its age
above the question; a missing, unparseable or future instant is refused; and a page whose validity mark is not
`valid` stops producing a card while staying in the ranked index, which is the one EXACT, keyed relation
available. `src/briefing/cardPremise.ts`.

**What it does NOT do, stated rather than discovered.** The ask is for a card to be re-graded every tick
against the owner's turns and dropped when overtaken. Codex's planning pass returned BLOCKED on the universal half
and it is right: **later in time is not the same as overtook.** A
`LockInRow` carries an instant, an identity and an outcome — it is not an exhaustive stream of the owner's turns, and
it holds no semantic relation to a card it never names, so a rule invalidating every card older than the owner's last
utterance would drop cards the owner is still waiting to answer. The evidence is on the same page: the owner's Slack post that
settled card eight reached no ledger for fifteen hours, and the three pages the owner ruled on within half an hour were each correctly re-aimed BY HAND on the very next render. Closing that half needs a typed
current-tick card disposition, generated from a complete reconciliation read — the named next row.

**And there is no age CAP.** Whether an old but un-overtaken card is dropped, re-graded or merely stamped is
the owner's call about the owner's own attention, and it is the one open question here. A hard drop at 12
hours would have removed 21 of the 28 cards the owner was served, including the three the owner answered inside eight
minutes.

`SLOPWEAVER_ALLOW_CARD_FRAMING=1` lifts the age findings for one invocation of `briefing check`, alongside the
three wording rules in [fleet-briefing-shape](fleet-briefing-shape.md), so the reader still works on an
archive. `briefing render` never honours it.

`slopweaver hatch open stale-cards --reason "<why>"` skips the live read for one deliberate exception — the same
journalled break-glass shape the `bare-refs` and `voice-rules` hatches use. Both
verbs then say in their own report that the leg did not run, so an unchecked page never looks like a checked
one.

## Queue cards: one ruling clears every card it decides

A separate surface from the briefing's react-now cards, with its own half that IS built. The Queue cards must
refresh too, and a card the owner already reacted to must never be served again. The commonest way one is: a ruling spoken over one card that also decides
others, landed on the open card only.

**Built:** `relay_steer`'s `also_answers`. The voice names the other cards the owner's words decide, the page holds each
key to the latest `action_items` answer this call served and to the owner's current Queue, and `talk relay
--also-answers` lands each on the same anchor, so the Queue and `action_items` stop drawing it — no session
step, no card asking the owner — unless the relay is not stated whole, when nothing lands and the row opens `HELD:`. The
contract, its bounds and the manual `talk land` path are in
[card-landing](../../../docs/console/card-landing.md).

**Built elsewhere, and not built here:** a card the Queue walk moved past on a call leaves the owner's Queue on its own
(`docs/console/card-landing.md` § The Queue walk), unless the owner said to come back to it,
which defers it. A card nobody walked past still ages on the Queue. Keeping those fresh by age is still the
supervisor's sweep, re-cut against the board and the owner's later rulings, or withdrawn. That sweep does not wait on the
premise-reconciliation row above, which is about the briefing's cards.
