/**
 * Which card subjects are pages that do not name their local copy — the criterion `projectOpenPageCards`
 * refuses on.
 */
import { describe, expect, it } from "vitest";

import { lacksLocalCopy } from "../../../briefing/localCopySubject.js";

const PAGES = "/Users/owner/.slopweaver/pages";

describe("lacksLocalCopy", () => {
  it("accepts a local page inside this home's pages directory", () => {
    expect(lacksLocalCopy({ pagesDirectory: PAGES, url: `file://${PAGES}/queue-decision/index.html` })).toBe(false);
  });

  it("refuses a claude.ai artifact, with or without a fragment", () => {
    expect(
      [
        "https://claude.ai/code/artifact/9d4848a3-3b8c-4d54-80cf-429f9082f991",
        "https://claude.ai/code/artifact/abc#react-now",
      ].map((url) => lacksLocalCopy({ pagesDirectory: PAGES, url })),
    ).toEqual([true, true]);
  });

  it("refuses a page rendered into a temp directory, in either shape", () => {
    expect(
      ["file:///tmp/fleet-briefing.html", "file:///private/tmp/scratchpad/pages/queue/index.html"].map((url) =>
        lacksLocalCopy({ pagesDirectory: PAGES, url }),
      ),
    ).toEqual([true, true]);
  });

  it("refuses a page-shaped address under another home, and a sibling directory sharing the prefix", () => {
    expect(
      [
        "file:///Users/someone/.slopweaver/pages/queue/index.html",
        "file:///Users/owner/.slopweaver/pages-old/queue/index.html",
      ].map((url) => lacksLocalCopy({ pagesDirectory: PAGES, url })),
    ).toEqual([true, true]);
  });

  it("refuses a page nested deeper under this home's pages, whose slug names a different page's freeze", () => {
    expect(lacksLocalCopy({ pagesDirectory: PAGES, url: `file://${PAGES}/a/pages/b/index.html` })).toBe(true);
  });

  it("leaves a subject that is not a page alone", () => {
    expect(
      [
        "https://github.com/acme/acme-admin/pull/17433",
        "https://acme.slack.com/archives/D0SYN000001/p1789566535694529",
        "not a url",
      ].map((url) => lacksLocalCopy({ pagesDirectory: PAGES, url })),
    ).toEqual([false, false, false]);
  });
});
