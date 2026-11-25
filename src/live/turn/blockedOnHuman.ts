/**
 * BLOCKED ON THE OWNER — the pure half of a turn that has got as far as it can without the owner.
 *
 * The design: the loop itself never waits on the owner. The listener is always on and the session can
 * generally run autonomously. What waits is a STEP. The worked case is real and daily: someone asks the bot to
 * deploy a Datadog monitor, the deploy needs a local Google Cloud sign-in, and only the owner can do that
 * sign-in.
 *
 * This module owns the WORDS and the SELECTION. What acts on them is
 * `../../cli/commands/turn/block.ts` (enter the state), `../../cli/commands/turn/unblock.ts` (leave it) and
 * `../../cli/commands/turn/blockedList.ts` (who is waiting on what). Everything here is total, clock-free
 * and Slack-free, so the exact card and the exact thread tag are assertable with nothing running.
 *
 * ## The three rails, stated where the code is rather than in a skill
 *
 * **It never reads as a failure.** A blocked card does not present as a failure: it says nothing about the request
 * failing, being unable to be handled, or the bot being broken. Nothing this module composes contains the words failed,
 * error, sorry, unable or cannot; `../../outbound/assistant/todoBlock.ts`'s `blocked` glyph is an hourglass rather than
 * a cross for the same reason, and the step keeps its own text rather than being overwritten with a problem report.
 *
 * **It never states a time.** The wait may be short or long, so no wording here estimates, promises or
 * implies one, and nothing downstream
 * derives an age bound from the event's own `tsIso` — see `../ask/lifecycle.ts`'s `BlockedOnHumanEvent`.
 *
 * **The turn is NOT done.** The ask stays non-terminal in the lifecycle log, and that is the mechanical half
 * of never marking a blocked ask done merely to tick it off a list, which would misrepresent the work.
 *
 * ## The session stands down; it does not sit here holding things
 *
 * Entering this state ENDS the dispatch, so the worker session finishes and releases whatever it was holding
 * — its lease, its burst slot, and the single bot listener token this machine runs one of. A turn that sat
 * blocked for a week while holding that token would put every other ask behind a sign-in the owner has not done
 * yet, which is the no-time-bound rule turning into an outage. Resumption is a fresh dispatch over the same
 * brief and the same card, never a session kept warm.
 */

import type { AskLifecycle, BlockedNeed, BlockedOnHumanEvent } from "../ask/lifecycle.js";
import { CARD_LINE_CAP, clampVisible } from "./answer.js";

/**
 * The stage line the card shows the hourglass ON — one line, in the same voice as every other step.
 *
 * It names the WORK that is waiting rather than the block, because the card's shape is a trail of what the
 * turn did and a line reading "blocked" would be the only one on it describing a state instead of a step.
 * The block itself is said once, in the detail under it ({@link blockedCardDetail}).
 *
 * @param what the one colleague-safe sentence saying what the owner has to do
 * @returns the step title, clamped to the card's own line cap
 */
export function blockedStepText({ what }: { what: string }): string {
  return clampVisible({ cap: CARD_LINE_CAP, text: `Waiting on the owner: ${what}` });
}

/**
 * The one sentence under the hourglass step. Pure.
 *
 * It replaces the mechanical `now:` line, which is derived from the worker's command log and would freeze at
 * whatever the worker was doing when it stood down — a "started 4m ago" that quietly becomes "started 6d
 * ago" is the stale-target defect `./progressCard.ts` already refuses to ship on a running step.
 *
 * @param need which of the two shapes this block is
 * @returns the detail line, clamped to the card's own line cap
 */
export function blockedCardDetail({ need }: { need: BlockedNeed }): string {
  return clampVisible({
    cap: CARD_LINE_CAP,
    text: `${blockedWaitClause({ need })} — picking straight back up once it is`,
  });
}

/**
 * The clause naming what is being waited for, per need. Pure and total.
 *
 * @param need which of the two shapes this block is
 * @returns the clause, no trailing punctuation
 */
function blockedWaitClause({ need }: { need: BlockedNeed }): string {
  switch (need) {
    case "sign-in":
      return "waiting on the owner to sign in";
    case "risky-approval":
      return "waiting on the owner's go-ahead";
    case "ruling":
      return "waiting on the owner to approve this one";
    case "other":
      return "waiting on the owner";
  }
}

/**
 * The detail line the card carries the moment the owner HAS done it and the turn is running again.
 *
 * A separate line rather than reverting to the `now:` line, and the reason is what a reader loses otherwise:
 * the card would show the step running with no trace that it had ever waited, so the trail — the thing the
 * owner likes about this shape — would quietly lose the most interesting minute in the turn.
 *
 * @param note what the owner did, in the unblocking session's own words
 * @returns the detail line, clamped to the card's own line cap
 */
export function resumedCardDetail({ note }: { note: string }): string {
  return clampVisible({ cap: CARD_LINE_CAP, text: `The owner did it — ${note} · picking up from here` });
}

