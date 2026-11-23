import { describe, expect, it } from "vitest";

import {
  blockedWithoutReviewDecision,
  type GithubMergeStatus,
  githubMergeStatus,
  mergeStatusClause,
  pendingCodeownerRequestIsNonBlocking,
} from "../../../review/githubMergeStatus.js";

/** The three tokens GitHub documents as a mergeable state, spelled here rather than imported. */
const MERGEABLE = ["CLEAN", "UNSTABLE", "HAS_HOOKS"] as const;

/** The four documented tokens that settle nothing about review, spelled here rather than imported. */
const UNPROVEN = ["BEHIND", "DIRTY", "DRAFT", "UNKNOWN"] as const;

describe("githubMergeStatus", () => {
  it.each(MERGEABLE)("classifies %s as mergeable, carrying the token back", (token) => {
    expect(githubMergeStatus({ value: token })).toEqual({ kind: "mergeable", status: token });
  });

  it("classifies BLOCKED on its own, because it is the only token that states a hold", () => {
    expect(githubMergeStatus({ value: "BLOCKED" })).toEqual({ kind: "blocked", status: "BLOCKED" });
  });

  it.each(UNPROVEN)("classifies %s as unproven rather than as the negation of BLOCKED", (token) => {
    expect(githubMergeStatus({ value: token })).toEqual({ kind: "unproven", status: token });
  });

  it("reads an ABSENT field as unread, naming what it found", () => {
    expect(githubMergeStatus({ value: undefined })).toEqual({
      kind: "unread",
      why: "this read carried no mergeStateStatus for it",
    });
  });

  it("reads a NULL field as unread, which is a different sentence from an absent one", () => {
    expect(githubMergeStatus({ value: null })).toEqual({
      kind: "unread",
      why: "GitHub returned a null mergeStateStatus for it",
    });
  });

  it("reads a token this repository does not know as unread, and quotes it", () => {
    expect(githubMergeStatus({ value: "SOMETHING_NEW" })).toEqual({
      kind: "unread",
      why: "GitHub returned a mergeStateStatus this read does not know (SOMETHING_NEW)",
    });
  });

  it("reads a non-string as unread, naming the type rather than interpolating the value", () => {
    expect(githubMergeStatus({ value: 7 })).toEqual({
      kind: "unread",
      why: "the mergeStateStatus field held number rather than a token",
    });
  });

  it("never answers mergeable for a lower-cased token, so a case change cannot wave a row through", () => {
    expect(githubMergeStatus({ value: "clean" }).kind).toBe("unread");
  });
});

describe("pendingCodeownerRequestIsNonBlocking", () => {
  it.each(MERGEABLE)("clears a pending request when GitHub answers %s over a complete request read", (token) => {
    const mergeStatus = githubMergeStatus({ value: token });
    expect(
      pendingCodeownerRequestIsNonBlocking({ mergeStatus, requestsTruncated: false, reviewDecision: undefined }),
    ).toBe(true);
  });

  it.each([...UNPROVEN, "BLOCKED", "SOMETHING_NEW"])("keeps the hold when GitHub answers %s", (token) => {
    const mergeStatus = githubMergeStatus({ value: token });
    expect(
      pendingCodeownerRequestIsNonBlocking({ mergeStatus, requestsTruncated: false, reviewDecision: undefined }),
    ).toBe(false);
  });

  it.each(MERGEABLE)("keeps the hold on a TRUNCATED request read even when GitHub answers %s", (token) => {
    // A capped request page can only ever LOSE a pending owner, so the register this exception argues about
    // is not fully known. Relaxing incomplete evidence is a second policy change, and this is not it.
    const mergeStatus = githubMergeStatus({ value: token });
    expect(
      pendingCodeownerRequestIsNonBlocking({ mergeStatus, requestsTruncated: true, reviewDecision: undefined }),
    ).toBe(false);
  });
  it.each(["CHANGES_REQUESTED", "REVIEW_REQUIRED", "APPROVED"])(
    "keeps the hold when GitHub STATED %s, even over a mergeable status and a complete read",
    (decision) => {
      // A mergeStateStatus is an answer about branch protection, never a reviewer withdrawing an opinion.
      // Without this arm the fleet read passed a pull request
      // the enqueue door refused on the identical inputs, at its own reviewFinding.
      const mergeStatus = githubMergeStatus({ value: "CLEAN" });
      expect(
        pendingCodeownerRequestIsNonBlocking({ mergeStatus, requestsTruncated: false, reviewDecision: decision }),
      ).toBe(false);
    },
  );

  it("reads an EMPTY decision string as no decision, which is how the fleet read spells it", () => {
    const mergeStatus = githubMergeStatus({ value: "CLEAN" });
    expect(pendingCodeownerRequestIsNonBlocking({ mergeStatus, requestsTruncated: false, reviewDecision: "" })).toBe(
      true,
    );
  });
});

describe("blockedWithoutReviewDecision", () => {
  const blocked = githubMergeStatus({ value: "BLOCKED" });

  it.each([undefined, ""])("answers true for BLOCKED with no decision stated (%s)", (decision) => {
    expect(blockedWithoutReviewDecision({ mergeStatus: blocked, reviewDecision: decision })).toBe(true);
  });

  it.each(["APPROVED", "CHANGES_REQUESTED", "REVIEW_REQUIRED"])("answers false over a stated %s", (decision) => {
    expect(blockedWithoutReviewDecision({ mergeStatus: blocked, reviewDecision: decision })).toBe(false);
  });

  it.each([...MERGEABLE, ...UNPROVEN, "SOMETHING_NEW"])("answers false for %s with no decision", (token) => {
    expect(blockedWithoutReviewDecision({ mergeStatus: githubMergeStatus({ value: token }), reviewDecision: "" })).toBe(
      false,
    );
  });
});

describe("mergeStatusClause", () => {
  it("says GitHub would merge it now for a mergeable status, naming the token", () => {
    const mergeStatus = githubMergeStatus({ value: "UNSTABLE" });
    expect(mergeStatusClause({ mergeStatus })).toBe("GitHub reports UNSTABLE, so it would merge this now");
  });

  it("never names a cause for BLOCKED, because GitHub does not state one", () => {
    const mergeStatus = githubMergeStatus({ value: "BLOCKED" });
    expect(mergeStatusClause({ mergeStatus })).toBe("GitHub reports the merge BLOCKED, without saying by what");
  });

  it("says an unproven status settles nothing about review", () => {
    const mergeStatus = githubMergeStatus({ value: "BEHIND" });
    expect(mergeStatusClause({ mergeStatus })).toBe("GitHub reports BEHIND, which settles nothing about review");
  });

  it("hands an unread status its own why straight back, rather than composing a second sentence", () => {
    const mergeStatus: GithubMergeStatus = githubMergeStatus({ value: null });
    expect(mergeStatusClause({ mergeStatus })).toBe("GitHub returned a null mergeStateStatus for it");
  });
});
