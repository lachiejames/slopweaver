/*
 * The list the session view hands Streamdown as `disallowedElements`: every HTML element that makes the
 * browser fetch on render. A test here cannot render Streamdown itself, because `react` and `streamdown` are
 * the site's dependencies and not the root's, which `knip` reads this tree against.
 */
import { describe, expect, it } from "vitest";

import { NO_REMOTE_MEDIA } from "../../lib/markdownSafety";

describe("NO_REMOTE_MEDIA", () => {
  it("names every element that fetches on render, and no link", () => {
    expect([...NO_REMOTE_MEDIA].toSorted()).toEqual([
      "audio",
      "embed",
      "iframe",
      "img",
      "object",
      "picture",
      "source",
      "video",
    ]);
  });
});
