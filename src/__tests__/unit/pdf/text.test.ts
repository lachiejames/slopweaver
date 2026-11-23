import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { unwrap } from "../../../lib/result.js";
import { PDF_BYTES_MAX } from "../../../pdf/limits.js";
import { extractPdfText, isPdf } from "../../../pdf/text.js";

/** A minimal, valid one-page PDF carrying one text run — committed so this needs no network. */
const TEXT_SAMPLE = join(import.meta.dirname, "../../fixtures/pdf/text-sample.pdf");

/**
 * A two-page PDF of drawn rectangles and no font at all — what a scanner produces. Committed because the
 * glyphless arm cannot be proved against a document that merely happens to be empty.
 */
const SCANNED_SAMPLE = join(import.meta.dirname, "../../fixtures/pdf/scanned-sample.pdf");

describe("isPdf", () => {
  it("accepts bytes beginning with the PDF header", () => {
    expect(isPdf({ bytes: new TextEncoder().encode("%PDF-1.4\n") })).toBe(true);
  });

  it("rejects bytes that merely contain it later", () => {
    expect(isPdf({ bytes: new TextEncoder().encode("not a %PDF-1.4") })).toBe(false);
  });

  it("rejects bytes shorter than the header", () => {
    expect(isPdf({ bytes: new Uint8Array([37, 80]) })).toBe(false);
  });

  it("rejects an empty document", () => {
    expect(isPdf({ bytes: new Uint8Array([]) })).toBe(false);
  });
});

describe("extractPdfText", () => {
  it("refuses bytes that are not a PDF rather than answering plausible nonsense", async () => {
    const result = await extractPdfText({ bytes: new TextEncoder().encode("# a markdown file") });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()[0]).toBe("these bytes are not a PDF: they do not begin with %PDF-");
  });

  it("extracts a page's text from a real PDF", async () => {
    const result = await extractPdfText({ bytes: new Uint8Array(readFileSync(TEXT_SAMPLE)) });
    const extracted = unwrap(result);
    expect(extracted.pages).toBe(1);
    expect(extracted.pagesRead).toBe(1);
    expect(extracted.text).toContain("contractors");
  });

  it("leaves the caller's own bytes intact, so the artifact can still be written", async () => {
    const bytes = new Uint8Array(readFileSync(TEXT_SAMPLE));
    const before = bytes.byteLength;
    await extractPdfText({ bytes });
    expect(bytes.byteLength).toBe(before);
  });

  it("reports a truncated PDF rather than throwing", async () => {
    const result = await extractPdfText({ bytes: new TextEncoder().encode("%PDF-1.4\ntruncated") });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()[0]).toContain("could not extract text");
  });

  it("refuses a document past the in-memory ceiling before pdfjs is asked to parse it", async () => {
    const bytes = new Uint8Array(PDF_BYTES_MAX + 1);
    bytes.set(new TextEncoder().encode("%PDF-"), 0);
    const result = await extractPdfText({ bytes });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()[0]).toContain(`past the ${String(PDF_BYTES_MAX)}-byte ceiling`);
  });

  it("calls a page-bearing document with no text layer glyphless, rather than answering an empty body", async () => {
    const result = await extractPdfText({ bytes: new Uint8Array(readFileSync(SCANNED_SAMPLE)) });
    const extracted = unwrap(result);
    expect(extracted.pages).toBe(2);
    expect(extracted.pagesRead).toBe(2);
    expect(extracted.text).toBe("");
    expect(extracted.glyphless).toBe(true);
  });

  it("does NOT call a document with real text glyphless — the other half of that witness", async () => {
    const result = await extractPdfText({ bytes: new Uint8Array(readFileSync(TEXT_SAMPLE)) });
    expect(unwrap(result).glyphless).toBe(false);
  });

  it("stops at the page cap and reports the pages it did not read", async () => {
    const result = await extractPdfText({ bytes: new Uint8Array(readFileSync(SCANNED_SAMPLE)), maxPages: 1 });
    const extracted = unwrap(result);
    expect(extracted.pages).toBe(2);
    expect(extracted.pagesRead).toBe(1);
  });
});
