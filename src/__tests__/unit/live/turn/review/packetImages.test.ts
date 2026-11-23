/**
 * `reviewerPacket`'s two image clauses — the user-facing impact clause, the 1b ceiling on an absent
 * screenshot, and the 1c duty to open every attached picture. Pure: every case is a literal in, a string out.
 */
import { describe, expect, it } from "vitest";

import { reviewerPacket } from "../../../../../live/turn/review.js";
import type { ReviewPacketImage } from "../../../../../live/turn/reviewImages.js";
import { userFacingImpactReviewLines } from "../../../../../live/turn/userFacingImpactGuidance.js";
import { ANSWER, DECISION, RECORD } from "./harness.js";

describe("reviewerPacket — the two image clauses", () => {
  const packetWith = ({
    images,
    question = "why did the staging pool exhaust?",
  }: {
    images: readonly ReviewPacketImage[];
    question?: string;
  }) =>
    reviewerPacket({
      answer: ANSWER,
      answerDigest: RECORD.answerDigest,
      askIdentity: { channel: "C1", messageTs: "1785000000.000100", threadTs: "1785000000.000100" },
      askPermalink: undefined,
      authorSession: RECORD.authorSession,
      briefPath: "/tmp/brief.json",
      images,
      carriedReads: [],
      carriedSettled: [],
      changes: undefined,
      clock: { reviewStartedAt: undefined, spawnedAt: RECORD.spawnedAt },
      carriedUnresolved: [],
      decision: DECISION,
      ownerDirectiveCount: 0,
      question,
      reviewerSession: RECORD.reviewerSession,
      round: 1,
      verdictPath: "/tmp/v.json",
      voicePrinciples: [],
    });

  const READY_IMAGE: ReviewPacketImage = {
    artifact: { digest: `sha256:${"c".repeat(64)}`, heightPx: 560, widthPx: 3000 },
    kind: "ready",
    path: "/shots/pool.png",
  };

  const IMPACT_QUESTION = "what's the user-facing impact of the staging pool exhausting?";

  it("puts the user-facing impact clause between 1b and 1c for an impact ask", () => {
    const lines = packetWith({ images: [READY_IMAGE], question: IMPACT_QUESTION }).split("\n");
    const clause = userFacingImpactReviewLines({ question: IMPACT_QUESTION });
    const start = lines.findIndex((line) => line === clause[0]);

    expect(lines.slice(start, start + clause.length)).toEqual(clause);
    expect(lines.indexOf("## 1b. A screenshot that is NOT THERE is a note, never a round")).toBeLessThan(start);
    expect(lines.findIndex((line) => line.startsWith("## 1c."))).toBe(start + clause.length);
  });

  it("carries no user-facing impact clause for any other ask", () => {
    expect(packetWith({ images: [READY_IMAGE] })).not.toContain("## 1b-i.");
  });

  it("keeps 1b's ceiling explicitly about a picture that is NOT there", () => {
    const packet = packetWith({ images: [] });

    expect(packet).toContain("## 1b. A screenshot that is NOT THERE is a note, never a round");
    expect(packet).toContain("This ceiling is about ABSENCE and nothing else.");
  });

  it("renders no 1c and an empty observation list when the answer attaches nothing", () => {
    const packet = packetWith({ images: [] });

    expect(packet).not.toContain("## 1c.");
    expect(packet).toContain("`imageObservations` is `[]`");
    expect(packet).toContain('"imageObservations": []');
  });

  it("names each attached picture and shows the observation to write for it", () => {
    const packet = packetWith({ images: [READY_IMAGE] });

    expect(packet).toContain("/shots/pool.png — 3000x560 px");
    expect(packet).toContain(READY_IMAGE.kind === "ready" ? READY_IMAGE.artifact.digest : "");
    expect(packet).toContain("OPEN every file listed above");
    expect(packet).toContain('"observedContent": "REPLACE THIS with what you actually saw after opening the file"');
    expect(packet).toContain('"outcome": "clean"');
  });

  it("cannot show a CLEAN example when an attachment could not be read", () => {
    const packet = packetWith({
      images: [{ issues: ["could not be read: ENOENT"], kind: "unavailable", path: "/gone.png" }],
    });

    expect(packet).toContain('"outcome": "incomplete"');
    expect(packet).toContain("COULD NOT BE READ");
  });
});
