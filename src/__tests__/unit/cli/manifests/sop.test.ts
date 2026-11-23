/**
 * The `sop` noun's manifest: `draft` renders markdown and writes a file under `--out` (local-state), `lint` only
 * reads a draft (a finding is the verb working, so diagnostic), and `publish` is the one door-routed external
 * write that creates a Notion page. That the manifest imports nothing heavier is `../manifestBarrelClosure.test.ts`'s job.
 */
import { describe, expect, it } from "vitest";

import { sopManifest } from "../../../../cli/manifests/sop.js";

import { classificationsOf } from "./_classification.js";

describe("sopManifest", () => {
  it("declares exactly `draft`, `lint` and `publish`", () => {
    expect(Object.keys(sopManifest).toSorted()).toEqual(["draft", "lint", "publish"]);
  });

  it("classifies `draft` as local-state, `lint` as an effect-free diagnostic and `publish` as a door-routed write", () => {
    expect(classificationsOf({ manifest: sopManifest })).toEqual({
      draft: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: true,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      lint: {
        createsWorkItem: false,
        diagnostic: true,
        doorRouted: false,
        dryParseSafe: true,
        effect: "none",
        parseRejectIsIoFree: true,
      },
      publish: {
        createsWorkItem: true,
        diagnostic: false,
        doorRouted: true,
        dryParseSafe: true,
        effect: "external-write",
        parseRejectIsIoFree: true,
      },
    });
  });
});
