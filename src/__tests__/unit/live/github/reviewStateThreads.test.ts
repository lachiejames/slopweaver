/** A pull-request node's review threads, decoded: who opened each, who spoke last, and who resolved it. */
import { describe, expect, it } from "vitest";

import { threadsOf } from "../../../../live/github/reviewStateThreads.js";

/** One thread node as the read's GraphQL returns it. */
const threadNode = (over: Record<string, unknown>): Record<string, unknown> => ({
  id: "PRRT_1",
  isOutdated: false,
  isResolved: false,
  line: 12,
  opener: { nodes: [{ author: { login: "reviewer" }, body: "a note", createdAt: "2026-09-28T04:00:00Z" }] },
  path: "src/a.ts",
  resolvedBy: null,
  tail: { nodes: [], totalCount: 1 },
  ...over,
});

describe("threadsOf", () => {
  it("names who resolved a resolved thread, and whoever spoke last", () => {
    const [thread] = threadsOf({
      node: {
        reviewThreads: {
          nodes: [
            threadNode({
              isResolved: true,
              resolvedBy: { login: "reviewer" },
              tail: {
                nodes: [{ author: { login: "teammate" }, body: "why?", createdAt: "2026-09-28T04:30:00Z" }],
                totalCount: 2,
              },
            }),
          ],
        },
      },
    });

    expect([thread!.resolvedByLogin, thread!.lastCommentLogin, thread!.commentCount, thread!.lastCommentBody]).toEqual([
      "reviewer",
      "teammate",
      2,
      "why?",
    ]);
  });

  it("carries no resolver for an open thread, and falls back to the opener when nobody has replied", () => {
    const [thread] = threadsOf({ node: { reviewThreads: { nodes: [threadNode({})] } } });

    expect(thread!.resolvedByLogin).toBeUndefined();
    expect([thread!.lastCommentLogin, thread!.commentCount, thread!.line]).toEqual(["reviewer", 1, 12]);
  });
});
