/**
 * Opening the files a Notion read addresses — a row's `files` properties and the slice's blocks, the four
 * outcomes, and the rule that none of them ends the read.
 *
 * Driven over the committed PDF fixtures through the real `openNotionAssets`, with the HTTP seam supplied
 * as a plain fake function (`testing.md` bans a mock; a seam passed in is not one). That fake answers the
 * ranged sizing probe and the full download separately, because the module's ceiling is enforced on the
 * PROBE and a fake that ignored the distinction would prove nothing about it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { AttachmentTransport } from "../../../../corpus/notion/attachmentFetch.js";
import { openNotionAssets } from "../../../../live/notion/assetDocuments.js";

const HOSTED = "https://prod-files-secure.s3.us-west-2.amazonaws.com/ff0ccd01/report.pdf?X-Amz-Signature=abc";

/** The one-page fixture with a real text layer. */
const TEXT_SAMPLE = join(import.meta.dirname, "../../../fixtures/pdf/text-sample.pdf");

/** The two-page fixture drawn without a font, so it has no text layer at all. */
const SCANNED_SAMPLE = join(import.meta.dirname, "../../../fixtures/pdf/scanned-sample.pdf");

/** The residue line every `--pdf` read opens with, naming where it looked. */
const OPENED_FROM =
  "files were opened from the page's own properties and every block this slice returned, nested ones included";

/** A page whose properties carry no file at all, so a case is about its blocks alone. */
const NO_FILE_PROPERTIES = { object: "page", properties: { Name: { title: [], type: "title" } } };

/** One raw pdf block of the shape `blocks.children.list` returns. */
const ONE_PDF = [{ object: "block", pdf: { file: { url: HOSTED } }, type: "pdf" }];

/** A transport that probes honestly and then serves these exact bytes. */
function serving({ bytes }: { bytes: Buffer }): AttachmentTransport {
  return ({ rangeBytes }) => {
    if (rangeBytes === undefined) {
      return Promise.resolve({
        body: bytes,
        contentRange: null,
        contentType: "application/pdf",
        ok: true,
        status: 200,
      });
    }
    return Promise.resolve({
      contentRange: `bytes 0-1023/${String(bytes.byteLength)}`,
      contentType: "application/pdf",
      ok: true,
      status: 206,
    });
  };
}

/** A transport serving one committed fixture. */
function servingFixture({ fixture }: { fixture: string }): AttachmentTransport {
  return serving({ bytes: readFileSync(fixture) });
}

