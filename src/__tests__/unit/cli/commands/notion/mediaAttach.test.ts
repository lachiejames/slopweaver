/**
 * The media attach PASS — the orchestration itself: what is uploaded, where it is inserted, as WHICH block,
 * and what is deliberately NOT done.
 *
 * The negative assertions carry the weight. A pass that uploaded before checking every file would leave a
 * page half-edited; one that treated an absent marker as a failure would never be re-runnable; one that
 * inserted anywhere but after the marker would put the hero shot at the bottom, which is the exact defect
 * this feature exists to prevent.
 *
 * Every edge is a plain injected function. No mocks.
 */
import { describe, expect, it } from "vitest";
import {
  attachMedia,
  attachReportLines,
  type MediaFileReader,
} from "../../../../../cli/commands/notion/mediaAttach.js";
import type { NotionMediaApi, PageBlock } from "../../../../../corpus/notion/mediaApi.js";
import { err as failure, ok } from "../../../../../lib/result.js";
import { placeholderMarker, withMediaMarkers } from "../../../../../outbound/notion/mediaPlaceholder.js";
import { notionApiFailure } from "../../../../notionApiErrorFixture.js";

const PAGE = "3c300000-0000-817c-a1d1-da9a9b003e05";
const BODY = "## TL;DR\n\n![The hero shot](file:./shots/hero.png)\n\nprose\n";

/** The placeholder ids `BODY` produces, so a fixture page can carry their markers. */
function idsOf({ markdown }: { markdown: string }): readonly string[] {
  return withMediaMarkers({ markdown }).placeholders.map((placeholder) => placeholder.id);
}

/** A page whose top-level blocks carry a marker for every placeholder in `markdown`. */
function pageWithMarkers({ markdown }: { markdown: string }): readonly PageBlock[] {
  return [
    { hasChildren: false, id: "heading", parentId: PAGE, text: "TL;DR", type: "heading_2" },
    ...idsOf({ markdown }).map((id, at): PageBlock => ({
      hasChildren: false,
      id: `marker-${String(at)}`,
      parentId: PAGE,
      text: placeholderMarker({ id }),
      type: "paragraph",
    })),
  ];
}

/** A recording fake seam plus the file edge, with each failure independently switchable. */
function harness({
  blocks = pageWithMarkers({ markdown: BODY }),
  files = { "/draft/shots/hero.png": new Uint8Array([1, 2, 3]) },
  upload = "ok",
  insert = "ok",
  remove = "ok",
  list = "ok",
}: {
  blocks?: readonly PageBlock[];
  files?: Readonly<Record<string, Uint8Array<ArrayBuffer>>>;
  upload?: "ok" | "fail";
  insert?: "ok" | "fail";
  remove?: "ok" | "fail";
  list?: "ok" | "fail";
} = {}): { api: NotionMediaApi; readMedia: MediaFileReader; calls: string[] } {
  const calls: string[] = [];
  const api: NotionMediaApi = {
    deleteBlock: ({ blockId }) => {
      calls.push(`delete:${blockId}`);
      return Promise.resolve(remove === "ok" ? ok(undefined) : failure(notionApiFailure({ message: "gone" })));
    },
    insertMediaAfter: ({ parentId, afterBlockId, fileUploadId, caption, blockType }) => {
      calls.push(`insert:${blockType}:${parentId}:${afterBlockId}:${fileUploadId}:${caption}`);
      return Promise.resolve(
        insert === "ok" ? ok(`block-${afterBlockId}`) : failure(notionApiFailure({ message: "refused" })),
      );
    },
    listChildren: ({ parentId, cursor }) => {
      calls.push(`list:${parentId}`);
      if (list === "fail") {
        return Promise.resolve(failure(notionApiFailure({ message: "socket hang up" })));
      }
      const children = parentId === PAGE && cursor === undefined ? blocks : [];
      return Promise.resolve(ok({ blocks: children, nextCursor: undefined }));
    },
    uploadFile: ({ filename, contentType, bytes }) => {
      calls.push(`upload:${filename}:${contentType}:${String(bytes.byteLength)}`);
      return Promise.resolve(
        upload === "ok" ? ok(`upload-${filename}`) : failure(notionApiFailure({ message: "413 too large" })),
      );
    },
  };
  return {
    api,
    calls,
    readMedia: ({ path }) => {
      calls.push(`read:${path}`);
      const bytes = files[path];
      return bytes === undefined ? { error: `cannot read ${path}` } : { bytes };
    },
  };
}

