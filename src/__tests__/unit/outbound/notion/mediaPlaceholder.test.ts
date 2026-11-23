/**
 * The media-placeholder contract: what counts as a placeholder, what the marker looks like, and the two
 * properties the whole feature rests on — position is preserved, and an id is stable for a position.
 *
 * The sigil is the third property and it is the one a PDF added. `!` asks for an `image` block and no `!`
 * asks for a `pdf` block, and the extension has to AGREE, because a PDF in an image block renders as a
 * broken image and Notion reports nothing at all.
 */
import { describe, expect, it } from "vitest";
import { unwrapErr } from "../../../../lib/result.js";
import {
  extensionOf,
  MEDIA_CONTENT_TYPES,
  markerBlocksOf,
  markerIdOf,
  mediaPlaceholders,
  placeholderMarker,
  resolveMediaPath,
  SINGLE_PART_BYTES_MAX,
  uploadableMedia,
  withMediaMarkers,
} from "../../../../outbound/notion/mediaPlaceholder.js";

/** Unwrap a successful check; `testing.md` bans a conditional in an assertion, so this throws instead. */
function accepted({ path, kind }: { path: string; kind: "image" | "pdf" }): {
  readonly blockType: string;
  readonly contentType: string;
} {
  const checked = uploadableMedia({ bytes: 1024, kind, path });
  return checked._unsafeUnwrap();
}

describe("withMediaMarkers", () => {
  it("substitutes a marker AT the placeholder's line, so block order survives the publish", () => {
    const marked = withMediaMarkers({
      markdown: "## TL;DR\n\n![The hero shot](file:./shots/hero.png)\n\nprose\n",
    });
    const lines = marked.markdown.split("\n");
    expect(lines[0]).toBe("## TL;DR");
    expect(lines[2]).toBe(marked.placeholders[0]!.marker);
    expect(lines[4]).toBe("prose");
  });

  it("preserves the line count, so a lint finding still points at the right line", () => {
    const source = "a\n\n![x](file:./a.png)\n\nb\n\n![y](file:./b.png)\n";
    expect(withMediaMarkers({ markdown: source }).markdown.split("\n").length).toBe(source.split("\n").length);
  });

  it("records the caption, the source and the 1-indexed line of each placeholder, in document order", () => {
    const marked = withMediaMarkers({ markdown: "intro\n\n![first](file:./a.png)\n\n![](file:../b.jpg)\n" });
    expect(marked.placeholders.length).toBe(2);
    expect(marked.placeholders[0]!.caption).toBe("first");
    expect(marked.placeholders[0]!.source).toBe("./a.png");
    expect(marked.placeholders[0]!.line).toBe(3);
    expect(marked.placeholders[1]!.caption).toBe("");
    expect(marked.placeholders[1]!.source).toBe("../b.jpg");
    expect(marked.placeholders[1]!.line).toBe(5);
  });

  it("gives the SAME file at two positions two different ids, or the attach pass could not tell them apart", () => {
    const marked = withMediaMarkers({ markdown: "![x](file:./a.png)\n\nmid\n\n![x](file:./a.png)\n" });
    expect(marked.placeholders[0]!.id).not.toBe(marked.placeholders[1]!.id);
  });

  it("is deterministic: the same body twice yields the same ids", () => {
    const body = "## A\n\n![shot](file:./a.png)\n";
    expect(withMediaMarkers({ markdown: body }).placeholders[0]!.id).toBe(
      withMediaMarkers({ markdown: body }).placeholders[0]!.id,
    );
  });

  it("leaves an http image alone — Notion embeds that by URL and nothing needs uploading", () => {
    const body = "![x](https://example.com/a.png)\n";
    const marked = withMediaMarkers({ markdown: body });
    expect(marked.markdown).toBe(body);
    expect(marked.placeholders.length).toBe(0);
  });

  it("ignores a placeholder that is not alone on its line — there would be no block to insert beside", () => {
    expect(mediaPlaceholders({ markdown: "see ![x](file:./a.png) here\n" }).length).toBe(0);
  });

  it("finds nothing in a body with no images at all", () => {
    expect(mediaPlaceholders({ markdown: "## A\n\njust prose\n" }).length).toBe(0);
  });
});

