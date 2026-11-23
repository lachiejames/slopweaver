/**
 * The `value` noun's manifest: `sample` reads GitHub and places one board row (`external-read`, `createsWorkItem`),
 * while `answer` only writes local state. `answer` REQUIRES its flags and refuses a bare run; `sample` acts on one.
 */
import { describe, expect, it } from "vitest";

import { valueManifest } from "../../../../cli/manifests/value.js";

import { classificationsOf } from "./_classification.js";

describe("valueManifest", () => {
  it("declares exactly `answer` and `sample`", () => {
    expect(Object.keys(valueManifest).toSorted()).toEqual(["answer", "sample"]);
  });

  it("pins every verb's six classification fields", () => {
    expect(classificationsOf({ manifest: valueManifest })).toEqual({
      answer: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: true,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      sample: {
        createsWorkItem: true,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: false,
        effect: "external-read",
        parseRejectIsIoFree: true,
      },
    });
  });
});
