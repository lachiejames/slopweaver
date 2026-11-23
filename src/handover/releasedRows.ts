/**
 * Which open runs a session deliberately let go of — `handover release` — so the Fleet page can say how many rows
 * sit started with nobody holding them, and why.
 *
 * The Fleet page shows the doctrine is being followed: a chair that calls the board quiet while rows sit unseated
 * needs the page to show the owner otherwise, and a released run is one of the reasons. `handover list --json` publishes only a run's disposition, never its ownership, so `handover reconcile`
 * — which already reads every journal — publishes this beside its other holds.
 *
 * A PARK also releases the writer (`./runRelease.ts`), but a parked run waits on a wake or on the owner, and the Fleet
 * page counts it as parked. So a run is counted only when no park stands on it (`activeParkedCheckpoint`, the
 * reader the page itself uses), the ownership fold says it sits released, AND the one event that emptied its
 * writer, found by position through that same fold, is a `released`. Every looser reading fails a counterexample:
 * matching instants, trusting the latest disposition event, and ignoring a standing park
 * each named a parked run or hid a released one. A run that is closed or waiting on the owner is not counted either:
 * the first has ended, and the second is the Queue's.
 *
 * Residue, stated: "closed" means whatever `runStateOf` folds, so an `answered`
 * line written after a `finished` reads the run open here exactly as it does on the board itself. No verb writes
 * that order, because `handover answer` is refused unless the run is waiting on the owner; only a hand edit of the
 * shared journal does, and the fix for it belongs in that fold, not in a second reading of closure here.
 *
 * One unreadable journal makes the whole answer `unread` and names every such slug, because a count over the
 * journals that did read would print as measured while missing the very run that might be released.
 */
import type { JournalEvidence } from "./assemble.js";
import { type RunEvent, runStateOf } from "./ledger.js";
import { activeParkedCheckpoint } from "./parked.js";
import { runOwnership, writerOf } from "./runOwner.js";

/** The released rows, or why they could not be counted. */
export type ReleasedRowsRead =
  | { readonly kind: "read"; readonly ids: readonly string[] }
  | { readonly kind: "unread"; readonly unreadableIds: readonly string[]; readonly why: string };

/**
 * The one event that emptied the run's writer: the event right after the longest prefix that still names one.
 * Read by position through the ownership fold itself, so no instant and no session id is matched by hand.
 *
 * @returns the event, or `undefined` when no prefix ever named a writer
 */
function emptyingEventOf({ events }: { events: readonly RunEvent[] }): RunEvent | undefined {
  for (let end = events.length - 1; end >= 0; end -= 1) {
    if (writerOf({ events: events.slice(0, end) }) !== undefined) {
      return events[end];
    }
  }
  return undefined;
}

/**
 * Whether one journal's run is open, no park stands on it, and the event that let go of its writer is a
 * deliberate `released`.
 *
 * @returns whether it was
 */
function deliberatelyReleased({ evidence }: { evidence: JournalEvidence }): boolean {
  const { events } = evidence;
  if (runStateOf({ events }).phase !== "open" || activeParkedCheckpoint({ events }) !== undefined) {
    return false;
  }
  if (runOwnership({ events, sessionId: undefined }).kind !== "released") {
    return false;
  }
  return emptyingEventOf({ events })?.kind === "released";
}

/**
 * The slugs whose open run a session deliberately released, sorted — or every slug whose journal would not read.
 *
 * @param journals every doc's current-cycle journal evidence, by slug, as `handover reconcile` read it
 * @returns the read
 */
export function releasedRowsOf({ journals }: { journals: ReadonlyMap<string, JournalEvidence> }): ReleasedRowsRead {
  const unreadableIds = [...journals.entries()]
    .filter(([, evidence]) => evidence.unreadableLines.length > 0)
    .map(([slug]) => slug)
    .toSorted();
  if (unreadableIds.length > 0) {
    return {
      kind: "unread",
      unreadableIds,
      why: `${String(unreadableIds.length)} run journal(s) carry a line this build could not read`,
    };
  }
  const ids = [...journals.entries()]
    .filter(([, evidence]) => deliberatelyReleased({ evidence }))
    .map(([slug]) => slug)
    .toSorted();
  return { ids, kind: "read" };
}
