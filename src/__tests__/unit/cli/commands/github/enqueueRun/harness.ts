/*
 * The shared harness for the `github enqueue` test files: throwaway homes, the fake merge-queue API whose
 * successive reads let a later one observe the write, and the deps a run is driven over.
 *
 * Every seam is a plain function that records what it was handed. None is a mock: the verb's contract is which
 * mutation reaches GitHub, against which head, and what it reports — and a recording fake is how that is
 * observed without reaching GitHub inside a unit test.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { errAsync, okAsync } from "neverthrow";

import type { DoorLedgerPort } from "../../../../../../admit/doorLedgerPort.js";
import type { BaseFreshness } from "../../../../../../cli/commands/github/baseFreshnessCore.js";
import type { GithubEnqueueDeps } from "../../../../../../cli/commands/github/enqueueDeps.js";
import type { GithubVerbResult } from "../../../../../../cli/commands/github/errors.js";
import type { MergeHoldDeps } from "../../../../../../cli/commands/github/holdDeps.js";
import type { WalkthroughStepDeps } from "../../../../../../cli/commands/github/walkthroughStep.js";
import type { BaselineBumpVerdict } from "../../../../../../codex/baselineBumpWitnessRun.js";
import type { PullRequestHead } from "../../../../../../codex/landingGate.js";
import type { LocalCodexLoopRead } from "../../../../../../codex/landingGateTypes.js";
import type { GithubAsyncMergeState } from "../../../../../../corpus/github/mergeAsync.js";
import type { ChangeSetPrivateTermsVerdict } from "../../../../../../hygiene/changeSetPrivateTerms.js";
import type { IngestError } from "../../../../../../lib/ingestError.js";
import { err, ok, type Result } from "../../../../../../lib/result.js";
import { type GithubLiveError, GithubLiveErrors } from "../../../../../../live/github/errors.js";
import type { MergeQueuePrState, MergeQueueState } from "../../../../../../live/github/mergeQueue.js";
import type { MergeHold } from "../../../../../../outbound/github/mergeHold.js";
import type { GithubMergeQueueApi } from "../../../../../../outbound/github/mergeQueue.js";
import { memoryDoorLedger } from "../../../../../doorLedgerFixture.js";
import { noWalkthroughs } from "../../../../../walkthroughFake.js";
import { HOLD_NOW, pairedCheckout, pr } from "./fixtures.js";

const QUEUE: MergeQueueState = { branch: "main", url: "https://example.invalid/queue" };

/** The just-fetched tip of `main` the preflight sweeps against by default. */
export const FETCHED_BASE_SHA = "b".repeat(40);

/** The preflight's default base fetch: `main`, the landing branch, fetched at {@link FETCHED_BASE_SHA}. */
const FETCHED_MAIN: GithubVerbResult<BaseFreshness> = ok({
  baseBranch: "main",
  baseSha: FETCHED_BASE_SHA,
  headSha: "cafe1234",
  kind: "fresh",
  remote: "origin",
  reverted: [],
});

/** The sweep's default answer: the terms loaded and nothing stands. */
const CLEAN_TERMS: ChangeSetPrivateTermsVerdict = {
  accepted: 0,
  binaryFiles: 0,
  kind: "clean",
  terms: [],
  textFiles: 1,
};

const HTTP_ERROR: IngestError = { kind: "http", message: "github said no", operation: "github.enqueuePullRequest" };

/** An accepted-but-not-finished asynchronous merge request, the ordinary answer of the REST enqueue. */
const PENDING_STATE: GithubAsyncMergeState = { message: "queued for merge", status: "pending", uuid: "req-1" };

// Every home the enqueue tests have minted, so each test file's `afterEach` can remove them.
const homes: string[] = [];

/**
 * Remove every home minted since the last call; each enqueue test file registers it with `afterEach`.
 *
 * @returns nothing
 */
export function removeHomes(): void {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
}

/**
 * A scratch state home this suite owns and removes.
 *
 * @param label the case's own word, so a leaked home names the case that minted it
 * @returns the new, empty home's path, removed by `removeHomes`
 */
