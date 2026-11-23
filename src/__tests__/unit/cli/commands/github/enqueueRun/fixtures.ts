/*
 * The pure fixtures every `github enqueue` test file shares: the pull request read the fake answers with, the
 * paired checkout, the transport failure the recovery path exists for, a standing merge hold, the native-stack
 * memberships, and the walkthrough threads the owner's own landing resolves.
 */
import type { LocalCodexLoopRead } from "../../../../../../codex/landingGateTypes.js";
import type { IngestError } from "../../../../../../lib/ingestError.js";
import type { MergeQueuePrState, MergeQueueStackMembership } from "../../../../../../live/github/mergeQueue.js";
import type { MergeHold } from "../../../../../../outbound/github/mergeHold.js";
import { walkthroughThread } from "../../../../../walkthroughFake.js";

/**
 * The failure this whole recovery path exists for: undici gave up on the socket, so no HTTP response of any
 * kind came back and GitHub never said whether it applied the press. Measured shape — see
 * `src/__tests__/unit/lib/ingestError.test.ts` for the Octokit error it is mapped from.
 */
export const TRANSPORT_ERROR: IngestError = {
  code: "UND_ERR_SOCKET",
  kind: "network",
  message: "other side closed",
  operation: "github.enqueuePullRequest",
  provider: "github",
};

/**
 * A checkout that matches the pull request under test and whose Codex loop cleared the floor. These cases are
 * about the enqueue press, so the pairing floor is held clean and gets its own cases elsewhere.
 *
 * @param repository the `owner/name` the checkout's evidence claims, for a case naming another repository
 * @returns a read of a paired checkout at the pull request's own head
 */
export function pairedCheckout({ repository = "acme/widget" }: { repository?: string } = {}): LocalCodexLoopRead {
  return {
    evidence: {
      baseSha: "ba5e0000",
      branch: "feature",
      failures: [],
      headSha: "cafe1234",
      leftovers: [],
      repository,
      roots: ["/w/repo"],
    },
    kind: "read",
  };
}

/**
 * A green, approved, mergeable, unqueued pull request.
 *
 * @returns that pull request, with each field `over` names replaced
 */
export function pr(over: Partial<MergeQueuePrState> = {}): MergeQueuePrState {
  return {
    approvedBy: ["reviewer-one"],
    baseRefName: "main",
    baseRefOid: "ba5e0000",
    body: "",
    checks: {
      baseRef: undefined,
      checks: [{ kind: "check-run", name: "build", state: "passed", url: undefined }],
      headSha: "cafe1234",
      mergeable: undefined,
      residue: [],
      rollupState: "SUCCESS",
      supersededChecks: [],
      truncated: false,
    },
    codeownerRequests: [],
    codeownerRequestsTruncated: false,
    githubMergeStatus: { kind: "mergeable", status: "CLEAN" },
    entry: undefined,
    headOid: "cafe1234",
    headRefName: "feature",
    isDraft: false,
    mergeable: "MERGEABLE",
    nodeId: "PR_kwabc",
    number: 9,
    reviewDecision: "APPROVED",
    stack: undefined,
    state: "OPEN",
    url: "https://example.invalid/pr/9",
    ...over,
  };
}

/** The instant the fake hold edge reads as now. */
export const HOLD_NOW = "2026-09-05T09:34:00.000Z";

/**
 * One standing hold on `acme/widget`, placed four minutes before {@link HOLD_NOW}.
 *
 * @param pr the pull request number that owns the merge queue
 * @returns the hold row as the hold store reads it back
 */
export function heldPr({ pr: number }: { pr: number }): MergeHold {
  return {
    atIso: "2026-09-05T09:30:00.000Z",
    holder: "a-session",
    pr: number,
    repo: "acme/widget",
    staleMinutes: 30,
    staleWarnedAtIso: "2026-09-05T09:30:00.000Z",
    why: "an expensive live measurement a moved head would invalidate",
  };
}

/** Stack 16958 as GitHub reports it for its bottom pull request, position 1 of 3, landing on `staging`. */
export const BOTTOM: MergeQueueStackMembership = { baseRefName: "staging", number: 16_958, position: 1, size: 3 };

/** The same stack for its middle pull request, position 2 — whose OWN base is the member below it, not the landing branch. */
export const MID: MergeQueueStackMembership = { baseRefName: "staging", number: 16_958, position: 2, size: 3 };

/** Two of the owner's one-voice notes and one thread a reviewer opened. */
export const MIXED = {
  authorLogin: "owner",
  headOid: "cafe1234",
  threads: [
    walkthroughThread({ id: "PRRT_note1" }),
    walkthroughThread({ id: "PRRT_note2" }),
    walkthroughThread({ id: "PRRT_reviewer", lastCommentLogin: "teammate", openedByLogin: "teammate" }),
  ],
  truncated: false,
  viewerLogin: "owner",
};

/** The owner's pull request, queued at position 1 — the confirming read after a walkthrough case's press. */
export const QUEUED = pr({ entry: { estimatedSecondsToMerge: 120, position: 1, state: "QUEUED" } });

/** One of the owner's notes, resolved by their account with a colleague's reply as its last word. */
export const COLLAPSED = walkthroughThread({
  commentCount: 2,
  id: "PRRT_collapsed",
  isResolved: true,
  lastCommentLogin: "teammate",
  resolvedByLogin: "owner",
});
