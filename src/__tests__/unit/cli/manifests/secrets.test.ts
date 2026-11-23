/**
 * The `secrets` noun's manifest rows in `cli/manifests/secrets.ts` quote their usage from a leaf module rather than
 * from the command module they describe, so enumerating the surface never loads a command. That the manifest imports
 * nothing heavier is `../manifestBarrelClosure.test.ts`'s job; this pins that every row still carries the very constant
 * the command prints on a usage error.
 */
import { describe, expect, it } from "vitest";

import { SECRETS_STATUS_USAGE } from "../../../../cli/commands/secrets/statusUsage.js";
import { secretsManifest } from "../../../../cli/manifests/secrets.js";

describe("secretsManifest", () => {
  it("quotes each verb's usage from its leaf — the constant the command itself prints, so the two cannot drift", () => {
    expect(secretsManifest["status"]!.meta.usage).toBe(SECRETS_STATUS_USAGE);
  });
});
