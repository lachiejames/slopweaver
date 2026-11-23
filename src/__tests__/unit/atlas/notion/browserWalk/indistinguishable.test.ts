/*
 * How `markIndistinguishablePages` treats two pages sharing one picture: both marked, each naming the other,
 * the shared artifact dropped and neither held.
 */
import { describe, expect, it } from "vitest";

import { NOTION_WEB_ORIGIN } from "../../../../../atlas/notion/browserPages.js";
import {
  isPageHeld,
  markIndistinguishablePages,
  type NotionPageObservation,
} from "../../../../../atlas/notion/browserWalk.js";

describe("markIndistinguishablePages", () => {
  /** One observation carrying exactly the artifact digest a test names. */
  function withShot({ surface, sha256 }: { surface: string; sha256: string }): NotionPageObservation {
    return {
      artifacts: [
        {
          byteLength: 3,
          kind: "page-png",
          mediaType: "image/png",
          relativePath: `artifacts/pages/${sha256}.png`,
          sha256,
        },
      ],
      attempted: true,
      calls: [],
      captureComplete: true,
      finalUrl: `${NOTION_WEB_ORIGIN}/space/${surface}`,
      observedAt: "2026-09-05T00:00:00.000Z",
      redirected: false,
      requestedUrl: `${NOTION_WEB_ORIGIN}/space/${surface}`,
      responseAccounting: { bodyFailed: 0, bodySucceeded: 1, eligible: 1, seen: 1 },
      screenshotMissingBecause: null,
      statusCode: 200,
      surface,
      title: `${surface} | Notion`,
      unreachableBecause: null,
    };
  }

  it("leaves a page whose picture is its own alone", () => {
    const marked = markIndistinguishablePages({
      pages: [
        withShot({ sha256: "a".repeat(64), surface: "one" }),
        withShot({ sha256: "b".repeat(64), surface: "two" }),
      ],
    });
    expect(marked[0]!.screenshotMissingBecause).toBeNull();
  });

  it("marks both pages when two share one picture", () => {
    const marked = markIndistinguishablePages({
      pages: [
        withShot({ sha256: "a".repeat(64), surface: "one" }),
        withShot({ sha256: "a".repeat(64), surface: "two" }),
      ],
    });
    expect(marked.filter((page) => page.screenshotMissingBecause !== null).length).toBe(2);
  });

  it("names the other pages it shares with, so the finding can be acted on", () => {
    const marked = markIndistinguishablePages({
      pages: [
        withShot({ sha256: "a".repeat(64), surface: "one" }),
        withShot({ sha256: "a".repeat(64), surface: "two" }),
      ],
    });
    expect(marked[0]!.screenshotMissingBecause).toContain("two");
  });

  it("drops the artifact reference, so a shared picture cannot be cited as this page's proof", () => {
    const marked = markIndistinguishablePages({
      pages: [
        withShot({ sha256: "a".repeat(64), surface: "one" }),
        withShot({ sha256: "a".repeat(64), surface: "two" }),
      ],
    });
    expect(marked[0]!.artifacts).toEqual([]);
  });

  it("stops a page sharing a picture from being held", () => {
    const marked = markIndistinguishablePages({
      pages: [
        withShot({ sha256: "a".repeat(64), surface: "one" }),
        withShot({ sha256: "a".repeat(64), surface: "two" }),
      ],
    });
    expect(marked.filter((page) => isPageHeld({ page }))).toEqual([]);
  });

  it("leaves a page with no picture at all exactly as it was", () => {
    const none = { ...withShot({ sha256: "a".repeat(64), surface: "one" }), artifacts: [] };
    expect(markIndistinguishablePages({ pages: [none] })[0]!.screenshotMissingBecause).toBeNull();
  });
});
