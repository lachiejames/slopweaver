import { describe, expect, it } from "vitest";

import { documentEscapes, documentLoads, stylesheetEscapes, stylesheetLoads } from "../../../pages/loadedFiles.js";
import { wrapPageFragment } from "../../../pages/shell.js";

/** The relative paths a fragment's document loads, as `acme-page`. */
function loadsOf({ fragment }: { fragment: string }): readonly string[] {
  return documentLoads({ document: wrapPageFragment({ fragment }), slug: "acme-page" }).map(
    (load) => load.relativePath,
  );
}

describe("documentLoads", () => {
  it("reads every loading attribute and the document's own CSS, each path once, in document order", () => {
    const fragment =
      '<link rel="stylesheet" href="css/page.css">' +
      '<img src="images/a.png" srcset="images/a.png 1x, images/a@2x.png 2x">' +
      '<video poster="images/poster.jpg"></video>' +
      '<p style="background: url(images/bg.png)">x</p>' +
      '<style>@import "css/extra.css"; .a { background: url("images/tile.png"); }</style>';
    expect(loadsOf({ fragment })).toEqual([
      "css/page.css",
      "images/a.png",
      "images/a@2x.png",
      "images/poster.jpg",
      "images/bg.png",
      "css/extra.css",
      "images/tile.png",
    ]);
  });

  it("reads every media element and script a browser fetches a file for, and an image input but no other input", () => {
    const fragment =
      '<video src="media/a.mp4"></video><audio src="media/b.mp3"></audio><track src="media/c.vtt">' +
      '<embed src="media/d.pdf"><iframe src="media/e.html"></iframe><object data="media/f.svg"></object>' +
      '<input type="IMAGE" src="media/g.png"><input type="text" src="media/ignored.png">' +
      '<script src="scripts/app.js"></script>';
    expect(loadsOf({ fragment })).toEqual([
      "media/a.mp4",
      "media/b.mp3",
      "media/c.vtt",
      "media/d.pdf",
      "media/e.html",
      "media/f.svg",
      "media/g.png",
      "scripts/app.js",
    ]);
  });

  it("keeps the reference that first named a path", () => {
    const loads = documentLoads({
      document: wrapPageFragment({ fragment: '<img src="./images/a.png"><img src="images/a.png">' }),
      slug: "acme-page",
    });
    expect(loads).toEqual([{ reference: "./images/a.png", relativePath: "images/a.png" }]);
  });

  it("never counts the document itself, another site's file or a link that is not a stylesheet", () => {
    const fragment =
      '<img src="index.html"><img src="?raw"><img src="https://example.com/a.png">' +
      '<a href="images/linked.png">a link</a><link rel="icon" href="images/icon.png">';
    expect(loadsOf({ fragment })).toEqual([]);
  });

  it("loads nothing from a page with no references", () => {
    expect(loadsOf({ fragment: "<p>plain</p>" })).toEqual([]);
  });
});

describe("stylesheetLoads", () => {
  it("resolves a sheet's references against the sheet's own address", () => {
    const loads = stylesheetLoads({
      css: '@import "fonts.css"; .a { background: url(../images/a.png); } .b { background: url(images/b.png); }',
      relativePath: "css/page.css",
      slug: "acme-page",
    });
    expect(loads.map((load) => load.relativePath)).toEqual(["css/fonts.css", "images/a.png", "css/images/b.png"]);
  });

  it("loads nothing from a sheet with no references", () => {
    expect(stylesheetLoads({ css: ".a { color: red; }", relativePath: "page.css", slug: "acme-page" })).toEqual([]);
  });
});

describe("documentEscapes", () => {
  it("names a reference the document's base resolves outside the page, each once", () => {
    const document = wrapPageFragment({
      fragment: '<base href="../"><img src="secret.png"><img src="secret.png"><img src="https://acme.example/a.png">',
    });
    expect(documentEscapes({ document, slug: "acme-page" })).toEqual(["secret.png"]);
  });

  it("names nothing on a page whose references all stay inside it", () => {
    const document = wrapPageFragment({ fragment: '<img src="images/a.png"><img src="../acme-page/b.png">' });
    expect(documentEscapes({ document, slug: "acme-page" })).toEqual([]);
  });
});

describe("stylesheetEscapes", () => {
  it("names a climb out of the page, a root path elsewhere and a file address, never a remote or inline one", () => {
    const css = [
      '@import "../../escape.css";',
      ".a { background: url(/etc/a.png); }",
      ".b { background: url(file:///etc/b.png); }",
      ".c { background: url(https://acme.example/c.png); }",
      ".d { background: url(data:image/png;base64,AA==); }",
      ".e { background: url(../images/e.png); }",
      '.f { background-image: image-set("../../secret.png" 1x); }',
    ].join(" ");

    expect(stylesheetEscapes({ css, relativePath: "css/page.css", slug: "acme-page" })).toEqual([
      "../../escape.css",
      "/etc/a.png",
      "file:///etc/b.png",
      "../../secret.png",
    ]);
  });
});
