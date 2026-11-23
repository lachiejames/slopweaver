/**
 * The `reflect` noun's manifest rows in `cli/manifests/reflect.ts` quote their usage from a leaf module rather than
 * from the command module they describe, so enumerating the surface never loads a command. That the manifest imports
 * nothing heavier is `../manifestBarrelClosure.test.ts`'s job; this pins that every row still carries the very constant
 * the command prints on a usage error.
 */
import { describe, expect, it } from "vitest";

import {
  REFLECT_BOARD_USAGE,
  REFLECT_BRIEF_USAGE,
  REFLECT_FRICTION_REVIEW_USAGE,
  REFLECT_GRADE_USAGE,
  REFLECT_TELEMETRY_USAGE,
} from "../../../../cli/commands/reflect/usage.js";
import { reflectManifest } from "../../../../cli/manifests/reflect.js";

describe("reflectManifest", () => {
  it("quotes each verb's usage from its leaf — the constant the command itself prints, so the two cannot drift", () => {
    expect(reflectManifest["board"]!.meta.usage).toBe(REFLECT_BOARD_USAGE);
    expect(reflectManifest["brief"]!.meta.usage).toBe(REFLECT_BRIEF_USAGE);
    expect(reflectManifest["friction-review"]!.meta.usage).toBe(REFLECT_FRICTION_REVIEW_USAGE);
    expect(reflectManifest["grade"]!.meta.usage).toBe(REFLECT_GRADE_USAGE);
    expect(reflectManifest["telemetry"]!.meta.usage).toBe(REFLECT_TELEMETRY_USAGE);
  });
});
