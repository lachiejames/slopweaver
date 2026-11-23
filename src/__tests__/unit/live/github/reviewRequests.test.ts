import { describe, expect, it } from "vitest";

import {
  codeOwnerRequests,
  parseReviewRequests,
  REVIEW_REQUESTS_SELECTION,
  reviewRequestsTruncated,
} from "../../../../live/github/reviewRequests.js";

const node = ({ nodes }: { nodes: readonly unknown[] }) => ({
  reviewRequests: { nodes, pageInfo: { hasNextPage: false } },
});

describe("parseReviewRequests", () => {
  it("reads a team by its combined slug and a user by their login, carrying GitHub's own flag", () => {
    const requests = parseReviewRequests({
      node: node({
        nodes: [
          { asCodeOwner: true, requestedReviewer: { __typename: "Team", combinedSlug: "acme/eng", slug: "eng" } },
          { asCodeOwner: false, requestedReviewer: { __typename: "User", login: "a-colleague" } },
        ],
      }),
    });
    expect(requests).toEqual([
      { asCodeOwner: true, kind: "team", name: "acme/eng" },
      { asCodeOwner: false, kind: "user", name: "a-colleague" },
    ]);
  });

  it("drops an entry whose reviewer GitHub returned unnamed", () => {
    expect(parseReviewRequests({ node: node({ nodes: [{ asCodeOwner: true, requestedReviewer: null }] }) })).toEqual(
      [],
    );
  });

  it("answers empty on a node carrying no reviewRequests connection at all", () => {
    expect(parseReviewRequests({ node: { number: 1 } })).toEqual([]);
  });

  it("treats a missing asCodeOwner as false rather than as a code-owner requirement", () => {
    const requests = parseReviewRequests({
      node: node({ nodes: [{ requestedReviewer: { __typename: "User", login: "a-colleague" } }] }),
    });
    expect(requests[0]!.asCodeOwner).toBe(false);
  });
});

describe("codeOwnerRequests", () => {
  it("keeps only what GitHub itself flagged as a code-owner requirement", () => {
    const requests = codeOwnerRequests({
      requests: [
        { asCodeOwner: true, kind: "team", name: "acme/eng" },
        { asCodeOwner: false, kind: "user", name: "a-colleague" },
      ],
    });
    expect(requests).toEqual([{ asCodeOwner: true, kind: "team", name: "acme/eng" }]);
  });

  it("is empty when GitHub flagged none, which is the only honest reading of 'no open requirement'", () => {
    expect(codeOwnerRequests({ requests: [{ asCodeOwner: false, kind: "user", name: "a-colleague" }] })).toEqual([]);
  });
});

describe("REVIEW_REQUESTS_SELECTION", () => {
  it("asks for GitHub's own asCodeOwner flag and reports truncation, which a cap can only lose an owner to", () => {
    expect(REVIEW_REQUESTS_SELECTION).toContain("asCodeOwner");
    expect(REVIEW_REQUESTS_SELECTION).toContain("hasNextPage");
  });

  it("sizes its page from a variable, so each caller states its own cap", () => {
    expect(REVIEW_REQUESTS_SELECTION).toContain("first: $requestLimit");
  });
});

describe("reviewRequestsTruncated", () => {
  it("reads a page GitHub said carries more as incomplete", () => {
    expect(reviewRequestsTruncated({ node: { reviewRequests: { nodes: [], pageInfo: { hasNextPage: true } } } })).toBe(
      true,
    );
  });

  it("reads a fully-delivered page of named reviewers as complete", () => {
    const delivered = node({
      nodes: [{ asCodeOwner: true, requestedReviewer: { __typename: "Team", combinedSlug: "acme/eng" } }],
    });
    expect(reviewRequestsTruncated({ node: delivered })).toBe(false);
  });

  it("reads a DROPPED code-owner entry as incomplete, because the register then lies by omission", () => {
    // GitHub declares requestedReviewer nullable while asCodeOwner is Boolean!, so a deleted or invisible
    // reviewer arrives flagged and unnamed. parseReviewRequests drops it and the register reads EMPTY, which
    // passes codeowners-satisfied unconditionally.
    const dropped = node({ nodes: [{ asCodeOwner: true, requestedReviewer: null }] });
    expect(parseReviewRequests({ node: dropped })).toEqual([]);
    expect(reviewRequestsTruncated({ node: dropped })).toBe(true);
  });

  it("leaves a dropped NON-code-owner entry complete, because nothing it could hide is a requirement", () => {
    const dropped = node({ nodes: [{ asCodeOwner: false, requestedReviewer: null }] });
    expect(reviewRequestsTruncated({ node: dropped })).toBe(false);
  });
});

describe("a NULL entry in the request connection", () => {
  it("reads as incomplete, because a node that says nothing could be the required owner", () => {
    // `nodes` is [ReviewRequest], so an element may be null. The first fix for the dropped-entry hole used
    // .filter(isRecord) and discarded exactly the entry it was looking for.
    const withNull = { reviewRequests: { nodes: [null], pageInfo: { hasNextPage: false } } };
    expect(parseReviewRequests({ node: withNull })).toEqual([]);
    expect(reviewRequestsTruncated({ node: withNull })).toBe(true);
  });
});

describe("a request connection this read never got", () => {
  it.each([
    ["an absent connection", {}],
    ["a null connection", { reviewRequests: null }],
    ["a null nodes field", { reviewRequests: { nodes: null, pageInfo: { hasNextPage: false } } }],
    ["a non-array nodes field", { reviewRequests: { nodes: {}, pageInfo: { hasNextPage: false } } }],
  ])("reads %s as incomplete rather than as an empty register", (_label, unreadNode) => {
    // Both the connection and its nodes list are nullable in GitHub's schema, and substituting [] for either
    // turned "this read got nothing" into "there is nothing" — a pass over an outstanding required owner.
    //
    expect(reviewRequestsTruncated({ node: unreadNode })).toBe(true);
  });
});
