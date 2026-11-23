/**
 * The probe document, round-tripped through the same two libraries the shipped verbs use.
 *
 * `pdf check` asks whether this host can do PDFs at all, and it answers by writing one and reading it back.
 * That claim is only worth anything if the write half really produces a document the read half resolves, so
 * this test is that round trip rather than an assertion about bytes: `pdf-lib` builds, `pdfjs` extracts, and
 * the phrase that went in comes back out.
 */
import { describe, expect, it } from "vitest";

import { unwrap } from "../../../lib/result.js";
import { buildPdfProbe, PDF_PROBE_PHRASE } from "../../../pdf/probe.js";
import { extractPdfText, isPdf } from "../../../pdf/text.js";

describe("buildPdfProbe", () => {
  it("writes a real PDF, judged on the file's own magic", async () => {
    const bytes = unwrap(await buildPdfProbe());
    expect(isPdf({ bytes })).toBe(true);
  });

  it("carries a text layer the extractor reads the phrase back out of", async () => {
    const bytes = unwrap(await buildPdfProbe());
    const extraction = unwrap(await extractPdfText({ bytes }));
    expect(extraction.pages).toBe(1);
    expect(extraction.pagesRead).toBe(1);
    expect(extraction.glyphless).toBe(false);
    expect(extraction.text).toContain(PDF_PROBE_PHRASE);
  });

  it("names the check it is built for, so the assertion and the drawn text cannot drift", () => {
    expect(PDF_PROBE_PHRASE).toBe("slopweaver pdf check");
  });
});
