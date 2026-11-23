/*
 * The leaf both reading modes stand on: what a refusal looks like, and what is TRUE about one review.
 *
 * This module imports neither `./reviewPollRun.js` nor `./reviewClose.js`, and it holds no release, reap or
 * cleanup call of any kind. That absence is the mechanism described in `./review.ts` § "Reading a verdict and
 * closing a reviewer are two acts", not an accident of where the code landed: the original incident was a
 * call path from observation to teardown, so there is deliberately no shared "finish the review" helper, no
 * optional cleanup callback and no `finally` here for a future edit to hang one on. `--close` reaches
 * `releaseReviewerWorkspace` from its own module and nowhere else.
 */
import { realWorkspaceLivenessCheck } from "../../../cmux/liveness.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { AskIdentity } from "../../../live/ask/identity.js";
import type { ReviewRecord } from "../../../live/turn/review.js";
import { type ReviewPollTruth, reviewPollTruth } from "../../../live/turn/reviewPoll.js";
import { readReviewRecord, readVerdictFile } from "../../../live/turn/reviewStore.js";
import { type TurnCommandError, TurnCommandErrors } from "./errors.js";
import { readReviewerSurface } from "./reviewSurface.js";

/**
 * Print every reason a call is being refused, then hand back the exit code the caller returns.
 *
 * Shared by all three modes so a refusal reads the same whichever one produced it.
 *
 * @returns the code it was given, unchanged
 */
export function refuse({ code, errors }: { code: number; errors: readonly string[] }): number {
  for (const error of errors) {
    logger.error({ msg: error });
  }
  return code;
}

/**
 * Read one review's current truth, from its record, its verdict file and — whenever that file is not this
 * reviewer's own verdict — cmux's view of the workspace.
 *
 * Shared by `--poll` and `--close` so the two can never disagree about what is true; what they DO with it is
 * the only thing that differs, which is the whole point of their being two verbs.
 *
 * `delivery` is read from the same place the dispatch leg reads the worker's — cmux's own
 * `latest_submitted_message` for the recorded workspace — and only when the verdict file has not already
 * spoken, for the same reason liveness is not consulted then: a reviewer that wrote its verdict plainly got
 * its pickup, and asking again would spend a cmux round trip to learn nothing.
 *
 * The same read carries the SCREEN, and passing it on is what stops this verb calling a working reviewer
 * stranded. `readReviewerSurface` has always returned both over one connection; the poll fetched the screen
 * and dropped it on the floor while asserting a certainty only the screen could settle.
 *
 * @param askIdentity which ask's review to read
 * @param home the state home the review lives under
 * @returns the record and its truth, or the reason there is nothing to read
 */
export async function readReviewTruth({
  askIdentity,
  home,
}: {
  askIdentity: AskIdentity;
  home: string;
}): Promise<Result<{ readonly record: ReviewRecord; readonly truth: ReviewPollTruth }, TurnCommandError>> {
  const record = readReviewRecord({ askIdentity, home });
  if (record === undefined) {
    return err(TurnCommandErrors.reviewNotOpen({ channel: askIdentity.channel, messageTs: askIdentity.messageTs }));
  }
  const verdictRead = readVerdictFile({ record });
  if (verdictRead.kind === "present") {
    const liveness = {
      kind: "unknown" as const,
      reason: "not consulted — this reviewer's own verdict spoke",
      workspaceId: record.reviewer.workspaceId,
    };
    const delivery = { kind: "confirmed" as const, submittedAtIso: undefined };
    const nowIso = new Date().toISOString();
    const truth = reviewPollTruth({ delivery, liveness, nowIso, record, screen: undefined, verdictRead });
    return ok({ record, truth });
  }
  const liveness = await realWorkspaceLivenessCheck()({ workspaceId: record.reviewer.workspaceId });
  const { delivery, screen } = await readReviewerSurface({ record });
  const nowIso = new Date().toISOString();
  const truth = reviewPollTruth({ delivery, liveness, nowIso, record, screen, verdictRead });
  return ok({ record, truth });
}
