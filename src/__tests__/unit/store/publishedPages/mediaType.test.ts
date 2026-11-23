/*
 * A published page's file is stored as the media type its extension names, as a bare essence; a file whose
 * extension names nothing has no type here, so the projection stores it as opaque bytes rather than a guess.
 */

import { describe, expect, it } from "vitest";

import { publishedPageMediaType } from "../../../../store/publishedPages/mediaType.js";

describe("publishedPageMediaType", () => {
  it("reads the extension of the last segment, case-insensitively, as an essence with no charset", () => {
    expect([
      publishedPageMediaType({ relativePath: "index.html" }),
      publishedPageMediaType({ relativePath: "assets/style.css" }),
      publishedPageMediaType({ relativePath: "media/Shot.JPG" }),
      publishedPageMediaType({ relativePath: "data.v2.json" }),
    ]).toEqual(["text/html", "text/css", "image/jpeg", "application/json"]);
  });

  it("names no type for an unknown extension, no extension, or a dot only in a directory name", () => {
    expect([
      publishedPageMediaType({ relativePath: "run.sh" }),
      publishedPageMediaType({ relativePath: "noextension" }),
      publishedPageMediaType({ relativePath: "assets.v1/noextension" }),
      publishedPageMediaType({ relativePath: "trailing." }),
    ]).toEqual([undefined, undefined, undefined, undefined]);
  });
});
