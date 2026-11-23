/**
 * The `briefing` noun's manifest rows in `cli/manifests/briefing.ts` quote their usage from a leaf module rather than
 * from the command module they describe, so enumerating the surface never loads a command. That the manifest imports
 * nothing heavier is `../manifestBarrelClosure.test.ts`'s job; this pins that every row still carries the very constant
 * the command prints on a usage error.
 */
import { describe, expect, it } from "vitest";

import {
  BRIEFING_ARCHIVE_USAGE,
  BRIEFING_CARD_USAGE,
  BRIEFING_CHECK_USAGE,
  BRIEFING_CORRECTIONS_USAGE,
  BRIEFING_FOLD_CAPS_USAGE,
  BRIEFING_FREEZE_USAGE,
  BRIEFING_RECUT_USAGE,
  BRIEFING_RENDER_USAGE,
  BRIEFING_SWEEP_BLOCK_USAGE,
} from "../../../../cli/commands/briefing/usage.js";
import { briefingManifest } from "../../../../cli/manifests/briefing.js";

describe("briefingManifest", () => {
  it("quotes each verb's usage from its leaf — the constant the command itself prints, so the two cannot drift", () => {
    expect(briefingManifest["archive"]!.meta.usage).toBe(BRIEFING_ARCHIVE_USAGE);
    expect(briefingManifest["card"]!.meta.usage).toBe(BRIEFING_CARD_USAGE);
    expect(briefingManifest["check"]!.meta.usage).toBe(BRIEFING_CHECK_USAGE);
    expect(briefingManifest["corrections"]!.meta.usage).toBe(BRIEFING_CORRECTIONS_USAGE);
    expect(briefingManifest["freeze"]!.meta.usage).toBe(BRIEFING_FREEZE_USAGE);
    expect(briefingManifest["fold-caps"]!.meta.usage).toBe(BRIEFING_FOLD_CAPS_USAGE);
    expect(briefingManifest["recut"]!.meta.usage).toBe(BRIEFING_RECUT_USAGE);
    expect(briefingManifest["sweep-block"]!.meta.usage).toBe(BRIEFING_SWEEP_BLOCK_USAGE);
    expect(briefingManifest["render"]!.meta.usage).toBe(BRIEFING_RENDER_USAGE);
  });
});
