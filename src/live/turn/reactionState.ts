/**
 * WHICH LIFECYCLE REACTION AN ASK'S CURRENT STATE EARNS — the pure half of "the reaction must not contradict
 * the turn".
 *
 * `./indicators.ts` answers the same question for a turn that is OVER, and answers it from the terminal
 * state the ending path already holds in hand. This module answers it from the FOLD — the durable
 * `AskLifecycle` any reader can rebuild off `asks.jsonl` — which is the only form of the question a caller
 * outside the turn can ask, and therefore the only one a re-dispatch or a sweep tick can act on.
 *
 * ## The measured gap, and why it needed a function rather than a patch
 *
 * Ask `C0SYN000017`/`1789708136.457099`, from its own lifecycle rows:
 *
 * ```text
 * dispatch-failed  06:12:14.344Z  "cmux has no workspace … — the workspace this dispatch recorded is gone"
 * dispatched       06:19:51.314Z  the loop's own re-dispatch, carrying the dead worker's findings
 * answered         07:02:52.462Z
 * ```
 *
 * The phantom finding settled the tag to the STOPPED emoji, correctly — nothing was running at 06:12. The
 * re-dispatch seven minutes later wrote the `dispatched` event, the durable record and the session-ledger
 * row, and touched no reaction, because no dispatch path ever has. So for the 43 minutes a live worker spent
 * answering, the asker's own message advertised the turn as failed. The owner's ruling: the warning
 * react must not stay on the ask post once self-recovery is in progress; it goes back to the first emoji,
 * eyes.
 *
 * Patching the re-dispatch alone would fix that one path and leave the rest of the system with no way to
 * state what the reaction OUGHT to be. {@link lifecycleReactionForAsk} is that statement, and it is what lets
 * `../../cli/commands/turn/reactionAssert.ts` check the claim every sweep tick instead of trusting that every
 * writer remembered.
 *
 * Everything here is pure and total: no clock, no filesystem, no Slack. The effects are in
 * `../../cli/commands/turn/reactionAssert.ts`.
 */

import type { AskLifecycle } from "../ask/lifecycle.js";
import type { LifecycleReaction } from "./lifecycleReactions.js";

/**
 * The lifecycle reaction one ask's folded state earns. Pure and total.
 *
 * **`activeDispatch` is tested FIRST and it outranks `state`**, which is the whole decision rather than an
 * ordering detail. `../ask/lifecycle.ts` documents that field as "a worker holds this ask right now", and it
 * exists precisely because `state` answers a different question — what happened most recently — that a
 * recovery pass's `captured`/`checklist-posted` observation moves off `dispatched` while the worker is still
 * alive (measured on a real message). Every arm of `turn dispatch --sweep` already
 * keys on `activeDispatch` for that reason; a reaction keyed on `state` would re-create the same class one
 * layer up, and would put a warning back on a live worker the moment a recovery pass re-observed its ask.
 *
 * A narrower predicate was considered and rejected: a worker that has just been dispatched has written no
 * progress stage yet (`./progressLog.ts` — the log is empty until the first one), so keying on a live stage
 * would hold the warning over exactly the window this exists to close.
 *
 * `dispatch-unwitnessed` needs no arm of its own and gets the right answer for free: it is in
 * `../ask/lifecycle.ts`'s `DISPATCH_PRESERVING_KINDS`, so it keeps `activeDispatch` and therefore keeps the
 * capture emoji — matching that event's own rule that it posts nothing and raises no warning.
 *
 * The switch is EXHAUSTIVE with no `default`, so a kind added to `../ask/lifecycle.ts` later fails to compile
 * here rather than falling into whichever arm an `else` happened to be. That is this repo's own rule for a
 * switch over a domain union, and it matters more than usual here: a reaction is the one indicator nobody
 * re-reads, so a kind that silently inherited the wrong arm would be invisible until an owner walked over to
 * report it — which is exactly how this defect was found.
 *
 * `blocked-on-human` reads as `working`, not as an ending. A turn paused on the owner is not over and the
 * asker is not owed a warning about it; the fleet briefing is what surfaces an outstanding block.
 *
 * @param entry the ask's folded lifecycle, as `foldAskLifecycle` builds it
 * @returns the one reaction its tagged message should be wearing right now
 */