export function scratchHome({ label }: { label: string }): string {
  const home = mkdtempSync(join(tmpdir(), `slopweaver-enqueue-${label}-`));
  homes.push(home);
  return home;
}

/** What one fake API was asked to do, in order. */
export interface Calls {
  readonly enqueued: { nodeId: string; expectedHeadOid: string }[];
  readonly dequeued: string[];
  /** Every asynchronous stack request sent — the transport a native-stack member must take. */
  readonly stackEnqueued: { owner: string; repo: string; number: number; expectedHeadOid: string }[];
  /** Every branch the queue and required-context reads were addressed with, in order. */
  readonly branchesRead: string[];
}

/**
 * A fresh, empty call record.
 *
 * @returns a record with no call in any of its lists
 */
export function noCalls(): Calls {
  return { branchesRead: [], dequeued: [], enqueued: [], stackEnqueued: [] };
}

/** The fake's pull request reads, in order: each takes the next of `reads`, and breaks once a case says so. */
function readSequence({
  reads,
  readFails,
  readFailsFrom,
}: {
  reads: MergeQueuePrState[];
  readFails: boolean;
  readFailsFrom: number;
}): () => Result<MergeQueuePrState, GithubLiveError> {
  let readsTaken = 0;
  return () => {
    readsTaken += 1;
    const broken = readFails || (readFailsFrom > 0 && readsTaken >= readFailsFrom);
    if (broken) {
      return err(GithubLiveErrors.notFound({ identity: "acme/widget#9", kind: "pull request" }));
    }
    const next = reads.shift();
    if (next === undefined) {
      return ok(pr());
    }
    return ok(next);
  };
}

/** The fake's send outcomes, in order: each takes the next of `writeFailures`, then `writeFails` decides. */
function sendSequence({
  writeFails,
  writeFailures,
}: {
  writeFails: boolean;
  writeFailures: IngestError[];
}): () => IngestError | undefined {
  return () => {
    if (writeFailures.length > 0) {
      return writeFailures.shift();
    }
    return writeFails ? HTTP_ERROR : undefined;
  };
}

/**
 * A plain fake whose successive reads let the second one observe the write.
 *
 * @returns the merge-queue API a run is handed, recording every call into `calls`
 */
export function api({
  reads,
  calls,
  noQueue = false,
  writeFails = false,
  writeFailures = [],
  readFails = false,
  readFailsFrom = 0,
}: {
  reads: MergeQueuePrState[];
  calls: Calls;
  noQueue?: boolean;
  writeFails?: boolean;
  /**
   * One failure per SEND, consumed in order; a send past the end succeeds. This is how a case says "the
   * transport dropped once and the retry went through" — a single boolean cannot express a sequence, and the
   * whole point of the recovery path is that the second send behaves differently from the first.
   */
  writeFailures?: IngestError[];
  readFails?: boolean;
  /** The 1-based read that starts failing, so a case can let the guard's reads through and break the witness. */
  readFailsFrom?: number;
}): GithubMergeQueueApi {
  const queue: MergeQueueState | undefined = noQueue ? undefined : QUEUE;
  const readResult = readSequence({ readFails, readFailsFrom, reads });
  const sendOutcome = sendSequence({ writeFailures, writeFails });
  return {
    dequeue: ({ nodeId }) => {
      calls.dequeued.push(nodeId);
      const failure = sendOutcome();
      return failure === undefined ? okAsync(undefined) : errAsync(failure);
    },
    enqueue: ({ nodeId, expectedHeadOid }) => {
      calls.enqueued.push({ expectedHeadOid, nodeId });
      const failure = sendOutcome();
      return failure === undefined ? okAsync(undefined) : errAsync(failure);
    },
    requiredContexts: async ({ branch }) => {
      calls.branchesRead.push(branch);
      return ok({ branch, contexts: ["build"], requiresCodeOwnerReviews: undefined });
    },
    queue: ({ branch }) => {
      calls.branchesRead.push(branch);
      return Promise.resolve(ok(queue === undefined ? undefined : { ...queue, branch }));
    },
    read: () => Promise.resolve(readResult()),
    asyncMergeResult: () => Promise.resolve(ok(PENDING_STATE)),
    enqueueStack: ({ owner, repo, number, expectedHeadOid }) => {
      calls.stackEnqueued.push({ expectedHeadOid, number, owner, repo });
      return writeFails ? errAsync(HTTP_ERROR) : okAsync(PENDING_STATE);
    },
  };
}

