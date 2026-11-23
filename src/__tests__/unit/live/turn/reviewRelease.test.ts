/**
 * `reviewRelease` — whether an ask's terminal outcome leaves a reviewer to release, and the line that says
 * what happened. Pure: a record in, a decision or a string out.
 */
import { describe, expect, it } from "vitest";

import type { ReviewRecord } from "../../../../live/turn/review.js";
import { reviewerReaping, reviewerReapLine } from "../../../../live/turn/reviewRelease.js";

const ASK = { channel: "C1", messageTs: "1785000000.000100", threadTs: "1785000000.000100" };

const RECORD: ReviewRecord = {
  ...ASK,
  answerDigest: "sha256:" + "a".repeat(64),
  answerPath: "/tmp/answer.json",
  authorSession: "author workspace workspace:1 (id-workspace:1)",
  carriedUnresolved: [],
  packetPath: "/tmp/packet.md",
  reviewer: {
    host: "claude-code",
    surfaceId: "id-surface:9",
    surfaceRef: "surface:9",
    workspaceId: "id-workspace:9",
    workspaceRef: "workspace:9",
  },
  reviewerSession: "reviewer workspace workspace:9 (id-workspace:9)",
  round: 1,
  schemaVersion: 2,
  spawnedAt: "2026-08-27T00:00:00.000Z",
  verdictPath: "/tmp/verdict.json",
};

describe("reviewerReaping", () => {
  it("has nothing to do when no review was ever opened", () => {
    expect(reviewerReaping({ record: undefined, terminal: "answered and posted" })).toStrictEqual({
      kind: "nothing",
      why: "no review was opened for this ask",
    });
  });

  it("reaps whenever a record exists, WITHOUT consulting liveness — the ask is over either way", () => {
    const reaping = reviewerReaping({ record: RECORD, terminal: "answered and posted" });

    expect(reaping.kind).toBe("reap");
    expect(reaping.why).toBe("the ask is answered and posted, so no verdict from this reviewer can be consumed");
  });

  it("has nothing to do for a record already stamped released — a worker's own `--close` is not a failure here", () => {
    expect(
      reviewerReaping({
        record: { ...RECORD, releasedAt: "2026-08-27T05:00:00.000Z" },
        terminal: "answered and posted",
      }),
    ).toStrictEqual({ kind: "nothing", why: "its reviewer was already released at 2026-08-27T05:00:00.000Z" });
  });

  it("carries the terminal's own words, so a swept phantom and a posted answer read apart", () => {
    expect(reviewerReaping({ record: RECORD, terminal: "worker-failed" }).why).toBe(
      "the ask is worker-failed, so no verdict from this reviewer can be consumed",
    );
  });
});

describe("reviewerReapLine", () => {
  it("names the ask and the workspace it released", () => {
    expect(
      reviewerReapLine({
        askIdentity: ASK,
        outcome: undefined,
        reaping: reviewerReaping({ record: RECORD, terminal: "answered and posted" }),
      }),
    ).toBe(
      "reviewer reap C1/1785000000.000100: released workspace:9 — the ask is answered and posted, so no verdict from this reviewer can be consumed",
    );
  });

  it("says the ledger row was retired anyway when cmux could not close the workspace", () => {
    expect(
      reviewerReapLine({
        askIdentity: ASK,
        outcome: "workspace not found",
        reaping: reviewerReaping({ record: RECORD, terminal: "answered and posted" }),
      }),
    ).toBe(
      "reviewer reap C1/1785000000.000100: workspace:9 could not be closed (workspace not found) — its ledger row was retired anyway",
    );
  });

  it("says there was nothing to release when no review was opened", () => {
    expect(
      reviewerReapLine({
        askIdentity: ASK,
        outcome: undefined,
        reaping: reviewerReaping({ record: undefined, terminal: "answered and posted" }),
      }),
    ).toBe("reviewer reap C1/1785000000.000100: nothing to release — no review was opened for this ask");
  });
});
