/**
 * The `page` noun's manifest rows in `cli/manifests/page.ts` quote their usage from a leaf module rather than from the
 * command module they describe, so enumerating the surface never loads a command. That the manifest imports nothing
 * heavier is `../manifestBarrelClosure.test.ts`'s job; this pins that every row still carries the very constant the
 * command prints on a usage error.
 */
import { describe, expect, it } from "vitest";

import { PAGE_FIND_USAGE, PAGE_PUBLISH_USAGE } from "../../../../cli/commands/page/usage.js";
import { pageManifest } from "../../../../cli/manifests/page.js";

describe("pageManifest", () => {
  it("quotes each verb's usage from its leaf — the constant the command itself prints, so the two cannot drift", () => {
    expect(pageManifest["publish"]!.meta.usage).toBe(PAGE_PUBLISH_USAGE);
    expect(pageManifest["find"]!.meta.usage).toBe(PAGE_FIND_USAGE);
  });
});
