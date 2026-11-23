/**
 * One local attachment, asked whether it is a PDF and what it says — the call every doored provider makes
 * after its own door has put the bytes on disk.
 *
 * ## Why every door calls this instead of `./text.ts` directly
 *
 * Three decisions repeat at every door, and each was got wrong at least once before this module existed:
 * the bytes decide whether this is a PDF (never the mimetype an uploader chose), a document with no text
 * layer must not be reported as an empty one, and a provider that serves images and videos must not load a
 * 400 MB file into memory to find out it is not a PDF. Written out at four doors, those become four chances
 * to differ.
 *
 * ## The header is read before the file is
 *
 * `%PDF-` is five bytes, so the "is this a PDF" question is answered by reading five bytes rather than the
 * whole file. Only a file that answers yes is read into memory, and `./text.ts` then holds it to the byte
 * ceiling `./limits.ts` carries. A Slack thread with a screen recording is what makes this matter: it
 * is an ordinary attachment, it is not a PDF, and reading it whole to discover that would cost more memory
 * than every real document in the thread put together.
 */
import { closeSync, openSync, readFileSync, readSync } from "node:fs";

import { err, ok, type Result } from "../lib/result.js";
import { safeFs } from "../lib/safeBoundary.js";
import { extractPdfText, isPdf } from "./text.js";

/** How many bytes the magic test needs — `%PDF-`, and nothing after it. */
const MAGIC_BYTES = 5;

/** What one PDF attachment yielded. */
export interface PdfAttachment {
  /**
   * The document's words, or `undefined` when there were none to read. Deliberately not the empty string:
   * a renderer printing `""` under a page count says "this document is blank", which is the one wrong
   * answer — {@link PdfAttachment.glyphless} is what the caller prints instead.
   */
  readonly text: string | undefined;
  /** How many pages the document declares. */
  readonly pages: number;
  /** How many of them were read, below {@link pages} when the page cap bit. */
  readonly pagesRead: number;
  /** True when pages were read and none of them carried a glyph — a scan, never a blank document. */
  readonly glyphless: boolean;
}

/**
 * Whether a local file begins with the PDF magic, read without loading the file.
 *
 * @param localPath the file the door wrote
 * @returns whether the first bytes are `%PDF-`, or why they could not be read
 */
function headerIsPdf({ localPath }: { localPath: string }): Result<boolean> {
  const sniffed = safeFs({
    execute: () => {
      const handle = openSync(localPath, "r");
      try {
        const head = Buffer.alloc(MAGIC_BYTES);
        const read = readSync(handle, head, 0, MAGIC_BYTES, 0);
        return new Uint8Array(head.subarray(0, read));
      } finally {
        closeSync(handle);
      }
    },
    operation: "pdf.attachment.sniff",
    path: localPath,
  });
  if (sniffed.isErr()) {
    return err([sniffed.error.message]);
  }
  return ok(isPdf({ bytes: sniffed.value }));
}

/**
 * Read one attachment already in memory as a PDF, when that is what it is.
 *
 * A door that fetched its bytes over the wire has no reason to write them to a disk first, and
 * {@link pdfAttachmentAt} is this function plus a file read — so the three decisions this module exists to
 * make happen in exactly one place however the bytes arrived.
 *
 * @param bytes the attachment exactly as the provider served it
 * @returns the extraction, `undefined` when the bytes are not a PDF at all, or why a PDF could not be read
 */
export async function pdfAttachmentFrom({ bytes }: { bytes: Uint8Array }): Promise<Result<PdfAttachment | undefined>> {
  if (!isPdf({ bytes })) {
    return ok(undefined);
  }
  const extraction = await extractPdfText({ bytes });
  if (extraction.isErr()) {
    return err(extraction.error);
  }
  const { glyphless, pages, pagesRead, text } = extraction.value;
  if (glyphless) {
    return ok({ glyphless, pages, pagesRead, text: undefined });
  }
  return ok({ glyphless, pages, pagesRead, text });
}

/**
 * Read one local attachment as a PDF, when that is what it is.
 *
 * @param localPath the file a provider's door already wrote
 * @returns the extraction, `undefined` when the file is not a PDF at all, or why a PDF could not be read
 */
export async function pdfAttachmentAt({
  localPath,
}: {
  localPath: string;
}): Promise<Result<PdfAttachment | undefined>> {
  const header = headerIsPdf({ localPath });
  if (header.isErr()) {
    return err(header.error);
  }
  if (!header.value) {
    return ok(undefined);
  }
  const read = safeFs({
    execute: () => new Uint8Array(readFileSync(localPath)),
    operation: "pdf.attachment.read",
    path: localPath,
  });
  if (read.isErr()) {
    return err([read.error.message]);
  }
  return pdfAttachmentFrom({ bytes: read.value });
}
