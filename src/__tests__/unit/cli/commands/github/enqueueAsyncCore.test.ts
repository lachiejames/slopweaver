/**
 * The asynchronous enqueue's DECISION and its operator lines (`enqueueAsyncCore.ts`), driven directly.
 *
 * The decision's precedence is pinned pairwise — each rule beside the input that would have reached the next
 * one — and every rendered line is compared whole, with and without the request's uuid.
 */
import { describe, expect, it } from "vitest";

import {
  type AsyncEnqueueDecision,
  type AsyncSubject,
  asyncEnqueueDecision,
  asyncFailedLine,
  asyncInFlightLine,
  asyncMayHaveStartedLine,
  asyncMergedLine,
  asyncUnconfirmedLine,
} from "../../../../../cli/commands/github/enqueueAsyncCore.js";
import type { GithubAsyncMergeState } from "../../../../../corpus/github/mergeAsync.js";
import type { MergeQueueEntryState } from "../../../../../live/github/mergeQueue.js";

const PENDING: GithubAsyncMergeState = { message: "working", status: "pending", uuid: "u-1" };
const FAILED: GithubAsyncMergeState = { message: "the stack moved under it", status: "failed", uuid: "u-1" };
const MERGED: GithubAsyncMergeState = { message: "done", sha: "abc123", status: "merged", uuid: "u-1" };
const ENTRY: MergeQueueEntryState = { estimatedSecondsToMerge: undefined, position: 1, state: "QUEUED" };

const WITH_UUID: AsyncSubject = { number: 16378, owner: "acme", repo: "acme-admin", uuid: "u-1" };
const NO_UUID: AsyncSubject = { number: 16378, owner: "acme", repo: "acme-admin", uuid: undefined };

function decide({
  state = PENDING,
  entry,
  prState = "OPEN",
  exhausted = false,
}: {
  state?: GithubAsyncMergeState;
  entry?: MergeQueueEntryState;
  prState?: string;
  exhausted?: boolean;
}): AsyncEnqueueDecision {
  return asyncEnqueueDecision({ entry, exhausted, prState, state });
}

describe("asyncEnqueueDecision", () => {
  it("reports a refused request as failed even when a queue entry is present", () => {
    expect(decide({ entry: ENTRY, state: FAILED })).toBe("failed");
    expect(decide({ entry: ENTRY, state: PENDING })).toBe("confirmed");
  });

  it("reports a request GitHub says merged as merged even when a queue entry is present", () => {
    expect(decide({ entry: ENTRY, state: MERGED })).toBe("merged");
  });

  it("settles MERGED and CLOSED read-backs alike on merged, rather than confirming the leftover entry an OPEN one confirms", () => {
    expect(decide({ entry: ENTRY, prState: "MERGED" })).toBe("merged");
    expect(decide({ entry: ENTRY, prState: "CLOSED" })).toBe("merged");
    expect(decide({ entry: ENTRY, prState: "OPEN" })).toBe("confirmed");
  });

  it("keeps waiting while the budget lasts, and reports unconfirmed once it is exhausted", () => {
    expect(decide({ exhausted: false })).toBe("wait");
    expect(decide({ exhausted: true })).toBe("unconfirmed");
  });

  it("confirms an observed entry even on the round that exhausts the budget", () => {
    expect(decide({ entry: ENTRY, exhausted: true })).toBe("confirmed");
  });
});

describe("the asynchronous enqueue's operator lines", () => {
  it("prints a refusal with GitHub's own reason and the request id", () => {
    expect(asyncFailedLine({ about: WITH_UUID, message: "the stack moved under it" })).toBe(
      "FAILED: GitHub refused the asynchronous enqueue of acme/acme-admin#16378, request u-1: the stack moved under it",
    );
    expect(asyncFailedLine({ about: NO_UUID, message: "the stack moved under it" })).toBe(
      "FAILED: GitHub refused the asynchronous enqueue of acme/acme-admin#16378: the stack moved under it",
    );
  });

  it("prints GitHub's merged report with its sha when the request itself says merged", () => {
    expect(asyncMergedLine({ about: WITH_UUID, prState: "MERGED", state: MERGED })).toBe(
      "MERGED: GitHub reports acme/acme-admin#16378, request u-1 already merged (abc123): done. " +
        "This invocation confirmed no queue ENTRY, which is the only thing it reports success on.",
    );
    expect(
      asyncMergedLine({
        about: NO_UUID,
        prState: "MERGED",
        state: { message: "done", sha: undefined, status: "merged", uuid: undefined },
      }),
    ).toBe(
      "MERGED: GitHub reports acme/acme-admin#16378 already merged: done. " +
        "This invocation confirmed no queue ENTRY, which is the only thing it reports success on.",
    );
  });

  it("names the read-back state when it is the pull request's own state that settled the round", () => {
    expect(asyncMergedLine({ about: WITH_UUID, prState: "MERGED", state: PENDING })).toBe(
      "MERGED: acme/acme-admin#16378, request u-1 reads back MERGED rather than OPEN while the asynchronous " +
        "request reads pending. This invocation confirmed no queue ENTRY, which is the only thing it reports success on.",
    );
  });

  it("prints UNCONFIRMED with the last status and the warning against a second job", () => {
    expect(asyncUnconfirmedLine({ about: WITH_UUID, status: "pending" })).toBe(
      "UNCONFIRMED: GitHub accepted the asynchronous enqueue of acme/acme-admin#16378, request u-1 and it " +
        "still reads pending; no mergeQueueEntry was observed within this invocation's confirmation budget. " +
        "Re-read it before retrying — the request may still complete, and a second one would be a second job.",
    );
  });

  it("prints IN FLIGHT naming the accepted request", () => {
    expect(asyncInFlightLine({ about: WITH_UUID })).toBe(
      "IN FLIGHT: GitHub already ACCEPTED an asynchronous merge request for acme/acme-admin#16378, request u-1. " +
        "Re-read it before doing anything else — enqueueing again would start a second merge job on the stack.",
    );
  });

  it("prints UNCERTAIN, not IN FLIGHT, when the request's own answer could not be read", () => {
    expect(asyncMayHaveStartedLine({ about: NO_UUID })).toBe(
      "UNCERTAIN: an asynchronous merge request for acme/acme-admin#16378 may already have reached GitHub — " +
        "this failed while sending it or while reading its answer. Re-read the pull request before retrying; " +
        "enqueueing again would start a second merge job on the stack.",
    );
  });
});
