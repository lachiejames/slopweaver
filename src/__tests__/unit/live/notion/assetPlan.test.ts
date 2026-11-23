/**
 * Which files a Notion read addresses — the pure discovery half of `notion read --pdf`.
 *
 * Two cases carry the most weight. The **property** one, because a database row keeps its attachments on a
 * `files` property and has no blocks at all: measured, a block-only planner found a file on 1
 * of 40 real pdf-bearing pages. And the **off-host** one, because a file block pointing at somebody else's
 * site is the largest group in the workspace, and fetching those would spend the read on a video host's
 * content rather than the page's own.
 */
import { describe, expect, it } from "vitest";

import { planNotionAssets } from "../../../../live/notion/assetPlan.js";

const HOSTED = "https://prod-files-secure.s3.us-west-2.amazonaws.com/ff0ccd01/report.pdf?X-Amz-Signature=abc";
const OTHER_HOSTED = "https://prod-files-secure.s3.us-west-2.amazonaws.com/ff0ccd01/second.pdf?X-Amz-Signature=def";

/** A page whose properties carry no file, so a case is about its blocks alone. */
const NO_FILES = { object: "page", properties: { Name: { title: [], type: "title" } } };

/** One raw block of the shape `blocks.children.list` returns, carrying a signed url. */
function fileBlock({ type, url }: { type: string; url: string }): Record<string, unknown> {
  return { [type]: { file: { url } }, object: "block", type };
}

/** A page carrying one `files` property, the shape a database row keeps a CV or a signed form on. */
function pageWithFileProperty({ name, entry }: { name: string; entry: unknown }): Record<string, unknown> {
  return { object: "page", properties: { [name]: { files: [entry], id: "TXsG", type: "files" } } };
}

describe("planNotionAssets — the block half", () => {
  it("finds the signed url on a pdf block", () => {
    const planned = planNotionAssets({ blocks: [fileBlock({ type: "pdf", url: HOSTED })], max: 10, page: NO_FILES });
    expect(planned).toEqual({ external: 0, found: 1, urls: [HOSTED] });
  });

  it("reads every one of the five file block types, not just pdf", () => {
    const blocks = ["audio", "file", "image", "pdf", "video"].map((type) => fileBlock({ type, url: HOSTED }));
    expect(planNotionAssets({ blocks, max: 10, page: NO_FILES })).toEqual({ external: 0, found: 1, urls: [HOSTED] });
  });

  it("COUNTS an author's link to another site and never returns it for fetching", () => {
    const planned = planNotionAssets({
      blocks: [{ object: "block", type: "video", video: { file: { url: "https://vimeo.com/12345" } } }],
      max: 10,
      page: NO_FILES,
    });
    expect(planned).toEqual({ external: 1, found: 0, urls: [] });
  });

  it("refuses a lookalike host, which a substring test would have let through", () => {
    const planned = planNotionAssets({
      blocks: [fileBlock({ type: "pdf", url: "https://notion.so.evil.test/x.pdf" })],
      max: 10,
      page: NO_FILES,
    });
    expect(planned).toEqual({ external: 1, found: 0, urls: [] });
  });

  it("ignores a paragraph block, which addresses no file at all", () => {
    const planned = planNotionAssets({
      blocks: [{ object: "block", paragraph: { rich_text: [] }, type: "paragraph" }],
      max: 10,
      page: NO_FILES,
    });
    expect(planned).toEqual({ external: 0, found: 0, urls: [] });
  });

  it("walks a slice carrying nulls and strings without tripping over either", () => {
    const blocks = [null, "not a block", fileBlock({ type: "pdf", url: HOSTED })];
    expect(planNotionAssets({ blocks, max: 10, page: NO_FILES }).urls).toEqual([HOSTED]);
  });
});

describe("planNotionAssets — the page-property half", () => {
  it("finds a file a database row keeps on its own `files` property, with no block anywhere", () => {
    const planned = planNotionAssets({
      blocks: [],
      max: 10,
      page: pageWithFileProperty({ entry: { file: { url: HOSTED }, name: "cv.pdf", type: "file" }, name: "CV" }),
    });
    expect(planned).toEqual({ external: 0, found: 1, urls: [HOSTED] });
  });

  it("classifies a property entry an author linked elsewhere as external, never fetching it", () => {
    const planned = planNotionAssets({
      blocks: [],
      max: 10,
      page: pageWithFileProperty({
        entry: { external: { url: "https://drive.google.com/file/d/abc" }, name: "cv", type: "external" },
        name: "CV",
      }),
    });
    expect(planned).toEqual({ external: 1, found: 0, urls: [] });
  });

  it("leaves a page's cover alone — chrome, not an attachment", () => {
    const planned = planNotionAssets({
      blocks: [],
      max: 10,
      page: { cover: { file: { url: HOSTED }, type: "file" }, object: "page", properties: {} },
    });
    expect(planned).toEqual({ external: 0, found: 0, urls: [] });
  });

  it("reads a property's files before the slice's blocks, so a reader meets the row's own first", () => {
    const planned = planNotionAssets({
      blocks: [fileBlock({ type: "pdf", url: OTHER_HOSTED })],
      max: 10,
      page: pageWithFileProperty({ entry: { file: { url: HOSTED }, name: "cv.pdf", type: "file" }, name: "CV" }),
    });
    expect(planned.urls).toEqual([HOSTED, OTHER_HOSTED]);
  });

  it("counts one file once when a property and a block address it", () => {
    const planned = planNotionAssets({
      blocks: [fileBlock({ type: "pdf", url: HOSTED })],
      max: 10,
      page: pageWithFileProperty({ entry: { file: { url: HOSTED }, name: "cv.pdf", type: "file" }, name: "CV" }),
    });
    expect(planned).toEqual({ external: 0, found: 1, urls: [HOSTED] });
  });
});

describe("planNotionAssets — bounds", () => {
  it("caps what it returns in the page's own order and still reports how many there were", () => {
    const planned = planNotionAssets({
      blocks: [fileBlock({ type: "pdf", url: HOSTED }), fileBlock({ type: "pdf", url: OTHER_HOSTED })],
      max: 1,
      page: NO_FILES,
    });
    expect(planned).toEqual({ external: 0, found: 2, urls: [HOSTED] });
  });

  it("answers empty for an empty read", () => {
    expect(planNotionAssets({ blocks: [], max: 10, page: NO_FILES })).toEqual({ external: 0, found: 0, urls: [] });
  });

  it("answers empty when the page is not an object at all", () => {
    expect(planNotionAssets({ blocks: [], max: 10, page: undefined })).toEqual({ external: 0, found: 0, urls: [] });
  });
});
