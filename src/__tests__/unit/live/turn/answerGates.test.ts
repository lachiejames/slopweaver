/**
 * `verdictImageObservations` is the one reading the image gate and the attachment settlement share, so both
 * absences it folds to the empty list — no verdict, and a verdict that left the field out — are pinned here
 * beside the case that carries observations through untouched.
 */
import { describe, expect, it } from "vitest";

import type { ReviewedImage, ReviewVerdict } from "../../../../admit/reviewVerdict.js";
import { verdictImageObservations } from "../../../../live/turn/answerGates.js";

const OBSERVED: ReviewedImage = {
  artifactDigest: `sha256:${"a".repeat(64)}`,
  contextRetained: true,
  legible: true,
  observedContent: "p95 latency 412ms over the last hour",
  path: "shots/latency.png",
  targetState: "data",
};

const VERDICT: ReviewVerdict = {
  answerDigest: `sha256:${"b".repeat(64)}`,
  authorSession: "author-1",
  claims: [],
  outcome: "clean",
  reviewerSession: "reviewer-1",
  schemaVersion: 1,
};

describe("verdictImageObservations", () => {
  it("reads no observations when no verdict arrived", () => {
    expect(verdictImageObservations({ verdict: undefined })).toEqual([]);
  });

  it("reads the empty list when the verdict left imageObservations out", () => {
    expect(verdictImageObservations({ verdict: VERDICT })).toEqual([]);
  });

  it("hands back exactly what the reviewer recorded", () => {
    expect(verdictImageObservations({ verdict: { ...VERDICT, imageObservations: [OBSERVED] } })).toEqual([OBSERVED]);
  });
});
