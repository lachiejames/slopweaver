/*
 * The WorkOS atlas's generation paths: the four standard paths and all six kind files, hung off whichever atlas
 * root it is handed.
 */
import { describe, expect, it } from "vitest";

import { workosAtlasPaths } from "../../atlasHomeWorkos.js";

describe("workosAtlasPaths", () => {
  it("lays the WorkOS generation out under the atlas root with all six kind files", () => {
    expect(workosAtlasPaths({ atlasRoot: "/state/atlas" })).toEqual({
      kinds: {
        connection: "/state/atlas/workos/connections.jsonl",
        directory: "/state/atlas/workos/directories.jsonl",
        operation: "/state/atlas/workos/operations.jsonl",
        organization: "/state/atlas/workos/organizations.jsonl",
        page: "/state/atlas/workos/pages.jsonl",
        user: "/state/atlas/workos/users.jsonl",
      },
      manifest: "/state/atlas/workos/manifest.json",
      root: "/state/atlas/workos",
      sensitive: "/state/atlas/workos/_sensitive",
      superseded: "/state/atlas/_superseded/workos",
    });
  });

  it("hangs every path off whichever atlas root it is handed", () => {
    const paths = workosAtlasPaths({ atlasRoot: "/other-home/atlas" });
    expect(paths.root).toBe("/other-home/atlas/workos");
    expect(paths.kinds["directory"]).toBe("/other-home/atlas/workos/directories.jsonl");
    expect(paths.superseded).toBe("/other-home/atlas/_superseded/workos");
  });
});
