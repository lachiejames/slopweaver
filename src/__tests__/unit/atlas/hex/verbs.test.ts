import { describe, expect, it } from "vitest";

import { HEX_ATLAS_KINDS, HEX_ATLAS_PLATFORM } from "../../../../atlas/hex/model.js";
import { hexAtlasPaths } from "../../../../atlas/hex/store.js";
import { stateHomePaths } from "../../../../stateHome.js";

describe("where this atlas lives under the state home", () => {
  it("resolves one file per kind under its own platform directory", () => {
    const paths = hexAtlasPaths({ home: "/tmp/example-home" });

    expect(paths.directory).toBe("/tmp/example-home/atlas/hex");
    expect(Object.keys(paths.kinds).toSorted()).toEqual([...HEX_ATLAS_KINDS].toSorted());
    expect(paths.kinds.project).toBe("/tmp/example-home/atlas/hex/projects.jsonl");
    expect(paths.manifest).toBe("/tmp/example-home/atlas/hex/manifest.json");
  });

  it("hangs off the one atlas root every platform shares", () => {
    expect(stateHomePaths({ home: "/tmp/example-home" }).atlas.hex.root).toBe(
      `/tmp/example-home/atlas/${HEX_ATLAS_PLATFORM}`,
    );
  });
});
