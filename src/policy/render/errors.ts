/**
 * Why `policy render`'s read-back could not get text runs out of a rendered PDF.
 *
 * Two kinds, because they mean different things to a reader: bytes that never were a PDF point at the wrong
 * file, while a PDF `pdfjs` could not parse points at the render that wrote it.
 */
import { errorMessage } from "../../lib/errorMessage.js";

/** The bytes do not begin with `%PDF-`, so `pdfjs` was never asked. */
export interface NotAPdfError {
  readonly code: "NOT_A_PDF";
  readonly message: string;
}

/** The bytes claimed to be a PDF and `pdfjs` threw reading them. */
export interface PdfUnreadableError {
  readonly cause: unknown;
  readonly code: "PDF_UNREADABLE";
  readonly message: string;
}

/** Every way the read-back's text extraction fails. */
export type PolicyExtractError = NotAPdfError | PdfUnreadableError;

/** The one place each {@link PolicyExtractError} variant and its message are built. */
export const PolicyExtractErrors = {
  notAPdf: (): NotAPdfError => ({
    code: "NOT_A_PDF",
    message: "these bytes are not a PDF: they do not begin with %PDF-",
  }),
  pdfUnreadable: ({ cause }: { cause: unknown }): PdfUnreadableError => ({
    cause,
    code: "PDF_UNREADABLE",
    message: `could not read this policy PDF: ${errorMessage({ error: cause })}`,
  }),
} as const;
