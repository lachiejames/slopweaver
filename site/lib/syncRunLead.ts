/**
 * A sync run panel's state chip and lead line. A state the panel knows chips as itself; `failed` leads with
 * `failedRunLeadOf`'s fixed sentence and any other known state with the verb's own sentence. A state the panel has no
 * words for is never printed: it chips as "unknown", leads plainly, and folds the stored state and the verb's sentence,
 * which a forward producer may fill with a raw error.
 */
import { failedRunLeadOf } from "./plainReason";

/** The run states `src/syncRun/fold.ts` writes and the panel draws. */
const KNOWN_STATES: ReadonlySet<string> = new Set(["running", "finished", "ended-unfinished", "failed", "unreadable"]);

/**
 * The chip, the lead and what folds under it for one sync run.
 *
 * @param state the run's stored state, as `readSyncRun` read it
 * @param why the verb's sentence about the run
 * @param errors the run's stored errors, which decide a failed run's lead
 * @returns the chip word, the lead line, and the raw text to fold, `undefined` when nothing folds
 */
export function syncRunLeadOf({ state, why, errors }: { state: string; why: string; errors: readonly string[] }): {
  chip: string;
  lead: string;
  raw: string | undefined;
} {
  if (!KNOWN_STATES.has(state)) {
    return {
      chip: "unknown",
      lead: "In a state this page does not know yet.",
      raw: `Its recorded state: ${state}\n${why}`,
    };
  }
  if (state === "failed") {
    return { chip: state, lead: failedRunLeadOf({ errors }), raw: undefined };
  }
  return { chip: state, lead: why, raw: undefined };
}
