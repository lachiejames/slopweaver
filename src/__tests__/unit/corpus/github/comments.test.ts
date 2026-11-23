/**
 * The top-level issue/pull-request comment lane through a real Octokit whose transport is a plain fake `fetch`
 * recording each request: create, edit and read-back each project `{ id, htmlUrl, body }` and refuse a response
 * with no body, and the recent-comment list asks for one 100-item page since an ISO cutoff.
 */
import { Octokit } from "@octokit/rest";
import { describe, expect, it } from "vitest";

import {
  createIssueCommentVia,
  getIssueCommentVia,
  listIssueCommentsVia,
  updateIssueCommentVia,
} from "../../../../corpus/github/comments.js";
import type { WriteCtx } from "../../../../corpus/github/writeCtx.js";
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
    scopeId: `comments-${String(contextsMinted)}`,
  };
}

const REPO = { owner: "acme", repo: "widgets" };
const ISSUES_URL = "https://api.github.com/repos/acme/widgets/issues";
const STORED = { body: "stored body", html_url: "https://github.com/acme/widgets/pull/42#issuecomment-901", id: 901 };
const WRITTEN = { body: "stored body", htmlUrl: "https://github.com/acme/widgets/pull/42#issuecomment-901", id: 901 };

describe("createIssueCommentVia", () => {
  it("POSTs the body to the issue's comments and returns the stored body GitHub echoed", async () => {
    const sent: SentRequest[] = [];
    const ctx = recordingCtx({ data: STORED, sent, status: 201 });

    expect(unwrap(await createIssueCommentVia({ ctx, input: { ...REPO, body: "sent body", number: 42 } }))).toEqual(
      WRITTEN,
    );
    expect(sent).toEqual([{ body: { body: "sent body" }, method: "POST", url: `${ISSUES_URL}/42/comments` }]);
  });
});

describe("updateIssueCommentVia", () => {
  it("PATCHes the comment by id with the new body", async () => {
    const sent: SentRequest[] = [];
    const ctx = recordingCtx({ data: STORED, sent, status: 200 });

    expect(unwrap(await updateIssueCommentVia({ ctx, input: { ...REPO, body: "edited", commentId: 901 } }))).toEqual(
      WRITTEN,
    );
    expect(sent).toEqual([{ body: { body: "edited" }, method: "PATCH", url: `${ISSUES_URL}/comments/901` }]);
  });

  it("refuses an edit response with no body rather than reading it as an empty comment", async () => {
    const ctx = recordingCtx({ data: { html_url: STORED.html_url, id: 901 }, sent: [], status: 200 });

    const error = unwrapErr(await updateIssueCommentVia({ ctx, input: { ...REPO, body: "edited", commentId: 901 } }));

    expect(error.message).toBe("GitHub returned no body for github.issues.updateComment");
    expect(error.operation).toBe("github.issues.updateComment");
  });
});

describe("getIssueCommentVia", () => {
  it("GETs one comment by id and projects it", async () => {
    const sent: SentRequest[] = [];
    const ctx = recordingCtx({ data: STORED, sent, status: 200 });

    expect(unwrap(await getIssueCommentVia({ ctx, input: { ...REPO, commentId: 901 } }))).toEqual(WRITTEN);
    expect(sent).toEqual([{ body: undefined, method: "GET", url: `${ISSUES_URL}/comments/901` }]);
  });

  it("fails on a read-back with no body, naming getComment, after one request", async () => {
    const sent: SentRequest[] = [];
    const ctx = recordingCtx({ data: { html_url: STORED.html_url, id: 901 }, sent, status: 200 });

    const error = unwrapErr(await getIssueCommentVia({ ctx, input: { ...REPO, commentId: 901 } }));

    expect(error.message).toBe("GitHub returned no body for github.issues.getComment");
    expect(error.operation).toBe("github.issues.getComment");
    expect(sent.length).toBe(1);
  });
});

describe("listIssueCommentsVia", () => {
  it("asks for one 100-item page since the cutoff and returns each comment's id and creation time in order", async () => {
    const sent: SentRequest[] = [];
    const ctx = recordingCtx({
      data: [
        { created_at: "2026-10-01T00:00:00Z", id: 11 },
        { created_at: "2026-10-02T00:00:00Z", id: 12 },
      ],
      sent,
      status: 200,
    });

    const comments = unwrap(
      await listIssueCommentsVia({ ctx, input: { ...REPO, number: 42, sinceIso: "2026-09-30T00:00:00Z" } }),
    );

    expect(comments).toEqual([
      { createdAtIso: "2026-10-01T00:00:00Z", id: 11 },
      { createdAtIso: "2026-10-02T00:00:00Z", id: 12 },
    ]);
    expect(sent).toEqual([
      {
        body: undefined,
        method: "GET",
        url: `${ISSUES_URL}/42/comments?per_page=100&since=2026-09-30T00%3A00%3A00Z`,
      },
    ]);
  });

  it("returns a full page of 100 without requesting a second page", async () => {
    const sent: SentRequest[] = [];
    const page = Array.from({ length: 100 }, (_unused, index) => ({
      created_at: "2026-10-01T00:00:00Z",
      id: index + 1,
    }));
    const ctx = recordingCtx({ data: page, sent, status: 200 });

    const comments = unwrap(
      await listIssueCommentsVia({ ctx, input: { ...REPO, number: 42, sinceIso: "2026-09-30T00:00:00Z" } }),
    );

    expect(comments.length).toBe(100);
    expect(sent.length).toBe(1);
  });
});
