import { describe, expect, it } from "vitest";

import { hasFilledBrowserSurface, unfilledSurfaces } from "../../../../atlas/kit/contract.js";
import { SLACK_ATLAS_DESCRIPTOR } from "../../../../atlas/slackApi/descriptor.js";

describe("SLACK_ATLAS_DESCRIPTOR", () => {
  it("is one platform, not one per surface", () => {
    expect(SLACK_ATLAS_DESCRIPTOR.platform).toBe("slack");
  });

  it("reports a FILLED driven-browser surface — the thing no atlas here has ever declared", () => {
    expect(hasFilledBrowserSurface({ descriptor: SLACK_ATLAS_DESCRIPTOR })).toBe(true);
  });

  it("leaves no surface declared-unfilled", () => {
    expect(unfilledSurfaces({ descriptor: SLACK_ATLAS_DESCRIPTOR })).toEqual([]);
  });

  it("declares exactly two surfaces, one per acquisition", () => {
    expect(SLACK_ATLAS_DESCRIPTOR.surfaces.map((surface) => surface.acquisition)).toEqual(["api", "driven-browser"]);
  });

  it("grades BOTH surfaces authoritative, so the browser's unique findings are never merely corroborating", () => {
    expect(SLACK_ATLAS_DESCRIPTOR.surfaces.map((surface) => surface.role)).toEqual(["authoritative", "authoritative"]);
  });

  it("names one command that brings every surface current", () => {
    expect(SLACK_ATLAS_DESCRIPTOR.resyncCommand).toBe("slopweaver atlas slack-drive refresh");
  });

  it("states that no stored FIELD carries message content", () => {
    expect(SLACK_ATLAS_DESCRIPTOR.excludes[0]!.because).toContain("message content in any stored FIELD");
  });

  it("refuses to promise a screenshot is free of message content, because a rendered preview is not a path", () => {
    expect(SLACK_ATLAS_DESCRIPTOR.excludes[1]!.because).toContain("never committed");
  });

  it("bounds every claim to one member's session", () => {
    expect(SLACK_ATLAS_DESCRIPTOR.visibilityScope).toBe("one-member-session");
  });
});
