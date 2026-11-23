/**
 * The one call every door makes after its own download — over the two committed fixtures, a file that is
 * not a PDF at all, and a path that is not there.
 *
 * The non-PDF case is the one worth naming: it must answer "not a PDF" rather than an error, because every
 * provider here serves images and videos through the same attachment lane, and a door that treated "this is
 * a PNG" as a failure would report a limitation on every screenshot in a thread.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { unwrap } from "../../../lib/result.js";
import { pdfAttachmentAt } from "../../../pdf/attachment.js";

/** The one-page document with a real text layer. */
const TEXT_SAMPLE = join(import.meta.dirname, "../../fixtures/pdf/text-sample.pdf");

/** The two-page document drawn as rectangles, with no font and therefore no text layer. */
const SCANNED_SAMPLE = join(import.meta.dirname, "../../fixtures/pdf/scanned-sample.pdf");

const minted: string[] = [];

/** A throwaway directory inside this file's own sandbox. */
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "pdf-attachment-"));
  minted.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of minted.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe("pdfAttachmentAt", () => {
  it("extracts a PDF's words and its page count", async () => {
    const attachment = unwrap(await pdfAttachmentAt({ localPath: TEXT_SAMPLE }))!;
    expect(attachment.pages).toBe(1);
    expect(attachment.pagesRead).toBe(1);
    expect(attachment.glyphless).toBe(false);
    expect(attachment.text).toContain("personnel and contractors");
  });

  it("reports a scanned document as glyphless and carries no text at all", async () => {
    const attachment = unwrap(await pdfAttachmentAt({ localPath: SCANNED_SAMPLE }))!;
    expect(attachment.pages).toBe(2);
    expect(attachment.glyphless).toBe(true);
    // Deliberately `undefined` rather than "": a renderer printing an empty string under a two-page
    // heading says the document was blank, which is the one thing this read must never claim.
    expect(attachment.text).toBe(undefined);
  });

  it("answers `undefined` for a file that is not a PDF, rather than failing", async () => {
    const path = join(tempDir(), "screenshot.png");
    writeFileSync(path, "\u0089PNG\r\n\u001a\nnot a pdf");
    expect(unwrap(await pdfAttachmentAt({ localPath: path }))).toBe(undefined);
  });

  it("judges the bytes, not the extension — a .pdf name over PNG bytes is not a PDF", async () => {
    const path = join(tempDir(), "report.pdf");
    writeFileSync(path, "\u0089PNG\r\n\u001a\nstill not a pdf");
    expect(unwrap(await pdfAttachmentAt({ localPath: path }))).toBe(undefined);
  });

  it("answers `undefined` for an empty file, which cannot carry the magic", async () => {
    const path = join(tempDir(), "empty.pdf");
    writeFileSync(path, "");
    expect(unwrap(await pdfAttachmentAt({ localPath: path }))).toBe(undefined);
  });

  it("names the path when there is no file there", async () => {
    const path = join(tempDir(), "gone.pdf");
    const attachment = await pdfAttachmentAt({ localPath: path });
    expect(attachment.isErr()).toBe(true);
    expect(attachment._unsafeUnwrapErr().join(" ")).toContain("gone.pdf");
  });

  it("refuses bytes that begin with the magic but are not a readable document", async () => {
    const path = join(tempDir(), "truncated.pdf");
    writeFileSync(path, "%PDF-1.7\nand then nothing that resolves");
    const attachment = await pdfAttachmentAt({ localPath: path });
    expect(attachment.isErr()).toBe(true);
    expect(attachment._unsafeUnwrapErr().join(" ")).toContain("could not extract text");
  });
});
