/*
 * When each review request was made, off GitHub's timeline. The property: the NEWEST event per reviewer wins,
 * because a re-request resets the wait, and a page is trusted as whole only when GitHub says it holds nothing
 * older.
 */

import { describe, expect, it } from "vitest";

import { parseReviewRequestTimes } from "../../../../live/github/reviewRequestEvents.js";

const TEAM = { __typename: "Team", combinedSlug: "acme/eng" };
const USER = { __typename: "User", login: "a-colleague" };

const node = ({ nodes, hasPreviousPage }: { nodes: readonly unknown[]; hasPreviousPage: unknown }) => ({
  requestEvents: { nodes, pageInfo: { hasPreviousPage } },
});

describe("parseReviewRequestTimes", () => {
  it("keeps each reviewer's newest request, a team by its combined slug and a user by their login", () => {
    const times = parseReviewRequestTimes({
      node: node({
        hasPreviousPage: false,
        nodes: [
          { createdAt: "2026-09-20T01:00:00Z", requestedReviewer: TEAM },
          { createdAt: "2026-09-22T05:07:00Z", requestedReviewer: TEAM },
          { createdAt: "2026-09-21T00:00:00Z", requestedReviewer: TEAM },
          { createdAt: "2026-09-23T09:00:00Z", requestedReviewer: USER },
        ],
      }),
    });
    expect(times.latestByReviewer).toStrictEqual({
      "@a-colleague": "2026-09-23T09:00:00Z",
      "@acme/eng": "2026-09-22T05:07:00Z",
    });
    expect(times.truncated).toBe(false);
  });

  it("drops an event with no instant or no named reviewer", () => {
    const times = parseReviewRequestTimes({
      node: node({
        hasPreviousPage: false,
        nodes: [
          { requestedReviewer: TEAM },
          { createdAt: "2026-09-22T05:07:00Z", requestedReviewer: { __typename: "Team", combinedSlug: "" } },
          { createdAt: "2026-09-22T05:07:00Z", requestedReviewer: null },
        ],
      }),
    });
    expect(times.latestByReviewer).toStrictEqual({});
  });

  it("reads a page GitHub says has older events, or does not say, as cut", () => {
    const older = parseReviewRequestTimes({ node: node({ hasPreviousPage: true, nodes: [] }) });
    const unsaid = parseReviewRequestTimes({ node: node({ hasPreviousPage: undefined, nodes: [] }) });
    expect([older.truncated, unsaid.truncated]).toStrictEqual([true, true]);
  });

  it("reads a node with no timeline selection as cut and empty", () => {
    const times = parseReviewRequestTimes({ node: {} });
    expect([times.latestByReviewer, times.truncated]).toStrictEqual([{}, true]);
  });
});
