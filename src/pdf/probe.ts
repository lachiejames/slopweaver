/**
 * The document `slopweaver pdf check` writes and reads back, so the scope check answers for a real
 * extraction rather than for a module having imported.
 *
 * ## Why it is BUILT rather than carried as a base64 literal
 *
 * Because of what the check claims. This install renders PDFs as well as reading them — `policy render`
 * and `write vanta upload-policy-version` both go through `pdf-lib` — so a check that exercises both
 * halves of the stack is the honest reading of "can this host do PDFs at all". A hand-assembled literal
 * without an xref table also makes pdfjs print `Indexing all PDF objects` on every run, which is noise on
 * a verb whose whole job is to be quiet.
 *
 * It lives here rather than beside the verb because the subject is a PDF, not a command line.
 */
import { PDFDocument, StandardFonts } from "pdf-lib";

import { errorMessage } from "../lib/errorMessage.js";
import { err, ok, type Result } from "../lib/result.js";

/**
 * The words the probe document carries.
 *
 * `pdf check` asserts on THIS rather than on "the text was not empty": an extractor that answered
 * whitespace for every document would pass a non-empty check and then report every real attachment blank.
 */
export const PDF_PROBE_PHRASE = "slopweaver pdf check";

/** The probe page's geometry and type size. Arbitrary and irrelevant to the result; named, never inline. */
const PROBE_PAGE = { fontSize: 12, height: 100, textX: 20, textY: 50, width: 200 } as const;

/**
 * Build the one-page document the scope check reads back.
 *
 * @returns the document's bytes, or why this host could not build one
 */
export async function buildPdfProbe(): Promise<Result<Uint8Array>> {
  try {
    const document = await PDFDocument.create();
    const font = await document.embedFont(StandardFonts.Helvetica);
    const page = document.addPage([PROBE_PAGE.width, PROBE_PAGE.height]);
    page.drawText(PDF_PROBE_PHRASE, { font, size: PROBE_PAGE.fontSize, x: PROBE_PAGE.textX, y: PROBE_PAGE.textY });
    // `useObjectStreams: false` keeps the xref a plain table, which is what a reader with no compressed
    // object-stream support can still resolve — the probe must fail for the host's reasons, not for ours.
    return ok(await document.save({ useObjectStreams: false }));
  } catch (error: unknown) {
    return err([`could not build a probe PDF on this host: ${errorMessage({ error })}`]);
  }
}
