/**
 * One published page as one file (`src/pages/selfContained.ts`): every file it loads by attribute is carried inside it
 * as a `data:` URL, a reference to a file it does not serve and a CSS load are reported, and nothing else changes.
 */
import { describe, expect, it } from "vitest";

import { referencedPageFile } from "../../../pages/pageReferences.js";
import { dataUrlOf, selfContainedPage } from "../../../pages/selfContained.js";

const SLUG = "acme-briefing";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46]);
const PNG_URL = `data:image/png;base64,${Buffer.from(PNG).toString("base64")}`;
const WEBP_URL = `data:image/webp;base64,${Buffer.from(WEBP).toString("base64")}`;

const FILES: ReadonlyMap<string, Uint8Array> = new Map([
  ["index.html", new Uint8Array()],
  ["shot.png", PNG],
  ["charts/wide.webp", WEBP],
  ["sheet.css", new TextEncoder().encode("p{color:red}")],
]);

/** The attribute values of every element matching a tag, in document order, read back out of the built file. */
function valuesOf({ html, attribute }: { html: string; attribute: string }): readonly string[] {
  return [...html.matchAll(new RegExp(`${attribute}="([^"]*)"`, "gu"))].map((match) => match[1]!);
}

describe("referencedPageFile", () => {
  it("names the page file a relative reference loads, query and fragment dropped, escapes decoded", () => {
    const references = [
      "shot.png",
      "./shot.png",
      "charts/wide.webp?v=2#x",
      "charts/../shot.png",
      "a%20b.png",
      "http:shot.png",
      "/api/page/acme-briefing/charts/wide.webp",
      " shot.png ",
    ];
    expect(references.map((reference) => referencedPageFile({ reference, slug: SLUG }))).toEqual([
      "shot.png",
      "shot.png",
      "charts/wide.webp",
      "shot.png",
      "a b.png",
      "shot.png",
      "charts/wide.webp",
      "shot.png",
    ]);
  });

  it("names no page file for an address with a scheme, a root or network path, a climb out, or nothing", () => {
    const references = [
      "https://example.com/shot.png",
      "data:image/png;base64,AA==",
      "file:///Users/someone/shot.png",
      "/shot.png",
      "/api/page/other-page/shot.png",
      "https:shot.png",
      "//cdn.example.com/shot.png",
      "../other/shot.png",
      "",
      "%E0%A4%A.png",
    ];
    expect(references.map((reference) => referencedPageFile({ reference, slug: SLUG }))).toEqual(
      references.map(() => undefined),
    );
  });
});

describe("dataUrlOf", () => {
  it("types a file by its extension, and an unknown one as opaque bytes", () => {
    expect(dataUrlOf({ bytes: PNG, relativePath: "charts/A.PNG" })).toBe(PNG_URL);
    expect(dataUrlOf({ bytes: PNG, relativePath: "measure/run.tsv" })).toBe(
      `data:application/octet-stream;base64,${Buffer.from(PNG).toString("base64")}`,
    );
  });
});

