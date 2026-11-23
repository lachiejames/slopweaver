/**
 * The `connect` noun's manifest in `cli/manifests/connect.ts`: pins the verb set (the bare noun and `check` share one
 * handler) and that both are the same diagnostic `external-read` preflight, not dry-parse-safe. The usage is inline
 * and not copied here.
 */
import { describe, expect, it } from "vitest";

import { DEFAULT_VERB } from "../../../../cli/manifest.js";
import { connectManifest } from "../../../../cli/manifests/connect.js";
import { classificationsOf } from "./_classification.js";

describe("connectManifest", () => {
  it("declares exactly the bare noun and check", () => {
    expect(Object.keys(connectManifest).toSorted()).toEqual([DEFAULT_VERB, "check"]);
  });

  it("classifies both verbs as a diagnostic external read that is not dry-parse-safe", () => {
    expect(classificationsOf({ manifest: connectManifest })).toEqual({
      "": {
        createsWorkItem: false,
        diagnostic: true,
        doorRouted: false,
        dryParseSafe: false,
        effect: "external-read",
        parseRejectIsIoFree: true,
      },
      check: {
        createsWorkItem: false,
        diagnostic: true,
        doorRouted: false,
        dryParseSafe: false,
        effect: "external-read",
        parseRejectIsIoFree: true,
      },
    });
  });
});
