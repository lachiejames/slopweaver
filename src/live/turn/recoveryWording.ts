/**
 * WHAT A FAILED TURN SAYS TO THE PERSON WATCHING — a statement of what broke, never an instruction to the
 * reader to restart it by hand.
 *
 * ## The measured failure this exists for
 *
 * Over one week of real bot turns, seven asks never posted an answer. Five of those
 * never reached a session at all, and four of the five ended with a public card telling the person who asked
 * to tag the bot again. Reproduce the class over any live home with:
 *
 * ```
 * jq -r 'select(.kind=="dispatch-failed") | .reason' "$SLOPWEAVER_HOME/live/slack/asks.jsonl" | sort | uniq -c
 * ```
 *
 * The owner's ruling on it was flat: they would never want to re-tag the bot to get it going again, and if it
 * breaks it needs to recover on its own. They also kept the loud part — a failure nobody can see is worse than
 * one stated badly — so the card still says something went wrong. What goes is the homework.
 *
 * ## Why this is wording rather than a retry
 *
 * Doctrine rule 2 is explicit that a tag arriving when no session is running is a no-op BY DESIGN, and that
 * no queue consumption, restart or retry may be added to catch it. So this module adds none. It states the
 * truth the code already establishes: `dispatch-failed` is re-dispatch-safe, so a visible session that
 * reaches this ask afterwards still answers it and the card corrects forward. That is a fact about the
 * system, not a promise about timing, and the wording is careful not to imply one.
 *
 * **A RUNNING VISIBLE session actually does reach it** — `../listen/stranded.ts` picks each
 * stranded ask up exactly once, from inside a pass the loop session runs itself. The wording below is
 * unchanged by that and deliberately so: a card cannot promise a session will be running, and the whole
 * point of the bound is that with none running the ask stays stranded and this sentence stays standing.
 *
 * MEASURED, and the reason the wording promises nothing: `./dispatch.ts`'s own note records four of seven
 * historical cases later dispatched and answered anyway — but over that week's window, ZERO of the
 * four went on to be answered. Whatever the recovery rate is, it is not a guarantee, and a card that implied
 * one would be the second lie after "re-tag".
 */

/**
 * Which half of the failure the reader is being told about.
 *
 * `follow-through-stopped` is the one context where the thread already HAS an answer: the worker posted its
 * first answer (the plan) and then stopped, or ran out of time, before building what it promised. The card
 * must not read as though nothing was said — the plan is standing directly above it.
 */
export type RecoveryContext =
  "nothing-ran" | "never-routed" | "lease-ran-out" | "worker-stopped" | "follow-through-stopped";

/** The reader-facing finding a `follow-through-stopped` card leads with — the plan above it stands. */
export const FOLLOW_THROUGH_STOPPED_FINDING = "the first answer above was posted";

/**
 * The sentence appended to a failure reason on the card the asker sees.
 *
 * Says what the state is and what will happen without them, and stops. No imperative, because the one thing
 * the owner ruled out is the reader being handed the job.
 *
 * @param context which failure this is
 * @returns the trailing clause, without leading punctuation
 */
export function recoveryClause({ context }: { context: RecoveryContext }): string {
  if (context === "nothing-ran") {
    return "nothing ran, and this is still waiting for a session to pick it up";
  }
  if (context === "lease-ran-out") {
    return "it is back in the queue for a session to pick up";
  }
  if (context === "worker-stopped") {
    return "it is back in the queue for another session to take";
  }
  if (context === "follow-through-stopped") {
    return "the session building it stopped before it finished; one re-dispatch pending";
  }
  return "no session picked it up, and it is still waiting for one";
}

/**
 * The whole reader-facing reason for a swept ask that did not answer.
 *
 * @param context which failure this is
 * @param reason the sweep's own finding, already colleague-safe
 * @returns the composed sentence for the card
 */
export function recoveryCardReason({ context, reason }: { context: RecoveryContext; reason: string }): string {
  return `${reason}; ${recoveryClause({ context })}`;
}