/** Run the pass with `BODY` against a harness. */
async function run({
  h,
  markdown = BODY,
}: {
  h: { api: NotionMediaApi; readMedia: MediaFileReader };
  markdown?: string;
}): ReturnType<typeof attachMedia> {
  return attachMedia({ api: h.api, baseDir: "/draft", markdown, pageId: PAGE, readMedia: h.readMedia });
}

describe("attachMedia — the happy path", () => {
  it("uploads the file, inserts AFTER the marker, then deletes the marker, in that order", async () => {
    const h = harness();
    const report = await run({ h });
    expect(report.attached.length).toBe(1);
    expect(h.calls).toEqual([
      "read:/draft/shots/hero.png",
      `list:${PAGE}`,
      "upload:hero.png:image/png:3",
      `insert:image:${PAGE}:marker-0:upload-hero.png:The hero shot`,
      "delete:marker-0",
    ]);
  });

  it("records the block id, the upload id and the byte count of what it placed", async () => {
    const report = await run({ h: harness() });
    expect(report.attached[0]).toEqual({
      blockId: "block-marker-0",
      blockType: "image",
      bytes: 3,
      fileUploadId: "upload-hero.png",
      placeholderId: idsOf({ markdown: BODY })[0],
      source: "./shots/hero.png",
    });
  });

  it("carries the caption through to the image block", async () => {
    const h = harness();
    await run({ h });
    expect(h.calls.some((call) => call.endsWith(":The hero shot"))).toBe(true);
  });

  it("sends no caption at all when the placeholder had none", async () => {
    const markdown = "## A\n\n![](file:./shots/hero.png)\n";
    const h = harness({ blocks: pageWithMarkers({ markdown }) });
    await run({ h, markdown });
    expect(h.calls.some((call) => call.startsWith(`insert:image:${PAGE}:marker-0:upload-hero.png:`))).toBe(true);
  });
});

