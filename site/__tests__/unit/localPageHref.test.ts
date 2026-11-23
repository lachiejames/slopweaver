/*
 * A local page's link on a card goes to the console's own route, never to the `file://` address Chrome refuses
 * from an `http://` page — and the slug it reads out agrees with `src/pages/url.ts`, the verb that publishes it.
 */

import { describe, expect, it } from "vitest";

import { localPageSlug } from "../../../src/pages/url";
import { PUBLISHED_PAGE_MEDIA_TYPES, publishedPageMediaType } from "../../../src/store/publishedPages/mediaType";
import { citedSource } from "../../lib/citationDisplay";
import { CONTENT_TYPES, consoleHref, localPageSlugOf, pageFileOf } from "../../lib/localPageHref";

/** A 128-character slug, the longest the alphabet allows, and one past it. */
const LONGEST = `a${"b".repeat(127)}`;
const TOO_LONG = `${LONGEST}c`;

/** Addresses both readers are asked about, pages and not, beside the slug each must read. */
const ADDRESSES: readonly (readonly [string, string | undefined])[] = [
  ["file:///Users/me/.slopweaver/pages/acme-console-pages-react-27-sep/index.html", "acme-console-pages-react-27-sep"],
  ["file://localhost/Users/me/.slopweaver/pages/a.b_c-1/index.html", "a.b_c-1"],
  ["file:///Users/me/.slopweaver/pages/alpha/index.html?tab=a#finding", "alpha"],
  ["file://LOCALHOST/Users/me/.slopweaver/pages/alpha/index.html?tab=a#finding", "alpha"],
  ["FILE:///Users/me/.slopweaver/pages/alpha/index.html", "alpha"],
  ["file:///Users/me/.slopweaver/pages/placeholder/../alpha/index.html?tab=a#finding", "alpha"],
  ["file:///Users/me/.slopweaver/pages/alpha/./index.html", "alpha"],
  ["file:///Users/me/.slopweaver/pages/alpha/../index.html", undefined],
  ["file:///Users/me/.slopweaver/PAGES/alpha/index.html", undefined],
  ["file:///Users/me/.slopweaver/pages/alpha/INDEX.html", undefined],
  ["file:///Users/me/.slopweaver/pages/%41lpha/index.html", "Alpha"],
  [`file:///Users/me/.slopweaver/pages/${LONGEST}/index.html`, LONGEST],
  [`file:///Users/me/.slopweaver/pages/${TOO_LONG}/index.html`, undefined],
  ["file:///Users/me/.slopweaver/pages/../index.html", undefined],
  ["file:///Users/me/.slopweaver/pages/./index.html", undefined],
  ["file:///Users/me/.slopweaver/pages/.hidden/index.html", undefined],
  ["file:///Users/me/.slopweaver/pages/-dash/index.html", undefined],
  ["file:///Users/me/.slopweaver/pages/a%2Fb/index.html", undefined],
  ["file:///Users/me/.slopweaver/pages/%2e%2e/index.html", undefined],
  ["file:///Users/me/.slopweaver/pages/a%zz/index.html", undefined],
  ["file:///tmp/a%2Fb/pages/alpha/index.html", undefined],
  ["file:///tmp/%00/pages/alpha/index.html", undefined],
  ["file:///tmp/a%5Cb/pages/alpha/index.html", "alpha"],
  ["file:///tmp/%80/pages/alpha/index.html", undefined],
  ["file:///tmp/%C3%A9/pages/alpha/index.html", "alpha"],
  ["file://elsewhere/Users/me/.slopweaver/pages/alpha/index.html", undefined],
  ["file:///Users/me/.slopweaver/pages/alpha/shot.png", undefined],
  ["file:///Users/me/.slopweaver/pages/alpha/index.html.bak", undefined],
  ["file:///Users/me/.slopweaver/notpages/alpha/index.html", undefined],
  ["https://example.com/pages/alpha/index.html", undefined],
  ["http://localhost:3000/queue?open=ask%3Aabc", undefined],
  ["not a url", undefined],
];

