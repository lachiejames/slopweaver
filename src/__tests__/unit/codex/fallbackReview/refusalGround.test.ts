/*
 * A Claude fallback review grounded on a pass Codex refused on policy twice: the request round-trips with its ground
 * and mode, a bad ground or mode is refused, the ledger row names the refused pass, and the receipt clears the review
 * floor while never witnessing a cap for the plan half.
 */
import { describe, expect, it } from "vitest";

import { codexErrorLines } from "../../../../codex/errors.js";
import { fallbackGroundLine, fallbackReviewEntries } from "../../../../codex/fallbackReview.js";
import { parseFallbackRequest } from "../../../../codex/fallbackReviewParse.js";
import { unwrap } from "../../../../lib/result.js";
import { BRANCH, CLEAN_NOW, floor, REPO, receiptFor, refusalRequest, request, STALE_PLAN } from "./harness.js";

describe("a Claude fallback review grounded on a twice-refused pass", () => {
  it("round-trips through JSON with its ground and mode, and carries no cap evidence", () => {
    const req = refusalRequest();
    const parsed = unwrap(parseFallbackRequest({ value: JSON.parse(JSON.stringify(req)) }));
    expect(parsed).toEqual(req);
    expect(Object.keys(parsed).includes("capEvidence")).toBe(false);
  });

  it("refuses a refusal-mode request whose ground is incomplete", () => {
    const result = parseFallbackRequest({ value: { ...refusalRequest(), ground: { kind: "cyber-policy" } } });
    expect(codexErrorLines({ error: result._unsafeUnwrapErr() })).toEqual([
      "ground must carry kind cyber-policy, artifactId, initialFinishedAtIso and retryFinishedAtIso",
    ]);
  });

  it("refuses a request declaring a mode that is neither review nor the refusal ground", () => {
    const result = parseFallbackRequest({ value: { ...request(), mode: "review-something-else" } });
    expect(codexErrorLines({ error: result._unsafeUnwrapErr() })).toEqual([
      "mode must be absent, review or review-policy-refusal or review-codex-provider-unregistered",
    ]);
  });

  it("names the refused pass on the ledger row, never a cap", () => {
    const [row] = fallbackReviewEntries({
      branch: BRANCH,
      now: CLEAN_NOW,
      receipts: [receiptFor({ req: refusalRequest() })],
      repoRoot: REPO,
    });
    expect(row!.outcomeContext).toBe(
      "Claude fallback review in workspace:7 — Codex refused this review on policy twice (pass codex-r3-refused)",
    );
    expect(row!.fallbackGround).toBe("cyber-policy");
    expect(fallbackGroundLine({ request: request() })).toBe(
      "Codex could not take the pass: Codex reported workspace_member_usage_limit_reached at 2026-09-13T14:49:01.803Z",
    );
  });

  it("clears the review floor exactly as a cap-grounded receipt does", () => {
    const failures = floor({ records: [STALE_PLAN], receipts: [receiptFor({ req: refusalRequest() })] });
    expect(failures).toEqual([]);
  });

  it("never witnesses a cap for the PLAN half — a refused review says nothing about whether Codex can plan", () => {
    const failures = floor({ records: [], receipts: [receiptFor({ req: refusalRequest() })] });
    expect(failures).toEqual([
      "no planning pass has run on this branch — nothing planned the work before it was written",
    ]);
  });
});
