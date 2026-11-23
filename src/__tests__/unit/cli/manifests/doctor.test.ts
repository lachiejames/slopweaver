/**
 * The `doctor` noun's manifest: the bare noun and `run` are one effect-free diagnostic, and both quote the usage from
 * the leaf the command itself prints. That the manifest imports nothing heavier is `../manifestBarrelClosure.test.ts`'s
 * job.
 */
import { describe, expect, it } from "vitest";

import { DOCTOR_USAGE } from "../../../../cli/commands/doctor/usage.js";
import { doctorManifest } from "../../../../cli/manifests/doctor.js";

import { classificationsOf } from "./_classification.js";

describe("doctorManifest", () => {
  it("declares exactly the bare noun and its `run` alias", () => {
    expect(Object.keys(doctorManifest).toSorted()).toEqual(["", "run"]);
  });

  it("classifies both rows as an effect-free diagnostic with an I/O-free parse reject", () => {
    expect(classificationsOf({ manifest: doctorManifest })).toEqual({
      "": {
        createsWorkItem: false,
        diagnostic: true,
        doorRouted: false,
        dryParseSafe: false,
        effect: "none",
        parseRejectIsIoFree: true,
      },
      run: {
        createsWorkItem: false,
        diagnostic: true,
        doorRouted: false,
        dryParseSafe: false,
        effect: "none",
        parseRejectIsIoFree: true,
      },
    });
  });

  it("quotes both rows' usage from the leaf the command itself prints", () => {
    expect(doctorManifest[""]!.meta.usage).toBe(DOCTOR_USAGE);
    expect(doctorManifest["run"]!.meta.usage).toBe(DOCTOR_USAGE);
  });
});
