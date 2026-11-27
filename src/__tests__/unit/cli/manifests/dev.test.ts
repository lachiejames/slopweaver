/**
 * The `dev` noun's manifest: repo-development verbs, none door-routed and none creating a work item. The measuring
 * verbs are effect-free diagnostics, `baseline-bump` writes a manifest only past its required `--reason`, `build` and
 * `drizzle-rebase` write local state and are not dry-parse safe, `door` and
 * `gate` are neither dry-parse-safe nor parse-reject I/O-free, and `profile` is not parse-reject I/O-free. `heap-curve`,
 * `manifest` and `slice-shape` read the corpus on a bare run, so they are not dry-parse safe either. That the manifest
 * imports nothing heavier is `../manifestBarrelClosure.test.ts`'s job.
 */
import { describe, expect, it } from "vitest";

import { devManifest } from "../../../../cli/manifests/dev.js";

import { classificationsOf } from "./_classification.js";

describe("devManifest", () => {
  it("declares exactly the fifteen repo-development verbs", () => {
    expect(Object.keys(devManifest).toSorted()).toEqual([
      "answer-quality",
      "baseline-bump",
      "build",
      "capture-conflicts",
      "dedup-index",
      "door",
      "door-coverage",
      "drizzle-rebase",
      "gate",
      "heap-curve",
      "lint",
      "manifest",
      "profile",
      "slice-shape",
      "targeted-tests",
    ]);
  });

  it("classifies each verb by effect, diagnostic status, and parse safety", () => {
    expect(classificationsOf({ manifest: devManifest })).toEqual({
      "answer-quality": {
        createsWorkItem: false,
        diagnostic: true,
        doorRouted: false,
        dryParseSafe: true,
        effect: "none",
        parseRejectIsIoFree: true,
      },
      "baseline-bump": {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: true,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      build: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: false,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      "capture-conflicts": {
        createsWorkItem: false,
        diagnostic: true,
        doorRouted: false,
        dryParseSafe: true,
        effect: "none",
        parseRejectIsIoFree: true,
      },
      "dedup-index": {
        createsWorkItem: false,
        diagnostic: true,
        doorRouted: false,
        dryParseSafe: true,
        effect: "none",
        parseRejectIsIoFree: true,
      },
      door: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: false,
        effect: "local-state",
        parseRejectIsIoFree: false,
      },
      "door-coverage": {
        createsWorkItem: false,
        diagnostic: true,
        doorRouted: false,
        dryParseSafe: false,
        effect: "none",
        parseRejectIsIoFree: true,
      },
      "drizzle-rebase": {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: false,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      gate: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: false,
        effect: "local-state",
        parseRejectIsIoFree: false,
      },
      "heap-curve": {
        createsWorkItem: false,
        diagnostic: true,
        doorRouted: false,
        dryParseSafe: false,
        effect: "none",
        parseRejectIsIoFree: true,
      },
      lint: {
        createsWorkItem: false,
        diagnostic: true,
        doorRouted: false,
        dryParseSafe: false,
        effect: "none",
        parseRejectIsIoFree: true,
      },
      manifest: {
        createsWorkItem: false,
        diagnostic: true,
        doorRouted: false,
        dryParseSafe: false,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      profile: {
        createsWorkItem: false,
        diagnostic: true,
        doorRouted: false,
        dryParseSafe: true,
        effect: "local-state",
        parseRejectIsIoFree: false,
      },
      "slice-shape": {
        createsWorkItem: false,
        diagnostic: true,
        doorRouted: false,
        dryParseSafe: false,
        effect: "none",
        parseRejectIsIoFree: true,
      },
      "targeted-tests": {
        createsWorkItem: false,
        diagnostic: true,
        doorRouted: false,
        dryParseSafe: false,
        effect: "none",
        parseRejectIsIoFree: true,
      },
    });
  });
});
