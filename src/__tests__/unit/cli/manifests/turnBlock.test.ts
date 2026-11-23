/**
 * The `turn` noun's blocked-on-the-owner rows in `cli/manifests/turnBlock.ts` quote their usage from a leaf module
 * rather than from the command module they describe, so enumerating the surface never loads a command. That the
 * manifest imports nothing heavier is `../manifestBarrelClosure.test.ts`'s job; this pins that every row still
 * carries the very constant the command prints on a usage error, and that `turn.ts` spreads all four in.
 */
import { describe, expect, it } from "vitest";

import {
  TURN_BLOCK_USAGE,
  TURN_BLOCKED_USAGE,
  TURN_REACH_USAGE,
  TURN_UNBLOCK_USAGE,
} from "../../../../cli/commands/turn/blockUsage.js";
import { turnManifest } from "../../../../cli/manifests/turn.js";
import { turnBlockManifest } from "../../../../cli/manifests/turnBlock.js";

describe("turnBlockManifest", () => {
  it("quotes each verb's usage from its leaf — the constant the command itself prints, so the two cannot drift", () => {
    expect(turnBlockManifest["block"]!.meta.usage).toBe(TURN_BLOCK_USAGE);
    expect(turnBlockManifest["blocked"]!.meta.usage).toBe(TURN_BLOCKED_USAGE);
    expect(turnBlockManifest["reach"]!.meta.usage).toBe(TURN_REACH_USAGE);
    expect(turnBlockManifest["unblock"]!.meta.usage).toBe(TURN_UNBLOCK_USAGE);
  });

  it("declares exactly the four blocked-on-the-owner verbs, each spread into the `turn` noun unchanged", () => {
    expect(Object.keys(turnBlockManifest).toSorted()).toEqual(["block", "blocked", "reach", "unblock"]);
    expect(turnManifest["block"]).toBe(turnBlockManifest["block"]);
    expect(turnManifest["blocked"]).toBe(turnBlockManifest["blocked"]);
    expect(turnManifest["reach"]).toBe(turnBlockManifest["reach"]);
    expect(turnManifest["unblock"]).toBe(turnBlockManifest["unblock"]);
  });
});
