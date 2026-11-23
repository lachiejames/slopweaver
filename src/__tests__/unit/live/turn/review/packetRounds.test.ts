/**
 * `reviewerPacket` across rounds — where the round block sits, the claims a re-review inherits, and the
 * narrowing past the round cap. Pure: every case is a literal in, a string out.
 */
import { describe, expect, it } from "vitest";

import { reviewerPacket } from "../../../../../live/turn/review.js";
import { ANSWER, DECISION, RECORD } from "./harness.js";

describe("reviewerPacket rounds", () => {
  const packetForRound = ({ carriedUnresolved, round }: { carriedUnresolved: readonly string[]; round: number }) =>
    reviewerPacket({
      answer: ANSWER,
      answerDigest: RECORD.answerDigest,
      askIdentity: { channel: "C1", messageTs: "1785000000.000100", threadTs: "1785000000.000100" },
      askPermalink: undefined,
      authorSession: RECORD.authorSession,
      briefPath: "/tmp/brief.json",
      images: [],
      carriedReads: [],
      carriedSettled: [],
      carriedUnresolved,
      changes: undefined,
      clock: { reviewStartedAt: undefined, spawnedAt: RECORD.spawnedAt },
      decision: DECISION,
      ownerDirectiveCount: 0,
      question: "why did the staging pool exhaust?",
      reviewerSession: RECORD.reviewerSession,
      round,
      verdictPath: RECORD.verdictPath,
      voicePrinciples: [],
    });

  it("puts the round block AFTER the deliverables section and before the question, so section numbers hold", () => {
    const packet = packetForRound({ carriedUnresolved: [], round: 1 });
    const deliverables = packet.indexOf("## 1. What the question literally asked for — CHECK THIS FIRST");
    const thisRound = packet.indexOf("## This round");
    const question = packet.indexOf("## 2. The question, as asked");

    expect(thisRound).toBeGreaterThan(deliverables);
    expect(question).toBeGreaterThan(thisRound);
  });

  it("hands a re-review the claims the last round left open, so round N continues rather than restarts", () => {
    const packet = packetForRound({ carriedUnresolved: ["the deploy link is absent"], round: 2 });

    expect(packet).toContain("Round 2 of review for this ask");
    expect(packet).toContain("- the deploy link is absent");
  });

  it("carries no narrowing inside the cap", () => {
    expect(packetForRound({ carriedUnresolved: [], round: 3 })).not.toContain("what a claim at this depth may");
  });

  it("narrows what a NEW unrequested-scope finding may escalate past the cap, and says the bar is unchanged", () => {
    const packet = packetForRound({ carriedUnresolved: ["the rollback"], round: 4 });

    expect(packet).toContain("This ask is on round 4 — what a claim at this depth may escalate is narrowed");
    expect(packet).toContain("Nothing here lowers the bar on what is delivered.");
    // It rides INSIDE the verdict section, above the shape to write — a rule after the JSON is a rule read last.
    expect(packet.indexOf("This ask is on round 4")).toBeGreaterThan(packet.indexOf("## What to write"));
    expect(packet.indexOf("This ask is on round 4")).toBeLessThan(packet.indexOf("Write EXACTLY this shape"));
  });
});