// The half a PDF added. The sigil is what a reader of the markdown uses to tell what the page will look
// like, so it decides the kind at the MATCH rather than being reconciled later against the extension.
describe("the sigil picks the block, and both sigils are placeholders", () => {
  it("reads a bare link line as a `pdf` placeholder and an image line as an `image` one", () => {
    const found = mediaPlaceholders({ markdown: "![shot](file:./a.png)\n\n[the DPA](file:./dpa.pdf)\n" });
    expect(found.map((placeholder) => placeholder.kind)).toEqual(["image", "pdf"]);
    expect(found.map((placeholder) => placeholder.source)).toEqual(["./a.png", "./dpa.pdf"]);
  });

  it("carries the caption off a link placeholder, which is what becomes the block's caption", () => {
    expect(mediaPlaceholders({ markdown: "[signed 31 Jul](file:./dpa.pdf)\n" })[0]!.caption).toBe("signed 31 Jul");
  });

  it("ignores a link that is not alone on its line, exactly as it ignores an inline image", () => {
    expect(mediaPlaceholders({ markdown: "read [the DPA](file:./dpa.pdf) first\n" }).length).toBe(0);
  });

  it("is not fooled by an image line into reading the link form too, so one line is ONE placeholder", () => {
    expect(mediaPlaceholders({ markdown: "![shot](file:./a.png)\n" }).length).toBe(1);
  });

  it("substitutes a marker for a link placeholder in place, the same as for an image one", () => {
    const marked = withMediaMarkers({ markdown: "intro\n\n[d](file:./d.pdf)\n\noutro\n" });
    expect(marked.markdown.split("\n")[2]).toBe(marked.placeholders[0]!.marker);
    expect(marked.markdown.split("\n").length).toBe(6);
  });
});

describe("placeholderMarker / markerIdOf", () => {
  it("round-trips an id through the marker text Notion reads back", () => {
    expect(markerIdOf({ text: placeholderMarker({ id: "0123456789abcdef" }) })).toBe("0123456789abcdef");
  });

  it("tolerates the surrounding whitespace a block's plain text may carry", () => {
    expect(markerIdOf({ text: "  [slopweaver-image:0123456789abcdef]  " })).toBe("0123456789abcdef");
  });

  it("refuses ordinary prose, so a paragraph is never mistaken for a marker", () => {
    expect(markerIdOf({ text: "the slopweaver-image pass runs after publish" })).toBe(undefined);
  });

  it("refuses a marker whose id is not a 16-hex placeholder id", () => {
    expect(markerIdOf({ text: "[slopweaver-image:not-hex]" })).toBe(undefined);
  });
});

describe("markerBlocksOf", () => {
  const blocks = [
    { id: "b1", parentId: "page", text: "## TL;DR", type: "heading_2" },
    { id: "b2", parentId: "page", text: "[slopweaver-image:0123456789abcdef]", type: "paragraph" },
    { id: "b3", parentId: "toggle", text: "[slopweaver-image:fedcba9876543210]", type: "paragraph" },
  ];

  it("keys each marker by its placeholder id and records the parent an insertion is addressed to", () => {
    const found = markerBlocksOf({ blocks });
    expect(found.get("0123456789abcdef")!.blockId).toBe("b2");
    expect(found.get("fedcba9876543210")!.parentId).toBe("toggle");
  });

  it("finds no marker in a page that carries none", () => {
    expect(markerBlocksOf({ blocks: [{ id: "b1", parentId: "page", text: "prose", type: "paragraph" }] }).size).toBe(0);
  });

  it("keeps the FIRST of two blocks claiming one placeholder, so a duplicate cannot redirect an insertion", () => {
    const duplicated = [
      ...blocks,
      { id: "b9", parentId: "page", text: "[slopweaver-image:0123456789abcdef]", type: "paragraph" },
    ];
    expect(markerBlocksOf({ blocks: duplicated }).get("0123456789abcdef")!.blockId).toBe("b2");
  });
});

describe("resolveMediaPath", () => {
  it("resolves a relative source against the markdown file's own directory", () => {
    expect(resolveMediaPath({ baseDir: "/repo/docs", source: "./shots/hero.png" })).toBe("/repo/docs/shots/hero.png");
  });

  it("walks up out of the base directory when the source does", () => {
    expect(resolveMediaPath({ baseDir: "/repo/docs", source: "../assets/a.png" })).toBe("/repo/assets/a.png");
  });

  it("leaves an absolute source alone", () => {
    expect(resolveMediaPath({ baseDir: "/repo/docs", source: "/tmp/a.png" })).toBe("/tmp/a.png");
  });
});