// ONE pass carrying BOTH kinds, because the kind is a per-placeholder fact and a pass that read it once
// off the first placeholder would pass every single-kind case here.
describe("attachMedia — a document and a shot in the same pass", () => {
  const MIXED = "## TL;DR\n\n![The hero shot](file:./shots/hero.png)\n\n[The signed DPA](file:./dpa.pdf)\n";
  /** `%PDF-` — what a real PDF opens with, and what the pass now insists on for a `pdf` block. */
  const PDF_MAGIC = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
  const mixedHarness = (): ReturnType<typeof harness> =>
    harness({
      blocks: pageWithMarkers({ markdown: MIXED }),
      files: {
        "/draft/dpa.pdf": PDF_MAGIC,
        "/draft/shots/hero.png": new Uint8Array([1, 2, 3]),
      },
    });

  it("writes an `image` block for the image sigil and a `pdf` block for the link one", async () => {
    const h = mixedHarness();
    await run({ h, markdown: MIXED });
    expect(h.calls.filter((call) => call.startsWith("insert:"))).toEqual([
      `insert:image:${PAGE}:marker-0:upload-hero.png:The hero shot`,
      `insert:pdf:${PAGE}:marker-1:upload-dpa.pdf:The signed DPA`,
    ]);
  });

  it("declares each upload with its own content type, so Notion stores a PDF as a PDF", async () => {
    const h = mixedHarness();
    await run({ h, markdown: MIXED });
    expect(h.calls.filter((call) => call.startsWith("upload:"))).toEqual([
      "upload:hero.png:image/png:3",
      "upload:dpa.pdf:application/pdf:5",
    ]);
  });

  it("reports the block type per attachment, so the report says what it wrote and not just where", async () => {
    const report = await run({ h: mixedHarness(), markdown: MIXED });
    expect(report.attached.map((media) => media.blockType)).toEqual(["image", "pdf"]);
  });

  // The all-or-nothing precheck, on the mismatch a PDF made possible. Nothing is uploaded at all, which
  // is the property: a page half-attached is a page a reader sees mid-edit.
  it("refuses the WHOLE pass, uploading nothing, when one placeholder uses the wrong sigil", async () => {
    const wrong = "## A\n\n![The signed DPA](file:./dpa.pdf)\n\n![The hero shot](file:./shots/hero.png)\n";
    const h = harness({
      blocks: pageWithMarkers({ markdown: wrong }),
      files: {
        "/draft/dpa.pdf": PDF_MAGIC,
        "/draft/shots/hero.png": new Uint8Array([1, 2, 3]),
      },
    });
    const report = await run({ h, markdown: wrong });
    expect(report.attached).toEqual([]);
    expect(report.failures.length).toBe(1);
    expect(report.failures[0]).toContain("renders as a broken image");
    expect(h.calls.filter((call) => call.startsWith("upload:"))).toEqual([]);
  });

  // An extension is a CLAIM about a file. The bytes are the fact, and the read side of this repo already
  // decides from bytes — a `pdf` block holding something else opens as nothing with Notion reporting no
  // error at all, which is the exact silence this whole lane exists to remove.
  it("refuses a file named like a PDF whose bytes are not one, before anything is uploaded", async () => {
    const h = harness({
      blocks: pageWithMarkers({ markdown: MIXED }),
      files: {
        "/draft/dpa.pdf": new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
        "/draft/shots/hero.png": new Uint8Array([1, 2, 3]),
      },
    });
    const report = await run({ h, markdown: MIXED });
    expect(report.attached).toEqual([]);
    expect(report.failures.length).toBe(1);
    expect(report.failures[0]).toContain("does not begin with");
    expect(h.calls.filter((call) => call.startsWith("upload:"))).toEqual([]);
  });

  // The other direction stays ALLOWED, and that asymmetry is the decision rather than an oversight: there
  // is no single magic for twelve image formats, and a wrong image renders visibly broken to its author.
  it("does not sniff an IMAGE placeholder, so an odd-but-named image still attaches", async () => {
    const h = harness({
      blocks: pageWithMarkers({ markdown: MIXED }),
      files: {
        "/draft/dpa.pdf": PDF_MAGIC,
        "/draft/shots/hero.png": new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      },
    });
    const report = await run({ h, markdown: MIXED });
    expect(report.attached.map((media) => media.blockType)).toEqual(["image", "pdf"]);
  });
});

