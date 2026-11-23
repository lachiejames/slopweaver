/*
 * The pure half of the page-review gate: reading a Codex pass or a fallback receipt as a candidate, binding it to
 * the prepared page, and deciding the record a publish carries.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import {
  bindPageReview,
  candidateFromCodexRecord,
  candidateFromFallbackReceipt,
  decidePageReview,
} from "../../../pages/review.js";
import {
  FIXTURE_DIFF_SHA,
  FIXTURE_FRAGMENT_SHA,
  FIXTURE_HEAD_SHA,
  FIXTURE_REPO_ROOT,
  FIXTURE_REVIEW_SCOPE,
  fixtureCodexRecord,
  fixtureEvidence,
  fixtureFallbackReceipt,
  fixturePreparation,
} from "../../pageReviewFixture.js";

const FACTS = { diffSha256: FIXTURE_DIFF_SHA, fragmentSha256: FIXTURE_FRAGMENT_SHA };
const NOW = "2026-11-03T07:00:00.000Z";

describe("candidateFromCodexRecord", () => {
  it("reads a conclusive review pass as a Codex candidate", () => {
    const candidate = unwrap(candidateFromCodexRecord({ id: "pass-1", record: fixtureCodexRecord() }));
    expect(candidate.reviewer).toBe("codex");
    expect(candidate.repoRoot).toBe(FIXTURE_REPO_ROOT);
    expect(candidate.headSha).toBe(FIXTURE_HEAD_SHA);
    expect(candidate.verdict).toBe("CLEAN");
    expect(candidate.summary).toBe("Every claim traces to the owner's words.");
  });

  it("refuses a record whose artifact id is not the one cited", () => {
    const result = candidateFromCodexRecord({ id: "pass-2", record: fixtureCodexRecord() });
    expect(unwrapErr(result).code).toBe("REVIEW_WRONG_PAGE");
  });

  it("refuses a planning pass", () => {
    const record = fixtureCodexRecord({ scope: { mode: "plan", pass: "p1", promptBytes: 1, promptSha256: "a" } });
    const result = candidateFromCodexRecord({ id: "pass-1", record });
    expect(unwrapErr(result).code).toBe("REVIEW_INCONCLUSIVE");
    expect(unwrapErr(result).message).toContain("p1 planning pass");
  });

  it("refuses a record whose pass field is not a review pass, so it never reaches the fold", () => {
    const tampered = "r1<style>[data-page-review]{display:none}</style>" as unknown as "r1";
    const record = fixtureCodexRecord({ scope: { ...FIXTURE_REVIEW_SCOPE, pass: tampered } });
    const result = candidateFromCodexRecord({ id: "pass-1", record });
    expect(unwrapErr(result).message).toContain("its record names no review pass");
  });

  it("refuses a pass that never answered", () => {
    const record = fixtureCodexRecord({
      outcome: { kind: "no-verdict", rawFinalResponse: null, reason: "invalid-output", salvage: null },
    });
    const result = candidateFromCodexRecord({ id: "pass-1", record });
    expect(unwrapErr(result).code).toBe("REVIEW_INCONCLUSIVE");
    expect(unwrapErr(result).message).toContain("its outcome is no-verdict");
  });

  it("refuses an answer for a different property than the pass asked", () => {
    const record = fixtureCodexRecord({
      scope: { ...FIXTURE_REVIEW_SCOPE, property: { id: "other", statement: "x" } },
    });
    const result = candidateFromCodexRecord({ id: "pass-1", record });
    expect(unwrapErr(result).message).toContain("not other");
  });
});

describe("candidateFromFallbackReceipt", () => {
  it("reads a receipt as a Claude fallback candidate", () => {
    const candidate = candidateFromFallbackReceipt({ id: "receipt-1", receipt: fixtureFallbackReceipt() });
    expect(candidate.reviewer).toBe("claude-fallback");
    expect(candidate.diffSha256).toBe(FIXTURE_DIFF_SHA);
    expect(candidate.summary).toBe("Claude found every claim in the owner's words.");
  });
});

describe("bindPageReview", () => {
  const candidate = unwrap(candidateFromCodexRecord({ id: "pass-1", record: fixtureCodexRecord() }));

  it("binds a candidate whose commits reproduce the prepared page", () => {
    const evidence = unwrap(
      bindPageReview({ candidate, facts: FACTS, preparation: fixturePreparation(), slug: "queue" }),
    );
    expect(evidence.preparationId).toBe("prep-1");
    expect(evidence.reviewedFragmentSha256).toBe(FIXTURE_FRAGMENT_SHA);
  });

  it("refuses a review of another slug's preparation", () => {
    const result = bindPageReview({ candidate, facts: FACTS, preparation: fixturePreparation(), slug: "other" });
    expect(unwrapErr(result).message).toContain('preparation for page "queue"');
  });

  it("refuses a review taken at commits the preparation did not make", () => {
    const preparation = fixturePreparation({ headSha: "0".repeat(40) });
    const result = bindPageReview({ candidate, facts: FACTS, preparation, slug: "queue" });
    expect(unwrapErr(result).message).toContain("not the ones `page review-prepare` committed");
  });

  it("refuses a review whose diff does not reproduce from the commits", () => {
    const facts = { ...FACTS, diffSha256: "0".repeat(64) };
    const result = bindPageReview({ candidate, facts, preparation: fixturePreparation(), slug: "queue" });
    expect(unwrapErr(result).message).toContain("working tree was edited before the review ran");
  });

  it("refuses a head whose page.html is not the prepared fragment", () => {
    const facts = { ...FACTS, fragmentSha256: "0".repeat(64) };
    const result = bindPageReview({ candidate, facts, preparation: fixturePreparation(), slug: "queue" });
    expect(unwrapErr(result).message).toContain("not the fragment that was prepared");
  });
});

describe("decidePageReview", () => {
  const decide = ({
    reviews = [fixtureEvidence()],
    reviewChanged,
    published = FIXTURE_FRAGMENT_SHA,
  }: {
    reviews?: ReturnType<typeof fixtureEvidence>[];
    reviewChanged?: string;
    published?: string;
  }) =>
    decidePageReview({
      publishedAtIso: NOW,
      publishedFragmentSha256: published,
      reviewChanged,
      reviews,
      slug: "queue",
    });

  it("publishes the exact reviewed cut with nothing changed", () => {
    const record = unwrap(decide({}));
    expect(record).toStrictEqual({
      changedAfterReview: null,
      publishedAtIso: NOW,
      publishedFragmentSha256: FIXTURE_FRAGMENT_SHA,
      reviews: [fixtureEvidence()],
      schemaVersion: 1,
      slug: "queue",
      status: "reviewed",
    });
  });

  it("refuses edited bytes without --review-changed", () => {
    const result = decide({ published: "0".repeat(64) });
    expect(unwrapErr(result).code).toBe("REVIEW_CHANGED_REQUIRED");
    expect(unwrapErr(result).message).toContain("differs from the cut 1 cited review(s) read");
  });

  it("refuses a BROKEN review without --review-changed, even over the exact cut", () => {
    const result = decide({ reviews: [fixtureEvidence({ verdict: "BROKEN" })] });
    expect(unwrapErr(result).message).toContain("1 cited review(s) came back BROKEN");
  });

  it("treats a blank --review-changed as absent", () => {
    const result = decide({ published: "0".repeat(64), reviewChanged: "   " });
    expect(unwrapErr(result).code).toBe("REVIEW_CHANGED_REQUIRED");
  });

  it("treats a --review-changed with nothing visible in it as absent, zero-width characters included", () => {
    const result = decide({ published: "0".repeat(64), reviewChanged: "​⁠  " });
    expect(unwrapErr(result).code).toBe("REVIEW_CHANGED_REQUIRED");
  });

  it("publishes edited bytes once the author says what changed, trimmed", () => {
    const record = unwrap(decide({ published: "0".repeat(64), reviewChanged: "  fixed the date the review flagged " }));
    expect(record).toMatchObject({ changedAfterReview: "fixed the date the review flagged", status: "reviewed" });
  });
});
