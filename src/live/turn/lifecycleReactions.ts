/**
 * THE LIFECYCLE REACTION SET, and the one rule that keeps it honest: a message wears AT MOST ONE of them.
 *
 * Every stage of an ask's life puts a reaction on the ORIGINAL tagged message — `:hourglass_flowing_sand:`
 * when it is queued behind the asker's own earlier ask, the profile's capture emoji while it is being
 * worked, and one of the two terminal emoji once it is over. Each of those transitions used to ADD its own
 * emoji and remove only the ONE specific prior state its own code happened to know about, which is not a
 * transition at all — it is an append that occasionally tidies up.
 *
 * Measured, both on the same channel (identified here by message ts alone — the channel id is a
 * raw workspace identifier this repository does not carry):
 *
 *  - ts `1787540563.699759` — a failed attempt settled the tag to the STOPPED emoji; the
 *    successful retry, ten minutes later, settled it to the COMPLETION emoji. `settleTagReaction` removed the
 *    capture emoji (already gone) and added the completion one BESIDE the warning, so the owner-visible
 *    message now says the turn both failed and succeeded. The "set to a value, so it is idempotent" claim
 *    holds only for repeated calls with the SAME outcome; failure-then-retry is exactly two calls that
 *    disagree.
 *  - ts `1787540579.950269` — a queued tag wore the hourglass, was later dequeued, and went through the
 *    fresh-tag capture path, which ADDS the capture emoji. Nothing removed the hourglass, so a survivor
 *    that was being worked on still advertised itself as waiting in a queue.
 *
 * Both are the same defect, so this is one fix rather than two: settling a lifecycle reaction means
 * CONVERGING the message to exactly one of them — retire every other member of the set (Slack's
 * `reactions.remove` answers `no_reaction` for one that was never there, which the transport already treats
 * as success), then add the one that is now true.
 *
 * Only reactions in THIS set are ever removed. A human's own `:+1:` or `:tada:` on the tagged message is
 * not a lifecycle signal and is never touched — the convergence is scoped to the emoji the bot itself
 * raises, which is what lets it be unconditional.
 *
 * ## The vocabulary was terminal-only, and that is what made a self-recovery unrepresentable
 *
 * Originally the only thing a caller could ask this module for was one of `./indicators.ts`'s three
 * TERMINAL endings, so the capture emoji was raised in exactly one place in the tree — `../listen/capture.ts`'s
 * `withCaptureReaction`, in the LISTENER, once, at capture time. Every later transition could only ever move
 * the message further towards an ending.
 *
 * Measured on ask `C0SYN000017`/`1789708136.457099`, from its own lifecycle rows: a phantom workspace was
 * found at 06:12:14.344Z and correctly settled the tag to the STOPPED emoji; the loop re-dispatched a live
 * worker at 06:19:51.314Z; the answer landed at 07:02:52.462Z. For the 43 minutes in between, a working turn
 * advertised itself to the asker as failed. Nothing was wrong with either transition — the state the system
 * re-entered simply had no name in this vocabulary, so no code path COULD have said it.
 *
 * {@link LifecycleReaction} is that name. The owner's rule: the warning reaction on the ask post goes back to
 * the first emoji, eyes, once the self-recovery is in progress.
 */

import {
  acknowledgedReactionEmojiFromProfile,
  captureReactionEmojiFromProfile,
  completionReactionEmojiFromProfile,
  forAHumanReactionEmojiFromProfile,
  stoppedReactionEmojiFromProfile,
} from "../../profileStore.js";
import type { TerminalReaction } from "./indicators.js";

/**
 * The queued-burst reaction is GONE, and it stays in the retire list below rather than the add path.
 *
 * `:hourglass_flowing_sand:` used to acknowledge a tag parked in the burst queue. Nothing parks a tag any
 * more (owner ruling — every tag is judged), so nothing adds it. It remains enumerated as a
 * reaction the bot itself may have raised, because a message tagged before this change is still wearing one
 * and the next transition on that ask has to take it off.
 */
const RETIRED_BURST_QUEUED_EMOJI = "hourglass_flowing_sand";

/**
 * Every reaction this module can be asked to leave STANDING — the four terminal endings, plus the one
 * non-terminal member that says a worker is on this ask right now.
 *
 * `working` is deliberately NOT a member of {@link TerminalReaction}, and the separation is the whole point
 * rather than a naming preference. `./indicators.ts`'s `IndicatorPlan` is the plan for a turn that is OVER,
 * and a terminal plan able to express "still working" would be a turn finalising itself into a lie — the
 * exact class that file exists to end. So the terminal vocabulary stays closed to it, this one is its
 * superset, and only the two live-state callers (`../../cli/commands/turn/dispatchInitial.ts`'s successful dispatch
 * and `../../cli/commands/turn/reactionAssert.ts`'s per-tick assertion) ever hold a value that can be
 * `working`.
 */
export type LifecycleReaction = TerminalReaction | "working";

