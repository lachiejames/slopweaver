/**
 * The `session-start` noun's manifest rows in `cli/manifests/sessionStart.ts` quote their usage from a leaf module
 * rather than from the command module they describe, so enumerating the surface never loads a command. That the
 * manifest imports nothing heavier is `../manifestBarrelClosure.test.ts`'s job; this pins that every row still carries
 * the very constant the command prints on a usage error.
 */
import { describe, expect, it } from "vitest";

import { LOCK_IN_USAGE } from "../../../../cli/commands/sessionStart/lockInUsage.js";
import { sessionStartManifest } from "../../../../cli/manifests/sessionStart.js";

describe("sessionStartManifest", () => {
  it("quotes each verb's usage from its leaf — the constant the command itself prints, so the two cannot drift", () => {
    expect(sessionStartManifest["lock-in"]!.meta.usage).toBe(LOCK_IN_USAGE);
  });
});
