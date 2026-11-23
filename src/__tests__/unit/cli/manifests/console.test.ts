/**
 * The `console` noun's manifest row in `cli/manifests/console.ts` quotes its usage from the leaf `batchUsage.ts`
 * rather than from the command module it describes, so enumerating the surface never loads `console batch`. That the
 * manifest imports nothing heavier is `../manifestBarrelClosure.test.ts`'s job; this pins that the row still carries
 * the very constant the command prints on a usage error, and the effect its header argues for.
 */
import { describe, expect, it } from "vitest";

import { CONSOLE_BATCH_USAGE } from "../../../../cli/commands/console/batchUsage.js";
import { consoleManifest } from "../../../../cli/manifests/console.js";

describe("consoleManifest", () => {
  it("quotes batch's usage from its leaf — the constant the command itself prints, so the two cannot drift", () => {
    expect(consoleManifest["batch"]!.meta.usage).toBe(CONSOLE_BATCH_USAGE);
  });

  it("declares batch as local-state, since an item it runs may write local state and an external write is refused", () => {
    expect(consoleManifest["batch"]!.meta.effect).toBe("local-state");
  });
});
