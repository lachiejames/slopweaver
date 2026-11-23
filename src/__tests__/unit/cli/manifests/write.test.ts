/**
 * The `write` noun's manifest: `vanta` is the one external-write, door-routed verb, and every sub-verb behind it
 * (`deactivate`, `group-people`, `upload-evidence` and the rest) refuses a bare run before it reads a file,
 * consumes stdin or resolves a credential, so it is `dryParseSafe`. That the manifest imports nothing heavier is
 * `../manifestBarrelClosure.test.ts`'s job.
 */
import { describe, expect, it } from "vitest";

import { writeManifest } from "../../../../cli/manifests/write.js";

import { classificationsOf } from "./_classification.js";

describe("writeManifest", () => {
  it("declares exactly `vanta`", () => {
    expect(Object.keys(writeManifest).toSorted()).toEqual(["vanta"]);
  });

  it("classifies `vanta` as a door-routed external write", () => {
    expect(classificationsOf({ manifest: writeManifest })).toEqual({
      vanta: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: true,
        dryParseSafe: true,
        effect: "external-write",
        parseRejectIsIoFree: true,
      },
    });
  });
});
