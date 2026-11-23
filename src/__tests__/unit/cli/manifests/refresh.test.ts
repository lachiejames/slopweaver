/**
 * The `refresh` noun's manifest: the bare noun and `run` share one entry. A bare run ingests, so it is not
 * `dryParseSafe`, and its missing-token usage exit reads the token store first, so `parseRejectIsIoFree` is
 * false too. Both quote the one `REFRESH_USAGE` leaf. That the manifest imports nothing
 * heavier is `../manifestBarrelClosure.test.ts`'s job.
 */
import { describe, expect, it } from "vitest";

import { REFRESH_USAGE } from "../../../../cli/commands/refresh/flags.js";
import { refreshManifest } from "../../../../cli/manifests/refresh.js";

import { classificationsOf } from "./_classification.js";

describe("refreshManifest", () => {
  it("declares exactly the bare noun and `run`", () => {
    expect(Object.keys(refreshManifest).toSorted()).toEqual(["", "run"]);
  });

  it("pins every verb's six classification fields", () => {
    expect(classificationsOf({ manifest: refreshManifest })).toEqual({
      "": {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: false,
        effect: "local-state",
        parseRejectIsIoFree: false,
      },
      run: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: false,
        effect: "local-state",
        parseRejectIsIoFree: false,
      },
    });
  });

  it("quotes the one REFRESH_USAGE leaf on both entries by identity", () => {
    expect(refreshManifest[""]!.meta.usage).toBe(REFRESH_USAGE);
    expect(refreshManifest["run"]!.meta.usage).toBe(REFRESH_USAGE);
  });
});
