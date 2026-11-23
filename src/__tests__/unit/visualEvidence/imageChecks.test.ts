/**
 * The consolidated image checks: Slack's five asked of one picture's records, a failed record terminal for its
 * bytes, and the crop rule that refuses a whole frame.
 */
import { describe, expect, it } from "vitest";

import { IMAGE_CHECKS, imageCheckFailures, wholeFrameProblem } from "../../../visualEvidence/imageChecks.js";
import { IMAGE_POLICY_VERSION, type ImageRecord } from "../../../visualEvidence/types.js";

const DIGEST = `sha256:${"d".repeat(64)}`;

const READ_BACK = {
  contextRetained: true,
  observedAtIso: "2026-11-17T01:00:00.000Z",
  observedContent: "a terminal showing 12 passing tests",
  observerSession: "unit-test",
  targetState: "data" as const,
};

const PASSED: ImageRecord = {
  artifact: { digest: DIGEST, heightPx: 100, widthPx: 200 },
  crop: { kind: "already-framed", reason: "rendered from the kept lines" },
  obstruction: "none",
  outcome: "passed",
  policyVersion: IMAGE_POLICY_VERSION,
  readBack: READ_BACK,
  receiptId: "rec-pass",
  schemaVersion: 1,
};

const FAILED: ImageRecord = {
  artifact: { digest: DIGEST, heightPx: 100, widthPx: 200 },
  correction: "re-capture at a larger size",
  crop: { kind: "already-framed", reason: "rendered from the kept lines" },
  outcome: "failed",
  policyVersion: IMAGE_POLICY_VERSION,
  readBack: READ_BACK,
  reason: "illegible",
  receiptId: "rec-fail",
  schemaVersion: 1,
};

describe("IMAGE_CHECKS", () => {
  it("names the five checks in refusal order", () => {
    expect(IMAGE_CHECKS.length).toBeGreaterThan(0);
    expect(IMAGE_CHECKS.map((check) => check.id)).toEqual(["viewed", "rendered", "legible", "context", "unobstructed"]);
  });
});

describe("imageCheckFailures", () => {
  it("passes a picture whose deciding record passed and says nothing covers it", () => {
    expect(imageCheckFailures({ measuredLegibilityIssues: [], records: [PASSED] })).toEqual([]);
  });

  it("fails viewed when no record exists", () => {
    expect(imageCheckFailures({ measuredLegibilityIssues: [], records: [] })).toEqual([
      {
        check: "viewed",
        why: "no record says anybody opened these bytes — look, then `slopweaver browser image-record`",
      },
    ]);
  });

  it("keeps a failed record terminal even under a later pass", () => {
    expect(imageCheckFailures({ measuredLegibilityIssues: [], records: [FAILED, PASSED] })).toEqual([
      { check: "legible", why: "recorded illegible: re-capture at a larger size" },
    ]);
  });

  it("fails rendered, context and unobstructed off what a passed record leaves out, plus a measured legibility issue", () => {
    const thin: ImageRecord = {
      ...PASSED,
      obstruction: undefined,
      readBack: { ...READ_BACK, contextRetained: false, targetState: "unloaded" },
    };
    expect(
      imageCheckFailures({ measuredLegibilityIssues: ["10px feature projects to 4px"], records: [thin] }).map(
        (failure) => failure.check,
      ),
    ).toEqual(["rendered", "legible", "context", "unobstructed"]);
  });
});

describe("wholeFrameProblem", () => {
  const source = { heightPx: 100, widthPx: 200 };

  it("passes a crop narrower or shorter than its source", () => {
    expect(wholeFrameProblem({ cropRect: { height: 100, width: 199, x: 0, y: 0 }, source })).toBe(null);
    expect(wholeFrameProblem({ cropRect: { height: 40, width: 200, x: 0, y: 30 }, source })).toBe(null);
  });

  it("refuses a crop that kept the whole frame", () => {
    expect(wholeFrameProblem({ cropRect: { height: 100, width: 200, x: 0, y: 0 }, source })).toBe(
      "the capture kept the whole 200x100 frame — crop it to what it proves, never a whole screen",
    );
  });
});
