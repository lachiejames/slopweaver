/**
 * Turning a PDF's bytes into the text a session can read — the ONE extractor every door's attachment
 * reaches, whichever provider served it.
 *
 * ## Why it is provider-neutral
 *
 * Nothing about reading a PDF is Vanta-shaped, or Slack-shaped. An extractor reachable from only one
 * provider's code leaves every other door holding bytes it cannot read — MEASURED when
 * `slack read-file` downloaded a 321,706-byte pentest report and left `text` undefined, and `slack
 * read-thread` reported a `localPath` and nothing else. So this sits above every provider and each one
 * injects it: the Vanta walk as `VantaDocumentExtract` (`../atlas/vanta/policyDocuments.ts`), the Slack
 * read lanes directly.
 *
 * `../policy/render/extract.ts` is a DIFFERENT extraction and stays where it is: `policy render`'s read-back
 * groups each run into a line by its POSITION — its `x` and its height — and this module deliberately throws
 * all of that away. Its own header carries the argument.
 *
 * ## Line breaks come from the layout, not from spacing
 *
 * `pdfjs` emits one item per run of glyphs, so joining items with a space produces `"E ff ective Date"` and
 * `"Classi fi cation"` wherever the font used a ligature — measured on this tenant's Human Resource
 * Security Policy. Joining on `hasEOL` instead reproduces `"Effective Date"` and `"Classification"`, and it
 * is the reason this walks items rather than concatenating `str` values.
 *
 * ## A document that extracts to nothing is NOT an empty document
 *
 * A scanned report, a signed policy photographed into a page, an invoice exported as an image — every one
 * of them is a valid PDF with no text layer, and every one extracts to `""`. Rendered as an empty `text`
 * field that is indistinguishable from a blank page, and a reader concludes the document said nothing. So
 * {@link PdfExtraction} carries {@link PdfExtraction.glyphless} and every renderer in this repo prints
 * `GLYPHLESS_LINE` (`./limits.ts`) rather than an empty body. This module does no OCR and never guesses at pixels;
 * it says it could not read them.
 */
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

import { errorMessage } from "../lib/errorMessage.js";
import { isRecord } from "../lib/parsers.js";
import { err, ok, type Result } from "../lib/result.js";
import { PDF_BYTES_MAX, PDF_PAGES_DEFAULT } from "./limits.js";

/** The five bytes every PDF begins with. */
const PDF_MAGIC = "%PDF-";

/** What one extraction yielded. */
export interface PdfExtraction {
  /** How many pages the document declares. */
  readonly pages: number;
  /** How many of them this call actually read — below {@link pages} when the page cap bit. */
  readonly pagesRead: number;
  /** The laid-out text of the pages read, one line per laid-out line. */
  readonly text: string;
  /**
   * True when pages were read and every one of them yielded no glyphs. The witness that separates "this
   * document is blank" from "this document has no text layer" — see this module's header.
   */
  readonly glyphless: boolean;
}

/**
 * Whether these bytes are a PDF, judged on the file's own magic rather than on a served header.
 *
 * A presigned storage URL's `content-type` is set at upload time by whoever uploaded it, and Slack reports
 * a mimetype an uploader chose, so neither is evidence about the bytes.
 *
 * @param bytes the document's exact bytes
 * @returns whether the bytes begin with a PDF header
 */
export function isPdf({ bytes }: { bytes: Uint8Array }): boolean {
  if (bytes.byteLength < PDF_MAGIC.length) {
    return false;
  }
  return Buffer.from(bytes.subarray(0, PDF_MAGIC.length)).toString("latin1") === PDF_MAGIC;
}

/**
 * Every laid-out line of one page, joined on the layout's own EOL markers.
 *
 * Separate from {@link extractPdfText} because the two branches it carries — an item with no `str`, and a
 * run that ends a line — are the whole reason a single-function version scored over this repository's
 * cognitive-complexity ceiling.
 *
 * @param items the text runs `pdfjs` emits for one page, in reading order
 * @returns the page's lines, in order
 */
function pageLines({ items }: { items: readonly unknown[] }): readonly string[] {
  const lines: string[] = [];
  let line = "";
  for (const item of items) {
    if (!isRecord(item) || typeof item["str"] !== "string") {
      continue;
    }
    line += item["str"];
    if (item["hasEOL"] === true) {
      lines.push(line);
      line = "";
    }
  }
  if (line.length > 0) {
    lines.push(line);
  }
  return lines;
}

/**
 * Extract a PDF's text, one line per laid-out line.
 *
 * @param bytes the document's exact bytes; the caller's own copy is left intact
 * @param maxPages stop after this many pages
 * @returns the page counts, the text and the glyphless witness, or why the document could not be read
 */
export async function extractPdfText({
  bytes,
  maxPages = PDF_PAGES_DEFAULT,
}: {
  bytes: Uint8Array;
  maxPages?: number;
}): Promise<Result<PdfExtraction>> {
  if (!isPdf({ bytes })) {
    return err(["these bytes are not a PDF: they do not begin with %PDF-"]);
  }
  if (bytes.byteLength > PDF_BYTES_MAX) {
    return err([
      `this PDF is ${String(bytes.byteLength)} bytes, past the ${String(PDF_BYTES_MAX)}-byte ceiling this reader holds in memory`,
    ]);
  }
  try {
    // `data` is consumed (and detached) by pdfjs, so the caller's own copy stays usable for the artifact.
    const document = await getDocument({ data: Uint8Array.from(bytes), useSystemFonts: true }).promise;
    const pagesRead = Math.min(document.numPages, maxPages);
    const lines: string[] = [];
    for (let pageNumber = 1; pageNumber <= pagesRead; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      lines.push(...pageLines({ items: content.items }), "");
    }
    const text = lines.join("\n").trimEnd();
    return ok({ glyphless: pagesRead > 0 && text.trim() === "", pages: document.numPages, pagesRead, text });
  } catch (error: unknown) {
    return err([`could not extract text from this PDF: ${errorMessage({ error })}`]);
  }
}
