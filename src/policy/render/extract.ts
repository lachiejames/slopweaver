/**
 * The one effectful step of `policy render`'s read-back: asking `pdfjs` for the rendered PDF's positioned
 * text runs.
 *
 * Everything downstream of this function is pure, so this is deliberately thin — it reads a PDF and
 * re-shapes what comes back into {@link PolicyPageRuns}, and it makes no judgement about what any of it
 * means. A test that wants to prove the line grouping supplies runs directly and never opens a file.
 *
 * ## Why this does not reuse `pdf/text.ts`
 *
 * That module keeps only `str`, joined on `hasEOL`. The height and the left edge this one carries are what
 * `textRuns.ts` groups lines by. Both read the same bytes with the same library; they answer different
 * questions, and `textRuns.ts`'s module note says why neither should be folded into the other.
 */
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";

import { type PolicyExtractError, PolicyExtractErrors } from "./errors.js";
import type { PolicyPageRuns, PolicyTextRun } from "./textRuns.js";

/** The five bytes every PDF begins with. */
const PDF_MAGIC = "%PDF-";

/** One `pdfjs` text item, reduced to the fields the read-back keeps, or null when it carries no string. */
function runFromItem({ item }: { item: unknown }): PolicyTextRun | null {
  if (!isRecord(item) || typeof item["str"] !== "string") {
    return null;
  }
  const transform = item["transform"];
  const positioned = Array.isArray(transform) && transform.length >= 6;
  const height = typeof item["height"] === "number" ? item["height"] : 0;
  return {
    endsLine: item["hasEOL"] === true,
    fontName: typeof item["fontName"] === "string" ? item["fontName"] : "",
    height: Math.round(height * 10) / 10,
    text: item["str"],
    width: typeof item["width"] === "number" ? Math.round(item["width"] * 10) / 10 : 0,
    x: positioned && typeof transform[4] === "number" ? Math.round(transform[4] * 10) / 10 : 0,
    y: positioned && typeof transform[5] === "number" ? Math.round(transform[5] * 10) / 10 : 0,
  };
}

/**
 * Read one policy PDF's positioned text runs, page by page.
 *
 * @param bytes the document's exact bytes, which are copied because `pdfjs` detaches the buffer it is given
 * @returns each page's runs in reading order, or why the document could not be read
 */
export async function policyRunsFromPdf({
  bytes,
}: {
  bytes: Uint8Array;
}): Promise<Result<readonly PolicyPageRuns[], PolicyExtractError>> {
  const header = Buffer.from(bytes.subarray(0, PDF_MAGIC.length)).toString("latin1");
  if (header !== PDF_MAGIC) {
    return err(PolicyExtractErrors.notAPdf());
  }
  try {
    const document = await getDocument({ data: Uint8Array.from(bytes), useSystemFonts: true }).promise;
    const pages: PolicyPageRuns[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const runs: PolicyTextRun[] = [];
      for (const item of content.items) {
        const run = runFromItem({ item });
        if (run !== null) {
          runs.push(run);
        }
      }
      pages.push({ page: pageNumber, runs });
    }
    return ok(pages);
  } catch (error: unknown) {
    return err(PolicyExtractErrors.pdfUnreadable({ cause: error }));
  }
}
