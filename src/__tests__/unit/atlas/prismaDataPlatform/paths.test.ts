import { describe, expect, it } from "vitest";

import { PRISMA_DATA_PLATFORM_ATLAS_KINDS } from "../../../../atlas/prismaDataPlatform/kinds.js";
import { stateHomePaths } from "../../../../stateHome.js";

describe("where the Prisma Data Platform atlas lives", () => {
  // `atlasHome.ts` spells the twenty-six kind filenames as a literal record rather than deriving them, so
  // this is what stops the record and the kind constant drifting the first time a kind is added.
  it("resolves a file for every declared kind and no others", () => {
    const kinds = stateHomePaths({ home: "/tmp/does-not-need-to-exist" }).atlas.prismaDataPlatform.kinds;

    expect(Object.keys(kinds).toSorted()).toEqual([...PRISMA_DATA_PLATFORM_ATLAS_KINDS].toSorted());
  });

  it("hangs every path off the platform's own directory under the atlas root", () => {
    const paths = stateHomePaths({ home: "/tmp/does-not-need-to-exist" }).atlas.prismaDataPlatform;

    expect(paths.root).toBe("/tmp/does-not-need-to-exist/atlas/prisma-data-platform");
    expect(paths.manifest).toBe("/tmp/does-not-need-to-exist/atlas/prisma-data-platform/manifest.json");
    expect(paths.superseded).toBe("/tmp/does-not-need-to-exist/atlas/_superseded/prisma-data-platform");
  });

  // Every kind file is streamed a record at a time, and `kindFileName` derives the extension rather than
  // trusting what the platform declared — six atlases once landed declaring `.json` while the format moved
  // under them. This asserts the derivation reached this platform's table too.
  it("names every kind file .jsonl", () => {
    const kinds = stateHomePaths({ home: "/tmp/does-not-need-to-exist" }).atlas.prismaDataPlatform.kinds;

    expect(Object.values(kinds).filter((path) => !path.endsWith(".jsonl"))).toEqual([]);
  });
});
