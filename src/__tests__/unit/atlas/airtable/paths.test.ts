import { describe, expect, it } from "vitest";

import { AIRTABLE_ATLAS_KINDS } from "../../../../atlas/airtable/kinds.js";
import { stateHomePaths } from "../../../../stateHome.js";

describe("where the Airtable atlas lives", () => {
  // `stateHome.ts` spells the nineteen kind filenames as a literal record rather than deriving them, so
  // this is what stops the record and the kind constant drifting the first time a kind is added.
  it("resolves a file for every declared kind and no others", () => {
    const kinds = stateHomePaths({ home: "/tmp/does-not-need-to-exist" }).atlas.airtable.kinds;

    expect(Object.keys(kinds).toSorted()).toEqual([...AIRTABLE_ATLAS_KINDS].toSorted());
  });

  it("hangs every path off the platform's own directory under the atlas root", () => {
    const paths = stateHomePaths({ home: "/tmp/does-not-need-to-exist" }).atlas.airtable;

    expect(paths.root).toBe("/tmp/does-not-need-to-exist/atlas/airtable");
    expect(paths.manifest).toBe("/tmp/does-not-need-to-exist/atlas/airtable/manifest.json");
    expect(paths.superseded).toBe("/tmp/does-not-need-to-exist/atlas/_superseded/airtable");
  });
});
