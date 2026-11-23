/*
 * How `isPageHeld` grades one observation: held only when the page was reached, photographed, and carries the
 * artifact that proves it.
 */
import { describe, expect, it } from "vitest";

import { NOTION_WEB_ORIGIN } from "../../../../../atlas/notion/browserPages.js";
import { isPageHeld, type NotionPageObservation } from "../../../../../atlas/notion/browserWalk.js";

describe("isPageHeld", () => {
  /** One artifact reference, so a "held" row carries the proof a held row is supposed to have. */
  const shot = {
    byteLength: 3,
    kind: "page-png" as const,
    mediaType: "image/png",
    relativePath: `artifacts/pages/${"a".repeat(64)}.png`,
    sha256: "a".repeat(64),
  };

  /** A full observation, so a test states only the three fields this judgement reads. */
  function judged({
    artifacts,
    screenshotMissingBecause,
    unreachableBecause,
  }: {
    artifacts: NotionPageObservation["artifacts"];
    screenshotMissingBecause: string | null;
    unreachableBecause: string | null;
  }): NotionPageObservation {
    return {
      artifacts,
      attempted: true,
      calls: [],
      captureComplete: true,
      finalUrl: `${NOTION_WEB_ORIGIN}/space/members`,
      observedAt: "2026-09-05T00:00:00.000Z",
      redirected: false,
      requestedUrl: `${NOTION_WEB_ORIGIN}/space/members`,
      responseAccounting: { bodyFailed: 0, bodySucceeded: 1, eligible: 1, seen: 1 },
      screenshotMissingBecause,
      statusCode: 200,
      surface: "space-members",
      title: "Members | Notion",
      unreachableBecause,
    };
  }

  it("holds a page that was reached, photographed, and carries its artifact", () => {
    const page = judged({ artifacts: [shot], screenshotMissingBecause: null, unreachableBecause: null });
    expect(isPageHeld({ page })).toBe(true);
  });

  it("does not hold a page that was reached and never photographed", () => {
    const page = judged({ artifacts: [], screenshotMissingBecause: "no PNG came back", unreachableBecause: null });
    expect(isPageHeld({ page })).toBe(false);
  });

  it("does not hold a page that was never reached", () => {
    const page = judged({ artifacts: [shot], screenshotMissingBecause: null, unreachableBecause: "sent elsewhere" });
    expect(isPageHeld({ page })).toBe(false);
  });

  // The Codex counterexample: both reasons null and NO artifact, which graded as held and published `synced`
  // coverage over screenshots that existed nowhere on disk.
  it("does not hold a page whose reasons look clean but which carries no artifact at all", () => {
    const page = judged({ artifacts: [], screenshotMissingBecause: null, unreachableBecause: null });
    expect(isPageHeld({ page })).toBe(false);
  });
});
