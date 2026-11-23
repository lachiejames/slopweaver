import { describe, expect, it } from "vitest";
import {
  approvingLogins,
  humanReviewsAfter,
  humanReviewsSince,
  isBotLogin,
  requiredApprovers,
  reviewOpinion,
} from "../../../../review/reviewState.js";

describe("requiredApprovers", () => {
  it("flags the author's own token as unable to satisfy the requirement", () => {
    const approvers = requiredApprovers({
      authorLogin: "author-login",
      owners: [
        { kind: "user", paths: ["a.ts"], token: "@author-login" },
        { kind: "team", paths: ["a.ts"], token: "@org/platform" },
      ],
    });
    expect(approvers.map((approver) => approver.isAuthor)).toEqual([true, false]);
  });
});

describe("reviewOpinion, approvingLogins and humanReviewsAfter", () => {
  const review = ({ login, state, at }: { login: string; state: string; at: string }) => ({
    commitOid: "abc",
    login,
    state,
    submittedAtIso: at,
  });

  it("reads GitHub's own three states, treating anything that is not a verdict as a comment", () => {
    expect(reviewOpinion({ state: "APPROVED" })).toBe("approved");
    expect(reviewOpinion({ state: "CHANGES_REQUESTED" })).toBe("changes-requested");
    expect(reviewOpinion({ state: "DISMISSED" })).toBe("commented");
  });

  it("takes each reviewer's LATEST verdict, so a withdrawn approval no longer counts", () => {
    const logins = approvingLogins({
      authorLogin: "the-author",
      reviews: [
        review({ at: "2026-08-28T00:00:00Z", login: "A-Colleague", state: "APPROVED" }),
        review({ at: "2026-08-29T00:00:00Z", login: "A-Colleague", state: "CHANGES_REQUESTED" }),
      ],
    });
    expect([...logins]).toEqual([]);
  });

  it("keeps an approval that a later COMMENT did not overturn", () => {
    const logins = approvingLogins({
      authorLogin: "the-author",
      reviews: [
        review({ at: "2026-08-28T00:00:00Z", login: "a-colleague", state: "APPROVED" }),
        review({ at: "2026-08-29T00:00:00Z", login: "a-colleague", state: "COMMENTED" }),
      ],
    });
    expect([...logins]).toEqual(["a-colleague"]);
  });

  it("never counts a bot or the author as an approval", () => {
    const logins = approvingLogins({
      authorLogin: "the-author",
      reviews: [
        review({ at: "2026-08-28T00:00:00Z", login: "coderabbitai", state: "APPROVED" }),
        review({ at: "2026-08-28T00:00:00Z", login: "some-app[bot]", state: "APPROVED" }),
        review({ at: "2026-08-28T00:00:00Z", login: "the-author", state: "APPROVED" }),
      ],
    });
    expect([...logins]).toEqual([]);
  });

  it("carries what each human said after the ask, not merely that they answered", () => {
    const after = humanReviewsAfter({
      askIso: "2026-08-28T00:00:00Z",
      authorLogin: "the-author",
      reviews: [
        review({ at: "2026-08-27T00:00:00Z", login: "too-early", state: "APPROVED" }),
        review({ at: "2026-08-29T00:00:00Z", login: "a-colleague", state: "CHANGES_REQUESTED" }),
      ],
    });
    expect(after).toEqual([{ atIso: "2026-08-29T00:00:00Z", login: "a-colleague", opinion: "changes-requested" }]);
  });
});

describe("isBotLogin", () => {
  it("recognises CodeRabbit, whose review is never the reviewer answering", () => {
    expect(isBotLogin({ login: "coderabbitai" })).toBe(true);
  });

  it("recognises GitHub's own app-login suffix", () => {
    expect(isBotLogin({ login: "dependabot[bot]" })).toBe(true);
  });

  it("does not call a colleague a bot", () => {
    expect(isBotLogin({ login: "reviewer-one" })).toBe(false);
  });
});

describe("humanReviewsSince", () => {
  const reviews = [
    { commitOid: "x", login: "coderabbitai", state: "APPROVED", submittedAtIso: "2026-08-29T00:00:00Z" },
    { commitOid: "x", login: "a", state: "COMMENTED", submittedAtIso: "2026-08-29T00:00:00Z" },
    { commitOid: "x", login: "reviewer-one", state: "COMMENTED", submittedAtIso: "2026-08-29T00:00:00Z" },
    { commitOid: "x", login: "reviewer-one", state: "COMMENTED", submittedAtIso: "2026-08-27T00:00:00Z" },
  ];

  it("keeps only a non-author human's review submitted after the ask", () => {
    const found = humanReviewsSince({ askIso: "2026-08-28T00:00:00Z", authorLogin: "a", reviews });
    expect(found.map((review) => review.login)).toEqual(["reviewer-one"]);
  });
});
