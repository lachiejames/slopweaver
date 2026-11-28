/**
 * The comments already on an open pull request as a description review judges them: read whole from GitHub, with
 * every thread the write itself resolves marked superseded.
 *
 * `github pr review-prepare` builds the packet from this and the write verbs' last check
 * (`../../cli/commands/github/descriptionReviewCheck.ts`) re-reads it, so both see the same marks from the same
 * sources. A write that posts inline comments is a self-review round, and a round resolves the previous round its
 * ledger owns in the same mutation (`../../cli/commands/github/selfReviewRun.ts`), so those threads are read from the
 * same ledger, through the same {@link ownedThreadIds}, bound to the pull request's node id the read returned. A write
 * posting no comments resolves nothing, so the ledger is not read at all. A round whose send would refuse on a held
 * reservation resolves nothing either, so that write is refused here rather than reviewed as if it would.
 */
import { err, ok, type Result } from "#lib/result.js";

import type { DescriptionReviewCommentsReader } from "./descriptionReviewComments.js";
import { type DescriptionReviewError, DescriptionReviewErrors } from "./descriptionReviewErrors.js";
import { markSupersededReviewComments } from "./descriptionReviewHistory.js";
import type { DescriptionReviewComment, ExistingPullRequestComment } from "./descriptionReviewTypes.js";
import {
  readSelfReviewReservation,
  readSelfReviewRound,
  selfReviewLockHeld,
  selfReviewLocus,
} from "./selfReviewLedger.js";
import { ownedThreadIds } from "./selfReviewRound.js";

/**
 * Read an open pull request's comments and mark the threads this write resolves.
 *
 * @param outgoingComments the inline comments the write posts; non-empty means a self-review round
 * @param readComments reads the pull request's comments; a test passes a plain function
 * @returns the comments, superseded marks applied, or why they or the round's ledger could not be read
 */
export async function readDescriptionReviewEvidence({
  home,
  owner,
  repo,
  number,
  outgoingComments,
  readComments,
}: {
  home: string;
  owner: string;
  repo: string;
  number: number;
  outgoingComments: readonly DescriptionReviewComment[];
  readComments: DescriptionReviewCommentsReader;
}): Promise<Result<readonly ExistingPullRequestComment[], DescriptionReviewError>> {
  const reading = await readComments({ home, number, owner, repo });
  if (reading.isErr()) {
    return err(reading.error);
  }
  if (outgoingComments.length === 0) {
    return ok(reading.value.comments);
  }
  const locus = selfReviewLocus({ number, owner, repo });
  const round = readSelfReviewRound({ home, locus, pullRequestId: reading.value.pullRequestId });
  if (round.isErr()) {
    // An untrusted ledger names no thread this write would resolve, and the round's own send refuses on it too.
    return err(DescriptionReviewErrors.commentsReadFailed({ detail: round.error.join("; ") }));
  }
  // A held reservation or lock makes the round's own send refuse before it resolves anything
  // (`preDoorPreviousRound`, `../../cli/commands/github/selfReviewRun.ts`), so marking that round superseded would
  // hide a thread that stays live after the description goes out. The same two reads, the same refusal.
  const held = readSelfReviewReservation({ home, locus });
  if (held.isErr()) {
    return err(DescriptionReviewErrors.commentsReadFailed({ detail: held.error.join("; ") }));
  }
  if (held.value !== null) {
    return err(DescriptionReviewErrors.selfReviewReserved({ heldHeadSha: held.value.headSha, number, owner, repo }));
  }
  if (selfReviewLockHeld({ home, locus })) {
    return err(DescriptionReviewErrors.selfReviewReserved({ heldHeadSha: null, number, owner, repo }));
  }
  return ok(
    markSupersededReviewComments({
      comments: reading.value.comments,
      supersededThreadIds: ownedThreadIds({ read: round.value }),
    }),
  );
}
