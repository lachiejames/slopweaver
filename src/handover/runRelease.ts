/**
 * Which journal events RELEASE a run's writer, and the reason each one reads as.
 *
 * Two do: `released`, a session letting go of its own run, and `parked`, a seat closed at rest on the owner. A
 * parked seat is CLOSED, so its writer is released rather than left to die: a dead writer on a waiting run is
 * exactly what `handover reap` orphans, which would close the cycle the checkpoint lives in. Its own module so
 * `./runOwner.ts`'s fold reads one release case rather than one per kind.
 */
import type { RunEvent } from "./ledger.js";

/**
 * Why `event` releases the writer `holder` names.
 *
 * @param event one event of the run's current cycle
 * @param holder the session id of the writer the fold holds at that event, if any
 * @returns the release reason, or `undefined` when the event releases nothing — including a release or park
 *   that names some other session, which a stale act cannot use to clear the live writer
 */
export function releaseWhyOf({ event, holder }: { event: RunEvent; holder: string | undefined }): string | undefined {
  if (event.kind === "released" && event.sessionId === holder) {
    return event.why;
  }
  if (event.kind === "parked" && event.sessionId === holder) {
    return (
      `parked at rest and closed ${event.workspaceRef}; a reseat reopens ${event.worktree}, else rebuilds it ` +
      `from ${event.branch}`
    );
  }
  return undefined;
}
