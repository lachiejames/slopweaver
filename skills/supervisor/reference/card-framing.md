# The four card-framing rules

Bundled reference for the `supervisor` skill, linked from
[fleet-briefing-shape.md](fleet-briefing-shape.md) § Card shape. The two GROUPINGS are
[react-now-groupings.md](react-now-groupings.md); the live premise read and the age measurement are
[card-freshness.md](card-freshness.md).

## What the owner asked for

A page where four of the eight cards at the top could not be answered as written leaves the owner unable to react
to badly written, badly framed cards. Each of the four below is a refusal rather than a note, because prose telling a
sweep to write better is what produced that page.

1. **Plain words before the ask.** A fleet word — settled, fill, reaper, row, seam, tick, sweep, silver,
   gold, bronze, waiver — may sit above the fold only where the card has GLOSSED it above the fold. The
   refusal is the missing gloss, never the word: MEASURED over the owner's own 322 recorded turns, the owner uses almost all
   of them, so a ban would refuse the owner's own vocabulary back at the owner. The subject line is not read, since
   that is the subject's own title. `src/briefing/fleetJargon.ts`.
2. **A card exists only where the supervisor cannot decide.** A question asking PERMISSION for an act
   doctrine already authorises is refused with the rule named — "does this get a pull request" is rule 1, and
   the answer is yes, and the owner cannot see why it was a question. A question asking the owner to choose
   between IMPLEMENTATIONS is refused too (the owner cares about the outcome, not how it works
   internally); ask for the criterion the owner would judge the result by instead. `why you` must also name a
   conflict between the owner's rules or a fact only the owner holds — that last half is a FLOOR, and six of the seven cards
   it was built from already cleared it. `src/briefing/doctrineSettled.ts`.
3. **An option is pickable where it sits.** An option that sends the owner somewhere else to decide is refused —
   including `hold, you will read the page first`, which four of the seven cards carried and which duplicates
   `if silent` while adding homework. On a card whose premise is a pull request, an option that would change
   what that pull request ships is refused outright rather than offered with a caveat.
   `src/briefing/optionPickability.ts`.
4. **Every card carries its own age.** `premise` is required — `artifact` with a `landedIso` (and an optional
   `updatedIso`), `pull-request` with an `observedIso`, or `composed` with a `readIso` — and the renderer puts
   the age above the question. A missing, unparseable or future instant is refused. A page the owner's own ruling has
   already settled stops producing a card at all while staying in the ranked index.
   [card-freshness](card-freshness.md) carries the half of the owner's card-age ruling that is NOT decidable yet, and
   why. `src/briefing/cardPremise.ts`.

`SLOPWEAVER_ALLOW_CARD_FRAMING=1` lifts all four FINDINGS for one invocation of `briefing check`, so the reader
works on an archived page that predates them. It never lifts the required `premise` field, which is
structural, and **`briefing render` never honours it at all** — that door publishes.

## The same rules run over the rest of the page

The briefing is fully aligned with this way of writing, since it is much easier to read. Rule 1's registry and gloss test, and rule 2's two
question refusals, are read over every section outside the cards as well —
[fleet-briefing-shape](fleet-briefing-shape.md) § "Every OTHER section reads the way a gated card does" is
the contract, and `src/briefing/sectionQuality.ts` carries the measurement and the disclosure scope. Rule 3
(option pickability) does not travel: a pointer band exists to send the owner to a page. Rule 4 travels as far as
the ranked index, which prints each page's age rather than only the instant it landed.

The break-glass covers both: `SLOPWEAVER_ALLOW_CARD_FRAMING=1` lifts every finding for `briefing check`
alone, and `briefing render` never honours it.
