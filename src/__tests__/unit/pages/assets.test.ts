import { describe, expect, it } from "vitest";

import { srcsetUrls, unsafePageAssets, unsafeReferenceKind } from "../../../pages/assets.js";
import { cssUrls } from "../../../pages/cssUrls.js";

describe("unsafeReferenceKind", () => {
  it("refuses a file: address in any case, with junk around its scheme", () => {
    expect(
      ["file:///Users/x/c.png", "FILE:///x.png", "  file:///x.png", "fi\tle:///x.png", "\u0001file:x.png"].map(
        (reference) => unsafeReferenceKind({ reference }),
      ),
    ).toEqual(["file-url", "file-url", "file-url", "file-url", "file-url"]);
  });

  it("refuses an absolute path, a backslash one included", () => {
    expect(["/Users/x/c.png", "\\Users\\x\\c.png"].map((reference) => unsafeReferenceKind({ reference }))).toEqual([
      "root-absolute",
      "root-absolute",
    ]);
  });

  it("refuses a relative path that climbs out of the page, however it climbs", () => {
    expect(
      ["../charts/x.png", "a/../../x.png", "%2e%2e/x.png", "..\\x.png"].map((reference) =>
        unsafeReferenceKind({ reference }),
      ),
    ).toEqual(["parent-relative", "parent-relative", "parent-relative", "parent-relative"]);
  });

  it("allows what sits beside the page, a network address, a data image and an in-page anchor", () => {
    expect(
      [
        "x.png",
        "./x.png",
        "assets/x.png",
        "a/../x.png",
        "https://example.com/x.png",
        "//example.com/x.png",
        "data:image/png;base64,AAAA",
        "#top",
        "",
      ].map((reference) => unsafeReferenceKind({ reference })),
    ).toEqual([undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined]);
  });
});

describe("srcsetUrls", () => {
  it("reads every candidate's URL past its descriptor", () => {
    expect(srcsetUrls({ srcset: "a.png 1x, b.png 2x,c.png 480w" })).toEqual(["a.png", "b.png", "c.png"]);
  });

  it("keeps a data URL's own comma inside it", () => {
    expect(srcsetUrls({ srcset: "data:image/png;base64,AA,BB 1x, file:///x.png 2x" })).toEqual([
      "data:image/png;base64,AA,BB",
      "file:///x.png",
    ]);
  });

  it("closes a candidate on a comma ending its URL", () => {
    expect(srcsetUrls({ srcset: "a.png,b.png" })).toEqual(["a.png,b.png"]);
    expect(srcsetUrls({ srcset: "a.png, b.png" })).toEqual(["a.png", "b.png"]);
  });

  it("reads nothing from an empty value", () => {
    expect(srcsetUrls({ srcset: "  " })).toEqual([]);
  });
});

describe("cssUrls", () => {
  it("reads quoted and unquoted url() and an @import string", () => {
    expect(cssUrls({ css: `@import "a.css"; b { background: url(b.png) } c { background: URL( 'c.png' ) }` })).toEqual([
      "a.css",
      "b.png",
      "c.png",
    ]);
  });

  it("resolves an escape, so an escaped scheme is still read as written", () => {
    expect(
      cssUrls({ css: String.raw`a { background: url(\66 ile:///x.png) } b { background: url("\66ile:y") }` }),
    ).toEqual(["file:///x.png", "file:y"]);
  });

  it("reads an @import and a url() whose name is spelled with an escape, as the browser does", () => {
    expect(
      cssUrls({ css: String.raw`@\69mport "a.css"; b { background: \75 rl(b.png) } c { x: u\RL(c.png) }` }),
    ).toEqual(["a.css", "b.png", "c.png"]);
  });

  it("never reads a url() inside a longer name, nor an import from another at-rule", () => {
    expect(cssUrls({ css: `@imports "a.css"; b { background: myurl(b.png) } @media print { c { x: 1 } }` })).toEqual(
      [],
    );
  });

  it("skips a comment and a string that is not an import", () => {
    expect(cssUrls({ css: `/* url(file:///no.png) */ a::before { content: "url(file:///no.png)" }` })).toEqual([]);
  });

  it("reads a top-level image-set() string in either spelling, never a type() string nested inside one", () => {
    const css =
      `a { background: image-set("../a.png" 1x, url(b.png) 2x, "c.avif" type("image/avif")) } ` +
      `b { background: -WEBKIT-image-set('d.png' 1x) } c { background: fake-set("e.png") } d::after { content: "f" }`;
    expect(cssUrls({ css })).toEqual(["../a.png", "b.png", "c.avif", "d.png"]);
  });
});

describe("unsafePageAssets", () => {
  it("names every reference the console cannot load, in document order", () => {
    const fragment = [
      '<img src="file:///Users/x/charts/a.png" alt="a">',
      '<picture><source srcset="../b.png 1x, ok.png 2x"><img src="ok.png" srcset="/Users/c.png 2x"></picture>',
      '<source src="file:///d.mp4">',
      '<style>.h { background: url("file:///e.png") }</style>',
      '<div style="background-image:url(../f.png)"></div>',
    ].join("\n");

    expect(unsafePageAssets({ fragment })).toEqual([
      { kind: "file-url", reference: "file:///Users/x/charts/a.png", source: "img-src" },
      { kind: "parent-relative", reference: "../b.png", source: "source-srcset" },
      { kind: "root-absolute", reference: "/Users/c.png", source: "img-srcset" },
      { kind: "file-url", reference: "file:///d.mp4", source: "source-src" },
      { kind: "file-url", reference: "file:///e.png", source: "css-url" },
      { kind: "parent-relative", reference: "../f.png", source: "css-url" },
    ]);
  });

  it("reads no reference out of a comment, prose or a template", () => {
    const fragment = [
      '<!-- <img src="file:///a.png"> -->',
      "<p>the old page used file:///b.png and url(file:///c.png)</p>",
      '<template><img src="file:///d.png"><style>a{background:url(file:///e.png)}</style></template>',
    ].join("\n");

    expect(unsafePageAssets({ fragment })).toEqual([]);
  });

  it("reads a linked stylesheet's href and an SVG image's href, in either spelling", () => {
    const fragment =
      '<link rel="Preload stylesheet" href="file:///s.css"><link rel="icon" href="file:///i.png">' +
      '<svg><image href="/a.png"/><image xlink:href="../b.png"/></svg><a href="file:///doc.pdf">doc</a>';

    expect(unsafePageAssets({ fragment })).toEqual([
      { kind: "file-url", reference: "file:///s.css", source: "link-href" },
      { kind: "root-absolute", reference: "/a.png", source: "svg-image-href" },
      { kind: "parent-relative", reference: "../b.png", source: "svg-image-href" },
    ]);
  });

  it("finds nothing in a page whose images sit beside it", () => {
    const fragment =
      '<title>t</title><figure><img src="charts/a.png" srcset="charts/a@2x.png 2x" alt="a"></figure>' +
      '<img src="data:image/png;base64,AA,BB"><img src="https://example.com/x.png">' +
      '<link rel="stylesheet" href="page.css"><svg><image href="charts/b.svg"/></svg>';

    expect(unsafePageAssets({ fragment })).toEqual([]);
  });
});