describe("consoleHref", () => {
  it("sends a local page's file address to the console's page route", () => {
    expect(consoleHref({ url: "file:///Users/me/.slopweaver/pages/acme-console-pages-react-27-sep/index.html" })).toBe(
      "/api/page/acme-console-pages-react-27-sep/index.html",
    );
  });

  it("keeps the page's query and fragment", () => {
    expect(consoleHref({ url: "file:///Users/me/.slopweaver/pages/alpha/index.html?tab=a#finding" })).toBe(
      "/api/page/alpha/index.html?tab=a#finding",
    );
    expect(consoleHref({ url: "file:///Users/me/.slopweaver/pages/alpha/index.html?#finding" })).toBe(
      "/api/page/alpha/index.html?#finding",
    );
  });

  it("folds the scheme and the localhost authority, and normalises dot segments, as a URL parser does", () => {
    expect(
      [
        "file://LOCALHOST/Users/me/.slopweaver/pages/alpha/index.html?tab=a#finding",
        "FILE:///Users/me/.slopweaver/pages/alpha/index.html",
        "file:///Users/me/.slopweaver/pages/placeholder/../alpha/index.html?tab=a#finding",
      ].map((url) => consoleHref({ url })),
    ).toEqual([
      "/api/page/alpha/index.html?tab=a#finding",
      "/api/page/alpha/index.html",
      "/api/page/alpha/index.html?tab=a#finding",
    ]);
  });

  it("follows a pull request, a thread, a ticket and a queue link as written", () => {
    const urls = [
      "https://github.com/lachiejames/slopweaver/pull/1428",
      "https://acme.slack.com/archives/C01/p1727400000000000",
      "https://linear.app/acme/issue/JJJJ-1642",
      "http://localhost:3000/queue?open=ask%3Aabc",
      "/workstreams?row=abc",
      "file:///tmp/run.log",
    ];
    expect(urls.map((url) => consoleHref({ url }))).toEqual(urls);
  });
});

describe("localPageSlugOf", () => {
  it("reads each address's slug, or none", () => {
    expect(ADDRESSES.length).toBeGreaterThan(0);
    expect(ADDRESSES.map(([url]) => localPageSlugOf({ url }))).toEqual(ADDRESSES.map(([, slug]) => slug));
  });

  it("agrees with src/pages/url.ts on every one", () => {
    expect(ADDRESSES.map(([url]) => localPageSlugOf({ url }))).toEqual(
      ADDRESSES.map(([url]) => localPageSlug({ url })),
    );
  });

  it("is what makes a chip a page, so the chip's kind and its link never disagree", () => {
    expect(ADDRESSES.map(([url]) => citedSource({ reference: { kind: "address", url } }).kind === "page")).toEqual(
      ADDRESSES.map(([, slug]) => slug !== undefined),
    );
  });
});

describe("pageFileOf", () => {
  it("serves a page's index as html", () => {
    expect(pageFileOf({ file: ["index.html"], slug: "alpha" })).toEqual({
      contentType: "text/html; charset=utf-8",
      segments: ["index.html"],
    });
  });

  it("serves a relatively linked asset beside it or nested under it", () => {
    expect([
      pageFileOf({ file: ["pull-requests.png"], slug: "talk-voice-phase-2" }),
      pageFileOf({ file: ["assets", "style.css"], slug: "alpha" }),
      pageFileOf({ file: ["Shot.JPG"], slug: "alpha" }),
    ]).toEqual([
      { contentType: "image/png", segments: ["pull-requests.png"] },
      { contentType: "text/css; charset=utf-8", segments: ["assets", "style.css"] },
      { contentType: "image/jpeg", segments: ["Shot.JPG"] },
    ]);
  });

  it("refuses a dot-walk, a separator, a hidden file, an unknown type, an empty path and a bad slug", () => {
    expect([
      pageFileOf({ file: ["..", "secrets", "token.txt"], slug: "alpha" }),
      pageFileOf({ file: ["a/b.html"], slug: "alpha" }),
      pageFileOf({ file: [".env"], slug: "alpha" }),
      pageFileOf({ file: ["run.sh"], slug: "alpha" }),
      pageFileOf({ file: ["noextension"], slug: "alpha" }),
      pageFileOf({ file: [], slug: "alpha" }),
      pageFileOf({ file: ["index.html"], slug: ".." }),
    ]).toEqual([undefined, undefined, undefined, undefined, undefined, undefined, undefined]);
  });
});

describe("the store stores a page file as the type the console serves it as", () => {
  it("knows exactly the console's extensions, each as the essence of the console's content type", () => {
    expect(CONTENT_TYPES.size).toBeGreaterThan(0);
    const essences = new Map([...CONTENT_TYPES].map(([extension, type]) => [extension, type.split(";")[0].trim()]));
    expect(PUBLISHED_PAGE_MEDIA_TYPES).toEqual(essences);
  });

  it("reads an extension as the console's route does, case-insensitively", () => {
    expect(publishedPageMediaType({ relativePath: "Shot.JPG" })).toBe(
      pageFileOf({ file: ["Shot.JPG"], slug: "alpha" })!.contentType,
    );
  });
});
