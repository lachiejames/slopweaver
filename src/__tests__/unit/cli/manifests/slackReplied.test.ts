/**
 * `slack replied` in `cli/manifests/slackReplied.ts` quotes its usage from the leaf the command prints, declares a
 * live Slack read routed through no door, and is spread into the slack noun unchanged.
 */
import { describe, expect, it } from "vitest";

import { SLACK_REPLIED_USAGE } from "../../../../cli/commands/slack/repliedUsage.js";
import { slackManifest } from "../../../../cli/manifests/slack.js";
import { slackRepliedManifest } from "../../../../cli/manifests/slackReplied.js";

describe("slackRepliedManifest", () => {
  it("quotes its usage from the leaf, so the manifest and --help cannot drift", () => {
    expect(slackRepliedManifest["replied"]!.meta.usage).toBe(SLACK_REPLIED_USAGE);
  });

  it("declares an external read with no door, and is spread into the slack noun", () => {
    expect([slackRepliedManifest["replied"]!.meta.effect, slackRepliedManifest["replied"]!.meta.doorRouted]).toEqual([
      "external-read",
      false,
    ]);
    expect(slackManifest["replied"]).toStrictEqual(slackRepliedManifest["replied"]);
  });
});
