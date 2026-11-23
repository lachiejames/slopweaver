/*
 * The comments already on a pull request, parsed whole from the node the typed live reader selected — or refused.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import {
  DESCRIPTION_COMMENTS_READ_LIMIT,
  existingDescriptionCommentsOf,
} from "../../../../outbound/github/descriptionReviewComments.js";

/** A whole connection over some nodes. */
function connection({ nodes, hasNextPage = false }: { nodes: unknown[]; hasNextPage?: boolean }): unknown {
  return { nodes, pageInfo: { endCursor: null, hasNextPage }, totalCount: nodes.length };
}

const CONVERSATION = {
  author: { login: "quillfeather" },
  body: "Does this hold for a work account too?",
  createdAt: "2026-11-17T00:00:00Z",
  id: "IC_1",
  updatedAt: "2026-11-17T00:05:00Z",
  url: "https://github.com/acme/widgets/pull/7#issuecomment-1",
};

const INLINE = {
  author: null,
  body: "This branch never runs on a personal account.",
  createdAt: "2026-11-17T01:00:00Z",
  diffHunk: "@@ -1,3 +1,4 @@",
  id: "RC_1",
  originalLine: 12,
  updatedAt: "2026-11-17T01:00:00Z",
  url: "https://github.com/acme/widgets/pull/7#discussion_r1",
};

/** A pull-request node with one conversation comment and one inline thread. */
function pullRequest(over: Record<string, unknown> = {}): unknown {
  return {
    comments: connection({ nodes: [CONVERSATION] }),
    reviewThreads: connection({
      nodes: [{ comments: connection({ nodes: [INLINE] }), id: "T_1", line: 14, path: "src/consent.ts" }],
    }),
    ...over,
  };
}

describe("existingDescriptionCommentsOf", () => {
  it("reads every conversation and inline comment, anchoring an inline one by its thread's path and original line", () => {
    expect(unwrap(existingDescriptionCommentsOf({ data: pullRequest() }))).toStrictEqual([
      {
        authorLogin: "quillfeather",
        body: "Does this hold for a work account too?",
        createdAtIso: "2026-11-17T00:00:00Z",
        id: "IC_1",
        kind: "issue-comment",
        updatedAtIso: "2026-11-17T00:05:00Z",
        url: "https://github.com/acme/widgets/pull/7#issuecomment-1",
      },
      {
        authorLogin: null,
        body: "This branch never runs on a personal account.",
        createdAtIso: "2026-11-17T01:00:00Z",
        id: "RC_1",
        kind: "review-comment",
        originalLine: 12,
        path: "src/consent.ts",
        updatedAtIso: "2026-11-17T01:00:00Z",
        url: "https://github.com/acme/widgets/pull/7#discussion_r1",
      },
    ]);
  });

  it("reads a pull request with no comments as none", () => {
    const empty = pullRequest({ comments: connection({ nodes: [] }), reviewThreads: connection({ nodes: [] }) });
    expect(unwrap(existingDescriptionCommentsOf({ data: empty }))).toStrictEqual([]);
  });

  it("keeps a file-level inline comment, whose original line is null", () => {
    const fileLevel = { ...INLINE, originalLine: null };
    const data = pullRequest({
      reviewThreads: connection({ nodes: [{ comments: connection({ nodes: [fileLevel] }), path: "README.md" }] }),
    });
    const inline = unwrap(existingDescriptionCommentsOf({ data }))[1]!;
    expect(inline.kind).toBe("review-comment");
    expect(inline).toStrictEqual({
      authorLogin: null,
      body: "This branch never runs on a personal account.",
      createdAtIso: "2026-11-17T01:00:00Z",
      id: "RC_1",
      kind: "review-comment",
      originalLine: null,
      path: "README.md",
      updatedAtIso: "2026-11-17T01:00:00Z",
      url: "https://github.com/acme/widgets/pull/7#discussion_r1",
    });
  });

  it("refuses a conversation with another page rather than reviewing part of it as the whole", () => {
    const data = pullRequest({ comments: connection({ hasNextPage: true, nodes: [CONVERSATION] }) });
    const failure = unwrapErr(existingDescriptionCommentsOf({ data }));
    expect(failure.code).toBe("COMMENTS_READ_FAILED");
    expect(failure.message).toContain(
      `the conversation comments has more than ${String(DESCRIPTION_COMMENTS_READ_LIMIT)} nodes`,
    );
  });

  it("refuses a truncated thread", () => {
    const data = pullRequest({
      reviewThreads: connection({
        nodes: [{ comments: connection({ hasNextPage: true, nodes: [INLINE] }), path: "src/consent.ts" }],
      }),
    });
    expect(unwrapErr(existingDescriptionCommentsOf({ data })).message).toContain(
      "the comments on a thread in src/consent.ts has more than",
    );
  });

  it("refuses a page of threads that reports more", () => {
    const data = pullRequest({ reviewThreads: connection({ hasNextPage: true, nodes: [] }) });
    expect(unwrapErr(existingDescriptionCommentsOf({ data })).message).toContain("the review threads has more than");
  });

  it("refuses a comment whose body is missing", () => {
    const { body: _body, ...bodiless } = CONVERSATION;
    const data = pullRequest({ comments: connection({ nodes: [bodiless] }) });
    expect(unwrapErr(existingDescriptionCommentsOf({ data })).message).toContain(
      "a comment's id, body, url, createdAt or updatedAt is not a string",
    );
  });

  it("refuses an author that is neither null nor a login", () => {
    const data = pullRequest({ comments: connection({ nodes: [{ ...CONVERSATION, author: { name: "x" } }] }) });
    expect(unwrapErr(existingDescriptionCommentsOf({ data })).message).toContain(
      "author is neither null nor { login }",
    );
  });

  it("refuses an inline comment whose original line is not an integer", () => {
    const data = pullRequest({
      reviewThreads: connection({
        nodes: [{ comments: connection({ nodes: [{ ...INLINE, originalLine: "12" }] }), path: "src/consent.ts" }],
      }),
    });
    expect(unwrapErr(existingDescriptionCommentsOf({ data })).message).toContain(
      "a review comment's originalLine is neither null nor an integer",
    );
  });

  it("refuses a thread with no path", () => {
    const data = pullRequest({ reviewThreads: connection({ nodes: [{ comments: connection({ nodes: [] }) }] }) });
    expect(unwrapErr(existingDescriptionCommentsOf({ data })).message).toContain("a review thread carries no path");
  });

  it("refuses a node that selected no comment connection", () => {
    const { comments: _comments, ...uncommented } = pullRequest() as Record<string, unknown>;
    expect(unwrapErr(existingDescriptionCommentsOf({ data: uncommented })).message).toContain(
      "the conversation comments is not a connection",
    );
  });
});
