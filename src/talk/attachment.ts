/**
 * What a file the owner attaches in the console's Messenger may be, judged by its own bytes: the pure half of
 * `slopweaver talk attach`. A call gives the owner the controls to decide what to share and to upload files.
 *
 * An attachment is kept only when the thinking model's existing `file_read` can read it, so the voice is never told
 * about a file it would then refuse: a PNG, JPEG or WebP by its first bytes (`./imageSniff.ts`), sent as the picture,
 * or UTF-8 text with no NUL byte, the window `./localText.ts` reads and masks. Anything else — a PDF, a zip, a
 * spreadsheet — is refused with the reason, never stored and never cut down to fit: a cap that truncated would have
 * the voice answer from half a file as if it were the whole.
 */
import { err, ok, type Result } from "#lib/result.js";

import { IMAGE_SNIFF_BYTES, type ImageMediaType, sniffImage } from "./imageSniff.js";
import { isCredentialName } from "./localPath.js";

/** The largest picture kept: half of `file_read`'s own 16 MiB picture ceiling (`./localImage.ts`). */
export const ATTACHMENT_PICTURE_MAX_BYTES = 8 * 1024 * 1024;

/** The largest text file kept: many `file_read` windows, small enough to post from the page in one body. */
export const ATTACHMENT_TEXT_MAX_BYTES = 1024 * 1024;

/** The longest name kept, in UTF-8 bytes: under every filesystem's 255-byte name limit. */
export const ATTACHMENT_NAME_MAX_BYTES = 240;

/** An attachment that passed, its bytes exactly as the owner chose them. */
export type Attachment =
  | {
      readonly kind: "picture";
      readonly mediaType: ImageMediaType;
      readonly safeName: string;
      readonly bytes: Uint8Array;
    }
  | { readonly kind: "text"; readonly safeName: string; readonly bytes: Uint8Array };

/** The file is empty. */
export interface AttachmentEmptyError {
  readonly code: "EMPTY";
  readonly message: string;
}

/** The file is over its kind's cap. */
export interface AttachmentTooLargeError {
  readonly code: "TOO_LARGE";
  readonly message: string;
  readonly bytes: number;
  readonly maxBytes: number;
}

/** The file is neither one of the three pictures nor UTF-8 text. */
export interface AttachmentBinaryError {
  readonly code: "BINARY";
  readonly message: string;
  readonly reason: "nul-byte" | "invalid-utf8";
}

/** The file's name cannot be kept as a file name, or names a credential. */
export interface AttachmentNameInvalidError {
  readonly code: "NAME_INVALID";
  readonly message: string;
  readonly name: string;
}

/** Why an attachment was refused. */
export type AttachmentError =
  AttachmentEmptyError | AttachmentTooLargeError | AttachmentBinaryError | AttachmentNameInvalidError;

/** What the voice can read, said in every binary refusal. */
const READABLE_KINDS =
  "the voice reads PNG, JPEG and WebP pictures and UTF-8 text files, not a PDF or other binary file";

/** The attachment domain's error factories. */
export const AttachmentErrors = {
  binary: ({ reason }: { reason: AttachmentBinaryError["reason"] }): AttachmentBinaryError => ({
    code: "BINARY",
    message: `the file is not a picture or text (${reason === "nul-byte" ? "it holds a NUL byte" : "it is not valid UTF-8"}): ${READABLE_KINDS}`,
    reason,
  }),
  empty: (): AttachmentEmptyError => ({ code: "EMPTY", message: "the file is empty" }),
  nameInvalid: ({ name, why }: { name: string; why: string }): AttachmentNameInvalidError => ({
    code: "NAME_INVALID",
    message: `the file name cannot be kept: ${why}`,
    name,
  }),
  tooLarge: ({
    bytes,
    maxBytes,
    kind,
  }: {
    bytes: number;
    maxBytes: number;
    kind: Attachment["kind"];
  }): AttachmentTooLargeError => ({
    bytes,
    code: "TOO_LARGE",
    maxBytes,
    message: `the ${kind === "picture" ? "picture" : "text file"} is ${String(bytes)} bytes; the most attached is ${String(maxBytes)}`,
  }),
} as const;

