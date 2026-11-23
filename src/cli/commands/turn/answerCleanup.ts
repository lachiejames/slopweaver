/**
 * What `turn answer` closes up AFTER the answer is in the thread — the reviewer's workspace, the worker's
 * own, and the session-ledger row that named it.
 *
 * Split out of `./postAnswer.ts` along the seam the verb's own ordering already draws: everything here runs
 * strictly after the durable completion exists, so nothing in it can change whether the turn answered, and
 * a failure in any of it is reported rather than allowed to read as the turn failing. That is also why none
 * of it runs on the non-terminal refusal — `../../../live/turn/runContract.ts`'s `AnswerSendRefusal`
 * leaves the worker alive and holding the answer, so closing its workspace would destroy the session that
 * is about to correct and re-offer it.
 *
 * A posted FIRST answer (`first-answered`, a form declaring `followThrough`) is the other non-ending, and
 * only its reviewer is released: the worker is still building what the answer promised. Closing its
 * workspace here is the self-reap measured on one ask, where a worker
 * obeying the answer-first rule was gone within a minute of posting its plan.
 */

import { logger } from "../../../lib/logger.js";
import type { AskIdentity } from "../../../live/ask/identity.js";
import type { TurnCompletion } from "../../../live/turn/envelope.js";
import { closeDispatchedSession } from "../../../live/turn/sessionLedger.js";
import { withCmuxSessionHost } from "../../../sessionHarness/cmuxHost.js";
import { EXIT_ERROR } from "../../exitCodes.js";
import type { DispatchedWorker } from "./loadInputs.js";
import { reapAskReviewer } from "./reviewReap.js";

/**
 * Close a dispatched fresh workspace only after the durable completion confirms Slack accepted the answer.
 *
 * Direct answers have no workspace. Withheld and failed turns did not post an answer, so their visible
 * workspace remains available for diagnosis. Closing is attempted by the original loop after the turn
 * returns; the fresh child never closes itself because its live screen is the readiness proof this process
 * must read first.
 *
 * @param completion the durable turn outcome returned after Slack posting and completion persistence
 * @param workspaceId the dispatched cmux workspace's id, absent for direct mode
 * @param close the effectful close seam, returning the failure text or `undefined`
 * @returns undefined on success or no-op; otherwise the close failure text
 */
export async function closeAnsweredDispatchWorkspace({
  completion,
  workspaceId,
  close,
}: {
  completion: TurnCompletion;
  workspaceId: string | undefined;
  close: (input: { workspaceId: string }) => Promise<string | undefined>;
}): Promise<string | undefined> {
  if (workspaceId === undefined || completion.primary.kind !== "answered") {
    return undefined;
  }
  return close({ workspaceId });
}

/**
 * Close both cmux workspaces a posted turn leaves behind — the reviewer's, then the worker's own.
 *
 * A failure here is reported and returns non-zero, but only AFTER the answer went — the answer reaching the
 * thread is the point of the turn, and an orphaned workspace is the recoverable half of this pair.
 *
 * The REVIEWER is released here rather than by the worker remembering `turn review --close`, and the ordering
 * is why: this function's next act closes the worker's own workspace, so a worker that had not released its
 * reviewer by now never gets another chance to. Measured: six reviewer workspaces left standing
 * on one ask. `./reviewReap.ts` has the rest, and never throws.
 *
 * @param askIdentity the ask that just ended, which is the key its review record answers to
 * @param code the exit code the lifecycle report produced
 * @param home the state home the session ledger lives under
 * @param outcome the answer completion, which says whether anything was posted at all
 * @param worker the dispatched worker this turn ran in, absent for a direct answer
 * @returns the exit code
 */
export async function closeWorkspaceAfterAnswer({
  askIdentity,
  code,
  home,
  outcome,
  worker,
}: {
  askIdentity: AskIdentity;
  code: number;
  home: string;
  outcome: TurnCompletion;
  worker: DispatchedWorker | undefined;
}): Promise<number> {
  if (outcome.primary.kind === "answered") {
    await reapAskReviewer({ askIdentity, home, terminal: "answered and posted" });
  }
  // A FIRST answer spent its reviewer's verdict, so that reviewer goes — and NOTHING else does. The worker
  // is still building what the answer promised, so its workspace and its ledger row stay exactly as they
  // are; the final answer closes both through the arm below.
  if (outcome.primary.kind === "first-answered") {
    await reapAskReviewer({ askIdentity, home, terminal: "first answer posted, follow-through still owed" });
    return code;
  }
  const closeFailure = await closeAnsweredDispatchWorkspace({
    close: ({ workspaceId: id }) =>
      withCmuxSessionHost({
        body: async ({ host }) => {
          const closed = await host.closeWorkspace({ workspaceId: id });
          return closed.isErr() ? closed.error.message : undefined;
        },
      }),
    completion: outcome,
    workspaceId: worker?.workspaceId,
  });
  if (closeFailure !== undefined) {
    logger.error({
      // `worker!` is honest rather than substituted: a close is only ATTEMPTED when `worker.workspaceId` was
      // there, so a close failure proves the worker is there too.
      msg: `answer posted, but the dispatched cmux workspace ${worker!.workspaceRef} could not be closed: ${closeFailure}`,
    });
    return EXIT_ERROR;
  }
  if (worker !== undefined) {
    closeDispatchedSession({
      home,
      sessionKey: worker.sessionKey,
      tsIso: new Date().toISOString(),
      workspaceRef: worker.workspaceRef,
    });
  }
  return code;
}
