/**
 * The `atlas` noun's manifest rows in `cli/manifests/atlasEstate.ts` quote their usage from a leaf module rather than
 * from the command module they describe, so enumerating the surface never loads a command. That the manifest imports
 * nothing heavier is `../manifestBarrelClosure.test.ts`'s job; this pins that every row still carries the very constant
 * the command prints on a usage error.
 */
import { describe, expect, it } from "vitest";

import { ATLAS_BACKLOG_USAGE } from "../../../../cli/commands/atlas/backlogUsage.js";
import { ATLAS_PROBE_USAGE } from "../../../../cli/commands/atlas/probeUsage.js";
import { atlasEstateManifest } from "../../../../cli/manifests/atlasEstate.js";

describe("atlasEstateManifest", () => {
  it("quotes each verb's usage from its leaf — the constant the command itself prints, so the two cannot drift", () => {
    expect(atlasEstateManifest["backlog"]!.meta.usage).toBe(ATLAS_BACKLOG_USAGE);
    expect(atlasEstateManifest["probe"]!.meta.usage).toBe(ATLAS_PROBE_USAGE);
  });
});
