# The owner's priorities on the Queue

**One order, everywhere** (an owner P0): the order things are raised in matches the order the Queue puts them to the
owner, which matches whatever the alignment work suggests. The page draws it, the voice's `action_items` lists it, a triage pass walks it by voice, and
the board's reconcile ranks by the same rule. The rest of the Queue is [Queue and Triage](./queue-and-triage.md).

## The order

The owner's ruling:

1. **Blocking your priorities**: a card that blocks one of the owner's priorities, with its reason, by the priority it
   blocks.
2. **Your priorities**: each priority's own cards, the owner's first priority first, then by board band, then by the
   controls each resolves, most first.
3. **Stopped automations**: a hand step marked `stopsWork`, such as an automation held on the owner's own word. It is
   not a blocker, and it ranks below the owner's priorities: an automation the owner disabled for now waits on them,
   but blocks nothing they have ranked.
4. Everything else, by tier, then the cards the owner put off, oldest deferral first.

Where no key separates two cards, the order the Queue was given stands (currency's, fresh first). An unstated rank,
band or count sorts after a stated one. The rule is `src/waiting/queueOrder.ts` `rankQueue`, mirrored at
`site/lib/queueOrderRank.ts` because the site cannot import `src/`. `site/__tests__/unit/waitingRank.test.ts` holds the
two equal. `site/__tests__/unit/queueOrderReplay.test.ts` holds the page, the voice and its triage pass to one order over
the call's card set, and `src/__tests__/unit/handover/queueOrderReplay.test.ts` holds reconcile to its head over the
same fixture. That one lives in `src/` because the site's build would type-check the whole board graph.

## What a priority is

A priority is STATE, never a name in code: a live workstream on the owner's outcomes register at priority `urgent` that states
`queueWorkstream`, the board's `workstream=` tag value its cards carry, and has not ended. Its `priority.rank` orders it
against the owner's others, 1 first; an unranked one follows every ranked one in register order (`slopweaver workstreams put`,
[workstreams](../../skills/workstreams/SKILL.md)). The page polls it once a minute; reconcile reads it each pass
(`src/workstreams/queuePriorities.ts`). A card is in a priority by that tag read whole, never by its words, so a card
whose tags read only in part never joins one. A Vanta card states what it resolves with a `controls-resolved=` tag
([tags](../tags.md)).

A lift never moves a card's tier, so the badge, the view counts and the tier words stay true. A check-in and a card the owner
put off are never lifted into a priority. With no priority standing, only a stopped automation moves.

A register that could not be read draws one staleness mark above the list (`focusGap`, `site/lib/queueFocus.ts`), and
every card stands by its tier. An empty store is not that: `workstreams list` exits 3, `NO_WORKSTREAMS`, the
console reads it as no priority (`site/lib/workstreamsReading.ts`), and nothing is marked. `GET /api/queue-stopping`
reads it the same way and stays complete.

## The stamp that lifts a blocker or a stopped automation

`withStopping` (`site/lib/queueStopping.ts`) stamps `stopping` on a hand step marked `stopsWork` (`reason: "marked"`)
and on any card waiting on the owner that a priority's open row names in `blockedBy` (`reason: "blocks"`, carrying the
highest priority it blocks). A stamped card is shown in both work contexts whichever one places it (`shownOnQueue`), and
on the view that is not its own it says whose card it is (`stoppingElsewhere`). It
keeps its place when the owner puts it off: `deferredLast` and the page's deferred section leave it there. A check-in is never
stamped. The card draws its decision, options and lean above the fold (`stoppingFold`), so the choice is on the card,
not one disclosure away. `GET /api/queue-stopping` serves the stamped cards in that order to
`slopweaver queue stopping --json`. The supervisor's tick reads it: a blocker is what its chat update opens on, and a
stopped automation is raised straight after the owner's priorities.

## Numbering

A lifted section is never folded, so the card the page numbers N through the owner's priorities is the card the voice raises
at N. A tier still folds each register past eight; past the lifted sections, a fold can make the page's numbering and
the voice's differ until the owner expands it.

## Triage

A triage pass, one clock a card over the Queue's own cards, walks the same order. A voice pass already under way keeps the order it began with
until a priority is switched on or off. A blocker that appears mid-pass goes in front of the owner next. A stopped automation
goes next once no priority card ahead of it is still unshown (`nextTriageCard`). When the priorities change,
the unseen cards the pass began with are re-ordered in the Queue's order as it stands then. A card that arrived since still
comes after all of them, as an arrival always does.

## Reconcile

`slopweaver handover reconcile` ranks the board by the same rule (`src/handover/rank.ts` `rankRows`, facts from
`src/handover/queueFacts.ts`). A board row blocking a priority's row leads whether or not it waits on the owner: there it is
the work to seat first. An ask the owner put off on the Queue (`queue defer`) is not ranked as the owner's priority and
goes last, earliest put off first, as its card does; a blocker the owner put off still leads. A hand step is no board row, so reconcile has no stopped band. With the register
or the deferral ledger unread, it says so on stderr and ranks as if there were none.

Reconcile matches the Queue on the bands the owner ruled: blockers, then the owner's priorities' cards, then what the
owner put off, last. Inside the rest band each keeps the order it was given, as the rule says. The Queue's is tier then
question age. Reconcile's is the board's own band, landing and age, since the owner parks rows at `p3` on purpose.

It matches the Queue on what the board and the deferral ledger say, and on nothing else. Three card overlays are
computed only on the site, so reconcile does not see them:

- a card moved to check-in after the owner's reply or ruling (`site/lib/cardCurrencyMark.ts`);
- an ask absorbed into a hand card (`site/lib/handStepRows.ts`);
- two docs sharing one slug, which the board already refuses.

On those rows the Queue's order is the one the owner reads.