/**
 * What no kept name carries: control characters (`Cc`), format characters such as a bidi override (`Cf`), and the
 * line and paragraph separators (`Zl`, `Zp`), which `JSON.stringify` leaves unescaped and a reader may break a line on.
 * The name rides one quoted line in the owner's message, so nothing in it may end that line or reorder how it reads.
 */
const CONTROL_CHARACTERS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;

/**
 * The name an attachment is kept under: the last path segment of what the owner chose, with control characters removed,
 * NFC-normalised and trimmed. Never shortened: an overlong name is refused.
 *
 * @param name the name as the page or a caller gave it
 * @returns the kept name, or why none can be
 */
export function safeAttachmentName({ name }: { name: string }): Result<string, AttachmentNameInvalidError> {
  const base = name.split(/[/\\]/u).at(-1)!;
  const kept = base.replaceAll(CONTROL_CHARACTERS, "").normalize("NFC").trim();
  if (kept === "" || kept === "." || kept === "..") {
    return err(AttachmentErrors.nameInvalid({ name, why: "it is empty once its folders are left off" }));
  }
  const bytes = new TextEncoder().encode(kept).length;
  if (bytes > ATTACHMENT_NAME_MAX_BYTES) {
    const why = `it is ${String(bytes)} bytes; the most kept is ${String(ATTACHMENT_NAME_MAX_BYTES)}`;
    return err(AttachmentErrors.nameInvalid({ name, why }));
  }
  if (isCredentialName({ name: kept })) {
    return err(AttachmentErrors.nameInvalid({ name, why: "it is named like a credential, which file_read refuses" }));
  }
  return ok(kept);
}

/**
 * The cap a file is held to, by its first bytes alone — so a caller can refuse an oversize file before reading it.
 *
 * @param head the file's first bytes, twelve when it has that many
 * @returns the kind its head names and that kind's cap
 */
export function attachmentCapOf({ head }: { head: Uint8Array }): {
  readonly kind: Attachment["kind"];
  readonly maxBytes: number;
} {
  if (sniffImage({ head }) !== undefined) {
    return { kind: "picture", maxBytes: ATTACHMENT_PICTURE_MAX_BYTES };
  }
  return { kind: "text", maxBytes: ATTACHMENT_TEXT_MAX_BYTES };
}

/**
 * Judge one attachment whole: its name, then its size against its kind's cap, then — when it is not a picture —
 * whether it is text `file_read` reads.
 *
 * @param name the name the owner chose it under
 * @param bytes every byte of it
 * @returns the attachment, its bytes untouched, or the one reason it is refused
 */
export function attachmentVerdict({
  name,
  bytes,
}: {
  name: string;
  bytes: Uint8Array;
}): Result<Attachment, AttachmentError> {
  const safeName = safeAttachmentName({ name });
  if (safeName.isErr()) {
    return err(safeName.error);
  }
  if (bytes.length === 0) {
    return err(AttachmentErrors.empty());
  }
  const head = bytes.subarray(0, IMAGE_SNIFF_BYTES);
  const cap = attachmentCapOf({ head });
  if (bytes.length > cap.maxBytes) {
    return err(AttachmentErrors.tooLarge({ bytes: bytes.length, kind: cap.kind, maxBytes: cap.maxBytes }));
  }
  const mediaType = sniffImage({ head });
  if (mediaType !== undefined) {
    return ok({ bytes, kind: "picture", mediaType, safeName: safeName.value });
  }
  if (bytes.includes(0)) {
    return err(AttachmentErrors.binary({ reason: "nul-byte" }));
  }
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return err(AttachmentErrors.binary({ reason: "invalid-utf8" }));
  }
  return ok({ bytes, kind: "text", safeName: safeName.value });
}
