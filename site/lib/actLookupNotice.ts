/**
 * The sentence a finding act's by-branch pull-request lookup adds to its card (`./queueActRow.ts` `withLookedUpPull`).
 * Its own module because the rows module sits against the file-size cap.
 *
 * Pure: a lookup state in, a sentence out.
 */
import type { ActPullState } from "./actPullVerb";
import type { ReasonWords } from "./quotedReason";

/**
 * The sentence a by-branch lookup adds to an act card, so a missing link is always said rather than blank. A lookup
 * that failed with a reason keeps that reason apart from the console's lead, so the card says it plainly with the raw
 * message folded beneath; every other notice is the console's own words.
 *
 * @param lookup the lookup's state
 * @returns the notice, or `undefined` when the lookup found exactly the one pull request it links
 */
export function lookupNoticeOf({ lookup }: { lookup: ActPullState }): ReasonWords | undefined {
  if (lookup.phase === "idle") {
    return undefined;
  }
  if (lookup.phase === "loading") {
    return `Looking up the pull request opened from branch ${lookup.branch}, merged or not.`;
  }
  if (lookup.phase === "not-measured") {
    if (lookup.why.trim() === "") {
      return `The pull request opened from branch ${lookup.branch} could not be looked up, and the lookup gave no reason.`;
    }
    return [{ lead: `The pull request opened from branch ${lookup.branch} could not be looked up`, why: lookup.why }];
  }
  if (!Number.isInteger(lookup.unchecked) || lookup.unchecked < 0) {
    // `actPullStateOf` refuses this answer already; a caller building one by hand gets the same sentence.
    return `The pull request opened from branch ${lookup.branch} could not be looked up: ${String(lookup.unchecked)} unread matches is not a count.`;
  }
  let unread = "";
  if (lookup.unchecked > 0) {
    unread = ` ${String(lookup.unchecked)} more search matches were not read, so one of them may be it.`;
    if (lookup.unchecked === 1) {
      unread = " 1 more search match was not read, so it may be it.";
    }
  }
  if (lookup.pulls.length === 0) {
    return `No pull request, open or merged, was opened from branch ${lookup.branch}.${unread}`;
  }
  if (lookup.pulls.length > 1) {
    return `${String(lookup.pulls.length)} pull requests were opened from branch ${lookup.branch}, so each is linked and the card is about neither.${unread}`;
  }
  if (unread !== "") {
    // One exact match with candidates unread proves it was opened from the branch, not that it is the only one.
    return `This pull request was opened from branch ${lookup.branch}, but the card is not about it yet:${unread}`;
  }
  return undefined;
}
