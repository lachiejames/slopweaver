/**
 * The `hex` noun's manifest rows in `cli/manifests/hex.ts` quote their usage from a leaf module rather than from the
 * command module they describe, so enumerating the surface never loads a command. That the manifest imports nothing
 * heavier is `../manifestBarrelClosure.test.ts`'s job; this pins that every row still carries the very constant the
 * command prints on a usage error.
 */
import { describe, expect, it } from "vitest";

import {
  HEX_CELLS_USAGE,
  HEX_CONNECTIONS_USAGE,
  HEX_OUTPUT_USAGE,
  HEX_PROJECT_USAGE,
  HEX_PROJECTS_USAGE,
  HEX_RAW_USAGE,
  HEX_RUNS_USAGE,
  HEX_VERIFY_USAGE,
} from "../../../../cli/commands/hex/usage.js";
import { hexManifest } from "../../../../cli/manifests/hex.js";

describe("hexManifest", () => {
  it("quotes each verb's usage from its leaf — the constant the command itself prints, so the two cannot drift", () => {
    expect(hexManifest["cells"]!.meta.usage).toBe(HEX_CELLS_USAGE);
    expect(hexManifest["connections"]!.meta.usage).toBe(HEX_CONNECTIONS_USAGE);
    expect(hexManifest["output"]!.meta.usage).toBe(HEX_OUTPUT_USAGE);
    expect(hexManifest["project"]!.meta.usage).toBe(HEX_PROJECT_USAGE);
    expect(hexManifest["projects"]!.meta.usage).toBe(HEX_PROJECTS_USAGE);
    expect(hexManifest["raw"]!.meta.usage).toBe(HEX_RAW_USAGE);
    expect(hexManifest["runs"]!.meta.usage).toBe(HEX_RUNS_USAGE);
    expect(hexManifest["verify"]!.meta.usage).toBe(HEX_VERIFY_USAGE);
  });
});
