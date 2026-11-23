/**
 * The `memory` noun's manifest: which verbs it declares and how each is classified. Six verbs REQUIRE `--dir` (or a
 * positional) and refuse a bare run before reading anything, so they are `dryParseSafe`; `gate` and `passes` have only
 * optional flags, so a bare run acts. That the manifest imports nothing heavier is `../manifestBarrelClosure.test.ts`'s job.
 */
import { describe, expect, it } from "vitest";

import { memoryManifest } from "../../../../cli/manifests/memory.js";

import { classificationsOf } from "./_classification.js";

describe("memoryManifest", () => {
  it("declares exactly the eight memory verbs", () => {
    expect(Object.keys(memoryManifest).toSorted()).toEqual([
      "check",
      "gate",
      "grade",
      "hook",
      "hygiene",
      "overlaps",
      "passes",
      "sweep",
    ]);
  });

  it("pins every verb's six classification fields", () => {
    expect(classificationsOf({ manifest: memoryManifest })).toEqual({
      check: {
        createsWorkItem: false,
        diagnostic: true,
        doorRouted: false,
        dryParseSafe: true,
        effect: "none",
        parseRejectIsIoFree: true,
      },
      gate: {
        createsWorkItem: false,
        diagnostic: true,
        doorRouted: false,
        dryParseSafe: false,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      grade: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: true,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      hook: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: true,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      hygiene: {
        createsWorkItem: false,
        diagnostic: true,
        doorRouted: false,
        dryParseSafe: true,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      overlaps: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: true,
        effect: "none",
        parseRejectIsIoFree: true,
      },
      passes: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: false,
        effect: "none",
        parseRejectIsIoFree: true,
      },
      sweep: {
        createsWorkItem: false,
        diagnostic: true,
        doorRouted: false,
        dryParseSafe: true,
        effect: "none",
        parseRejectIsIoFree: true,
      },
    });
  });
});
