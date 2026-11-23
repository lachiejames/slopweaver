/**
 * When the page-walk engine counts a page as held: reached, photographed, and carrying the artifact to prove
 * it, never on clear reasons alone.
 */
import { describe, expect, it } from "vitest";

import { screenshotArtifact } from "../../../../../atlas/kit/pageScreenshot.js";
import { isPageHeld } from "../../../../../atlas/kit/pageWalk.js";

import { observation } from "./harness.js";

describe("isPageHeld", () => {
  const shot = screenshotArtifact({ artifactPathFor: ({ sha256 }) => sha256, bytes: new Uint8Array([1]) });

  it("holds a page that was reached, photographed and carries the artifact to prove it", () => {
    expect(isPageHeld({ page: observation({ over: { artifacts: [shot] } }) })).toBe(true);
  });

  // The reasons are set by the walk and the artifact list by the writer, so a complete-looking walk with no
  // screenshots anywhere could otherwise grade `synced`.
  it("does not hold a page whose reasons are clear but whose artifact list is empty", () => {
    expect(isPageHeld({ page: observation({ over: { artifacts: [] } }) })).toBe(false);
  });

  it("does not hold a page that was not reached", () => {
    expect(isPageHeld({ page: observation({ over: { artifacts: [shot], unreachableBecause: "gone" } }) })).toBe(false);
  });

  it("does not hold a page that was reached but not photographed", () => {
    expect(isPageHeld({ page: observation({ over: { screenshotMissingBecause: "none came back" } }) })).toBe(false);
  });
});
