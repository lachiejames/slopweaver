/** The governed submit, resolve, readback and local-confirmation path for one self-review round. */
import { DEFAULT_GATES } from "../../../admit/door.js";
import type { DoorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { throughDoor } from "../../../admit/effects.js";
import type { GithubWriteApi, WrittenPr } from "../../../corpus/github/write.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { renderSelfReviewComments, type SelfReviewForm } from "../../../outbound/github/selfReview.js";
import {
  confirmSelfReviewRound,
  readSelfReviewReservation,
  readSelfReviewRound,
  releaseSelfReviewReservation,
  reserveSelfReviewRound,
  selfReviewFormHash,
  selfReviewLockHeld,
  selfReviewLocus,
} from "../../../outbound/github/selfReviewLedger.js";
import { ownedThreadIds, type SelfReviewRoundRead } from "../../../outbound/github/selfReviewRound.js";
import { githubSelfReviewDoorRequest, reviewThreadIdsFor, selfReviewDiffAnchorRefusals } from "./selfReviewCore.js";
import { type GithubSelfReviewOutcome, reservationTakenOutcome, withSetAside } from "./selfReviewOutcome.js";

/** The three provider operations the review lifecycle consumes. */
export type GithubSelfReviewApi = Pick<GithubWriteApi, "diffFiles" | "reviewThreads" | "submitReviewRound">;

/** Confirm the submitted comments map to owned threads, then commit the local ownership record. */
async function confirmSubmittedRound({
  api,
  form,
  formHash,
  home,
  locus,
  nowIso,
  pr,
  previousThreadIds,
  submittedCommentIds,
}: {
  api: GithubSelfReviewApi;
  form: SelfReviewForm;
  formHash: string;
  home: string;
  locus: string;
  nowIso: string;
  pr: WrittenPr;
  previousThreadIds: readonly string[];
  submittedCommentIds: readonly string[];
}): Promise<GithubSelfReviewOutcome> {
  const threads = await api.reviewThreads({ pullRequestId: pr.nodeId });
  if (threads.isErr()) {
    return {
      kind: "unconfirmed",
      locus,
      reason: `the review landed but thread readback failed (${threads.error.message}); inspect GitHub before any retry`,
    };
  }
  const mapping = reviewThreadIdsFor({ commentIds: submittedCommentIds, threads: threads.value });
  if (mapping.isErr()) {
    return { kind: "unconfirmed", locus, reason: `the review landed but ${mapping.error.message}` };
  }
  const confirmed = confirmSelfReviewRound({
    home,
    record: {
      confirmedIso: nowIso,
      formHash,
      headSha: pr.head.sha,
      locus,
      pullRequestId: pr.nodeId,
      threadIds: mapping.value,
    },
  });
  return confirmed.kind === "confirmed"
    ? {
        comments: form.comments.length,
        kind: "posted",
        number: pr.number,
        resolvedThreads: previousThreadIds.length,
        url: pr.htmlUrl,
      }
    : {
        kind: "unconfirmed",
        locus,
        reason: `GitHub confirmed the review but the local ledger did not (${confirmed.reason})`,
      };
}

/**
 * Refuse the round before any GitHub mutation when a comment's anchor is not part of the live diff.
 *
 * A stale line number after a rebase is the measured cause of a self-review submit landing PARTIALLY: the
 * composite mutation's review field fails on the bad anchor while its sibling thread-resolution fields still
 * execute, resolving the previous round's threads with nothing new posted. Checking every anchor against the
 * reviewed head SHA's own diff first turns that into a clean, nothing-sent refusal instead.
 */
async function selfReviewDiffRefusal({
  api,
  form,
  pr,
}: {
  api: GithubSelfReviewApi;
  form: SelfReviewForm;
  pr: WrittenPr;
}): Promise<string | undefined> {
  const separator = pr.baseRepoFullName.indexOf("/");
  const owner = pr.baseRepoFullName.slice(0, separator);
  const repo = pr.baseRepoFullName.slice(separator + 1);
  const diffFiles = await api.diffFiles({ number: pr.number, owner, repo });
  if (diffFiles.isErr()) {
    return `could not read the live diff to validate comment anchors (${diffFiles.error.message})`;
  }
  const bad = selfReviewDiffAnchorRefusals({ comments: form.comments, files: diffFiles.value });
  return bad.length === 0
    ? undefined
    : `these comment anchors are not part of the live diff at the reviewed head SHA: ${bad.join(", ")}`;
}

/** Submit the composite mutation and hand a successful send to exact readback confirmation. */
async function submitAndConfirmRound({
  api,
  form,
  formHash,
  home,
  locus,
  nowIso,
  pr,
  previousThreadIds,
}: {
  api: GithubSelfReviewApi;
  form: SelfReviewForm;
  formHash: string;
  home: string;
  locus: string;
  nowIso: string;
  pr: WrittenPr;
  previousThreadIds: readonly string[];
}): Promise<GithubSelfReviewOutcome> {
  const submitted = await api.submitReviewRound({
    // Each comment as GitHub receives it, through the one rendering the description review also binds.
    comments: renderSelfReviewComments({ form }),
    commitOid: pr.head.sha,
    pullRequestId: pr.nodeId,
    resolveThreadIds: previousThreadIds,
  });
  if (submitted.isErr()) {
    return {
      kind: "unconfirmed",
      locus,
      reason: `the submit-and-resolve mutation failed (${submitted.error.message}); inspect GitHub before any retry`,
    };
  }
  return confirmSubmittedRound({
    api,
    form,
    formHash,
    home,
    locus,
    nowIso,
    pr,
    previousThreadIds,
    submittedCommentIds: submitted.value.commentIds,
  });
}

/** Reserve the locus, validate, send once, and hand successful responses to exact readback confirmation. */
async function performSelfReviewRound({
  api,
  form,
  formHash,
  home,
  locus,
  nowIso,
  pr,
}: {
  api: GithubSelfReviewApi;
  form: SelfReviewForm;
  formHash: string;
  home: string;
  locus: string;
  nowIso: string;
  pr: WrittenPr;
}): Promise<GithubSelfReviewOutcome> {
  const reservation = reserveSelfReviewRound({
    home,
    intent: { formHash, headSha: pr.head.sha, locus, reservedIso: nowIso },
    pullRequestId: pr.nodeId,
  });
  if (reservation.kind === "taken") {
    return withSetAside({
      outcome: reservationTakenOutcome({ locus, pending: reservation.pending }),
      read: reservation.previous,
    });
  }
  if (reservation.kind === "unreadable") {
    return { kind: "refused", reason: reservation.reason };
  }
  const read = reservation.previous;
  // Below this point the reservation this call just took is ours to release. It stays held once the composite
  // mutation is actually attempted — a failure from there is genuinely ambiguous (GitHub's own top-level
  // mutation fields execute serially and independently, so a failed review post does not undo an already
  // -resolved sibling thread) and needs `self-review release` after a human or agent reads GitHub back.
  const refusal = await selfReviewDiffRefusal({ api, form, pr });
  if (refusal !== undefined) {
    releaseSelfReviewReservation({ home, locus });
    return withSetAside({ outcome: { kind: "refused", reason: refusal }, read });
  }
  const outcome = await submitAndConfirmRound({
    api,
    form,
    formHash,
    home,
    locus,
    nowIso,
    pr,
    previousThreadIds: ownedThreadIds({ read }),
  });
  return withSetAside({ outcome, read });
}

/**
 * What is checked before the door is asked: what the ledger holds for this pull request, whose owned round
 * says how many threads are left to retire, or the refusal that ends the call.
 *
 * A round record that cannot be trusted refuses before the door: posting anyway leaves the walkthrough it
 * should have retired standing beside the new one. A hold, corrupt or not, answers here too, not inside the
 * door, so a round that can never be sent writes no door row. The reservation inside the door still decides.
 */
function preDoorPreviousRound({
  home,
  locus,
  pullRequestId,
}: {
  home: string;
  locus: string;
  pullRequestId: string;
}): Result<SelfReviewRoundRead, GithubSelfReviewOutcome> {
  const previous = readSelfReviewRound({ home, locus, pullRequestId });
  if (previous.isErr()) {
    return err({ kind: "refused", reason: previous.error.join("; ") });
  }
  const held = readSelfReviewReservation({ home, locus });
  if (held.isErr()) {
    return err(withSetAside({ outcome: { kind: "refused", reason: held.error.join("; ") }, read: previous.value }));
  }
  if (held.value !== null || selfReviewLockHeld({ home, locus })) {
    return err(
      withSetAside({ outcome: reservationTakenOutcome({ locus, pending: held.value }), read: previous.value }),
    );
  }
  return ok(previous.value);
}

/**
 * Post a new reviewer walkthrough and retire the last Slopweaver-owned one.
 *
 * @param api the no-retry GitHub write surface
 * @param home the state home holding door and self-review ledgers
 * @param ledger the door ledger the decision is recorded through before the review is sent
 * @param pr the current live pull request, including its exact head SHA
 * @param form the validated visible-agent-authored review round
 * @param nowIso the reservation and confirmation instant
 * @returns a confirmed post, a pre-write refusal, or an ambiguous outcome that must never be retried
 */
export async function sendSelfReviewRound({
  api,
  home,
  ledger,
  pr,
  form,
  nowIso,
}: {
  api: GithubSelfReviewApi;
  home: string;
  ledger: DoorLedgerPort;
  pr: WrittenPr;
  form: SelfReviewForm;
  nowIso: string;
}): Promise<GithubSelfReviewOutcome> {
  const separator = pr.baseRepoFullName.indexOf("/");
  if (separator <= 0 || separator === pr.baseRepoFullName.length - 1) {
    return { kind: "refused", reason: `GitHub returned invalid repository name ${pr.baseRepoFullName}` };
  }
  const owner = pr.baseRepoFullName.slice(0, separator);
  const repo = pr.baseRepoFullName.slice(separator + 1);
  const locus = selfReviewLocus({ number: pr.number, owner, repo });
  const formHash = selfReviewFormHash({ form });
  const previousRound = preDoorPreviousRound({ home, locus, pullRequestId: pr.nodeId });
  if (previousRound.isErr()) {
    return previousRound.error;
  }
  const routed = await throughDoor({
    gates: DEFAULT_GATES,
    home,
    ledger,
    perform: () => performSelfReviewRound({ api, form, formHash, home, locus, nowIso, pr }),
    request: githubSelfReviewDoorRequest({
      comments: form.comments.length,
      headSha: pr.head.sha,
      home,
      number: pr.number,
      previousThreads: ownedThreadIds({ read: previousRound.value }).length,
      repo: pr.baseRepoFullName,
    }),
  });
  if (routed.performed) {
    return routed.result;
  }
  return withSetAside({ outcome: { kind: "not-performed", through: routed }, read: previousRound.value });
}