/**
 * The fragment a Slack permalink to one message ends in — `p` plus its `ts` with the dot removed.
 *
 * The whole permalink cannot be composed here: it starts with the workspace's own domain, which is a private
 * identifier this repository must never contain. The TOKEN is the half that is derivable, and it is the half
 * that matters — it appears verbatim in any real permalink to this message, so a page that links the thread
 * carries it and a page that does not, does not. That is what makes
 * `../../briefing/blockedAsks.ts`'s check falsifiable rather than a prose reminder.
 *
 * @param messageTs the addressing message's own `ts`
 * @returns the permalink's trailing token, e.g. `p1712345678000100`
 */
export function slackPermalinkToken({ messageTs }: { messageTs: string }): string {
  return `p${messageTs.replace(".", "")}`;
}

/**
 * Where one ask stands with respect to the owner: waiting on them, or cleared and owed a resume.
 *
 * Two values rather than a boolean because the two are acted on by different readers and neither is the
 * absence of the other: `waiting` is what the fleet briefing must card, and `ready-to-resume` is what a
 * visible session must re-dispatch. An ask in neither state is not on this list at all.
 *
 * @internal — the vocabulary {@link BlockedAsk} declares; every caller reads it off a row rather than
 * naming the type.
 */
export type BlockedStanding = "waiting" | "ready-to-resume";

/** One ask standing against the owner, folded down to what a briefing card and a resume both need. */
export interface BlockedAsk {
  readonly channel: string;
  readonly messageTs: string;
  readonly threadTs: string;
  /** Waiting on the owner, or cleared and owed a re-dispatch. */
  readonly standing: BlockedStanding;
  /** The block itself — its need, its sentence and when it was entered. */
  readonly blocked: BlockedOnHumanEvent;
  /** What the owner did, once an `unblocked` event has cleared it. Absent while it is still waiting. */
  readonly clearedNote?: string | undefined;
}

/**
 * Every ask standing against the owner right now, oldest block first. Pure — the fold goes in, the rows come out.
 *
 * **Oldest first, and never by any other key.** There is no priority, no severity and no age bound here on
 * purpose: a sort that ranked a week-old sign-in below a fresh one would be a clock deciding what the owner
 * sees, which is exactly the time constraint the owner ruled out. First blocked, first listed.
 *
 * A `ready-to-resume` row is found by the `unblocked` event still being this ask's LAST event — once a
 * visible session re-dispatches it, the ordinary `dispatched` event takes over and the row leaves this list
 * without anything having to remember to remove it.
 *
 * @param folded the ask-lifecycle fold, from `../ask/lifecycle.ts`'s `foldAskLifecycle`
 * @returns one row per ask waiting on the owner or owed a resume, oldest block first
 */
export function blockedAsks({ folded }: { folded: ReadonlyMap<string, AskLifecycle> }): readonly BlockedAsk[] {
  const rows: BlockedAsk[] = [];
  for (const ask of folded.values()) {
    const row = blockedAskOf({ ask });
    if (row !== undefined) {
      rows.push(row);
    }
  }
  return rows.toSorted((a, b) => a.blocked.tsIso.localeCompare(b.blocked.tsIso));
}

/**
 * One folded ask as a row, or `undefined` when nothing of the owner's is outstanding on it.
 *
 * The `waiting` test reads `blockedOnHuman`, which the fold clears on `unblocked`, rather than testing
 * `state === "blocked-on-human"` — a resumed turn that has since written a stage would fail the state test
 * while genuinely still being blocked if the resume never happened. The `ready-to-resume` test reads the
 * last event, because an ask the owner has cleared is owed exactly one re-dispatch and nothing else marks that.
 *
 * @param ask the folded ask
 * @returns the row, or `undefined`
 */
function blockedAskOf({ ask }: { ask: AskLifecycle }): BlockedAsk | undefined {
  const base = { channel: ask.channel, messageTs: ask.messageTs, threadTs: ask.threadTs };
  if (ask.blockedOnHuman !== undefined) {
    return { ...base, blocked: ask.blockedOnHuman, standing: "waiting" };
  }
  if (ask.lastEvent.kind !== "unblocked") {
    return undefined;
  }
  const cleared = lastBlockBefore({ ask });
  if (cleared === undefined) {
    return undefined;
  }
  return { ...base, blocked: cleared, clearedNote: ask.lastEvent.note, standing: "ready-to-resume" };
}

/**
 * The block an `unblocked` event lifted, read off the event itself.
 *
 * The fold drops {@link AskLifecycle.blockedOnHuman} when the block lifts, so this reads `lifted` — the need
 * and the sentence the `unblocked` event copied off the block at write time — rather than reconstructing
 * anything. A resume row therefore says exactly what the owner was asked for, never a guess.
 *
 * @param ask the folded ask, whose last event is `unblocked`
 * @returns the block to show on the resume row, or `undefined` when the last event is not an `unblocked`
 */
function lastBlockBefore({ ask }: { ask: AskLifecycle }): BlockedOnHumanEvent | undefined {
  const event = ask.lastEvent;
  if (event.kind !== "unblocked") {
    return undefined;
  }
  return {
    channel: ask.channel,
    kind: "blocked-on-human",
    messageTs: ask.messageTs,
    need: event.lifted.need,
    stepText: blockedStepText({ what: event.lifted.what }),
    threadTs: ask.threadTs,
    tsIso: event.tsIso,
    what: event.lifted.what,
  };
}
