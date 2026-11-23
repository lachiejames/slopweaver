/**
 * `policyRunsFromPdf`'s two refusals: bytes that are not a PDF never reach `pdfjs`, and bytes that claim to be
 * one but cannot be parsed come back as a typed `PDF_UNREADABLE` carrying the domain prefix rather than a throw.
 * The successful item-normalisation path needs a real document and is not exercised here.
 */
import { describe, expect, it } from "vitest";

import { unwrapErr } from "../../../lib/result.js";
import { PolicyExtractErrors } from "../../../policy/render/errors.js";
import { policyRunsFromPdf } from "../../../policy/render/extract.js";

describe("policyRunsFromPdf", () => {
  it("refuses bytes that do not begin with %PDF-, naming the missing header", async () => {
    const read = await policyRunsFromPdf({ bytes: new TextEncoder().encode("# a markdown policy\n") });

    expect(unwrapErr(read)).toEqual(PolicyExtractErrors.notAPdf());
    expect(unwrapErr(read).message).toBe("these bytes are not a PDF: they do not begin with %PDF-");
  });

  it("refuses an empty buffer as not a PDF", async () => {
    const read = await policyRunsFromPdf({ bytes: new Uint8Array(0) });

    expect(unwrapErr(read).code).toBe("NOT_A_PDF");
  });

  it("turns a pdfjs parse failure on a corrupt %PDF- document into PDF_UNREADABLE with the domain prefix", async () => {
    const read = await policyRunsFromPdf({ bytes: new TextEncoder().encode("%PDF-1.7\nthis is not a document\n") });

    const error = unwrapErr(read);
    expect(error.code).toBe("PDF_UNREADABLE");
    expect(error.message.startsWith("could not read this policy PDF: ")).toBe(true);
  });
});
