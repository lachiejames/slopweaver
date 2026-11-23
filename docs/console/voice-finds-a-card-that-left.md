# A card that left the owner's Queue is still found, marked removed

Part of [The voice's context pack](voice-context-and-calls.md).

A card removed from the Queue stays visible to the voice, marked as removed. Measured on one call: the owner was
reading a review-bump card aloud, the owner's words landed on it through the transcript, and from that instant the
card was off both the Queue and `action_items`, so `read_card` said no card answered to it. The relay rows settled after it were never cards.

- **Only what a register evidences, over the last day at the caller's clock**: the instant `action_items` is
  called, or the pack is rendered into a call, never the last render or the build. A card the owner's words still hold off
  the list (the `talk cards` landing, dated by the EARLIEST one, or the steer this page collapsed), and an ask that
  was the owner's settled off it, dated by the `settledIso` `handover settle` writes beside the witness — or, when the owner
  ruled on it first, by the owner's FIRST ruling since it was asked (`ruledBeforeSettleIso`, `src/cli/commands/handover/listJsonSettlement.ts`),
  since a ruled ask is off the owner's Queue before a session settles it — so one ruled and not yet settled is listed
  too, dated by that ruling (`ruledSinceQuestionIso`) — a run of any kind whose question the Queue drew as the owner's ask
  included, and one that ended still carrying its question, dated by its settle or the words that landed on it.
  A sent draft or a done hand step leaves the page no row to redraw, so only the pack's ledger lists one the owner's words landed on — and only when they landed before
  the pack was built. **The known gap**: words that land after the build, on a card whose row then leaves its
  register before the next build, are found by neither half; closing it needs the page to draw a
  card from its landing alone. Nothing here claims a universal history.
- **The earliest evidenced event names the removal.** A landing on a settled ask is its why only when it came
  before the settle (or the ruling), and a steer that collapsed the card before words landed on it is its why
  over them — the first collapse since the last steer that came back, which drew the card again; a later event did not take the card off. An instant is said as
  `toISOString` writes it, so a stored date no calendar has is never read aloud verbatim.
- **The page's half** is `recentQueueDepartures` (`site/lib/recentQueueDepartures.ts`), one projection with the
  Queue's own rows (`actionItemProjection`, `site/lib/talkActionItems.ts`): `action_items` answers a capped
  `recentlyLeft` list with its residue, never counted in a total or a tier — and, while the board is still loading, places
  no hand step or act (`placementWaits`), so it names the board unread rather than listing one that left — and `read_card` resolves a key on the
  Queue first, then among them, answering with `removed` — when, why, `onQueue: false`. `open_card` on one opens
  nothing, since no Queue panel draws it.
- **The pack's half** is `packRecentlyLeftOf` (`src/talk/packRecentlyLeft.ts`, read by
  `src/cli/commands/talk/packRecentlyLeftRead.ts`): a section of cards that left the owner's Queue in the last day, 3 KiB, every line
  saying REMOVED with when and why, and the section named unread when the landing ledger or the board did not read.
  It is the ledgers as they stood at build: a steer the page saw come back draws the card again, or says no session
  picked it up, and only that page knows, so the section sends the voice to `read_card`, which resolves a card back on the Queue as live. A steer
  the page collapsed lives in that page's storage alone, so a card it took off before any words landed is in
  `action_items`' `recentlyLeft` and never in the pack, and the heading says so.
