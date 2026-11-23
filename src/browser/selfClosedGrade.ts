/**
 * The whole judgement of a page that closes the tab it was opened in: pure, total and unit-testable.
 *
 * `selfClosedTab.ts` runs it around a page visit; it lives apart so the shell can stay a shell. Why the
 * judgement exists, and the two measured shapes it grades, are in that module's own header.
 */
import type { ClientDiagnosis } from "./clientKill.js";

/**
 * The phrases a snippet reports when the PAGE it was driving went away, as against the relay.
 *
 * `session-closed` and `detached` name the relay and `version-skew` the client, so a snippet carrying any of
 * them is not a page closing itself however it was reported.
 */
const PAGE_GONE_PHRASES: ReadonlySet<ClientDiagnosis["phrases"][number]> = new Set(["target-closed", "browser-closed"]);

/**
 * The two ways a client ENDS on a page that closed itself: the snippet reporting it (exit 0), or the client
 * exiting non-zero carrying it. A client killed at its bound, one that never started or
 * overflowed its output, or an unclassified failure is not a page closing itself whatever phrase its output
 * happens to carry, so it keeps the relay's own verdict.
 */
const PAGE_GONE_KINDS: ReadonlySet<ClientDiagnosis["kind"]> = new Set(["snippet-reported", "exited-nonzero"]);

/**
 * How many pages a walk may lose to closing their own tab with no page captured between them.
 *
 * Derived, not tuned: Hex's declared surface carries exactly two such pages back to back (`/login-success`
 * then `/mcp-server-oauth-result`, `atlas/hex/generated/clientSurface.ts`), so two is the smallest bound that
 * walks it and one reproduces the measured stop. A third with nothing captured since is a browser killing
 * every tab, and the run stops without another rebuild.
 */
export const MAX_SELF_CLOSED_PAGES_WITHOUT_CAPTURE = 2;

/**
 * What to do about a page visit whose page went away, however the client reported it.
 *
 * @internal — the return of {@link selfClosedTabRecovery}.
 */
export type SelfClosedTabRecovery =
  /** Not a page closing itself; the visit's own error stands. */
  | "not-a-self-close"
  /** Rebuild the relay and visit the same page once more — a dropped relay recovers the page here. */
  | "rebuild-and-retry"
  /** The page closed a fresh tab too: rebuild so the walk can go on, and grade this page alone failed. */
  | "rebuild-and-lose-one-page"
  /** Too many pages have been lost this way since the last capture, so the browser is not coming back. */
  | "stop-the-run";

/**
 * Grade every failure one page visit has met so far. Pure: two values in, one out.
 *
 * A failure counts as the page going away when every phrase it carries is a page-gone one and the client
 * ended the way a closed page ends it — the snippet reported it (exit 0) or the client exited non-zero with it
 * (exit 1), never a client killed at its bound — the measured Hex stop was the
 * second shape on the page after the first. One such failure on this page buys a rebuild and a retry; a
 * second, on a freshly attached tab, is the page, so it is lost alone. What bounds it is
 * `selfClosedPagesSinceCapture`, not the reconnect bit: at {@link MAX_SELF_CLOSED_PAGES_WITHOUT_CAPTURE}
 * pages lost with nothing captured between, the run stops, so a browser that kills every tab cannot turn a
 * walk into an attach per page. The phrase alone cannot tell a page closing itself from an owner closing
 * Chrome, and this does not pretend to: an attach that cannot reach a browser fails `TRANSPORT_UNAVAILABLE`
 * and stops the walk.
 *
 * @param diagnoses every failure this page's visit has met, in order, across the relay's own retry and the
 *   visit's rebuild
 * @param selfClosedPagesSinceCapture pages already lost to closing their own tab since the last capture
 * @returns what the visit should do about it
 */
export function selfClosedTabRecovery({
  diagnoses,
  selfClosedPagesSinceCapture,
}: {
  diagnoses: readonly ClientDiagnosis[];
  selfClosedPagesSinceCapture: number;
}): SelfClosedTabRecovery {
  const pageGone = diagnoses.length > 0 && diagnoses.every((diagnosis) => isPageGone({ diagnosis }));
  if (!pageGone) {
    return "not-a-self-close";
  }
  if (selfClosedPagesSinceCapture >= MAX_SELF_CLOSED_PAGES_WITHOUT_CAPTURE) {
    return "stop-the-run";
  }
  return diagnoses.length === 1 ? "rebuild-and-retry" : "rebuild-and-lose-one-page";
}

/** Whether one failure is a page going away: a page-gone phrase only, ended the way a closed page ends a client. */
function isPageGone({ diagnosis }: { diagnosis: ClientDiagnosis }): boolean {
  return (
    PAGE_GONE_KINDS.has(diagnosis.kind) &&
    diagnosis.phrases.length > 0 &&
    diagnosis.phrases.every((id) => PAGE_GONE_PHRASES.has(id))
  );
}

/**
 * Which of one attempt's failures {@link selfClosedTabRecovery} grades.
 *
 * The relay's own earlier failures join the last one only while every one of them is a page going away — the
 * measured shape, a self-close the relay's reconnect retried into another. An earlier failure that is
 * anything else is a relay drop the relay already answered, so the attempt is graded exactly as it was before
 * both shapes reached one grader: a snippet's own report alone when the retried client exited 0, and nothing
 * when it did not.
 *
 * @param priorFailures what the relay's own retry met before the attempt's last client run, in order
 * @param last the last client run's failure — the snippet's report, or the client's own — or null for none
 * @returns the failures to grade, in order; empty grades `not-a-self-close`
 */
export function gradedFailures({
  priorFailures,
  last,
}: {
  priorFailures: readonly ClientDiagnosis[];
  last: ClientDiagnosis | null;
}): readonly ClientDiagnosis[] {
  if (last === null) {
    return [];
  }
  if (priorFailures.every((diagnosis) => isPageGone({ diagnosis }))) {
    return [...priorFailures, last];
  }
  return last.kind === "snippet-reported" ? [last] : [];
}

/**
 * Whether a page just lost for closing its own tab gives the NEXT page back the relay's reconnect.
 *
 * Only below the bound. The relay's own reconnect runs before a visit is graded, so a budget restored at the
 * bound would buy the next page one more rebuild before {@link selfClosedTabRecovery} could stop the run
 * Left spent instead, a thrown self-close on that page stops the run at once and a
 * reported one is graded `stop-the-run` here — neither rebuilds.
 *
 * @param selfClosedPagesSinceCapture pages lost this way since the last capture, the one just lost included
 * @returns true when the reconnect budget may be restored for the next page
 */
export function restoresReconnectAfterLostPage({
  selfClosedPagesSinceCapture,
}: {
  selfClosedPagesSinceCapture: number;
}): boolean {
  return selfClosedPagesSinceCapture < MAX_SELF_CLOSED_PAGES_WITHOUT_CAPTURE;
}
