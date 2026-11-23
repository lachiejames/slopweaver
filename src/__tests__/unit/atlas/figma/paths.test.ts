import { describe, expect, it } from "vitest";

import { FIGMA_ATLAS_KINDS } from "../../../../atlas/figma/kinds.js";
import { stateHomePaths } from "../../../../stateHome.js";

describe("where the Figma atlas lives", () => {
  // `atlasHome.ts` spells the eighteen kind filenames as a literal record rather than deriving them, so
  // this is what stops the record and the kind constant drifting the first time a kind is added.
  it("resolves a file for every declared kind and no others", () => {
    const kinds = stateHomePaths({ home: "/tmp/does-not-need-to-exist" }).atlas.figma.kinds;

    expect(Object.keys(kinds).toSorted()).toEqual([...FIGMA_ATLAS_KINDS].toSorted());
  });

  it("hangs every path off the platform's own directory under the atlas root", () => {
    const paths = stateHomePaths({ home: "/tmp/does-not-need-to-exist" }).atlas.figma;

    expect(paths.root).toBe("/tmp/does-not-need-to-exist/atlas/figma");
    expect(paths.manifest).toBe("/tmp/does-not-need-to-exist/atlas/figma/manifest.json");
    expect(paths.superseded).toBe("/tmp/does-not-need-to-exist/atlas/_superseded/figma");
  });
});
