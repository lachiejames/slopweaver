/**
 * The one plain line a run on the timeline leads with, and what folds beneath it: the words its verb said read
 * plainly (`plainReasonOf`), its whole record kept exactly as stored, and a stored state the page has no words for
 * kept reachable rather than printed as a headline. Pure; `./runTimeline.ts` draws the bullets around it.
 */
import { plainReasonOf } from "./plainReason";

/**
 * The headline of a run in a state this page has no words for: coloured as a failure so it cannot pass for fine, and
 * never the stored code itself, which folds beneath instead (`foldWithState`).
 */
export const UNKNOWN_STATE_HEADLINE = "In a state this page does not know yet";

/**
 * A run's fold with an unknown stored state on top, so the code the headline would not print stays reachable.
 *
 * @param errorDetail what already folds under the run
 * @param unknownState the stored state or outcome the page has no words for
 * @returns the fold
 */
export function foldWithState({
  errorDetail,
  unknownState,
}: {
  errorDetail: string | undefined;
  unknownState: string | undefined;
}): string | undefined {
  if (unknownState === undefined) {
    return errorDetail;
  }
  const line = `Its recorded state: ${unknownState}`;
  if (errorDetail === undefined) {
    return line;
  }
  return `${line}\n${errorDetail}`;
}

/**
 * A run's words as one plain line above the fold, and its whole record beneath. The line is read off the words the verb
 * already said, so a stack trace or a JSON body those words carried never leads; the record folds
 * whenever it is not those words exactly, and the words themselves fold when the line had to replace them. A FAILED run
 * that said nothing in words is still said plainly off its record, folded whole (a bare `… exited 1` reads as a command
 * that gave no reason), or as one that gave no message when it kept no record either, so a red headline never stands
 * alone; any other run that said nothing draws no line, and one that did not fail
 * draws none either, its words folded beneath its headline.
 *
 * @param said the run's own words, as the verb said them
 * @param record the run's whole record, exactly as its ledger stored it
 * @param failed whether the run is drawn as a failure, which alone earns a line when it said nothing
 * @returns the line and its fold
 */
export function plainLineOf({
  said,
  record,
  failed,
}: {
  said: string | undefined;
  record: string | undefined;
  failed: boolean;
}): {
  error: string | undefined;
  errorDetail: string | undefined;
} {
  if (said === undefined) {
    if (!failed) {
      return { error: undefined, errorDetail: undefined };
    }
    if (record === undefined) {
      return { error: "It failed without giving an error message.", errorDetail: undefined };
    }
    return { error: plainReasonOf({ why: record }).plain, errorDetail: record };
  }
  // A run that did not fail (a deferral's reason for waiting) is no error, so no failure sentence leads it: its words
  // fold under its own neutral headline, the whole record when it kept one.
  if (!failed) {
    return { error: undefined, errorDetail: record ?? said };
  }
  const reason = plainReasonOf({ why: said });
  if (record !== undefined && record !== said) {
    return { error: reason.plain, errorDetail: record };
  }
  return { error: reason.plain, errorDetail: reason.raw };
}
