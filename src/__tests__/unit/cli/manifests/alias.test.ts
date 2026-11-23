/**
 * The `alias` noun's manifest rows in `cli/manifests/alias.ts` quote their usage from a leaf module rather than from
 * the command module they describe, so enumerating the surface never loads a command. That the manifest imports nothing
 * heavier is `../manifestBarrelClosure.test.ts`'s job; this pins that every row still carries the very constant the
 * command prints on a usage error.
 */
import { describe, expect, it } from "vitest";

import {
  ALIAS_CATCH_ALL_USAGE,
  ALIAS_LIST_USAGE,
  ALIAS_PROVISION_USAGE,
} from "../../../../cli/commands/alias/usage.js";
import { aliasManifest } from "../../../../cli/manifests/alias.js";

describe("aliasManifest", () => {
  it("quotes each verb's usage from its leaf — the constant the command itself prints, so the two cannot drift", () => {
    expect(aliasManifest["catch-all"]!.meta.usage).toBe(ALIAS_CATCH_ALL_USAGE);
    expect(aliasManifest["list"]!.meta.usage).toBe(ALIAS_LIST_USAGE);
    expect(aliasManifest["provision"]!.meta.usage).toBe(ALIAS_PROVISION_USAGE);
  });
});
