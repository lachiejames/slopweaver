/*
 * captureFrom reduces the page's own links to same-origin navigation: off-origin, fragment-only, non-URL and non-string
 * entries are dropped, what is kept is sorted, and an empty list carries the snippet's own link error.
 */
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { captureFrom } from "../../../../browser/playwrightCli.js";
import { unwrap } from "../../../../lib/result.js";
import { clientStdout, NOTION_LEASE } from "./harness.js";

describe("captureFrom reduces the page's own links to same-origin navigation", () => {
  const screenshotPath = join(tmpdir(), "capture-from-no-such-shot.png");
  const url = "https://app.notion.com/settings/members";

  /** A capture built from one snippet output, for the fields this section is about. */
  function capturedWith({ snippet }: { snippet: Record<string, unknown> }): ReturnType<typeof captureFrom> {
    return captureFrom({
      lease: NOTION_LEASE,
      observedAt: "2026-09-07T10:00:00.000Z",
      screenshotPath,
      stdout: clientStdout({
        accounting: { bodyFailed: 0, bodySucceeded: 0, eligible: 0, seen: 0 },
        finalUrl: url,
        links: [],
        linksError: null,
        responses: [],
        screenshotWritten: false,
        statusCode: 200,
        title: "Members",
        ...snippet,
      }),
      url,
    });
  }

  it("keeps a same-origin link", () => {
    const captured = capturedWith({ snippet: { links: ["https://app.notion.com/settings/people"] } });
    expect(unwrap(captured).links).toEqual(["https://app.notion.com/settings/people"]);
  });

  it("drops a link to another origin, which is not this page's own navigation", () => {
    const captured = capturedWith({
      snippet: { links: ["https://app.notion.com/a", "https://www.notion.so/help"] },
    });
    expect(unwrap(captured).links).toEqual(["https://app.notion.com/a"]);
  });

  // A fragment is a position on a page rather than a different page.
  it("drops the fragment, so two links differing only by one are the same destination", () => {
    const captured = capturedWith({
      snippet: { links: ["https://app.notion.com/a#top", "https://app.notion.com/a#bottom"] },
    });
    expect(unwrap(captured).links).toEqual(["https://app.notion.com/a"]);
  });

  it("sorts what it keeps, so two runs over the same page produce the same list", () => {
    const captured = capturedWith({
      snippet: { links: ["https://app.notion.com/c", "https://app.notion.com/a", "https://app.notion.com/b"] },
    });
    expect(unwrap(captured).links).toEqual([
      "https://app.notion.com/a",
      "https://app.notion.com/b",
      "https://app.notion.com/c",
    ]);
  });

  it("drops an entry that is not a URL at all rather than failing the capture", () => {
    const captured = capturedWith({ snippet: { links: ["/settings/relative", "https://app.notion.com/a"] } });
    expect(unwrap(captured).links).toEqual(["https://app.notion.com/a"]);
  });

  it("drops a non-string entry", () => {
    const captured = capturedWith({ snippet: { links: [42, "https://app.notion.com/a"] } });
    expect(unwrap(captured).links).toEqual(["https://app.notion.com/a"]);
  });

  it("answers with no links when the snippet did not collect a list at all", () => {
    const captured = capturedWith({ snippet: { links: null } });
    expect(unwrap(captured).links).toEqual([]);
  });

  // The silence this field exists to end: "no admin links" and "the link read threw" are the same [].
  it("carries the snippet's own link error, so an empty list is never an unexplained silence", () => {
    const captured = capturedWith({ snippet: { links: [], linksError: "the link read threw" } });
    expect(unwrap(captured).linksBlockedBecause).toBe("the link read threw");
  });

  it("reports no link error when the page genuinely rendered none", () => {
    expect(unwrap(capturedWith({ snippet: { links: [] } })).linksBlockedBecause).toBe(null);
  });
});
