/**
 * The `sweep` noun's manifest: `apply` performs one register act and journals it (refused before any I/O without a
 * slug), `board` classifies the live board and can replace its file under `--write`, both reading GitHub for what a
 * live ask's question names (`external-read`), and `list` only reads the ledger back (`effect: "none"`). `board` and
 * `list` take only optional flags, so a bare run reads and reports rather than parsing dry. That the manifest imports
 * nothing heavier is `../manifestBarrelClosure.test.ts`'s job.
 */
import { describe, expect, it } from "vitest";

import { sweepManifest } from "../../../../cli/manifests/sweep.js";

import { classificationsOf } from "./_classification.js";

describe("sweepManifest", () => {
  it("declares exactly `apply`, `board`, `list` and `recheck`", () => {
    expect(Object.keys(sweepManifest).toSorted()).toEqual(["apply", "board", "list", "recheck"]);
  });

  it("classifies `apply` and `board` as external reads, `list` and `recheck` as effect-free, and the three readers as not dry parses", () => {
    expect(classificationsOf({ manifest: sweepManifest })).toEqual({
      apply: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: true,
        effect: "external-read",
        parseRejectIsIoFree: true,
      },
      board: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: false,
        effect: "external-read",
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
      recheck: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: false,
        effect: "none",
        parseRejectIsIoFree: true,
      },
    });
  });
});
