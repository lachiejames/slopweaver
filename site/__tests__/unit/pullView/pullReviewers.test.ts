/*
 * Each reviewer's standing on the pull-request view, as GitHub's sidebar computes it.
 */

import { describe, expect, it } from "vitest";

import { type PullView, pullReviewers, readPullDocument, standingLines, standingOf } from "../../../lib/pullView";
import { DATA, document, nodes, review, VIEW } from "./harness";

describe("pullReviewers and standing", () => {
  it("keeps a requested reviewer, and an approval a later comment does not undo", () => {
    expect(pullReviewers({ view: VIEW })).toEqual([
      { asCodeOwner: true, author: false, login: "dave", onBehalfOf: [], requested: true, review: undefined },
      { asCodeOwner: false, author: false, login: "bob", onBehalfOf: [], requested: false, review: "APPROVED" },
    ]);
  });

  it("lets a later decision replace an earlier one", () => {
    const flipped = {
      ...DATA,
      reviews: nodes(
        review({ at: "2026-09-29T03:00:00Z", id: "r2", login: "bob", state: "APPROVED" }),
        review({ at: "2026-09-29T04:00:00Z", id: "r3", login: "bob", state: "CHANGES_REQUESTED" }),
      ),
    };
    const view = readPullDocument({ payload: document(flipped) })!;
    expect(pullReviewers({ view }).find((row) => row.login === "bob")!.review).toBe("CHANGES_REQUESTED");
  });

  it("says an approval counts for a team, and a request for changes on its behalf counts for nobody", () => {
    const forTeam = (state: string) => ({
      ...review({ at: "2026-09-29T03:00:00Z", id: "r2", login: "bob", state }),
      onBehalfOf: nodes({ combinedSlug: "acme/eng" }),
    });
    const approved = readPullDocument({ payload: document({ ...DATA, reviews: nodes(forTeam("APPROVED")) }) })!;
    const blocking = readPullDocument({
      payload: document({ ...DATA, reviews: nodes(forTeam("CHANGES_REQUESTED")) }),
    })!;
    const bobOf = (view: PullView) =>
      standingLines({ standing: standingOf({ login: "bob", reviewers: pullReviewers({ view }), view }) });
    expect(bobOf(approved)).toEqual(["approved", "approval counts for acme/eng"]);
    expect(bobOf(blocking)).toEqual(["asked for changes"]);
  });

  it("says in words where the author, an approver and a requested code owner stand", () => {
    const reviewers = pullReviewers({ view: VIEW });
    expect(standingLines({ standing: standingOf({ login: "author", reviewers, view: VIEW }) })).toEqual([
      "opened this pull request",
    ]);
    expect(standingLines({ standing: standingOf({ login: "bob", reviewers, view: VIEW }) })).toEqual(["approved"]);
    expect(standingLines({ standing: standingOf({ login: "dave", reviewers, view: VIEW }) })).toEqual([
      "review requested, as a code owner",
    ]);
    expect(standingLines({ standing: standingOf({ login: "carol", reviewers, view: VIEW }) })).toEqual([]);
  });
});
