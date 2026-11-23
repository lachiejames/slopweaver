/**
 * `github enqueue`'s two reads: the pull request, then its landing branch's queue and required contexts,
 * where the contexts are read only when there is a queue to gate.
 */
import { okAsync } from "neverthrow";
import { describe, expect, it } from "vitest";

import type { GithubEnqueueArgs } from "../../../../../cli/commands/github/enqueueArgs.js";
import { readEnqueueState } from "../../../../../cli/commands/github/enqueueRead.js";
import { err, ok, unwrap, unwrapErr } from "../../../../../lib/result.js";
import { GithubLiveErrors } from "../../../../../live/github/errors.js";
import type { MergeQueuePrState } from "../../../../../live/github/mergeQueue.js";
import type { GithubMergeQueueApi } from "../../../../../outbound/github/mergeQueue.js";

const ARGS: GithubEnqueueArgs = {
  acknowledge: [],
  acknowledgeAll: false,
  dequeue: false,
  dryRun: false,
  home: undefined,
  json: false,
  number: 9,
  owner: "acme",
  reason: undefined,
  repo: "widget",
};

const PR: MergeQueuePrState = {
  approvedBy: [],
  baseRefName: "main",
  baseRefOid: "ba5e0000",
  body: "",
  checks: {
    baseRef: undefined,
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
  entry: undefined,
  githubMergeStatus: { kind: "mergeable", status: "CLEAN" },
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
};

/** A fake whose read, queue and contexts answers a case picks, recording which reads it was asked for. */
function api({
  readFails = false,
  noQueue = false,
  asked,
}: {
  readFails?: boolean;
  noQueue?: boolean;
  asked: string[];
}): GithubMergeQueueApi {
  return {
    asyncMergeResult: () => Promise.resolve(ok({ message: "queued", status: "pending", uuid: "req-1" })),
    dequeue: () => okAsync(undefined),
    enqueue: () => okAsync(undefined),
    enqueueStack: () => okAsync({ message: "queued", status: "pending", uuid: "req-1" }),
    queue: ({ branch }) => {
      asked.push(`queue ${branch}`);
      return Promise.resolve(ok(noQueue ? undefined : { branch, url: "https://example.invalid/queue" }));
    },
    read: () => {
      asked.push("read");
      if (readFails) {
        return Promise.resolve(err(GithubLiveErrors.notFound({ identity: "acme/widget#9", kind: "pull request" })));
      }
      return Promise.resolve(ok(PR));
    },
    requiredContexts: async ({ branch }) => {
      asked.push(`contexts ${branch}`);
      return ok({ branch, contexts: ["build"], requiresCodeOwnerReviews: true });
    },
  };
}

describe("readEnqueueState", () => {
  it("reads the pull request, its landing branch's queue and that branch's required contexts", async () => {
    const asked: string[] = [];

    const state = unwrap(await readEnqueueState({ api: api({ asked }), args: ARGS }));

    expect(asked).toEqual(["read", "queue main", "contexts main"]);
    expect(state.queue).toEqual({ branch: "main", url: "https://example.invalid/queue" });
    expect(state.requiredContexts).toEqual(["build"]);
    expect(state.requiresCodeOwnerReviews).toBe(true);
  });

  it("skips the contexts read when the branch has no queue", async () => {
    const asked: string[] = [];

    const state = unwrap(await readEnqueueState({ api: api({ asked, noQueue: true }), args: ARGS }));

    expect(asked).toEqual(["read", "queue main"]);
    expect(state.queue).toBe(undefined);
    expect(state.requiredContexts).toEqual([]);
    expect(state.requiresCodeOwnerReviews).toBe(undefined);
  });

  it("stops at a failed pull request read with its message", async () => {
    const asked: string[] = [];

    const state = await readEnqueueState({ api: api({ asked, readFails: true }), args: ARGS });

    expect(asked).toEqual(["read"]);
    expect(unwrapErr(state)).toEqual([
      GithubLiveErrors.notFound({ identity: "acme/widget#9", kind: "pull request" }).message,
    ]);
  });
});