// A marker SURVIVES a pass that did all the work whenever only its deletion failed, so a marker alone
// cannot mean 'the file never landed'. Before this, the re-run attached a second copy of the document.
describe("attachMedia — a marker whose file already landed", () => {
  const ONE = "## A\n\n[The signed DPA](file:./dpa.pdf)\n";
  const PDF_MAGIC = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
  /** The page as a half-failed pass left it: the pdf block inserted, its marker still standing. */
  const midAttach = (): readonly PageBlock[] => [
    ...pageWithMarkers({ markdown: ONE }),
    { hasChildren: false, id: "the-pdf", parentId: PAGE, text: "", type: "pdf" },
  ];
  const resumeHarness = (): ReturnType<typeof harness> =>
    harness({ blocks: midAttach(), files: { "/draft/dpa.pdf": PDF_MAGIC } });

  it("uploads nothing and inserts nothing, because the block after the marker IS the file", async () => {
    const h = resumeHarness();
    const report = await run({ h, markdown: ONE });
    expect(report.attached).toEqual([]);
    expect(report.alreadyAttached).toEqual(["./dpa.pdf"]);
    expect(report.failures).toEqual([]);
    expect(h.calls.filter((call) => call.startsWith("upload:"))).toEqual([]);
    expect(h.calls.filter((call) => call.startsWith("insert:"))).toEqual([]);
  });

  it("clears the leftover marker, which is what makes the re-run the repair", async () => {
    const h = resumeHarness();
    await run({ h, markdown: ONE });
    expect(h.calls.filter((call) => call.startsWith("delete:"))).toEqual(["delete:marker-0"]);
  });

  // The witness that the case above is not passing for some unrelated reason: with the pdf block absent,
  // the same marker and the same file DO drive a real upload and insert.
  it("still attaches when nothing sits after the marker, so the check is the block and not the marker", async () => {
    const h = harness({ blocks: pageWithMarkers({ markdown: ONE }), files: { "/draft/dpa.pdf": PDF_MAGIC } });
    const report = await run({ h, markdown: ONE });
    expect(report.attached.map((media) => media.blockType)).toEqual(["pdf"]);
    expect(h.calls.filter((call) => call.startsWith("upload:"))).toEqual(["upload:dpa.pdf:application/pdf:5"]);
  });

  // A media block under a DIFFERENT parent is not this marker's sibling, so it proves nothing.
  it("ignores a media block that is not the marker's own next sibling", async () => {
    const h = harness({
      blocks: [
        ...pageWithMarkers({ markdown: ONE }),
        { hasChildren: false, id: "elsewhere", parentId: "toggle", text: "", type: "pdf" },
      ],
      files: { "/draft/dpa.pdf": PDF_MAGIC },
    });
    const report = await run({ h, markdown: ONE });
    expect(report.attached.map((media) => media.blockType)).toEqual(["pdf"]);
  });
});

describe("attachMedia — doing nothing, correctly", () => {
  it("touches nothing at all when the body carries no placeholders", async () => {
    const h = harness();
    const report = await run({ h, markdown: "## A\n\njust prose\n" });
    expect(report).toEqual({ alreadyAttached: [], attached: [], failures: [], placeholders: 0 });
    expect(h.calls).toEqual([]);
  });

  it("is a no-op on a second run: an absent marker means the image is already there", async () => {
    const h = harness({ blocks: [{ hasChildren: false, id: "img", parentId: PAGE, text: "", type: "image" }] });
    const report = await run({ h });
    expect(report.alreadyAttached).toEqual(["./shots/hero.png"]);
    expect(report.attached).toEqual([]);
    expect(report.failures).toEqual([]);
    expect(h.calls.some((call) => call.startsWith("upload:"))).toBe(false);
  });
});

describe("attachMedia — refusing before it touches the page", () => {
  it("uploads NOTHING when a file cannot be read, and never even lists the page", async () => {
    const h = harness({ files: {} });
    const report = await run({ h });
    expect(report.attached).toEqual([]);
    expect(report.failures.length).toBe(1);
    expect(report.failures[0]).toContain("cannot read /draft/shots/hero.png");
    expect(h.calls).toEqual(["read:/draft/shots/hero.png"]);
  });

  it("refuses the WHOLE pass when one of two files is unusable, rather than half-editing the page", async () => {
    const markdown = "![a](file:./shots/hero.png)\n\n![b](file:./notes.pdf)\n";
    const h = harness({
      blocks: pageWithMarkers({ markdown }),
      files: { "/draft/notes.pdf": new Uint8Array([9]), "/draft/shots/hero.png": new Uint8Array([1]) },
    });
    const report = await run({ h, markdown });
    expect(report.attached).toEqual([]);
    expect(report.failures.length).toBe(1);
    expect(h.calls.some((call) => call.startsWith("upload:"))).toBe(false);
  });

  it("names the placeholder's line in a file refusal, so an operator can find it", async () => {
    const report = await run({ h: harness({ files: {} }) });
    expect(report.failures[0]).toContain("line 3:");
  });

  it("reports a page it cannot read as one failure, and uploads nothing", async () => {
    const h = harness({ list: "fail" });
    const report = await run({ h });
    expect(report.failures.length).toBe(1);
    expect(report.failures[0]).toContain("socket hang up");
    expect(h.calls.some((call) => call.startsWith("upload:"))).toBe(false);
  });
});

