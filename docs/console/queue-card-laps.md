# How many looks a Queue card took the owner

A child of [the queue](queue-and-triage.md); it reads the words [card landing](card-landing.md) records.

Done is the owner opening a card and having no notes to give, the first time. If not, how many tries, how many
steers, and what they were. A lap the fleet caused and one the world caused are counted apart. This is measured
because the owner spends more time saying what is wrong with cards than approving them.

`slopweaver talk laps [--since 14d] [--json]` is the reading (`src/talk/cardLaps.ts`, `src/talk/cardLapsRead.ts`):

- **A word is on a card only where its record names it.** That means a call stretch's open card (`open`), or a console
  steer's `about`. A supervisor turn names none, so it sits on none; `talk laps` counts those as `unplaced`.
- **A look** is a run of the owner's words on one card with no silence over 30 minutes. **Laps** are looks less one.
- **A lap is the world's** when the owner was away from the card 72 hours or more before the next look. Otherwise it is the
  fleet's. That is a proxy: nothing records whether the world actually moved.
- A re-cut hand step (`settles`) is the same card: its looks count under the newest key.
- A spoken relay repeats the call stretch it came from, so a look quotes the stretch.

**On the Queue** (`site/components/console/CardLaps.tsx`, `site/lib/cardLaps.ts`):

- A card the owner has steered carries `N lap(s) so far: F fleet, W world` under its question. A card the owner has
  looked at once carries nothing.
- Opened, it folds the owner's words look by look.
- Nothing about laps is drawn under the list: the page ends at its last card, by the owner's
  ruling. The totals across cards are
  `talk laps`'s own to print.

**Never claimed**:

- "Approved". The owner's yes and the owner's no both leave the Queue, and no record tells them apart.
- That a card the owner never spoke on passed first time. No look of the owner's is recorded on it.

## Why keywords do not place a word

The owner suggested matching a card's keywords against the owner's transcripts. The matcher was built and scored where
the answer is known. It used two-sided rare tokens and needed one token's margin over the runner-up. Over the 552 words
of the owner's whose
card IS recorded (a 14-day window):

| Floor                       | 2   | 3   | 4   | 5   | 6   |
| --------------------------- | --- | --- | --- | --- | --- |
| Words it put on a card      | 221 | 213 | 197 | 159 | 130 |
| Of those, on the right card | 7   | 7   | 7   | 5   | 3   |

At floor 2, it was right on 7 of 221. A wrong match invents a steer the owner never gave, which is worse than an undercount.
`slopweaver talk laps --since 14d --calibrate` reruns this score. A future matcher has to pass it before it places a
word.

**The residues**:

- Words said in the supervisor chat count on no card.
- A card's looks before the window are not read, so its laps are a floor.
- The opened card's fold reads `talk laps` once per page load, on the slow lane (measured 8.3s).
