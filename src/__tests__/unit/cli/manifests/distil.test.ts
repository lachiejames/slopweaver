/**
 * The `distil` noun's manifest rows in `cli/manifests/distil.ts` quote their usage from a leaf module rather than from
 * the command module they describe, so enumerating the surface never loads a command. That the manifest imports nothing
 * heavier is `../manifestBarrelClosure.test.ts`'s job; this pins that every row still carries the very constant the
 * command prints on a usage error.
 */
import { describe, expect, it } from "vitest";

import { DISTIL_ANSWER_USAGE, DISTIL_BRIEF_USAGE, DISTIL_STATUS_USAGE } from "../../../../cli/commands/distil/usage.js";
import { distilManifest } from "../../../../cli/manifests/distil.js";

describe("distilManifest", () => {
  it("quotes each verb's usage from its leaf — the constant the command itself prints, so the two cannot drift", () => {
    expect(distilManifest["answer"]!.meta.usage).toBe(DISTIL_ANSWER_USAGE);
    expect(distilManifest["brief"]!.meta.usage).toBe(DISTIL_BRIEF_USAGE);
    expect(distilManifest["status"]!.meta.usage).toBe(DISTIL_STATUS_USAGE);
  });
});