describe("attachMedia — one failure does not sink the batch", () => {
  const markdown = "![a](file:./a.png)\n\nmid\n\n![b](file:./b.png)\n";
  const files = { "/draft/a.png": new Uint8Array([1]), "/draft/b.png": new Uint8Array([2, 2]) };

  it("keeps the marker of a failed insert, so re-running attaches exactly that one", async () => {
    const h = harness({ blocks: pageWithMarkers({ markdown }), files, insert: "fail" });
    const report = await run({ h, markdown });
    expect(report.attached).toEqual([]);
    expect(report.failures.length).toBe(2);
    expect(h.calls.some((call) => call.startsWith("delete:"))).toBe(false);
  });

  it("reports an upload failure per item and still attempts the next one", async () => {
    const h = harness({ blocks: pageWithMarkers({ markdown }), files, upload: "fail" });
    const report = await run({ h, markdown });
    expect(report.failures.length).toBe(2);
    expect(h.calls.filter((call) => call.startsWith("upload:")).length).toBe(2);
  });

  it("counts an image whose marker could not be removed as attached-but-reported, never as lost", async () => {
    const h = harness({ remove: "fail" });
    const report = await run({ h });
    expect(report.attached).toEqual([]);
    expect(report.failures.length).toBe(1);
    expect(report.failures[0]).toContain("could not be removed");
  });
});

describe("attachMedia — markers nested inside a toggle", () => {
  it("descends into a block with children and addresses the insert to that block, not the page", async () => {
    const ids = idsOf({ markdown: BODY });
    const h = harness({
      blocks: [
        { hasChildren: true, id: "toggle", parentId: PAGE, text: "Appendix", type: "toggle" },
        {
          hasChildren: false,
          id: "inner",
          parentId: "toggle",
          text: placeholderMarker({ id: ids[0]! }),
          type: "paragraph",
        },
      ],
    });
    // The fake only answers for the page itself, so re-point it at the toggle's children for this case.
    const api: NotionMediaApi = {
      ...h.api,
      listChildren: ({ parentId }) =>
        Promise.resolve(
          ok({
            blocks:
              parentId === PAGE
                ? [{ hasChildren: true, id: "toggle", parentId: PAGE, text: "Appendix", type: "toggle" }]
                : [
                    {
                      hasChildren: false,
                      id: "inner",
                      parentId: "toggle",
                      text: placeholderMarker({ id: ids[0]! }),
                      type: "paragraph",
                    },
                  ],
            nextCursor: undefined,
          }),
        ),
    };
    const report = await attachMedia({
      api,
      baseDir: "/draft",
      markdown: BODY,
      pageId: PAGE,
      readMedia: h.readMedia,
    });
    expect(report.attached.length).toBe(1);
    expect(h.calls).toContain("insert:image:toggle:inner:upload-hero.png:The hero shot");
  });
});

describe("attachReportLines", () => {
  it("says nothing at all for a body with no placeholders", () => {
    expect(attachReportLines({ report: { alreadyAttached: [], attached: [], failures: [], placeholders: 0 } })).toEqual(
      [],
    );
  });

  it("counts every arm on one line, then itemises them", () => {
    const lines = attachReportLines({
      report: {
        alreadyAttached: ["./b.png"],
        attached: [
          {
            blockId: "blk",
            blockType: "pdf",
            bytes: 7,
            fileUploadId: "up",
            placeholderId: "0123456789abcdef",
            source: "./dpa.pdf",
          },
        ],
        failures: ["line 9: nope"],
        placeholders: 3,
      },
    });
    expect(lines[0]).toBe("files: 1 attached, 1 already in place, 1 failed, of 3 placeholder(s)");
    expect(lines[1]).toBe("  + ./dpa.pdf → pdf block blk (7 bytes)");
    expect(lines[3]).toBe("  ! line 9: nope");
  });
});
