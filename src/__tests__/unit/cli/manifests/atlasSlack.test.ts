/**
 * The `atlas` noun's manifest rows in `cli/manifests/atlasSlack.ts` quote their usage from a leaf module rather than
 * from the command module they describe, so enumerating the surface never loads a command. That the manifest imports
 * nothing heavier is `../manifestBarrelClosure.test.ts`'s job; this pins that every row still carries the very constant
 * the command prints on a usage error.
 */
import { describe, expect, it } from "vitest";

import {
  ATLAS_SLACK_API_USAGE,
  ATLAS_SLACK_DRIVE_USAGE,
  ATLAS_SLACK_USAGE,
} from "../../../../cli/commands/atlas/slackUsage.js";
import { atlasSlackManifest } from "../../../../cli/manifests/atlasSlack.js";

describe("atlasSlackManifest", () => {
  it("quotes each verb's usage from its leaf — the constant the command itself prints, so the two cannot drift", () => {
    expect(atlasSlackManifest["slack"]!.meta.usage).toBe(ATLAS_SLACK_USAGE);
    expect(atlasSlackManifest["slack-api"]!.meta.usage).toBe(ATLAS_SLACK_API_USAGE);
    expect(atlasSlackManifest["slack-drive"]!.meta.usage).toBe(ATLAS_SLACK_DRIVE_USAGE);
  });
});
