/**
 * The seams the landing-gate wiring proofs share: the pull request under test, the merge-queue and hold
 * edges `github enqueue` is run against, and the scratch-home cleanup. Each proof sits in its own file beside
 * this one.
 *
 * Zero mocks: every edge is a plain function this file writes, per `.claude/rules/testing.md`.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { okAsync } from "neverthrow";
import { afterEach } from "vitest";

import type { GithubEnqueueDeps } from "../../../../cli/commands/github/enqueueDeps.js";
import type { MergeHoldDeps } from "../../../../cli/commands/github/holdDeps.js";
import type { TreeFingerprint } from "../../../../codex/fingerprint.js";
import { captureTreeFingerprint } from "../../../../codex/gitDiff.js";
import type { PullRequestHead } from "../../../../codex/landingGate.js";
import type { LocalCodexLoopRead } from "../../../../codex/landingGateTypes.js";
import type { GithubAsyncMergeState } from "../../../../corpus/github/mergeAsync.js";
import { ok, type Result, unwrap } from "../../../../lib/result.js";
import type { RequiredCheckContexts } from "../../../../live/github/branchProtection.js";
import type { GithubLiveError } from "../../../../live/github/errors.js";
import type { MergeQueuePrState } from "../../../../live/github/mergeQueue.js";
import type { GithubMergeQueueApi } from "../../../../outbound/github/mergeQueue.js";
import { type MemoryDoorLedger, memoryDoorLedger } from "../../../doorLedgerFixture.js";
import { REAL_GIT_TIMEOUT_MS } from "../../../tempGitRepo.js";
import { noWalkthroughs } from "../../../walkthroughFake.js";

/** The real-git budget, hoisted so a `describe` naming it still fits on one line. */
export const REAL_GIT = { timeout: REAL_GIT_TIMEOUT_MS };

export const REPO = "acme/widget";
export const BRANCH = "feature";
const HEAD_SHA = "cafe1234";
export const BASE_SHA = "ba5e0000";
export const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

/**
 * A throwaway state home, so every door write in a case lands inside the test's own sandbox.
 *
 * @returns the new directory's path, removed after the test.
 */
export function scratchHome({ label }: { label: string }): string {
  const home = mkdtempSync(join(tmpdir(), `slopweaver-landing-${label}-`));
  homes.push(home);
  return home;
}

/**
 * Every door record the ledger holds, newest last.
 *
 * @returns the ledger's records in write order.
 */
export function doorRecords({ door }: { door: MemoryDoorLedger }): readonly { acknowledgements?: unknown }[] {
  return door.records();
}

/**
 * A reading that answers for the pull request under test; a case overrides one field.
 *
 * @returns a `read` verdict carrying the given failures and repository.
 */
export function checkout({
  failures = [],
  repository = REPO,
}: {
  failures?: readonly string[];
  repository?: string;
} = {}): LocalCodexLoopRead {
  return {
    evidence: {
      baseSha: BASE_SHA,
      branch: BRANCH,
      failures,
      headSha: HEAD_SHA,
      leftovers: [],
      repository,
      roots: ["/w/repo"],
    },
    kind: "read",
  };
}

export const INCOMPLETE = checkout({ failures: ["no planning pass has run on this branch"] });

/**
 * The asynchronous stack path's seams answer this and nothing here reaches them: every pull request in this
 * file is `stack: undefined`, so a case that DID reach them would fail on the message rather than pass.
 */
const ASYNC_UNREACHED: GithubAsyncMergeState = {
  message: "the asynchronous path is not this file's subject",
  status: "enqueued",
  uuid: undefined,
};

/**
 * A green, approved, mergeable, unqueued pull request on {@link BRANCH}.
 *
 * @returns the pull request's merge-queue state.
 */
function queuePr(): MergeQueuePrState {
  return {
    approvedBy: ["reviewer-one"],
    baseRefName: "main",
    baseRefOid: BASE_SHA,
    body: "",
    codeownerRequests: [],
    codeownerRequestsTruncated: false,
    githubMergeStatus: { kind: "mergeable", status: "CLEAN" },
    checks: {
      baseRef: "main",
      checks: [{ kind: "check-run", name: "build", state: "passed", url: undefined }],
      headSha: HEAD_SHA,
      mergeable: undefined,
      residue: [],
      rollupState: "SUCCESS",
      supersededChecks: [],
      truncated: false,
    },
    entry: undefined,
    headOid: HEAD_SHA,
    headRefName: BRANCH,
    isDraft: false,
    mergeable: "MERGEABLE",
    nodeId: "PR_kwabc",
    number: 9,
    reviewDecision: "APPROVED",
    stack: undefined,
    state: "OPEN",
    url: "https://github.invalid/acme/widget/pull/9",
  };
}

/**
 * The merge-queue surface, counting every enqueue mutation it is asked to perform.
 *
 * @returns a queue API that pushes each enqueued node id onto the given list.
 */
