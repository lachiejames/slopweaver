import { describe, expect, it } from "vitest";

import { figmaKindFor } from "../../../../atlas/figma/kinds.js";

describe("figmaKindFor", () => {
  it("places an operation the override table names under the resource, not the tag", () => {
    expect(figmaKindFor({ operationId: "getFileVersions", tag: "Files" })).toStrictEqual({
      alsoFeeds: [],
      kind: "file-version",
    });
  });

  it("carries the fan-out of the one operation whose response fills the asset kinds too", () => {
    expect(figmaKindFor({ operationId: "getFile", tag: "Files" })).toStrictEqual({
      alsoFeeds: ["component", "component-set", "style"],
      kind: "file",
    });
  });

  it("places an operation the override table does not name by its tag, filling its own kind alone", () => {
    expect(figmaKindFor({ operationId: "getComments", tag: "Comments" })).toStrictEqual({
      alsoFeeds: [],
      kind: "comment",
    });
  });

  it("refuses to place an operation neither table names", () => {
    expect(figmaKindFor({ operationId: "getSlides", tag: "Slides" })).toBeNull();
  });
});