describe("openNotionAssets — the four outcomes", () => {
  it("carries a document's words and its page count", async () => {
    const opened = await openNotionAssets({
      blocks: ONE_PDF,
      page: NO_FILE_PROPERTIES,
      scopeId: "notion:test",
      transport: servingFixture({ fixture: TEXT_SAMPLE }),
    });
    expect(opened.attachments).toEqual([
      {
        bytes: 600,
        outcome: "read",
        pdf: { glyphless: false, pages: 1, pagesRead: 1, text: "personnel and contractors" },
        url: HOSTED,
      },
    ]);
    expect(opened.residue).toEqual([OPENED_FROM]);
  });

  it("says a scanned document has no text layer rather than reporting an empty one", async () => {
    const opened = await openNotionAssets({
      blocks: ONE_PDF,
      page: NO_FILE_PROPERTIES,
      scopeId: "notion:test",
      transport: servingFixture({ fixture: SCANNED_SAMPLE }),
    });
    expect(opened.attachments[0]!).toEqual({
      bytes: 588,
      outcome: "read",
      pdf: { glyphless: true, pages: 2, pagesRead: 2, text: undefined },
      url: HOSTED,
    });
  });

  it("reports a file that is not a document as a fact, not a failure", async () => {
    const opened = await openNotionAssets({
      blocks: ONE_PDF,
      page: NO_FILE_PROPERTIES,
      scopeId: "notion:test",
      transport: serving({ bytes: Buffer.from("a screen recording, not a document") }),
    });
    expect(opened.attachments).toEqual([{ bytes: 34, outcome: "not-a-document", url: HOSTED }]);
    expect(opened.residue).toEqual([OPENED_FROM]);
  });

  it("keeps the byte count when bytes arrive and will not parse, and names the reason", async () => {
    const opened = await openNotionAssets({
      blocks: ONE_PDF,
      page: NO_FILE_PROPERTIES,
      scopeId: "notion:test",
      transport: serving({ bytes: Buffer.from("%PDF-1.4\nnot actually a pdf body\n") }),
    });
    expect(opened.attachments[0]!.outcome).toBe("unreadable");
    expect(opened.attachments[0]!).toMatchObject({ bytes: 33, url: HOSTED });
    expect(opened.residue[1]!).toContain("bytes retrieved, text not");
  });

  it("names a file that never arrived, and does not end the read", async () => {
    const opened = await openNotionAssets({
      blocks: ONE_PDF,
      page: NO_FILE_PROPERTIES,
      scopeId: "notion:test",
      transport: () => Promise.resolve({ contentRange: null, contentType: null, ok: false, status: 403 }),
    });
    expect(opened.attachments).toEqual([{ outcome: "unfetched", reason: "ranged probe returned 403", url: HOSTED }]);
    expect(opened.residue[1]!).toContain("not fetched");
  });

  it("refuses on the PROBE's total, before the file is read", async () => {
    const opened = await openNotionAssets({
      blocks: ONE_PDF,
      page: NO_FILE_PROPERTIES,
      scopeId: "notion:test",
      transport: ({ rangeBytes }) => {
        expect(rangeBytes).toBe(1024);
        return Promise.resolve({
          contentRange: "bytes 0-1023/99999999999",
          contentType: "application/pdf",
          ok: true,
          status: 206,
        });
      },
    });
    expect(opened.attachments[0]!.outcome).toBe("unfetched");
    expect(opened.residue[1]!).toContain("past the 67108864-byte ceiling");
  });

  it("says so when the probe reports no total at all", async () => {
    const opened = await openNotionAssets({
      blocks: ONE_PDF,
      page: NO_FILE_PROPERTIES,
      scopeId: "notion:test",
      transport: () => Promise.resolve({ contentRange: null, contentType: "application/pdf", ok: true, status: 200 }),
    });
    expect(opened.attachments[0]!).toEqual({
      outcome: "unfetched",
      reason: "the ranged probe reported no total, so the ceiling could not be enforced without reading it first",
      url: HOSTED,
    });
  });

  it("names an off-host PROPERTY entry without calling it a block, which would send a reader to the body", async () => {
    const opened = await openNotionAssets({
      blocks: [],
      page: {
        object: "page",
        properties: {
          CV: {
            files: [{ external: { url: "https://drive.google.com/file/d/abc" }, type: "external" }],
            type: "files",
          },
        },
      },
      scopeId: "notion:test",
      transport: servingFixture({ fixture: TEXT_SAMPLE }),
    });
    expect(opened.attachments).toEqual([]);
    expect(opened.residue[1]!).toBe("1 file reference(s) point at another site and were left alone, never fetched");
  });

  it("names the off-host blocks it left alone rather than passing over them silently", async () => {
    const opened = await openNotionAssets({
      blocks: [{ object: "block", type: "video", video: { file: { url: "https://vimeo.com/12345" } } }],
      page: NO_FILE_PROPERTIES,
      scopeId: "notion:test",
      transport: servingFixture({ fixture: TEXT_SAMPLE }),
    });
    expect(opened.attachments).toEqual([]);
    expect(opened.residue[1]!).toBe("1 file reference(s) point at another site and were left alone, never fetched");
  });

  it("carries the words off a database row's own `files` property, where there is no block at all", async () => {
    const opened = await openNotionAssets({
      blocks: [],
      page: {
        object: "page",
        properties: { CV: { files: [{ file: { url: HOSTED }, name: "cv.pdf", type: "file" }], type: "files" } },
      },
      scopeId: "notion:test",
      transport: servingFixture({ fixture: TEXT_SAMPLE }),
    });
    expect(opened.attachments).toEqual([
      {
        bytes: 600,
        outcome: "read",
        pdf: { glyphless: false, pages: 1, pagesRead: 1, text: "personnel and contractors" },
        url: HOSTED,
      },
    ]);
  });

  it("opens nothing for a slice that addresses no file, and still says where it looked", async () => {
    const opened = await openNotionAssets({
      blocks: [{ object: "block", paragraph: { rich_text: [] }, type: "paragraph" }],
      page: NO_FILE_PROPERTIES,
      scopeId: "notion:test",
      transport: servingFixture({ fixture: TEXT_SAMPLE }),
    });
    expect(opened.attachments).toEqual([]);
    expect(opened.residue).toEqual([OPENED_FROM]);
  });
});
