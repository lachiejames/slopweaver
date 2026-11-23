/**
 * `reviewerPacket` throughput — the round-1 clock and parallel-read instruction, and the change list a
 * round-2 reviewer is handed. Pure: every case is a literal in, a string out.
 */
import { describe, expect, it } from "vitest";

import { reviewerPacket } from "../../../../../live/turn/review.js";
import { ANSWER, DECISION, RECORD } from "./harness.js";

describe("reviewerPacket — throughput", () => {
  const base = {
    answer: ANSWER,
    answerDigest: RECORD.answerDigest,
    askIdentity: { channel: "C1", messageTs: "1785000000.000100", threadTs: "1785000000.000100" },
    askPermalink: undefined,
    authorSession: RECORD.authorSession,
    briefPath: "/tmp/brief.json",
    carriedReads: [],
    carriedSettled: [],
    carriedUnresolved: [],
    decision: DECISION,
    images: [],
    ownerDirectiveCount: 0,
    question: "why did the staging pool exhaust?",
    reviewerSession: RECORD.reviewerSession,
    verdictPath: RECORD.verdictPath,
    voicePrinciples: [],
  };

  it("carries the clock and the parallel-read instruction on round 1, and no re-review scope", () => {
    const packet = reviewerPacket({
      ...base,
      changes: undefined,
      clock: { reviewStartedAt: undefined, spawnedAt: RECORD.spawnedAt },
      round: 1,
    });

    expect(packet).toContain("### The clock — this round is on the asker's critical path");
    expect(packet).toContain("### How to verify — enumerate, fan out, then classify");
    expect(packet).not.toContain("## Where this round's work is");
  });

  it("hands a round-2 reviewer the change list even when the last round carried nothing settled", () => {
    const packet = reviewerPacket({
      ...base,
      changes: [{ kind: "changed", path: "/lead" }],
      clock: { reviewStartedAt: "2026-08-24T23:40:00.000Z", spawnedAt: RECORD.spawnedAt },
      round: 2,
    });

    expect(packet).toContain("## Where this round's work is");
    expect(packet).toContain("- `/lead` — changed");
    expect(packet).toContain("This ask has already spent 20m in review across 1 earlier round(s).");
    expect(packet).not.toContain("## What the last round already settled");
  });
});
