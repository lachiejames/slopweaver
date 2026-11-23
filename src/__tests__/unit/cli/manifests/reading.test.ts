/**
 * The `reading` noun's manifest: `record` appends to the readings ledger (`local-state`), while `last` and `list` only
 * read it (`effect: "none"`). `last` and `record` REQUIRE their flags and refuse a bare run; `list` reports on one.
 * That the manifest imports nothing heavier is `../manifestBarrelClosure.test.ts`'s job.
 */
import { describe, expect, it } from "vitest";

import { readingManifest } from "../../../../cli/manifests/reading.js";

import { classificationsOf } from "./_classification.js";

describe("readingManifest", () => {
  it("declares exactly `last`, `list` and `record`", () => {
    expect(Object.keys(readingManifest).toSorted()).toEqual(["last", "list", "record"]);
  });

  it("pins every verb's six classification fields", () => {
    expect(classificationsOf({ manifest: readingManifest })).toEqual({
      last: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: true,
        effect: "none",
        parseRejectIsIoFree: true,
      },
      list: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: false,
        effect: "none",
        parseRejectIsIoFree: true,
      },
      record: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: true,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
    });
  });
});
