import { describe, expect, it } from "vitest";

import { publishedPageTitle, publishedTitleOf } from "../../lib/publishedPageTitle";
import { type PageStoreFake, pageStoreFake } from "../pageStoreFake";

describe("publishedTitleOf", () => {
  it.each([
    ["<html><head><title>A help drawer</title></head>", "A help drawer"],
    ['<TITLE lang="en">Caps</TITLE>', "Caps"],
    ["<title>Costs &amp; plans</title>", "Costs & plans"],
    ["<title>a &#38; b &#x26; c</title>", "a & b & c"],
    ["<title>&amp;lt; once</title>", "&lt; once"],
    ["<title>\n  two\n  lines\n</title>", "two lines"],
    ["<title>first</title><title>second</title>", "first"],
    ["<title>&#xFFFFFFF; stays</title>", "&#xFFFFFFF; stays"],
    ["<title>&bogus; stays</title>", "&bogus; stays"],
  ])("reads %s", (html, title) => {
    expect(publishedTitleOf({ html })).toBe(title);
  });

  it.each([["<html></html>"], ["<title></title>"], ["<title>   </title>"], ["<title>never closed"]])(
    "finds no title in %s",
    (html) => {
      expect(publishedTitleOf({ html })).toBeUndefined();
    },
  );

  it("bounds a long title", () => {
    expect(publishedTitleOf({ html: `<title>${"x".repeat(500)}</title>` })).toBe("x".repeat(200));
  });
});

/** The title read off `slug` in `store`, through the read the viewer makes first. */
async function titleIn({ store, slug }: { store: PageStoreFake; slug: string }): Promise<string | undefined> {
  return publishedPageTitle({ fetchBody: store.fetchBody, read: await store.presentation({ fresh: true, slug }) });
}

describe("publishedPageTitle", () => {
  /** The title of `alpha` in a store holding it with `html` as its document. */
  const titleOf = ({ html, slug = "alpha" }: { html: string; slug?: string }) =>
    titleIn({ slug, store: pageStoreFake({ pages: { alpha: { "index.html": html } } }) });

  it("reads the title from the store", async () => {
    await expect(titleOf({ html: "<title>Alpha</title>" })).resolves.toBe("Alpha");
  });

  it("reads only the opening of the document", async () => {
    const html = `${" ".repeat(70 * 1024)}<title>Too far</title>`;
    await expect(titleOf({ html })).resolves.toBeUndefined();
  });

  it("has no title for a page that is not there", async () => {
    await expect(titleOf({ html: "<title>Alpha</title>", slug: "beta" })).resolves.toBeUndefined();
  });

  it("has no title when the store could not say, or answered other bytes", async () => {
    const stopped = pageStoreFake({ pages: { alpha: { "index.html": "<title>Alpha</title>" } }, unreadable: true });
    await expect(titleIn({ slug: "alpha", store: stopped })).resolves.toBeUndefined();
    const tampered = pageStoreFake({ pages: { alpha: { "index.html": "<title>Alpha</title>" } } });
    tampered.tamper.bytes = new TextEncoder().encode("<title>Other</title>");
    await expect(titleIn({ slug: "alpha", store: tampered })).resolves.toBeUndefined();
  });
});
