/**
 * A card's picture or briefing opens in a modal over the page the owner is on: which links preview in place, what the modal
 * frames, and which clicks still take the link's own new tab.
 */
import { describe, expect, it } from "vitest";

import { attachmentPagePreview, opensInPlace, pagePreviewOf } from "../../lib/previewModal";

const SHA = "06a776a9722bac62d757a9ab8c0b69d842d3e571d8df54bd2fefd6354a39448c";

/** The sandbox a served page is framed under — `inAppView.ts`'s, never the top window and never its origin. */
const SERVED = "allow-scripts allow-popups allow-popups-to-escape-sandbox allow-downloads";

/** A plain primary click, with one field overridden. */
const click = (over: Partial<Parameters<typeof opensInPlace>[0]> = {}): Parameters<typeof opensInPlace>[0] => ({
  altKey: false,
  button: 0,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  ...over,
});

describe("attachmentPagePreview", () => {
  it("frames an attached HTML briefing's page route under the served-page sandbox, titled by its name", () => {
    expect(attachmentPagePreview({ name: "one-pager.html", sha256: SHA })).toEqual({
      kind: "page",
      sandbox: SERVED,
      src: `/api/draft-media/${SHA}/page`,
      title: "one-pager.html",
    });
  });

  it("takes .htm in any case, and offers nothing for any other file", () => {
    expect(attachmentPagePreview({ name: "BRIEF.HTM", sha256: SHA })!.src).toBe(`/api/draft-media/${SHA}/page`);
    expect(attachmentPagePreview({ name: "notes.md", sha256: SHA })).toBe(undefined);
    expect(attachmentPagePreview({ name: "brief.html.txt", sha256: SHA })).toBe(undefined);
  });

  it("offers nothing for a name that is not a stored blob's", () => {
    expect(attachmentPagePreview({ name: "one-pager.html", sha256: "../../etc" })).toBe(undefined);
  });
});

describe("pagePreviewOf", () => {
  it("previews a local briefing page, query and fragment kept", () => {
    expect(pagePreviewOf({ href: "/api/page/leavers-briefing/index.html#who", title: "Leavers" })).toEqual({
      kind: "page",
      sandbox: SERVED,
      src: "/api/page/leavers-briefing/index.html#who",
      title: "Leavers",
    });
  });

  it("keeps the link for a console page, another site, a docs page and any other served file", () => {
    expect(pagePreviewOf({ href: "/pull-requests/lachiejames/slopweaver/2158", title: "x" })).toBe(undefined);
    expect(pagePreviewOf({ href: "/board?row=a", title: "x" })).toBe(undefined);
    expect(pagePreviewOf({ href: "https://github.com/lachiejames/slopweaver/pull/1", title: "x" })).toBe(undefined);
    expect(pagePreviewOf({ href: "//evil.example/api/page/a/index.html", title: "x" })).toBe(undefined);
    expect(pagePreviewOf({ href: "/docs/console/queue", title: "x" })).toBe(undefined);
    expect(pagePreviewOf({ href: `/api/draft-media/${SHA}`, title: "x" })).toBe(undefined);
    expect(pagePreviewOf({ href: "/view?src=%2Fapi%2Fpage%2Fa%2Findex.html", title: "x" })).toBe(undefined);
  });

  it("keeps the link for a page's own asset, a nested path and a slug the page route refuses", () => {
    expect(pagePreviewOf({ href: "/api/page/leavers-briefing/style.css", title: "x" })).toBe(undefined);
    expect(pagePreviewOf({ href: "/api/page/leavers-briefing/sub/index.html", title: "x" })).toBe(undefined);
    expect(pagePreviewOf({ href: "/api/page/.hidden/index.html", title: "x" })).toBe(undefined);
    expect(pagePreviewOf({ href: "/api/page/index.html", title: "x" })).toBe(undefined);
  });
});

describe("opensInPlace", () => {
  it("opens the modal on a plain primary click", () => {
    expect(opensInPlace(click())).toBe(true);
  });

  it("leaves a modified or middle click to the link's own new tab", () => {
    expect(
      [
        click({ metaKey: true }),
        click({ ctrlKey: true }),
        click({ shiftKey: true }),
        click({ altKey: true }),
        click({ button: 1 }),
      ].map((each) => opensInPlace(each)),
    ).toEqual([false, false, false, false, false]);
  });
});
