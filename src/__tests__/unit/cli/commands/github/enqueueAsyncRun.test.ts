import { describe, expect, it } from "vitest";

import { ASYNC_ENQUEUE_WAITS_MS, confirmAsyncEnqueue } from "../../../../../cli/commands/github/enqueueAsyncRun.js";
import type { GithubAsyncMergeState } from "../../../../../corpus/github/mergeAsync.js";
import type { ProgressEmitter } from "../../../../../lib/progress.js";
import { err, ok, type Result, unwrap, unwrapErr } from "../../../../../lib/result.js";
import { type GithubLiveError, GithubLiveErrors } from "../../../../../live/github/errors.js";
import type { MergeQueueEntryState, MergeQueuePrState } from "../../../../../live/github/mergeQueue.js";

const IDENTITY = { number: 16_378, owner: "acme", repo: "acme-admin" };

const PENDING: GithubAsyncMergeState = { message: "working on it", status: "pending", uuid: "req-1" };
const ENQUEUED: GithubAsyncMergeState = { message: "added to the queue", status: "enqueued", uuid: "req-1" };

const ENTRY: MergeQueueEntryState = { estimatedSecondsToMerge: 300, position: 4, state: "QUEUED" };

/** A pull request carrying (or not carrying) a queue entry, and its own GitHub state. */
function pr({ entry, state = "OPEN" }: { entry: MergeQueueEntryState | undefined; state?: string }): MergeQueuePrState {
  return {
    approvedBy: [],
    baseRefName: "staging",
    baseRefOid: "ba5e0000",
    body: "",
    checks: {
      baseRef: "staging",
      checks: [],
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
    entry,
    headOid: "cafe1234",
    headRefName: "mx-2386-onboarding-consent-invariant",
    isDraft: false,
    mergeable: "MERGEABLE",
    nodeId: "PR_kwabc",
    number: 16_378,
    reviewDecision: "APPROVED",
    stack: { baseRefName: "staging", number: 16_958, position: 1, size: 3 },
    state,
    url: "https://example.invalid/pr/16378",
  };
}

/** Everything one loop did, in order — the whole point of the fakes below. */
interface Trace {
  readonly waited: number[];
  readonly polled: string[];
  readonly reads: number[];
  readonly progress: string[];
}

/** A progress emitter that records its phases rather than writing anywhere. */
function tracingProgress({ trace }: { trace: Trace }): ProgressEmitter {
  return {
    finish: (u) => trace.progress.push(`finish:${u.phase}`),
    update: (u) => trace.progress.push(`update:${u.phase}`),
  };
}

/**
 * Plain fakes over the two reads and the wait: `polls` and `reads` are consumed in order, and the last
 * entry of each repeats once exhausted so a case can describe only the rounds it is about.
 */
function deps({
  trace,
  polls,
  reads,
}: {
  trace: Trace;
  polls: readonly Result<GithubAsyncMergeState, GithubLiveError>[];
  reads: readonly Result<MergeQueuePrState, GithubLiveError>[];
}): Parameters<typeof confirmAsyncEnqueue>[0]["deps"] {
  let pollAt = 0;
  let readAt = 0;
  return {
    api: {
      asyncMergeResult: ({ uuid }) => {
        trace.polled.push(uuid);
        const answer = polls[Math.min(pollAt, polls.length - 1)]!;
        pollAt += 1;
        return Promise.resolve(answer);
      },
      read: ({ number }) => {
        trace.reads.push(number);
        const answer = reads[Math.min(readAt, reads.length - 1)]!;
        readAt += 1;
        return Promise.resolve(answer);
      },
    },
    progress: tracingProgress({ trace }),
    wait: ({ ms }) => {
      trace.waited.push(ms);
      return Promise.resolve();
    },
  };
}

function emptyTrace(): Trace {
  return { polled: [], progress: [], reads: [], waited: [] };
}

describe("confirmAsyncEnqueue", () => {
  it("confirms on the first read-back, waiting for nothing, when GitHub was already quick", async () => {
    const trace = emptyTrace();
    const confirmed = await confirmAsyncEnqueue({
      deps: deps({ polls: [ok(PENDING)], reads: [ok(pr({ entry: ENTRY }))], trace }),
      identity: IDENTITY,
      initial: PENDING,
    });

    expect(unwrap(confirmed).entry).toStrictEqual(ENTRY);
    expect(trace.waited).toStrictEqual([]);
    expect(trace.polled).toStrictEqual([]);
    expect(trace.reads).toStrictEqual([16_378]);
    expect(trace.progress).toStrictEqual(["update:async-merge pending", "finish:async-merge queued"]);
  });

  it("polls the request by its own uuid and confirms once the entry appears", async () => {
    const trace = emptyTrace();
    const confirmed = await confirmAsyncEnqueue({
      deps: deps({
        polls: [ok(PENDING), ok(ENQUEUED)],
        reads: [ok(pr({ entry: undefined })), ok(pr({ entry: undefined })), ok(pr({ entry: ENTRY }))],
        trace,
      }),
      identity: IDENTITY,
      initial: PENDING,
    });

    expect(unwrap(confirmed).entry).toStrictEqual(ENTRY);
    expect(trace.waited).toStrictEqual([1000, 2000]);
    expect(trace.polled).toStrictEqual(["req-1", "req-1"]);
    expect(trace.reads).toStrictEqual([16_378, 16_378, 16_378]);
  });

  it("stops polling the request once it reads enqueued, and spends the rest of the budget on the entry", async () => {
    const trace = emptyTrace();
    await confirmAsyncEnqueue({
      deps: deps({
        polls: [ok(ENQUEUED)],
        reads: [
          ok(pr({ entry: undefined })),
          ok(pr({ entry: undefined })),
          ok(pr({ entry: undefined })),
          ok(pr({ entry: ENTRY })),
        ],
        trace,
      }),
      identity: IDENTITY,
      initial: PENDING,
    });

    // One poll only: the first round learned `enqueued`, which is terminal for the REQUEST even though the
    // GraphQL projection had not caught up yet.
    expect(trace.polled).toStrictEqual(["req-1"]);
    expect(trace.reads).toStrictEqual([16_378, 16_378, 16_378, 16_378]);
  });

  it("keeps the uuid from an acceptance that answered `enqueued`, so exhaustion can still name it", async () => {
    // A Codex review's counterexample: an acceptance that skips `pending` still carries the identifier, and
    // dropping it left the UNCONFIRMED line telling the operator to re-read something it could not name.
    const trace = emptyTrace();
    const outcome = await confirmAsyncEnqueue({
      deps: deps({ polls: [ok(ENQUEUED)], reads: [ok(pr({ entry: undefined }))], trace }),
      identity: IDENTITY,
      initial: ENQUEUED,
    });

    expect(unwrapErr(outcome)).toStrictEqual([
      "UNCONFIRMED: GitHub accepted the asynchronous enqueue of acme/acme-admin#16378, request req-1 and " +
        "it still reads enqueued; no mergeQueueEntry was observed within this invocation's confirmation " +
        "budget. Re-read it before retrying — the request may still complete, and a second one would be a " +
        "second job.",
    ]);
    // Still no polling: `enqueued` is terminal for the REQUEST, so the uuid is carried for the report only.
    expect(trace.polled).toStrictEqual([]);
  });

  it("never polls at all when the acceptance was already enqueued, since the request itself is settled", async () => {
    const trace = emptyTrace();
    const confirmed = await confirmAsyncEnqueue({
      deps: deps({ polls: [ok(ENQUEUED)], reads: [ok(pr({ entry: undefined })), ok(pr({ entry: ENTRY }))], trace }),
      identity: IDENTITY,
      initial: ENQUEUED,
    });

    expect(unwrap(confirmed).entry).toStrictEqual(ENTRY);
    expect(trace.polled).toStrictEqual([]);
  });

  it("reports a refusal with GitHub's own reason, without reading the pull request at all", async () => {
    const trace = emptyTrace();
    const outcome = await confirmAsyncEnqueue({
      deps: deps({ polls: [], reads: [ok(pr({ entry: ENTRY }))], trace }),
      identity: IDENTITY,
      initial: { message: "Head branch was modified.", status: "failed", uuid: undefined },
    });

    expect(unwrapErr(outcome)).toStrictEqual([
      // No `request …` clause: this refusal named no uuid, and the subject prints only what GitHub gave.
      "FAILED: GitHub refused the asynchronous enqueue of acme/acme-admin#16378: Head branch was modified.",
    ]);
    expect(trace.reads).toStrictEqual([]);
    expect(trace.progress).toStrictEqual(["finish:async-merge failed"]);
  });

  it("cannot be talked out of a refusal by a queue entry left over from an earlier press", async () => {
    const trace = emptyTrace();
    const outcome = await confirmAsyncEnqueue({
      deps: deps({
        polls: [ok({ message: "the stack moved under it", status: "failed", uuid: "req-1" })],
        reads: [ok(pr({ entry: undefined })), ok(pr({ entry: ENTRY }))],
        trace,
      }),
      identity: IDENTITY,
      initial: PENDING,
    });

    expect(unwrapErr(outcome)).toStrictEqual([
      "FAILED: GitHub refused the asynchronous enqueue of acme/acme-admin#16378, request req-1: the stack moved under it",
    ]);
  });

  it("reports an already-merged pull request as merged rather than as queued", async () => {
    const trace = emptyTrace();
    const outcome = await confirmAsyncEnqueue({
      deps: deps({ polls: [], reads: [], trace }),
      identity: IDENTITY,
      initial: { message: "merged by the queue", sha: "deadbeef", status: "merged", uuid: undefined },
    });

    expect(unwrapErr(outcome)).toStrictEqual([
      "MERGED: GitHub reports acme/acme-admin#16378 already merged (deadbeef): merged by the queue. This " +
        "invocation confirmed no queue ENTRY, which is the only thing it reports success on.",
    ]);
  });

  it("spends exactly the declared budget and then reports UNCONFIRMED with the request's own uuid", async () => {
    const trace = emptyTrace();
    const outcome = await confirmAsyncEnqueue({
      deps: deps({ polls: [ok(PENDING)], reads: [ok(pr({ entry: undefined }))], trace }),
      identity: IDENTITY,
      initial: PENDING,
    });

    expect(unwrapErr(outcome)).toStrictEqual([
      "UNCONFIRMED: GitHub accepted the asynchronous enqueue of acme/acme-admin#16378, request req-1 and " +
        "it still reads pending; no mergeQueueEntry was observed within this invocation's confirmation " +
        "budget. Re-read it before retrying — the request may still complete, and a second one would be a " +
        "second job.",
    ]);
    expect(trace.waited).toStrictEqual([1000, 2000, 4000, 8000, 15_000, 30_000]);
    expect(trace.waited).toStrictEqual([...ASYNC_ENQUEUE_WAITS_MS]);
    expect(trace.polled.length).toBe(6);
    expect(trace.reads.length).toBe(7);
  });

  it("stops on a failed poll and reports what the read said, never that the request was cancelled", async () => {
    const trace = emptyTrace();
    const outcome = await confirmAsyncEnqueue({
      deps: deps({
        polls: [err(GithubLiveErrors.readFailed({ message: "github said 502" }))],
        reads: [ok(pr({ entry: undefined }))],
        trace,
      }),
      identity: IDENTITY,
      initial: PENDING,
    });

    expect(unwrapErr(outcome)).toStrictEqual([
      "github said 502",
      "IN FLIGHT: GitHub already ACCEPTED an asynchronous merge request for acme/acme-admin#16378, " +
        "request req-1. Re-read it before doing anything else — enqueueing again would start a second " +
        "merge job on the stack.",
    ]);
    expect(trace.waited).toStrictEqual([1000]);
  });

  it("stops on a failed read-back of the pull request itself", async () => {
    const trace = emptyTrace();
    const outcome = await confirmAsyncEnqueue({
      deps: deps({
        polls: [ok(PENDING)],
        reads: [err(GithubLiveErrors.readFailed({ message: "github closed the connection" }))],
        trace,
      }),
      identity: IDENTITY,
      initial: PENDING,
    });

    // A bare transport message is anonymous, and under `--json` the verb's identity lines never print — so
    // the whole report about a merge job that is STILL RUNNING would be one sentence naming nothing. A
    // Codex review's counterexample; the operator's natural next move is the retry this line prevents.
    expect(unwrapErr(outcome)).toStrictEqual([
      "github closed the connection",
      "IN FLIGHT: GitHub already ACCEPTED an asynchronous merge request for acme/acme-admin#16378, " +
        "request req-1. Re-read it before doing anything else — enqueueing again would start a second " +
        "merge job on the stack.",
    ]);
    expect(trace.waited).toStrictEqual([]);
  });

  it("refuses to call a pull request queued once it reads back MERGED, entry or no entry", async () => {
    // A Codex review's counterexample, and the whole reason this endpoint needs the check: the merge runs
    // in the BACKGROUND, so the pull request can land inside the very window this loop waits through — and
    // GitHub can leave a mergeQueueEntry on it. Judging the entry alone printed "queued … at position 4"
    // and exited zero about a pull request that had already merged.
    const trace = emptyTrace();
    const outcome = await confirmAsyncEnqueue({
      deps: deps({ polls: [ok(PENDING)], reads: [ok(pr({ entry: ENTRY, state: "MERGED" }))], trace }),
      identity: IDENTITY,
      initial: PENDING,
    });

    expect(unwrapErr(outcome)).toStrictEqual([
      "MERGED: acme/acme-admin#16378, request req-1 reads back MERGED rather than OPEN while the " +
        "asynchronous request reads pending. This invocation confirmed no queue ENTRY, which is the only " +
        "thing it reports success on.",
      "IN FLIGHT: GitHub already ACCEPTED an asynchronous merge request for acme/acme-admin#16378, " +
        "request req-1. Re-read it before doing anything else — enqueueing again would start a second " +
        "merge job on the stack.",
    ]);
    expect(trace.waited).toStrictEqual([]);
    expect(trace.polled).toStrictEqual([]);
  });

  it("stops on a CLOSED read-back too, rather than waiting the whole budget out", async () => {
    const trace = emptyTrace();
    const outcome = await confirmAsyncEnqueue({
      deps: deps({ polls: [ok(PENDING)], reads: [ok(pr({ entry: undefined, state: "CLOSED" }))], trace }),
      identity: IDENTITY,
      initial: PENDING,
    });

    // CLOSED is not MERGED: somebody closed the pull request under us while the request itself still reads
    // `pending`, so the merge job may be running and a retry would start a second one. A Codex review found
    // this case wearing a settled-looking label without the warning.
    expect(unwrapErr(outcome)).toStrictEqual([
      "MERGED: acme/acme-admin#16378, request req-1 reads back CLOSED rather than OPEN while the " +
        "asynchronous request reads pending. This invocation confirmed no queue ENTRY, which is the only " +
        "thing it reports success on.",
      "IN FLIGHT: GitHub already ACCEPTED an asynchronous merge request for acme/acme-admin#16378, " +
        "request req-1. Re-read it before doing anything else — enqueueing again would start a second " +
        "merge job on the stack.",
    ]);
    expect(trace.waited).toStrictEqual([]);
  });
});
