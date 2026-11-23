import { describe, expect, it } from "vitest";

import { GithubAsyncMergeErrors } from "../../../../corpus/github/errors.js";
import { parseGithubAsyncMergeState } from "../../../../corpus/github/mergeAsync.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

/** One raw `merge-async` body, shaped as GitHub documents it; overrides replace what a case is about. */
function body({
  status = "pending",
  details = { message: "queued for merge", uuid: "3f1c" },
}: {
  status?: unknown;
  details?: unknown;
} = {}): unknown {
  return { details, status };
}

describe("parseGithubAsyncMergeState", () => {
  it("reads a pending request and keeps the uuid it must be polled by", () => {
    const state = unwrap(parseGithubAsyncMergeState({ data: body() }));
    expect(state).toStrictEqual({ message: "queued for merge", status: "pending", uuid: "3f1c" });
  });

  it("reads an enqueued request, keeping the uuid GitHub named even though nothing will poll it", () => {
    // Kept for the REPORT, not for polling: an acceptance that skips `pending` still identifies the request,
    // and the exhaustion line has to be able to name what it is telling the operator to re-read.
    const state = unwrap(
      parseGithubAsyncMergeState({
        data: body({ details: { message: "added to the queue", uuid: "req-1" }, status: "enqueued" }),
      }),
    );
    expect(state).toStrictEqual({ message: "added to the queue", status: "enqueued", uuid: "req-1" });
  });

  it("reads an enqueued request that names no uuid, without inventing one", () => {
    const state = unwrap(
      parseGithubAsyncMergeState({ data: body({ details: { message: "added to the queue" }, status: "enqueued" }) }),
    );
    expect(state).toStrictEqual({ message: "added to the queue", status: "enqueued", uuid: undefined });
  });

  it("reads a failed request and preserves GitHub's own reason verbatim", () => {
    const state = unwrap(
      parseGithubAsyncMergeState({
        data: body({
          details: { message: "Head branch was modified. Review and try the merge again." },
          status: "failed",
        }),
      }),
    );
    expect(state).toStrictEqual({
      message: "Head branch was modified. Review and try the merge again.",
      status: "failed",
      uuid: undefined,
    });
  });

  it("reads a merged request with the commit it produced", () => {
    const state = unwrap(
      parseGithubAsyncMergeState({
        data: body({ details: { message: "merged", sha: "deadbeef" }, status: "merged" }),
      }),
    );
    expect(state).toStrictEqual({ message: "merged", sha: "deadbeef", status: "merged", uuid: undefined });
  });

  it("reads a merged request with no sha as merged with no sha, rather than refusing it", () => {
    const state = unwrap(
      parseGithubAsyncMergeState({ data: body({ details: { message: "merged" }, status: "merged" }) }),
    );
    expect(state).toStrictEqual({ message: "merged", sha: undefined, status: "merged", uuid: undefined });
  });

  it("ignores fields it does not consume, so GitHub adding to the payload cannot break the read", () => {
    const state = unwrap(
      parseGithubAsyncMergeState({
        data: {
          details: { expected_head_sha: "cafe", merge_action: "merge_queue", message: "m", uuid: "u" },
          status: "pending",
          tomorrows_field: 1,
        },
      }),
    );
    expect(state).toStrictEqual({ message: "m", status: "pending", uuid: "u" });
  });

  it("refuses a pending request with no uuid, because nothing could then poll it", () => {
    const problem = unwrapErr(parseGithubAsyncMergeState({ data: body({ details: { message: "m" } }) }));
    expect(problem).toStrictEqual(GithubAsyncMergeErrors.pendingWithoutUuid({ salvaged: undefined }));
    expect(problem.code).toBe("ASYNC_MERGE_PENDING_WITHOUT_UUID");
    expect(problem.message).toBe("GitHub accepted an asynchronous merge as pending but named no uuid to poll it by");
  });

  it("refuses a status this build does not know rather than guessing what it means", () => {
    const problem = unwrapErr(parseGithubAsyncMergeState({ data: body({ status: "cancelled" }) }));
    expect(problem).toStrictEqual(GithubAsyncMergeErrors.unknownStatus({ request: "3f1c", status: "cancelled" }));
    expect(problem.code).toBe("ASYNC_MERGE_UNKNOWN_STATUS");
    expect(problem.message).toBe(
      "GitHub reported an asynchronous merge status this build does not know: cancelled (request 3f1c)",
    );
  });

  it("surrenders the uuid even when it refuses the payload, so an orphaned job can still be found", () => {
    // A Codex review's counterexample: a 202 with a uuid and no message is an ACCEPTED job, and the refusal
    // was throwing away the one field that could locate it.
    const problem = unwrapErr(
      parseGithubAsyncMergeState({ data: body({ details: { uuid: "req-123" }, status: "pending" }) }),
    );
    expect(problem.code).toBe("ASYNC_MERGE_MISSING_MESSAGE");
    expect(problem.message).toBe(
      "GitHub's asynchronous merge response (pending) carried no details.message (request req-123)",
    );
  });

  it("refuses a response with no details object", () => {
    const problem = unwrapErr(parseGithubAsyncMergeState({ data: { status: "failed" } }));
    expect(problem).toStrictEqual(GithubAsyncMergeErrors.missingDetails({ request: undefined, status: "failed" }));
    expect(problem.code).toBe("ASYNC_MERGE_MISSING_DETAILS");
    expect(problem.message).toBe("GitHub's asynchronous merge response (failed) carried no details object");
  });

  it("still names the uuid when the response carried one and no details object at all", () => {
    // Every refusal here names the identifier when there is one — the whole point is that a body this build
    // could not read may still be an accepted merge job. Missing this one refusal was a Codex review catch.
    const problem = unwrapErr(parseGithubAsyncMergeState({ data: { status: "pending", uuid: "req-123" } }));
    expect(problem.code).toBe("ASYNC_MERGE_MISSING_DETAILS");
    expect(problem.message).toBe(
      "GitHub's asynchronous merge response (pending) carried no details object (request req-123)",
    );
  });

  it("refuses a blank message, since the message IS what a failure reports", () => {
    const problem = unwrapErr(
      parseGithubAsyncMergeState({ data: body({ details: { message: "   " }, status: "failed" }) }),
    );
    expect(problem.code).toBe("ASYNC_MERGE_MISSING_MESSAGE");
    expect(problem.message).toBe("GitHub's asynchronous merge response (failed) carried no details.message");
  });

  it("salvages a uuid sitting outside details when the body did not hold its documented shape", () => {
    // Not a claim about the schema — `details.uuid` is where GitHub documents it. This is the case where the
    // schema DID NOT hold, and the identifier is the one field worth rescuing: the job may be running.
    const problem = unwrapErr(
      parseGithubAsyncMergeState({ data: { details: { message: "accepted" }, status: "unheard-of", uuid: "req-9" } }),
    );
    expect(problem.code).toBe("ASYNC_MERGE_UNKNOWN_STATUS");
    expect(problem.message).toBe(
      "GitHub reported an asynchronous merge status this build does not know: unheard-of (request req-9)",
    );
  });

  it("names the documented details.uuid over a different uuid elsewhere in a body it refuses", () => {
    const problem = unwrapErr(
      parseGithubAsyncMergeState({
        data: { details: { message: "accepted", uuid: "documented" }, status: "unheard-of", uuid: "stray" },
      }),
    );
    expect(problem).toStrictEqual(
      GithubAsyncMergeErrors.unknownStatus({ request: "documented", status: "unheard-of" }),
    );
  });

  it("salvages a uuid nested deeper than the documented position, in a body it is refusing anyway", () => {
    const problem = unwrapErr(
      parseGithubAsyncMergeState({
        data: { details: { message: "accepted", request: { uuid: "req-123" } }, status: "pending" },
      }),
    );
    expect(problem).toStrictEqual(GithubAsyncMergeErrors.pendingWithoutUuid({ salvaged: "req-123" }));
    expect(problem.code).toBe("ASYNC_MERGE_PENDING_WITHOUT_UUID");
    expect(problem.message).toBe(
      "GitHub accepted an asynchronous merge as pending but named no uuid at details.uuid to poll it by " +
        "(request req-123 was found elsewhere in the response)",
    );
  });

  it("gives up rather than walking an arbitrarily deep structure looking for one", () => {
    const problem = unwrapErr(
      parseGithubAsyncMergeState({ data: { a: { b: { c: { d: { uuid: "too-deep" } } } }, status: "failed" } }),
    );
    expect(problem.code).toBe("ASYNC_MERGE_MISSING_DETAILS");
    expect(problem.message).toBe("GitHub's asynchronous merge response (failed) carried no details object");
  });

  it("refuses a body that is not an object at all", () => {
    const problem = unwrapErr(parseGithubAsyncMergeState({ data: "accepted" }));
    expect(problem).toStrictEqual(GithubAsyncMergeErrors.notAnObject());
    expect(problem.code).toBe("ASYNC_MERGE_NOT_AN_OBJECT");
    expect(problem.message).toBe("GitHub's asynchronous merge response was not an object");
  });
});
