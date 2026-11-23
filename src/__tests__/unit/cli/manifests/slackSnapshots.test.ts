/**
 * The two Slack corpus snapshots in `cli/manifests/slackSnapshots.ts` quote their usage from the leaf the command
 * prints, and both stay local reads that route through no door — the property that lets the standing
 * `slack-owed-daily` row run one under a `read` effect.
 */
import { describe, expect, it } from "vitest";

import { SLACK_AWAITING_USAGE, SLACK_OWED_USAGE } from "../../../../cli/commands/slack/verbUsage.js";
import { slackManifest } from "../../../../cli/manifests/slack.js";
import { slackSnapshotsManifest } from "../../../../cli/manifests/slackSnapshots.js";

describe("slackSnapshotsManifest", () => {
  it("quotes each verb's usage from its leaf, so the manifest and --help cannot drift", () => {
    expect(slackSnapshotsManifest["awaiting"]!.meta.usage).toBe(SLACK_AWAITING_USAGE);
    expect(slackSnapshotsManifest["owed"]!.meta.usage).toBe(SLACK_OWED_USAGE);
  });

  it("declares both a local-state read with no door, and spreads both into the slack noun", () => {
    expect(
      ["awaiting", "owed"].map((verb) => [
        slackSnapshotsManifest[verb]!.meta.effect,
        slackSnapshotsManifest[verb]!.meta.doorRouted,
      ]),
    ).toStrictEqual([
      ["local-state", false],
      ["local-state", false],
    ]);
    expect([slackManifest["awaiting"], slackManifest["owed"]]).toStrictEqual([
      slackSnapshotsManifest["awaiting"],
      slackSnapshotsManifest["owed"],
    ]);
  });
});
