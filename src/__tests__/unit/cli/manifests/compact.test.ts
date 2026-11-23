/**
 * The `compact` noun's manifest in `cli/manifests/compact.ts`: pins the verb set (the bare noun and `run` share one
 * handler), each verb's six classification fields, and that `heal-refs` quotes the usage leaf the command prints. The
 * bare and `run` usage is derived inline from `BRONZE_SOURCES` and has no independent constant, so it is not pinned.
 */
import { describe, expect, it } from "vitest";

import { COMPACT_HEAL_REFS_USAGE } from "../../../../cli/commands/compact/healRefsUsage.js";
import { DEFAULT_VERB } from "../../../../cli/manifest.js";
import { compactManifest } from "../../../../cli/manifests/compact.js";
import { classificationsOf } from "./_classification.js";

describe("compactManifest", () => {
  it("declares exactly the bare noun, heal-refs and run", () => {
    expect(Object.keys(compactManifest).toSorted()).toEqual([DEFAULT_VERB, "heal-refs", "run"]);
  });

  it("classifies every verb as a local-state write that acts on a bare run, so none is dry-parse safe", () => {
    expect(classificationsOf({ manifest: compactManifest })).toEqual({
      "": {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: false,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      "heal-refs": {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: false,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      run: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: false,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
    });
  });

  it("quotes heal-refs' usage from its leaf — the constant the command itself prints, so the two cannot drift", () => {
    expect(compactManifest["heal-refs"]!.meta.usage).toBe(COMPACT_HEAL_REFS_USAGE);
  });
});