export function lifecycleReactionForAsk({ entry }: { entry: AskLifecycle }): LifecycleReaction {
  if (entry.activeDispatch !== undefined) {
    return "working";
  }
  switch (entry.state) {
    // `satisfied-elsewhere` shares the `answered` arm because the asker's answer IS standing in this
    // thread — it simply belongs to a different ask. `acknowledged` would understate that as "noted,
    // nothing owed"; `../ask/lifecycle.ts`'s `SatisfiedElsewhereEvent` carries the measured thread.
    case "answered":
    case "satisfied-elsewhere":
      return "completion";
    // Both are a DECISION that nothing is owed in reply — the turn's own judgement, and the supervisor's
    // ruling over a worker that was already running. `../turn/indicators.ts` records why neither may read as
    // `completion` (nothing was answered) nor as `stopped` (an asker reads a warning as an error to act on).
    case "triaged-no-response":
    case "triage-cleanup-intended":
      return "acknowledged";
    // A reply IS owed here, and a person should give it — the opposite claim to the arm above, so it earns
    // its own ending rather than `acknowledged`, which would tell the asker their message needs nothing.
    case "left-for-a-human":
    case "handover-cleanup-intended":
      return "for-a-human";
    case "withheld":
    case "failed":
    case "answer-lost":
    case "dispatch-failed":
    case "lease-expired":
      return "stopped";
    // Everything below is an ask nobody is inside that has not ENDED: seen, carded, re-dispatch-eligible,
    // paused on a human, or holding a dispatch this fold reports through `activeDispatch` instead — so the
    // capture emoji, which says "seen, working on it", is what each of them truthfully wears. The four
    // dispatch-shaped kinds are unreachable with no `activeDispatch` and are spelled out anyway: an arm that
    // exists is cheaper than a reader working out whether it can be reached. `first-answered` is one of them —
    // a posted plan keeps its dispatch — and `working` is its truth regardless: the same worker is building.
    case "captured":
    case "checklist-posted":
    case "dispatched":
    case "dispatch-unwitnessed":
    case "dispatch-witnessed":
    case "first-answered":
    case "blocked-on-human":
    case "unblocked":
    case "redispatched":
      return "working";
  }
}

/**
 * Whether the tagged message needs converging — it is NOT already wearing `standing` alone. Pure and total.
 *
 * Two halves, and the second is the one that catches the measured case: the expected reaction must be
 * PRESENT, and no OTHER member of the lifecycle set may be. A message that had `:warning:` settled onto it
 * and then a live worker re-dispatched fails the second half while an "is eyes there" check alone would pass
 * it the moment anything put eyes back.
 *
 * Scoped to the lifecycle set on purpose, exactly as `./lifecycleReactions.ts`'s convergence is: a human's
 * own `:+1:` on the tagged message is not a lifecycle signal and must never provoke a write.
 *
 * **The residue, stated rather than discovered.** `reactions.remove` only ever removes the CALLER's own
 * reaction, and this predicate reads names rather than who added them, so a human's own `:eyes:` beside no
 * bot reaction at all reads as converged and nothing is written. That case is harmless — the message
 * visibly wears the right emoji — and distinguishing it would cost an `auth.test` the sweep does not carry.
 * The case that matters is the opposite one, where the bot's own stale emoji is standing, and the second
 * half above catches it.
 *
 * @param emojis the full lifecycle set, from `./lifecycleReactions.ts`'s `lifecycleReactionEmojis`
 * @param present the reaction names currently on the message, as Slack reports them
 * @param standing the one lifecycle reaction that should be left on it
 * @returns whether a convergence has to be written
 */
export function reactionConvergenceNeeded({
  emojis,
  present,
  standing,
}: {
  emojis: readonly string[];
  present: readonly string[];
  standing: string;
}): boolean {
  const on = new Set(present);
  if (!on.has(standing)) {
    return true;
  }
  return emojis.some((name) => name !== standing && on.has(name));
}
