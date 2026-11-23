/**
 * The BLOCKED-ON-THE-OWNER half of the briefing gate: a page that does not surface a block the owner is holding
 * up is refused.
 *
 * The owner's design: when a bot turn stops on something only the owner can do, it is surfaced on react-now
 * in the fleet briefing, one of the places the owner looks most — and never in the bot DM, which carries so
 * much that it goes unread.
 *
 * ## Why this is a gate rather than a step in the sweep contract
 *
 * The sweep contract already tells a composer to card an owner-only blocker, and prose is what this
 * repository keeps measuring as insufficient: a briefing tick has a dozen reads to make and the one that
 * gets dropped is the one nothing checks. The mechanism is the same one every other half of this gate uses —
 * a page is REFUSED rather than a composer reminded, so the failure mode is a red publish step rather than a
 * turn quietly waiting on a sign-in the owner never heard about.
 *
 * ## Matched on the permalink token, which is the only falsifiable handle there is
 *
 * A card is prose, so "does this card mention that block" cannot be answered by reading its words. What CAN
 * be answered exactly is whether the page links the blocked thread: a real Slack permalink to the message
 * ends in `p<ts with the dot removed>`, so that token appears in the page's bytes when the card links it and
 * nowhere else when it does not. `../live/turn/blockedOnHuman.ts`'s `slackPermalinkToken` composes the same
 * token the CLI prints, so a composer pasting the link the verb handed it passes by construction.
 *
 * Requiring the LINK rather than a mention is deliberate, and it is worth more than the check: a card that
 * tells the owner a turn is waiting on a sign-in without linking the thread makes the owner go and find it, which is
 * exactly the context switch the whole feature exists to remove.
 *
 * Pure: the page's HTML and the blocked rows go in, defects come out. The CLI edge reads the ask-lifecycle
 * log, exactly as it already reads live pull-request state for `./prPremise.ts`.
 */

import { slackPermalinkToken } from "../live/turn/blockedOnHuman.js";
import { reactNowRegion } from "./reactNowCard.js";

/** One ask waiting on the owner, reduced to what this check needs. Built by the edge from `turn blocked`'s rows. */
export interface BlockedAskPremise {
  readonly channel: string;
  readonly messageTs: string;
  /** What the owner has to do, quoted back in the defect so a composer can write the card without a second read. */
  readonly what: string;
}

/**
 * One block the page failed to surface.
 *
 * @internal — the row shape {@link checkBlockedAsks} returns; `./check.ts` renders it and no other caller
 * names it directly, exactly as `./reactNowCard.ts`'s own `CardDefect` is.
 */
export interface BlockedAskDefect {
  readonly channel: string;
  readonly messageTs: string;
  readonly reason: string;
}

/** What checking one briefing page against the blocks the owner is holding up found. */
export interface BlockedAskCheck {
  /** How many blocks were checked — zero when nothing is waiting on the owner, which is the common case. */
  readonly blocksChecked: number;
  readonly defects: readonly BlockedAskDefect[];
}

/**
 * The empty result — what {@link checkBlockedAsks} returns when the caller supplied no rows at all.
 *
 * A caller with no rows and a caller with an unreadable log are the same value here, and that is the
 * conservative reading rather than a gap: this half can only ever ADD a refusal, so a missing input makes it
 * silent instead of making it guess.
 *
 * @internal — `./check.ts` uses it for the no-rows arm; no other caller names it.
 */
export const NO_BLOCKED_ASKS: BlockedAskCheck = { blocksChecked: 0, defects: [] };

/**
 * Refuse a briefing page that does not carry a react-now card linking every ask waiting on the owner.
 *
 * Scoped to the REACT-NOW block, never the whole page: a block named only in a collapsed fold further down
 * is a block the owner does not see, and react-now is where the owner looks most. A page with no react-now block at all is already refused by `./shape.ts`, so this
 * reports the blocks as unsurfaced rather than re-reporting the missing heading.
 *
 * @param blocked every ask currently waiting on the owner, from the ask-lifecycle log
 * @param html the whole artifact file
 * @returns how many blocks were checked, and every one the page did not surface
 */
export function checkBlockedAsks({
  blocked,
  html,
}: {
  blocked: readonly BlockedAskPremise[];
  html: string;
}): BlockedAskCheck {
  // A page with no react-now block at all has no region to search, so every block is unsurfaced — which is
  // the honest answer rather than a coalesce: `undefined` here means the heading is missing, and `./shape.ts`
  // is already refusing the page for that separately.
  const region = reactNowRegion({ html }).block;
  const surfaced = ({ messageTs }: { messageTs: string }): boolean =>
    region?.includes(slackPermalinkToken({ messageTs })) === true;
  const defects = blocked
    .filter((ask) => !surfaced({ messageTs: ask.messageTs }))
    .map((ask): BlockedAskDefect => ({
      channel: ask.channel,
      messageTs: ask.messageTs,
      reason:
        `a bot turn is waiting on the owner and react-now does not link it — "${ask.what}". Add a card whose ` +
        "options link the thread (the permalink `slopweaver turn blocked --json` prints), so the owner can do the " +
        "thing from the page already being read.",
    }));
  return { blocksChecked: blocked.length, defects };
}
