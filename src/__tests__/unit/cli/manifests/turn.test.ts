/**
 * The `turn` noun's manifest rows in `cli/manifests/turn.ts` quote their usage from a leaf module rather than from the
 * command module they describe, so enumerating the surface never loads a command. That the manifest imports nothing
 * heavier is `../manifestBarrelClosure.test.ts`'s job; this pins that every row still carries the very constant the
 * command prints on a usage error.
 */
import { describe, expect, it } from "vitest";

import {
  TURN_BLOCK_USAGE,
  TURN_BLOCKED_USAGE,
  TURN_REACH_USAGE,
  TURN_UNBLOCK_USAGE,
} from "../../../../cli/commands/turn/blockUsage.js";
import { TURN_BREAKAGE_USAGE } from "../../../../cli/commands/turn/breakageUsage.js";
import { TURN_LEDGER_USAGE } from "../../../../cli/commands/turn/ledgerUsage.js";
import { TURN_RETIRE_CARD_USAGE } from "../../../../cli/commands/turn/retireCardUsage.js";
import { TURN_SATISFIED_USAGE } from "../../../../cli/commands/turn/satisfiedUsage.js";
import {
  TURN_BRIEF_USAGE,
  TURN_DISPATCH_USAGE,
  TURN_FREEZE_USAGE,
  TURN_IGNORE_CONVERSATION_USAGE,
  TURN_IGNORE_USAGE,
  TURN_RESUME_USAGE,
  TURN_REVIEW_USAGE,
  TURN_SETTLE_REACTION_USAGE,
  TURN_STATUS_USAGE,
  TURN_USAGE,
  TURN_WATCH_USAGE,
} from "../../../../cli/commands/turn/usage.js";
import { turnManifest } from "../../../../cli/manifests/turn.js";

describe("turnManifest", () => {
  it("quotes each verb's usage from its leaf — the constant the command itself prints, so the two cannot drift", () => {
    expect(turnManifest["answer"]!.meta.usage).toBe(TURN_USAGE);
    expect(turnManifest["block"]!.meta.usage).toBe(TURN_BLOCK_USAGE);
    expect(turnManifest["blocked"]!.meta.usage).toBe(TURN_BLOCKED_USAGE);
    expect(turnManifest["breakage"]!.meta.usage).toBe(TURN_BREAKAGE_USAGE);
    expect(turnManifest["brief"]!.meta.usage).toBe(TURN_BRIEF_USAGE);
    expect(turnManifest["dispatch"]!.meta.usage).toBe(TURN_DISPATCH_USAGE);
    expect(turnManifest["watch"]!.meta.usage).toBe(TURN_WATCH_USAGE);
    expect(turnManifest["freeze"]!.meta.usage).toBe(TURN_FREEZE_USAGE);
    expect(turnManifest["ledger"]!.meta.usage).toBe(TURN_LEDGER_USAGE);
    expect(turnManifest["ignore"]!.meta.usage).toBe(TURN_IGNORE_USAGE);
    expect(turnManifest["reach"]!.meta.usage).toBe(TURN_REACH_USAGE);
    expect(turnManifest["ignore-conversation"]!.meta.usage).toBe(TURN_IGNORE_CONVERSATION_USAGE);
    expect(turnManifest["retire-card"]!.meta.usage).toBe(TURN_RETIRE_CARD_USAGE);
    expect(turnManifest["satisfied"]!.meta.usage).toBe(TURN_SATISFIED_USAGE);
    expect(turnManifest["settle-reaction"]!.meta.usage).toBe(TURN_SETTLE_REACTION_USAGE);
    expect(turnManifest["resume"]!.meta.usage).toBe(TURN_RESUME_USAGE);
    expect(turnManifest["review"]!.meta.usage).toBe(TURN_REVIEW_USAGE);
    expect(turnManifest["unblock"]!.meta.usage).toBe(TURN_UNBLOCK_USAGE);
    expect(turnManifest["status"]!.meta.usage).toBe(TURN_STATUS_USAGE);
  });
});
