/**
 * The `witness` noun's manifest rows quote their usage from the leaf the commands print, so the two cannot drift;
 * that the manifest imports nothing heavier is `../manifestBarrelClosure.test.ts`'s job.
 */
import { describe, expect, it } from "vitest";

import {
  WITNESS_DISPATCH_USAGE,
  WITNESS_HELP_USAGE,
  WITNESS_LIST_USAGE,
  WITNESS_RESUME_USAGE,
  WITNESS_REVISE_USAGE,
  WITNESS_SETTLE_USAGE,
  WITNESS_STAND_DOWN_USAGE,
} from "../../../../cli/commands/witness/usage.js";
import { witnessManifest } from "../../../../cli/manifests/witness.js";

describe("witnessManifest", () => {
  it("quotes each verb's usage from its leaf, the constant the command itself prints", () => {
    expect(witnessManifest["dispatch"]!.meta.usage).toBe(WITNESS_DISPATCH_USAGE);
    expect(witnessManifest["help"]!.meta.usage).toBe(WITNESS_HELP_USAGE);
    expect(witnessManifest["list"]!.meta.usage).toBe(WITNESS_LIST_USAGE);
    expect(witnessManifest["resume"]!.meta.usage).toBe(WITNESS_RESUME_USAGE);
    expect(witnessManifest["revise"]!.meta.usage).toBe(WITNESS_REVISE_USAGE);
    expect(witnessManifest["settle"]!.meta.usage).toBe(WITNESS_SETTLE_USAGE);
    expect(witnessManifest["stand-down"]!.meta.usage).toBe(WITNESS_STAND_DOWN_USAGE);
  });

  it("declares help, revise and stand-down the door-routed external writes, the journal writers local-state, the readers effect-free", () => {
    expect(Object.keys(witnessManifest).toSorted()).toEqual([
      "dispatch",
      "help",
      "list",
      "resume",
      "revise",
      "settle",
      "stand-down",
    ]);
    expect(witnessManifest["revise"]!.meta.effect).toBe("external-write");
    expect(witnessManifest["revise"]!.meta.doorRouted).toBe(true);
    expect(witnessManifest["stand-down"]!.meta.effect).toBe("external-write");
    expect(witnessManifest["stand-down"]!.meta.doorRouted).toBe(true);
    expect(witnessManifest["help"]!.meta.effect).toBe("external-write");
    expect(witnessManifest["help"]!.meta.doorRouted).toBe(true);
    expect(witnessManifest["dispatch"]!.meta.effect).toBe("local-state");
    expect(witnessManifest["settle"]!.meta.effect).toBe("local-state");
    expect(witnessManifest["list"]!.meta.effect).toBe("none");
    expect(witnessManifest["resume"]!.meta.effect).toBe("none");
  });
});