/** A plain fake hold edge: reads the holds it was handed, and records nothing anywhere. */
function holdDepsFor({ holds }: { holds: readonly MergeHold[] }): MergeHoldDeps {
  return {
    appendLedgerRow: () => ok(undefined),
    holderLive: () => ({ known: false, why: "not measured in this suite" }),
    nowIso: () => HOLD_NOW,
    out: () => undefined,
    publish: () => undefined,
    readHolds: () => holds,
    readLedgerRows: () => [],
    sessionId: () => "a-session",
    writeHolds: () => ok(undefined),
  };
}

/** The private-terms preflight's two reads, each recorded into `sweeps` in the order the verb asked. */
function preflightDepsFor({
  measurement,
  sweeps,
  terms,
}: {
  measurement: GithubVerbResult<BaseFreshness>;
  sweeps: unknown[];
  terms: ChangeSetPrivateTermsVerdict;
}): Pick<GithubEnqueueDeps, "measureBaseFreshness" | "sweepPrivateTerms"> {
  return {
    measureBaseFreshness: (args) => {
      sweeps.push({ measure: args });
      return measurement;
    },
    sweepPrivateTerms: (args) => {
      sweeps.push({ sweep: args });
      return terms;
    },
  };
}

/**
 * The deps one run of the verb is driven over, every line it writes recorded into `out` and `diagnostic`.
 *
 * @returns the enqueue verb's deps, over the fake surface and a paired checkout unless a case says not
 */
export function depsFor({
  door = memoryDoorLedger().port,
  home,
  out,
  diagnostic,
  surface,
  holds = [],
  codexLoop = pairedCheckout(),
  walkthrough = noWalkthroughs({ headOid: "cafe1234" }),
  bump = { kind: "clear" },
  bumpHeads = [],
  bumpBranches = [],
  measurement = FETCHED_MAIN,
  terms = CLEAN_TERMS,
  sweeps = [],
}: {
  door?: DoorLedgerPort;
  home: string;
  out: string[];
  diagnostic: string[];
  surface: GithubMergeQueueApi;
  holds?: readonly MergeHold[];
  codexLoop?: LocalCodexLoopRead;
  walkthrough?: WalkthroughStepDeps;
  /** What the ratchet-bump witness read answers. */
  bump?: BaselineBumpVerdict;
  /** Every head the witness read was asked about, so a case can prove the read happened and against what. */
  bumpHeads?: PullRequestHead[];
  /** The landing branch each witness read was handed, in step with `bumpHeads`. */
  bumpBranches?: (string | undefined)[];
  /** What the private-terms preflight's base fetch answers. */
  measurement?: GithubVerbResult<BaseFreshness>;
  /** What the private-terms sweep answers. */
  terms?: ChangeSetPrivateTermsVerdict;
  /** Every measurement and sweep the preflight asked for, in order, so a case can prove one ran or did not. */
  sweeps?: unknown[];
}): GithubEnqueueDeps {
  return {
    cwd: () => "/w/repo",
    ...preflightDepsFor({ measurement, sweeps, terms }),
    doorLedger: door,
    hold: holdDepsFor({ holds }),
    wait: () => Promise.resolve(),
    walkthrough,
    home: () => home,
    readCodexLoop: () => codexLoop,
    readBumpWitness: ({ head, landingBranch }) => {
      bumpHeads.push(head);
      bumpBranches.push(landingBranch);
      return bump;
    },
    makeApi: () => surface,
    out: (line) => out.push(line),
    token: () => "token",
    writeDiagnostic: (line) => diagnostic.push(line),
  };
}
