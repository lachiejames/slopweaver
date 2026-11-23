/**
 * The phase gate every journal-writing lifecycle verb passes through — which verb may run against which
 * derived run phase, as one pure table.
 *
 * Split out of {@link ./lifecycle.js} (the file-size ratchet), which holds the verbs themselves. It belongs
 * on its own because it is the one piece of the lifecycle that knows about EVERY verb at once: each new verb
 * adds a clause here, so a file holding the verbs and the table together grows on both axes for one change.
 * It reads nothing but its three arguments — no doc, no journal, no clock — which is what lets a test drive
 * every verb-by-phase pair directly.
 */

import type { RunPhase } from "../../../handover/ledger.js";

/** The verbs that act on an OPEN question, and what each says when there is none. */
const NEEDS_OPEN_QUESTION: ReadonlyMap<string, string> = new Map([
  ["answer", "this run has no recorded question to answer"],
  ["correct", "this run has no open question to correct — `handover ask` records one"],
  ["offer", "this run has no open question to offer an action on — `handover ask` records one"],
  ["reconfirm", "this run has no open question to re-confirm — nothing is waiting on the owner here"],
  ["withdraw", "this run has no open question to withdraw — nothing is waiting on the owner here"],
]);

/**
 * Whether a journal-writing verb may run, given the run's phase.
 *
 * This closes a silent-failure hole an adversarial pass found: `ask` was reachable with no run open at all, so
 * it appended a `question` event, printed "recorded the question and paused the run" — and `runStateOf` then
 * discarded it, because derivation reads only from the last `started`. The question was written to disk and
 * simultaneously invisible, which is exactly the class this feature exists to remove.
 *
 * Refusing is the honest answer rather than making derivation honour a pre-start question: with no run open
 * there is nothing to pause, nothing to answer and nothing to abandon.
 *
 * @param verb the verb being attempted
 * @param phase the run's derived phase
 * @param dispatchPending whether a dispatch is still awaiting any response, which only `abandon` may act on
 * @returns `undefined` when it may proceed, otherwise the sentence explaining why not
 */
export function phaseRefusal({
  verb,
  phase,
  dispatchPending,
}: {
  verb: string;
  phase: RunPhase;
  dispatchPending: boolean;
}): string | undefined {
  if (phase === "closed") {
    // The one exemption, and it is `abandon` alone. A journal holding only a `dispatched` event derives phase
    // `closed` — correctly, since a dispatch is deliberately inert in the phase reducer so that a no-show stays
    // detectable as a dispatch with no start after it. Without the exemption the state is UNCLEARABLE: measured
    // against a real `cmux spawn`, `abandon` refused with "no run is open", so the supervisor who dispatched
    // could not deliberately give up on its own dispatch, and the entry sat in every later digest forever.
    // `abandon` is exactly the typed way to say "this is not happening", so it is the verb that gets the
    // exemption; every other verb still wants a run that was actually started.
    if (!(verb === "abandon" && dispatchPending)) {
      return `no run is open for this doc — \`slopweaver handover start\` it first`;
    }
  }
  const needsQuestion = NEEDS_OPEN_QUESTION.get(verb);
  if (needsQuestion !== undefined && phase !== "waiting-on-owner") {
    return needsQuestion;
  }
  // `handover ask` reaches this only when its reshape path (`./askReshape.ts`) declined: the waiting question
  // already carries a shape or a draft, or the journal has a line this build cannot read.
  if (verb === "ask" && phase === "waiting-on-owner") {
    return (
      "this run is already waiting on a question that carries a shape or a draft (or its journal has a line this " +
      "build cannot read) — `handover correct` restates its wording, `handover offer` replaces its shape with a " +
      "draft, and a different decision waits for the owner's answer"
    );
  }
  return undefined;
}