function queueApi({ enqueued }: { enqueued: string[] }): GithubMergeQueueApi {
  const queued: MergeQueuePrState = {
    ...queuePr(),
    entry: { estimatedSecondsToMerge: undefined, position: 1, state: "QUEUED" },
  };
  let reads = 0;
  return {
    asyncMergeResult: () => Promise.resolve(ok(ASYNC_UNREACHED)),
    dequeue: () => okAsync(undefined),
    enqueueStack: () => okAsync(ASYNC_UNREACHED),
    enqueue: ({ nodeId }) => {
      enqueued.push(nodeId);
      return okAsync(undefined);
    },
    queue: () => Promise.resolve(ok({ branch: "main", url: "https://example.invalid/queue" })),
    read: () => {
      reads += 1;
      return Promise.resolve(ok(reads === 1 ? queuePr() : queued));
    },
    requiredContexts: async (): Promise<Result<RequiredCheckContexts, GithubLiveError>> =>
      ok({ branch: "main", contexts: ["build"], requiresCodeOwnerReviews: false }),
  };
}

/**
 * A surface whose pull request is already QUEUED, so `--dequeue` has a real entry to remove.
 *
 * @returns a queue API whose first read shows the pull request queued.
 */
export function queuedApi(): GithubMergeQueueApi {
  const queued: MergeQueuePrState = {
    ...queuePr(),
    entry: { estimatedSecondsToMerge: undefined, position: 1, state: "QUEUED" },
  };
  let reads = 0;
  return {
    asyncMergeResult: () => Promise.resolve(ok(ASYNC_UNREACHED)),
    dequeue: () => okAsync(undefined),
    enqueueStack: () => okAsync(ASYNC_UNREACHED),
    enqueue: () => okAsync(undefined),
    queue: () => Promise.resolve(ok({ branch: "main", url: "https://example.invalid/queue" })),
    read: () => {
      reads += 1;
      return Promise.resolve(ok(reads === 1 ? queued : queuePr()));
    },
    requiredContexts: async (): Promise<Result<RequiredCheckContexts, GithubLiveError>> =>
      ok({ branch: "main", contexts: ["build"], requiresCodeOwnerReviews: false }),
  };
}

/**
 * The merge hold's edges, holding nothing — these proofs are about the pairing floor, not the lane.
 *
 * @returns hold dependencies that hold no pull request and write nothing.
 */
function holdDeps(): MergeHoldDeps {
  return {
    appendLedgerRow: () => ok(undefined),
    holderLive: () => ({ known: false, why: "not measured in this suite" }),
    nowIso: () => "2026-09-09T00:00:00.000Z",
    out: () => undefined,
    publish: () => undefined,
    readHolds: () => [],
    readLedgerRows: () => [],
    sessionId: () => "a-session",
    writeHolds: () => ok(undefined),
  };
}

/**
 * The full `github enqueue` edge set over the fake queue, with the Codex loop read the case supplies.
 *
 * @returns enqueue dependencies that record output into `out` and enqueues into `enqueued`.
 */
export function enqueueDeps({
  home,
  enqueued,
  out,
  codexLoop,
  door = memoryDoorLedger(),
}: {
  home: string;
  enqueued: string[];
  out: string[];
  codexLoop: LocalCodexLoopRead;
  door?: MemoryDoorLedger;
}): GithubEnqueueDeps {
  return {
    cwd: () => "/w/repo",
    doorLedger: door.port,
    wait: () => Promise.resolve(),
    hold: holdDeps(),
    home: () => home,
    makeApi: () => queueApi({ enqueued }),
    // The private-terms preflight is not what this suite judges: a clean sweep over a skipped fetch.
    measureBaseFreshness: () => ok({ kind: "skipped", why: "the pairing floor is under test" }),
    sweepPrivateTerms: () => ({ accepted: 0, binaryFiles: 0, kind: "clean", terms: [], textFiles: 1 }),
    out: (line) => out.push(line),
    readCodexLoop: () => codexLoop,
    readBumpWitness: () => ({ kind: "clear" }),
    token: () => "token",
    walkthrough: noWalkthroughs({ headOid: HEAD_SHA }),
    writeDiagnostic: (line) => out.push(line),
  };
}

/**
 * The checkout's fingerprint, thrown on rather than branched on, per `.claude/rules/testing.md`.
 *
 * @returns the working tree's fingerprint.
 */
export function unwrapFingerprint({ cwd }: { cwd: string }): TreeFingerprint {
  return unwrap(captureTreeFingerprint({ cwd }));
}

/**
 * The pull request a scratch checkout's own commit would be the head of.
 *
 * The reader is asked about a PULL REQUEST now, so every case has to name one. Deriving it from the
 * repository the case just built keeps the head a real commit git can peel to a tree — which is the fact the
 * qualifying check turns on, and a hand-written sha would fail for the wrong reason.
 *
 * @returns the pull request head for the checkout's current commit.
 */
export function headOf({ cwd }: { cwd: string }): PullRequestHead {
  return { baseSha: BASE_SHA, branch: BRANCH, headSha: unwrapFingerprint({ cwd }).headSha, repository: REPO };
}
