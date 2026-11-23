/*
 * Resolving the ids `page publish --review` cites, through plain injected reads: a Codex pass first, the fallback
 * store only for an id that names no pass, and one false citation refusing the whole publish.
 */
import { describe, expect, it } from "vitest";

import type { ClaudeFallbackReviewReceipt } from "../../../codex/fallbackReview.js";
import { FallbackStoreErrors } from "../../../codex/fallbackStoreErrors.js";
import type { CodexArtifactRecord } from "../../../codex/types.js";
import { err, ok, unwrap, unwrapErr } from "../../../lib/result.js";
import type { PageReviewPreparation } from "../../../pages/review.js";
import { PageReviewErrors } from "../../../pages/reviewErrors.js";
import { type PageReviewReads, resolvePageReviews } from "../../../pages/reviewResolve.js";
import {
  FIXTURE_DIFF_SHA,
  FIXTURE_FRAGMENT_SHA,
  fixtureCodexRecord,
  fixtureFallbackReceipt,
  fixturePreparation,
} from "../../pageReviewFixture.js";

/** Reads over fixed values, counting how often the fallback store was scanned. */
function reads({
  passes = {},
  receipts = [],
  unreadable = 0,
  storeDown = false,
  foreignRepository = false,
}: {
  passes?: Record<string, CodexArtifactRecord>;
  receipts?: ClaudeFallbackReviewReceipt[];
  unreadable?: number;
  storeDown?: boolean;
  /** Whether the review's repository resolves to no preparation of this slug. */
  foreignRepository?: boolean;
}): { reads: PageReviewReads; scans: { count: number } } {
  const scans = { count: 0 };
  const preparation: PageReviewPreparation | undefined = foreignRepository ? undefined : fixturePreparation();
  return {
    reads: {
      commitFacts: () => ok({ diffSha256: FIXTURE_DIFF_SHA, fragmentSha256: FIXTURE_FRAGMENT_SHA }),
      readPass: ({ artifactId }) => ok(passes[artifactId]),
      readPreparation: () => ok(preparation),
      scanFallback: async () => {
        scans.count += 1;
        if (storeDown) {
          return err(FallbackStoreErrors.storeUnavailable({ doing: "scan receipts", reason: "offline" }));
        }
        return ok({
          foreign: 0,
          foreignModes: [],
          foreignReceipts: [],
          unboundReceipts: [],
          pending: 0,
          pendingPlans: 0,
          planReceipts: [],
          problems: [],
          receipts,
          unreadable,
        });
      },
    },
    scans,
  };
}

const HOME = "/h";

describe("resolvePageReviews", () => {
  it("resolves a Codex pass without touching the fallback store", async () => {
    const { reads: r, scans } = reads({ passes: { "pass-1": fixtureCodexRecord() } });
    const evidence = unwrap(await resolvePageReviews({ home: HOME, ids: ["pass-1"], reads: r, slug: "queue" }));
    expect(evidence.map((one) => one.reviewer)).toStrictEqual(["codex"]);
    expect(scans.count).toBe(0);
  });

  it("resolves a fallback receipt by its receipt id or by its request id", async () => {
    const byReceipt = reads({ receipts: [fixtureFallbackReceipt()] });
    const receipt = unwrap(
      await resolvePageReviews({ home: HOME, ids: ["receipt-1"], reads: byReceipt.reads, slug: "queue" }),
    );
    expect(receipt.map((one) => [one.id, one.reviewer])).toStrictEqual([["receipt-1", "claude-fallback"]]);
    const byRequest = reads({ receipts: [fixtureFallbackReceipt()] });
    const request = unwrap(
      await resolvePageReviews({ home: HOME, ids: ["request-1"], reads: byRequest.reads, slug: "queue" }),
    );
    expect(request.map((one) => [one.id, one.reviewer])).toStrictEqual([["request-1", "claude-fallback"]]);
  });

  it("refuses one receipt cited by both its ids, which the fold would count as two checks", async () => {
    const { reads: r, scans } = reads({ receipts: [fixtureFallbackReceipt()] });
    const result = await resolvePageReviews({ home: HOME, ids: ["receipt-1", "request-1"], reads: r, slug: "queue" });
    expect(unwrapErr(result)).toStrictEqual(
      PageReviewErrors.reviewCitedTwice({ first: "receipt-1", reviewId: "request-1" }),
    );
    expect(scans.count).toBe(1);
  });

  it("refuses the same Codex pass cited twice", async () => {
    const { reads: r } = reads({ passes: { "pass-1": fixtureCodexRecord() } });
    const result = await resolvePageReviews({ home: HOME, ids: ["pass-1", "pass-1"], reads: r, slug: "queue" });
    expect(unwrapErr(result).code).toBe("REVIEW_CITED_TWICE");
  });

  it("refuses the whole publish when one id names nothing", async () => {
    const { reads: r } = reads({ passes: { "pass-1": fixtureCodexRecord() } });
    const result = await resolvePageReviews({ home: HOME, ids: ["pass-1", "nope"], reads: r, slug: "queue" });
    expect(unwrapErr(result).code).toBe("REVIEW_NOT_FOUND");
    expect(unwrapErr(result).message).toContain("nope");
  });

  it("refuses rather than calling an id absent when the store holds unreadable receipts", async () => {
    const { reads: r } = reads({ unreadable: 2 });
    const result = await resolvePageReviews({ home: HOME, ids: ["receipt-9"], reads: r, slug: "queue" });
    expect(unwrapErr(result).code).toBe("REVIEW_STORE_UNAVAILABLE");
    expect(unwrapErr(result).message).toContain("2 stored receipt(s) cannot be read");
  });

  it("refuses a matching receipt too while others are unreadable, since one may be a later verdict on it", async () => {
    const { reads: r } = reads({ receipts: [fixtureFallbackReceipt()], unreadable: 1 });
    const result = await resolvePageReviews({ home: HOME, ids: ["receipt-1"], reads: r, slug: "queue" });
    expect(unwrapErr(result).code).toBe("REVIEW_STORE_UNAVAILABLE");
  });

  it("refuses when the fallback store cannot be read", async () => {
    const { reads: r } = reads({ storeDown: true });
    const result = await resolvePageReviews({ home: HOME, ids: ["receipt-1"], reads: r, slug: "queue" });
    expect(unwrapErr(result).code).toBe("REVIEW_STORE_UNAVAILABLE");
    expect(unwrapErr(result).message).toContain("The store said: offline");
  });

  it("refuses a review whose repository is not a preparation of this slug", async () => {
    const { reads: r } = reads({ foreignRepository: true, passes: { "pass-1": fixtureCodexRecord() } });
    const result = await resolvePageReviews({ home: HOME, ids: ["pass-1"], reads: r, slug: "queue" });
    expect(unwrapErr(result).code).toBe("REVIEW_WRONG_PAGE");
    expect(unwrapErr(result).message).toContain('not a `page review-prepare` repository for "queue"');
  });
});
