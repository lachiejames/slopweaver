/**
 * The effectful half of releasing a reviewer: closing its cmux workspace and retiring its session-ledger row.
 *
 * Split out of `./review.ts` because it now has two callers of very different shapes — that verb's `--close`,
 * which releases a reviewer mid-ask under a hard liveness gate, and the ask's own terminal paths
 * (`./run.ts`'s posted answer, `./dispatchSweep.ts`'s finalised terminals), which release it because the ask
 * is over. `../../../live/turn/reviewRelease.ts` holds the pure decision and the reported line for both, and
 * its header carries the measured cost of leaving this to an instruction the worker was supposed to remember.
 */
import { dispatchSessionName } from "../../../cmux/planNames.js";
import { logger } from "../../../lib/logger.js";
import type { AskIdentity } from "../../../live/ask/identity.js";
import type { ReviewRecord } from "../../../live/turn/review.js";
import { reviewerReaping, reviewerReapLine } from "../../../live/turn/reviewRelease.js";
import { markReviewerReleased, readReviewRecord } from "../../../live/turn/reviewStore.js";
import { closeDispatchedSession } from "../../../live/turn/sessionLedger.js";
import { withCmuxSessionHost } from "../../../sessionHarness/cmuxHost.js";

/** Tear down one cmux workspace, answering cmux's refusal as text, or `undefined` when it closed. */
export type ReviewerWorkspaceCloser = (args: { workspaceId: string }) => Promise<string | undefined>;

/** The wall-clock instant a release is stamped with, ISO 8601. */
export type ReviewerReleaseNow = () => string;

/** The production closer: one connection for the one close, released whatever the close answered. */
const closeViaCmux: ReviewerWorkspaceCloser = async ({ workspaceId }) =>
  withCmuxSessionHost({
    body: async ({ host }) => {
      const closed = await host.closeWorkspace({ workspaceId });
      return closed.isErr() ? closed.error.message : undefined;
    },
  });

/** The production clock, sampled at the moment of the release. */
const releaseNowIso: ReviewerReleaseNow = () => new Date().toISOString();

/**
 * Close a reviewer's workspace when there is one to close, and retire its session-ledger row either way.
 *
 * The two halves are decided separately by the caller — a workspace cmux no longer lists has nothing to close
 * but still has an open ledger row, and leaving that row standing keeps the sweep naming a reviewer that does
 * not exist. A cmux failure is returned rather than thrown, and the ledger fold still runs, since an
 * unclosable workspace is exactly the case where the row most needs retiring.
 *
 * The record is stamped `releasedAt` either way, including when cmux refused: the point of the stamp is that
 * nothing tries this workspace again, and a workspace that could not be closed is the strongest case of all.
 *
 * @param closeWorkspace whether cmux has a workspace left to tear down
 * @param home the state home the session ledger lives under
 * @param record the review whose reviewer is being released
 * @param closeReviewer how the workspace is torn down; omitted, through a cmux client
 * @param nowIso the clock the release is stamped from, sampled after the close; omitted, the wall clock
 * @returns the cmux failure text, or `undefined` when there was nothing to close or the close succeeded
 */
export async function releaseReviewerWorkspace({
  closeWorkspace,
  home,
  record,
  closeReviewer = closeViaCmux,
  nowIso = releaseNowIso,
}: {
  closeWorkspace: boolean;
  home: string;
  record: ReviewRecord;
  closeReviewer?: ReviewerWorkspaceCloser;
  nowIso?: ReviewerReleaseNow;
}): Promise<string | undefined> {
  const failure = closeWorkspace ? await closeReviewer({ workspaceId: record.reviewer.workspaceId }) : undefined;
  const tsIso = nowIso();
  closeDispatchedSession({
    home,
    sessionKey: dispatchSessionName({ askChannel: record.channel, askMessageTs: record.messageTs, role: "review" }),
    tsIso,
    // This round's reviewer, never the key: three earlier rounds of the same review are still running under
    // it, and a ref-less close would retire their rows while their workspaces lived on.
    workspaceRef: record.reviewer.workspaceRef,
  });
  markReviewerReleased({ atIso: tsIso, home, record });
  return failure;
}

/**
 * Release the reviewer of an ask that has just reached a terminal outcome, and say so in one line.
 *
 * Never throws and never changes what its caller returns: the ask has already ended, and an unreleasable
 * workspace must not turn a posted answer or a finalised sweep into a failure. Reported rather than silent,
 * because a reviewer this could not close is exactly the one a person has to close by hand.
 *
 * @param askIdentity the ask that ended
 * @param home the resolved state home
 * @param terminal how the ask ended, in the words the reported line carries
 */
export async function reapAskReviewer({
  askIdentity,
  home,
  terminal,
}: {
  askIdentity: AskIdentity;
  home: string;
  terminal: string;
}): Promise<void> {
  const reaping = reviewerReaping({ record: readReviewRecord({ askIdentity, home }), terminal });
  if (reaping.kind === "nothing") {
    return;
  }
  let outcome: string | undefined;
  try {
    outcome = await releaseReviewerWorkspace({ closeWorkspace: true, home, record: reaping.record });
  } catch (error) {
    outcome = error instanceof Error ? error.message : String(error);
  }
  logger.out({ line: reviewerReapLine({ askIdentity, outcome, reaping }) });
}