describe("selfContainedPage", () => {
  it("carries every image the page loads inside it, in src, srcset, poster and an SVG image", () => {
    const document = [
      "<!doctype html><html><head><title>acme briefing</title></head><body>",
      '<img src="shot.png" alt="a">',
      '<picture><source srcset="charts/wide.webp 2x, shot.png 1x"><img src="charts/wide.webp"></picture>',
      '<video poster="shot.png"></video>',
      '<svg><image href="shot.png"></image></svg>',
      "</body></html>",
    ].join("");
    const page = selfContainedPage({ document, files: FILES, slug: SLUG });

    expect(valuesOf({ attribute: "src", html: page.html })).toEqual([PNG_URL, WEBP_URL]);
    expect(valuesOf({ attribute: "srcset", html: page.html })).toEqual([`${WEBP_URL} 2x, ${PNG_URL} 1x`]);
    expect(valuesOf({ attribute: "poster", html: page.html })).toEqual([PNG_URL]);
    expect(valuesOf({ attribute: "href", html: page.html })).toEqual([PNG_URL]);
    expect(page.inlined).toEqual(["charts/wide.webp", "shot.png"]);
    expect(page.notInlined).toEqual([]);
    expect(page.html).toContain("<title>acme briefing</title>");
  });

  it("inlines a linked stylesheet, and leaves links, network images and data images exactly as written", () => {
    const document = [
      '<html><head><link rel="stylesheet" href="sheet.css"><link rel="icon" href="shot.png"></head><body>',
      '<a href="shot.png">open</a><img src="https://example.com/x.png"><img src="data:image/gif;base64,R0lG">',
      "</body></html>",
    ].join("");
    const page = selfContainedPage({ document, files: FILES, slug: SLUG });

    expect(valuesOf({ attribute: "href", html: page.html })).toEqual([
      `data:text/css;base64,${Buffer.from("p{color:red}").toString("base64")}`,
      "shot.png",
      "shot.png",
    ]);
    expect(valuesOf({ attribute: "src", html: page.html })).toEqual([
      "https://example.com/x.png",
      "data:image/gif;base64,R0lG",
    ]);
    expect(page.inlined).toEqual(["sheet.css"]);
  });

  it("reports a reference to a file the page does not serve, and every page file CSS loads, in document order", () => {
    const document = [
      "<html><head><style>body{background:url(shot.png)} h1{background:url('https://example.com/x.png')}</style>",
      '</head><body><img src="missing.png"><div style="background-image: url(charts/wide.webp)"></div>',
      "<template><img src='missing-too.png'></template></body></html>",
    ].join("");
    const page = selfContainedPage({ document, files: FILES, slug: SLUG });

    expect(page.notInlined).toEqual([
      { reference: "shot.png", why: "css" },
      { reference: "missing.png", why: "not-served" },
      { reference: "charts/wide.webp", why: "css" },
      { reference: "missing-too.png", why: "not-served" },
    ]);
    expect(page.inlined).toEqual([]);
    expect(valuesOf({ attribute: "src", html: page.html })).toEqual(["missing.png", "missing-too.png"]);
  });

  it("reports every page file a linked stylesheet loads, resolved against the sheet's own path", () => {
    const sheet = "@import 'more.css'; body{background:url(../bg.png)} h1{background:url(https://example.com/x.png)}";
    const files = new Map([...FILES, ["styles/main.css", new TextEncoder().encode(sheet)]]);
    const page = selfContainedPage({ document: '<link rel="stylesheet" href="styles/main.css">', files, slug: SLUG });

    expect(page.inlined).toEqual(["styles/main.css"]);
    expect(page.notInlined).toEqual([
      { reference: "more.css", why: "css" },
      { reference: "../bg.png", why: "css" },
    ]);
  });

  it("reports nothing for a linked stylesheet whose path climbs out of the page", () => {
    const page = selfContainedPage({
      document: '<link rel="stylesheet" href="../elsewhere.css">',
      files: FILES,
      slug: SLUG,
    });

    expect(page.inlined).toEqual([]);
    expect(page.notInlined).toEqual([]);
  });

  it("carries the document itself for a reference that resolves to it, as a query-only address does", () => {
    const documents = ['<img src="?raw">', '<base href="?v=1"><img src="?raw">'];
    const pages = documents.map((document) => selfContainedPage({ document, files: FILES, slug: SLUG }));

    expect(pages.map((page) => valuesOf({ attribute: "src", html: page.html }))).toEqual([
      ["data:text/html;base64,"],
      ["data:text/html;base64,"],
    ]);
    expect(pages.map((page) => page.inlined)).toEqual([["index.html"], ["index.html"]]);
  });

  it("carries both an SVG image's xlink:href and its href, since the browser loads the unprefixed one", () => {
    const page = selfContainedPage({
      document: '<svg><image xlink:href="shot.png" href="charts/wide.webp"></image></svg>',
      files: FILES,
      slug: SLUG,
    });

    expect(valuesOf({ attribute: "href", html: page.html })).toEqual([PNG_URL, WEBP_URL]);
    expect(page.inlined).toEqual(["charts/wide.webp", "shot.png"]);
  });

  it("resolves the document's references through its first base element, as the browser loads them", () => {
    const page = selfContainedPage({
      document: '<base href="charts/"><base href="elsewhere/"><img src="wide.webp"><img src="../shot.png">',
      files: FILES,
      slug: SLUG,
    });

    expect(valuesOf({ attribute: "src", html: page.html })).toEqual([WEBP_URL, PNG_URL]);
    expect(page.inlined).toEqual(["charts/wide.webp", "shot.png"]);
    expect(page.notInlined).toEqual([]);
  });

  it("falls back to the document's own address for a base that does not parse, or a data: or javascript: one", () => {
    const bases = ["http://[", "data:text/html,x", "javascript:void(0)"];
    const pages = bases.map((base) =>
      selfContainedPage({ document: `<base href="${base}"><img src="shot.png">`, files: FILES, slug: SLUG }),
    );

    expect(pages.map((page) => valuesOf({ attribute: "src", html: page.html }))).toEqual([
      [PNG_URL],
      [PNG_URL],
      [PNG_URL],
    ]);
  });

  it("never skips to a later base when the first does not parse, as HTML freezes the first base's URL", () => {
    const page = selfContainedPage({
      document: '<base href="http://["><base href="charts/"><img src="shot.png">',
      files: FILES,
      slug: SLUG,
    });

    expect(valuesOf({ attribute: "src", html: page.html })).toEqual([PNG_URL]);
  });

  it("ignores an SVG element named base, which is not the HTML base element", () => {
    const page = selfContainedPage({
      document: '<svg><base href="charts/"></base></svg><img src="shot.png">',
      files: FILES,
      slug: SLUG,
    });

    expect(valuesOf({ attribute: "src", html: page.html })).toEqual([PNG_URL]);
  });

  it("names no page file through a base outside the page, so nothing is inlined or reported", () => {
    const bases = ["https://example.com/", "/root/", "../"];
    const pages = bases.map((base) =>
      selfContainedPage({
        document: `<base href="${base}"><img src="shot.png"><img src="missing.png">`,
        files: FILES,
        slug: SLUG,
      }),
    );

    expect(pages.map((page) => page.inlined)).toEqual([[], [], []]);
    expect(pages.map((page) => page.notInlined)).toEqual([[], [], []]);
  });

  it("carries an image inside a template, which a script stamping it out later loads from the copy", () => {
    const document = [
      '<template id="card"><figure><img src="shot.png"></figure></template>',
      '<script>document.body.append(document.querySelector("#card").content.cloneNode(true))</script>',
    ].join("");
    const page = selfContainedPage({ document, files: FILES, slug: SLUG });

    expect(valuesOf({ attribute: "src", html: page.html })).toEqual([PNG_URL]);
    expect(page.inlined).toEqual(["shot.png"]);
    expect(page.notInlined).toEqual([]);
  });

  it("names an inlined file once however many references load it", () => {
    const page = selfContainedPage({
      document: '<img src="shot.png"><img src="./shot.png"><img srcset="shot.png 1x">',
      files: FILES,
      slug: SLUG,
    });
    expect(page.inlined).toEqual(["shot.png"]);
    expect(valuesOf({ attribute: "src", html: page.html })).toEqual([PNG_URL, PNG_URL]);
  });
});
