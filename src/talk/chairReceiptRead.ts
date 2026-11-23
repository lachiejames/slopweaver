/**
 * The effectful half of `./chairReceipt.ts`: read how far the supervisor cursor has read the owner's words and the chair
 * chain's turns since a relay, and hand them to the pure judgement. Every failure here supplies NO receipt and blocks
 * nothing — an unreadable chair leg or cursor must never read as the chair having the owner's words, and never stop the read
 * that asked. A Codex chair's transcript leg is such a leg until its rollout is read (slice 4b-ii): its turns are not
 * walked, so it supplies no `line` receipt. The cursor arm still answers for it, on purpose: the supervisor cursor is
 * a home file the chair marks through `talk unread` whichever host it runs on, so a relay behind it was read by the
 * chair, and no Claude transcript is consulted to say so.
 */
import { readSupervisorChainEvents } from "../supervisor/chainStore.js";
import { claudeHomeDir } from "../supervisor/chairRead.js";
import { readSupervisorChainTurns } from "../supervisor/intakeRead.js";

import { type ChairReceipt, type CursorCoverage, chairReceiptOf, cursorCoverageOf } from "./chairReceipt.js";
import { SUPERVISOR_UNREAD_CURSOR } from "./unreadCursorStore.js";
import { readUnread } from "./unreadRead.js";

/**
 * How far the supervisor's `talk unread` cursor has read across every call: the relay lines behind its frontiers.
 *
 * @param home the Slopweaver home the cursor and call files live under
 * @returns the coverage, or `undefined` when the cursor was never marked or the read fails — either way no receipt
 */
export function supervisorCursorCoverage({ home }: { home: string }): CursorCoverage | undefined {
  const read = readUnread({ home, name: SUPERVISOR_UNREAD_CURSOR, nowIso: new Date().toISOString() });
  if (read.isErr()) {
    return undefined;
  }
  return cursorCoverageOf({ read: read.value });
}

/**
 * The receipt the chair holds for one relay, reading the chain's turns only from when the owner said it.
 *
 * @param home the Slopweaver home the chain journal, pin, cursor and call files live under
 * @param stagedAtIso when the owner said it, which floors the transcript read
 * @param turnId the relay's whole turn id, which its call line carries and its slug derives from
 * @returns the receipt, or `undefined` when the chair holds none that could be read
 */
export function readChairReceipt({
  home,
  stagedAtIso,
  turnId,
}: {
  home: string;
  stagedAtIso: string;
  turnId: string;
}): ChairReceipt | undefined {
  const { turns } = readSupervisorChainTurns({
    chain: readSupervisorChainEvents({ home }),
    claudeHome: claudeHomeDir(),
    home,
    sinceIso: stagedAtIso,
  });
  return chairReceiptOf({ cursor: supervisorCursorCoverage({ home }), turnId, turns });
}