describe("uploadableMedia", () => {
  it("maps a known extension to the content type the upload declares, case-insensitively", () => {
    expect(accepted({ kind: "image", path: "/tmp/hero.PNG" })).toEqual({
      blockType: "image",
      contentType: "image/png",
    });
  });

  it("maps `.pdf` to Notion's own `pdf` block, which is the block `notion read --pdf` already extracts", () => {
    expect(accepted({ kind: "pdf", path: "/tmp/notes.pdf" })).toEqual({
      blockType: "pdf",
      contentType: "application/pdf",
    });
  });

  it("refuses a type Notion does not accept through this lane, naming what it does", () => {
    const checked = uploadableMedia({ bytes: 1024, kind: "pdf", path: "/tmp/notes.docx" });
    expect(checked.isOk()).toBe(false);
    expect(checked._unsafeUnwrapErr()).toContain(".png");
    expect(checked._unsafeUnwrapErr()).toContain(".pdf");
  });

  // The cross-check the sigil exists for. Both directions, because either one alone is satisfied by a
  // check that only ever reads the extension.
  it("refuses a PDF written with the image sigil, and an image written with the link sigil", () => {
    const asImage = uploadableMedia({ bytes: 1024, kind: "image", path: "/tmp/dpa.pdf" });
    expect(asImage.isOk()).toBe(false);
    expect(asImage._unsafeUnwrapErr()).toContain("renders as a broken image");
    const asFile = uploadableMedia({ bytes: 1024, kind: "pdf", path: "/tmp/hero.png" });
    expect(asFile.isOk()).toBe(false);
    expect(asFile._unsafeUnwrapErr()).toContain("![caption](file:./shot.png)");
  });

  it("refuses a file with no extension at all", () => {
    const result = uploadableMedia({ bytes: 10, kind: "image", path: "/tmp/hero" });
    expect(unwrapErr(result)).toBe(
      '/tmp/hero has extension "", which Notion does not accept through this lane. ' +
        "Accepted: .bmp, .gif, .heic, .ico, .jpeg, .jpg, .pdf, .png, .svg, .tif, .tiff, .webp.",
    );
  });

  it("refuses an empty file rather than uploading nothing", () => {
    const result = uploadableMedia({ bytes: 0, kind: "image", path: "/tmp/hero.png" });
    expect(unwrapErr(result)).toBe("/tmp/hero.png is empty, so there is nothing to upload");
  });

  it("accepts a file exactly at the single-part ceiling and refuses one byte more", () => {
    expect(uploadableMedia({ bytes: SINGLE_PART_BYTES_MAX, kind: "image", path: "/tmp/a.png" }).isOk()).toBe(true);
    expect(uploadableMedia({ bytes: SINGLE_PART_BYTES_MAX + 1, kind: "image", path: "/tmp/a.png" }).isOk()).toBe(false);
  });

  // MEASURED as a real hazard rather than a style point: the oversize line used to say "Crop or recompress
  // the shot" for everything, and an operator following that on a 30MB signed contract damages the
  // evidence. The advice has to differ because the remedy does.
  it("tells an operator to split a document and to recompress a shot, never the other way round", () => {
    const document = uploadableMedia({ bytes: SINGLE_PART_BYTES_MAX + 1, kind: "pdf", path: "/tmp/dpa.pdf" });
    expect(document._unsafeUnwrapErr()).toContain("Split the document");
    const shot = uploadableMedia({ bytes: SINGLE_PART_BYTES_MAX + 1, kind: "image", path: "/tmp/a.png" });
    expect(shot._unsafeUnwrapErr()).toContain("Crop or recompress the shot");
  });
});

describe("MEDIA_CONTENT_TYPES is the one place a file type is decided", () => {
  const extensions = Object.keys(MEDIA_CONTENT_TYPES);

  it("declares at least one type, so every guard below is over a non-empty set", () => {
    expect(extensions.length).toBeGreaterThan(0);
  });

  it("keys every entry on a lowercase dotted extension `extensionOf` can produce", () => {
    expect(extensions.filter((extension) => extensionOf({ path: `f${extension}` }) !== extension)).toEqual([]);
  });

  it("carries exactly one `pdf` block type, and it is `.pdf`", () => {
    const documents = extensions.filter((extension) => MEDIA_CONTENT_TYPES[extension]!.blockType === "pdf");
    expect(documents).toEqual([".pdf"]);
  });

  // `audio` and `video` are absent on purpose, not pending: the read lane calls a screen recording
  // not-a-document, so writing one would emit a block this repo's own reader skips.
  it("offers no block type beyond `image` and `pdf`", () => {
    const kinds = [...new Set(extensions.map((extension) => MEDIA_CONTENT_TYPES[extension]!.blockType))].toSorted();
    expect(kinds).toEqual(["image", "pdf"]);
  });
});