/**
 * Every reaction the bot itself raises over one ask's life, in lifecycle order — queued, being worked, and
 * all four terminal endings.
 *
 * ONE list, read by every site that adds a lifecycle reaction, is the whole mechanism: a fourth stage added
 * later joins here and every existing transition starts retiring it without being edited. A per-call-site
 * "remove the one I replace" is what produced the two measured contradictions above.
 *
 * The five configurable emoji may collide with each other on a hand-edited profile (nothing stops an
 * operator pointing `completionReaction` and `stoppedReaction` at the same name); {@link reactionsToRetire}
 * dedupes, so a collision costs a wasted call at worst and never removes the emoji it just added.
 *
 * The acknowledged ending joining this list is the whole reason the list exists: adding it here is the only
 * edit needed for every EXISTING transition to start retiring it, so a message that was settled to
 * "nothing owed" and later answered for real converges instead of wearing both.
 *
 * @param home the state home holding `profile.json`
 * @returns the lifecycle reaction names, bare (no colons), in lifecycle order
 */
export function lifecycleReactionEmojis({ home }: { home: string }): readonly string[] {
  return [
    RETIRED_BURST_QUEUED_EMOJI,
    captureReactionEmojiFromProfile({ home }),
    completionReactionEmojiFromProfile({ home }),
    stoppedReactionEmojiFromProfile({ home }),
    acknowledgedReactionEmojiFromProfile({ home }),
    forAHumanReactionEmojiFromProfile({ home }),
  ];
}

/**
 * The lifecycle reactions that must come OFF a message before `standing` goes on it. Pure and total.
 *
 * Deduped, and `standing` itself is never in the result — removing the emoji you are about to add would
 * make the message flicker through wearing no lifecycle reaction at all, and on a profile where two stages
 * share an emoji it would remove the very reaction the caller is settling to.
 *
 * Deliberately NOT a read of what is currently on the message: `reactions.remove` is idempotent for a
 * reaction that was never there, so retiring the whole set unconditionally converges in one pass without a
 * `reactions.get` round trip whose answer could be stale by the time it is acted on.
 *
 * @param emojis the full lifecycle set, from {@link lifecycleReactionEmojis}
 * @param standing the one lifecycle reaction that must be left on the message
 * @returns the names to remove, in the order given, each at most once, never including `standing`
 */
export function reactionsToRetire({
  emojis,
  standing,
}: {
  emojis: readonly string[];
  standing: string;
}): readonly string[] {
  return [...new Set(emojis)].filter((name) => name !== standing);
}

/**
 * The emoji one TERMINAL ending leaves standing — the whole of the ending decision, in one place.
 *
 * `../turn/indicators.ts` decides WHICH ending an outcome earns and this maps that ending to a name; the two
 * were previously the same three-line ternary written out at both of `./poster.ts`'s seam builders, and a
 * third caller was about to make it three. A mapping duplicated per call site is the same shape as the
 * per-call-site "remove the one I replace" that produced the contradictions this module exists to end.
 *
 * A `switch` rather than the ternary it replaced, so that the NEXT ending added to {@link TerminalReaction}
 * fails to compile here instead of silently falling through to whichever branch the `else` happened to be —
 * which is precisely how a two-ending vocabulary went on being used for a third outcome it could not
 * express.
 *
 * @param home the state home holding `profile.json`
 * @param reaction the terminal ending the message is being settled to
 * @returns the bare reaction name (no colons) for that ending
 */
export function terminalReactionEmoji({ home, reaction }: { home: string; reaction: TerminalReaction }): string {
  switch (reaction) {
    case "completion":
      return completionReactionEmojiFromProfile({ home });
    case "stopped":
      return stoppedReactionEmojiFromProfile({ home });
    case "acknowledged":
      return acknowledgedReactionEmojiFromProfile({ home });
    case "for-a-human":
      return forAHumanReactionEmojiFromProfile({ home });
  }
}

/**
 * The emoji ANY member of {@link LifecycleReaction} leaves standing — the terminal four, plus `working`.
 *
 * A separate function rather than a fourth arm on {@link terminalReactionEmoji}'s `switch`, deliberately:
 * that switch's exhaustiveness over {@link TerminalReaction} is load-bearing (its own doc says the next
 * ending added must fail to compile there), and widening it to a superset would silently retire that
 * guarantee for the type it was written to protect.
 *
 * `working` resolves to the CAPTURE emoji rather than a fourth configurable one, so a message a worker is
 * holding wears exactly what the listener put on it at capture — the reader sees one symbol for "seen,
 * working on it" whether this is the first worker or the third.
 *
 * @param home the state home holding `profile.json`
 * @param reaction the lifecycle reaction to leave standing
 * @returns the bare reaction name (no colons)
 */
export function lifecycleReactionEmoji({ home, reaction }: { home: string; reaction: LifecycleReaction }): string {
  if (reaction === "working") {
    return captureReactionEmojiFromProfile({ home });
  }
  return terminalReactionEmoji({ home, reaction });
}
