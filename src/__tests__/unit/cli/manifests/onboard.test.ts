/**
 * The `onboard` noun's manifest rows in `cli/manifests/onboard.ts` quote their usage from a leaf module rather than
 * from the command module they describe, so enumerating the surface never loads a command. That the manifest imports
 * nothing heavier is `../manifestBarrelClosure.test.ts`'s job; this pins that every row still carries the very constant
 * the command prints on a usage error.
 */
import { describe, expect, it } from "vitest";

import { ONBOARD_EVAL_USAGE, ONBOARD_PLAN_USAGE, ONBOARD_USAGE } from "../../../../cli/commands/onboard/usage.js";
import { onboardManifest } from "../../../../cli/manifests/onboard.js";

describe("onboardManifest", () => {
  it("quotes each verb's usage from its leaf — the constant the command itself prints, so the two cannot drift", () => {
    expect(onboardManifest["eval"]!.meta.usage).toBe(ONBOARD_EVAL_USAGE);
    expect(onboardManifest["plan"]!.meta.usage).toBe(ONBOARD_PLAN_USAGE);
    expect(onboardManifest["run"]!.meta.usage).toBe(ONBOARD_USAGE);
  });
});
