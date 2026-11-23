/**
 * The `catalog` noun's manifest in `cli/manifests/catalog.ts`: pins the verb set, including the bare-noun row
 * (`DEFAULT_VERB`), and that all four verbs are read-only index reads classified `none`. Usage strings are inline and
 * not copied here.
 */
import { describe, expect, it } from "vitest";

import { DEFAULT_VERB } from "../../../../cli/manifest.js";
import { catalogManifest } from "../../../../cli/manifests/catalog.js";
import { classificationsOf } from "./_classification.js";

describe("catalogManifest", () => {
  it("declares exactly the bare noun, health, list and trees", () => {
    expect(DEFAULT_VERB).toBe("");
    expect(Object.keys(catalogManifest).toSorted()).toEqual([DEFAULT_VERB, "health", "list", "trees"]);
  });

  it("classifies every verb as a read-only effect-free index read that is not dry-parse-safe", () => {
    expect(classificationsOf({ manifest: catalogManifest })).toEqual({
      "": {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: false,
        effect: "none",
        parseRejectIsIoFree: true,
      },
      health: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: false,
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
      trees: {
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
