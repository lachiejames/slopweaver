/**
 * `slack channel-view` in `cli/manifests/slackChannelView.ts` quotes its usage from the leaf the command prints,
 * declares a read that keeps picture previews under the home and is routed through no door, and is spread into the
 * slack noun unchanged.
 */
import { describe, expect, it } from "vitest";

import { SLACK_CHANNEL_VIEW_USAGE } from "../../../../cli/commands/slack/verbUsage.js";
import { slackManifest } from "../../../../cli/manifests/slack.js";
import { slackChannelViewManifest } from "../../../../cli/manifests/slackChannelView.js";

describe("slackChannelViewManifest", () => {
  it("quotes its usage from the leaf, so the manifest and --help cannot drift", () => {
    expect(slackChannelViewManifest["channel-view"]!.meta.usage).toBe(SLACK_CHANNEL_VIEW_USAGE);
  });

  it("declares local state with no door, and is spread into the slack noun", () => {
    const { meta } = slackChannelViewManifest["channel-view"]!;
    expect([meta.effect, meta.doorRouted]).toEqual(["local-state", false]);
    expect(slackManifest["channel-view"]).toStrictEqual(slackChannelViewManifest["channel-view"]);
  });
});
