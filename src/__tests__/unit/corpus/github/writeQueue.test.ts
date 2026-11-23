/**
 * The merge-queue writes through a real Octokit whose transport is a plain fake `fetch` recording each
 * request: the enqueue mutation pins the head with `expectedHeadOid`, the dequeue mutation names its field
 * `id`, and the native-stack enqueue is one `merge-async` PUT carrying `merge_action: "merge_queue"` and the
 * SHA with no `merge_method`, whose answer is parsed — a `failed` status under HTTP 200 included.
 */
import { Octokit } from "@octokit/rest";
import { describe, expect, it } from "vitest";

import { GithubAsyncMergeErrors } from "../../../../corpus/github/errors.js";
import type { WriteCtx } from "../../../../corpus/github/writeCtx.js";
import { dequeuePrVia, enqueuePrVia, enqueueStackPrVia } from "../../../../corpus/github/writeQueue.js";
import { isRecord } from "../../../../lib/parsers.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

/** One request as the fake transport saw it. */
interface SentRequest {
  readonly method: string;
  readonly url: string;
  readonly body: unknown;
}

/** Contexts minted so far — each gets its own rate scope, so one test's paced write never delays the next. */
let contextsMinted = 0;

/** A write context whose transport answers every request with one status and JSON body, recording each. */
function recordingCtx({ sent, status, data }: { sent: SentRequest[]; status: number; data: unknown }): WriteCtx {
  contextsMinted += 1;
  const fetch: typeof globalThis.fetch = async (url, init) => {
    const body = init?.body;
    sent.push({
      body: typeof body === "string" ? JSON.parse(body) : undefined,
      method: String(init?.method),
      url: url instanceof Request ? url.url : url.toString(),
    });
    return new Response(JSON.stringify(data), { headers: { "content-type": "application/json" }, status });
  };
  return {
    client: new Octokit({ auth: "test-token", request: { fetch } }),
    scopeId: `queue-${String(contextsMinted)}`,
  };
}

/** The GraphQL variables one recorded request carried. */
function variablesOf({ request }: { request: SentRequest }): unknown {
  return isRecord(request.body) ? request.body["variables"] : undefined;
}

const GRAPHQL_URL = "https://api.github.com/graphql";
const MERGE_ASYNC_URL = "https://api.github.com/repos/acme/widgets/pulls/42/merge-async";
const STACK_PR = { expectedHeadOid: "abc123", number: 42, owner: "acme", repo: "widgets" };

describe("enqueuePrVia", () => {
  it("sends one mutation carrying the pull request's node id and the pinned head commit", async () => {
    const sent: SentRequest[] = [];
    const ctx = recordingCtx({ data: { data: { enqueuePullRequest: { mergeQueueEntry: null } } }, sent, status: 200 });

    expect(unwrap(await enqueuePrVia({ ctx, input: { expectedHeadOid: "abc123", nodeId: "PR_9" } }))).toBeUndefined();
    expect(sent.map((request) => [request.method, request.url])).toEqual([["POST", GRAPHQL_URL]]);
    expect(variablesOf({ request: sent[0]! })).toEqual({ expectedHeadOid: "abc123", pullRequestId: "PR_9" });
  });
});

describe("dequeuePrVia", () => {
  it("sends one mutation naming the pull request's node id as `id`, not `pullRequestId`", async () => {
    const sent: SentRequest[] = [];
    const ctx = recordingCtx({ data: { data: { dequeuePullRequest: { mergeQueueEntry: null } } }, sent, status: 200 });

    expect(unwrap(await dequeuePrVia({ ctx, input: { nodeId: "PR_9" } }))).toBeUndefined();
    expect(sent.map((request) => [request.method, request.url])).toEqual([["POST", GRAPHQL_URL]]);
    expect(variablesOf({ request: sent[0]! })).toEqual({ id: "PR_9" });
  });
});

describe("enqueueStackPrVia", () => {
  it("PUTs merge_queue and the SHA with no merge_method, and returns a pending state's uuid", async () => {
    const sent: SentRequest[] = [];
    const ctx = recordingCtx({
      data: { details: { message: "queued for merge", uuid: "req-1" }, status: "pending" },
      sent,
      status: 202,
    });

    expect(unwrap(await enqueueStackPrVia({ ctx, input: STACK_PR }))).toEqual({
      message: "queued for merge",
      status: "pending",
      uuid: "req-1",
    });
    expect(sent).toEqual([
      { body: { merge_action: "merge_queue", sha: "abc123" }, method: "PUT", url: MERGE_ASYNC_URL },
    ]);
  });

  it("returns a failed status that arrived under HTTP 200 as failed, not as an acceptance", async () => {
    const ctx = recordingCtx({
      data: { details: { message: "head moved", uuid: "req-2" }, status: "failed" },
      sent: [],
      status: 200,
    });

    expect(unwrap(await enqueueStackPrVia({ ctx, input: STACK_PR }))).toEqual({
      message: "head moved",
      status: "failed",
      uuid: "req-2",
    });
  });

  it("fails with the parser's missing-message refusal when details carry no message", async () => {
    const sent: SentRequest[] = [];
    const ctx = recordingCtx({ data: { details: { uuid: "req-3" }, status: "pending" }, sent, status: 202 });

    const error = unwrapErr(await enqueueStackPrVia({ ctx, input: STACK_PR }));

    expect(error.message).toBe(GithubAsyncMergeErrors.missingMessage({ request: "req-3", status: "pending" }).message);
    expect(error.message).toBe(
      "GitHub's asynchronous merge response (pending) carried no details.message (request req-3)",
    );
    expect(error.operation).toBe("github.enqueueStackPullRequest");
    expect(sent.length).toBe(1);
  });
});
