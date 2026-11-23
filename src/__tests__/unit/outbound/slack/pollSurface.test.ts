import { describe, expect, it } from "vitest";

import { previewSurfaceFromChannelId } from "../../../../outbound/slack/pollRender.js";

/**
 * The PREVIEW-only surface heuristic.
 *
 * A dry run must work with no token and no network, and must still show the footer that will really ship — so it
 * derives the surface from the channel id and labels it as such. The real send asks Slack instead, because a
 * heuristic is good enough to draw a preview and not good enough to promise who can see someone's vote.
 */
describe("previewSurfaceFromChannelId", () => {
  it("reads a D-prefixed id as a DM", () => {
    expect(previewSurfaceFromChannelId({ channel: "D0AAA" })).toBe("direct-message");
  });

  it("reads a channel id as shared", () => {
    expect(previewSurfaceFromChannelId({ channel: "C0BBB" })).toBe("shared-channel");
  });

  it("treats a group DM as shared, since several people see each other's reactions there", () => {
    expect(previewSurfaceFromChannelId({ channel: "G0CCC" })).toBe("shared-channel");
  });

  it("defaults an unrecognisable id to shared, which is the LOUDER footer of the two", () => {
    // Erring toward "everyone can see this" makes a reader more guarded, not less. The opposite default would
    // promise privacy that might not hold, which is the failure that costs trust.
    expect(previewSurfaceFromChannelId({ channel: "" })).toBe("shared-channel");
  });
});
