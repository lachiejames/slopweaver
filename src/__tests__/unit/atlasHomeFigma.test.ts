/*
 * The Figma atlas's generation paths: the four standard paths and all eighteen kind files, each written with the
 * `.jsonl` extension although the resolver declares `.json`.
 */
import { describe, expect, it } from "vitest";

import { figmaAtlasPaths } from "../../atlasHomeFigma.js";

describe("figmaAtlasPaths", () => {
  it("lays the Figma generation out under the atlas root with all eighteen kind files as .jsonl", () => {
    expect(figmaAtlasPaths({ atlasRoot: "/state/atlas" })).toEqual({
      kinds: {
        comment: "/state/atlas/figma/comments.jsonl",
        component: "/state/atlas/figma/components.jsonl",
        "component-set": "/state/atlas/figma/component-sets.jsonl",
        credential: "/state/atlas/figma/credentials.jsonl",
        "dev-resource": "/state/atlas/figma/dev-resources.jsonl",
        "event-shape": "/state/atlas/figma/event-shapes.jsonl",
        file: "/state/atlas/figma/files.jsonl",
        "file-version": "/state/atlas/figma/file-versions.jsonl",
        folder: "/state/atlas/figma/folders.jsonl",
        method: "/state/atlas/figma/methods.jsonl",
        page: "/state/atlas/figma/pages.jsonl",
        person: "/state/atlas/figma/people.jsonl",
        project: "/state/atlas/figma/projects.jsonl",
        reaction: "/state/atlas/figma/reactions.jsonl",
        style: "/state/atlas/figma/styles.jsonl",
        team: "/state/atlas/figma/teams.jsonl",
        variable: "/state/atlas/figma/variables.jsonl",
        webhook: "/state/atlas/figma/webhooks.jsonl",
      },
      manifest: "/state/atlas/figma/manifest.json",
      root: "/state/atlas/figma",
      sensitive: "/state/atlas/figma/_sensitive",
      superseded: "/state/atlas/_superseded/figma",
    });
  });

  it("hangs every path off whichever atlas root it is handed", () => {
    const paths = figmaAtlasPaths({ atlasRoot: "/other-home/atlas" });
    expect(paths.root).toBe("/other-home/atlas/figma");
    expect(paths.kinds["team"]).toBe("/other-home/atlas/figma/teams.jsonl");
    expect(paths.superseded).toBe("/other-home/atlas/_superseded/figma");
  });
});
