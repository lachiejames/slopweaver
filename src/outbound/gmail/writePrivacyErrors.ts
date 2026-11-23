/**
 * Why the Gmail privacy guard could not judge a write: a body or message it cannot read whole, so it refuses rather
 * than pass anything unjudged. Every variant's `message` is the line `./writePrivacy.ts`'s refusal prints, opening on
 * the locus or command it names. A finding — a private term in a write it COULD read — is not one of these; it is
 * `../privacyCheck.ts`'s.
 */

/** A `raw` that is not base64url at all. */
export interface RawNotBase64UrlError {
  readonly code: "RAW_NOT_BASE64URL";
  readonly message: string;
  readonly locus: string;
}

/** A `raw` whose decoded message would be larger than the guard reads. */
export interface RawTooLargeError {
  readonly code: "RAW_TOO_LARGE";
  readonly message: string;
  readonly locus: string;
  readonly maxBytes: number;
}

/** A `raw` whose base64url carries bits a re-encode would not reproduce, so the decode dropped something. */
export interface RawNotCleanError {
  readonly code: "RAW_NOT_CLEAN";
  readonly message: string;
  readonly locus: string;
}

/** A MIME message the parser refused — its nesting, header size or part count. */
export interface MimeUnparseableError {
  readonly code: "MIME_UNPARSEABLE";
  readonly message: string;
  readonly locus: string;
}

/** Forwarded `message/rfc822` attachments nested deeper than the guard, or the parser, opens. */
export interface ForwardTooDeepError {
  readonly code: "FORWARD_TOO_DEEP";
  readonly message: string;
  readonly locus: string;
}

/** A text-like attachment whose bytes are not valid UTF-8. */
export interface AttachmentNotUtf8Error {
  readonly code: "ATTACHMENT_NOT_UTF8";
  readonly message: string;
  readonly locus: string;
}

/** A request body that is not JSON. */
export interface BodyNotJsonError {
  readonly code: "BODY_NOT_JSON";
  readonly message: string;
  readonly command: string;
}

/** A `drafts.create` carrying no `message.raw`, so there is nothing to judge it by. */
export interface DraftWithoutRawError {
  readonly code: "DRAFT_WITHOUT_RAW";
  readonly message: string;
  readonly command: string;
}

/** A body or a draft the transport could not hand over to be judged, carrying the transport's own reason. */
export interface WriteUnreadableError {
  readonly code: "WRITE_UNREADABLE";
  readonly message: string;
  readonly command: string;
}

/** Every reason the Gmail privacy guard could not judge a write. */
export type GmailWritePayloadError =
  | RawNotBase64UrlError
  | RawTooLargeError
  | RawNotCleanError
  | MimeUnparseableError
  | ForwardTooDeepError
  | AttachmentNotUtf8Error
  | BodyNotJsonError
  | DraftWithoutRawError
  | WriteUnreadableError;

/** The one place each {@link GmailWritePayloadError} is built. */
export const GmailWritePayloadErrors = {
  /** @returns an {@link AttachmentNotUtf8Error} */
  attachmentNotUtf8: ({ locus }: { locus: string }): AttachmentNotUtf8Error => ({
    code: "ATTACHMENT_NOT_UTF8",
    locus,
    message: `${locus}: a text-like attachment that is not valid UTF-8, so it cannot be judged`,
  }),

  /** @returns a {@link BodyNotJsonError} */
  bodyNotJson: ({ command }: { command: string }): BodyNotJsonError => ({
    code: "BODY_NOT_JSON",
    command,
    message: `${command}: a request body that is not JSON, so it cannot be judged`,
  }),

  /** @returns a {@link DraftWithoutRawError} */
  draftWithoutRaw: ({ command }: { command: string }): DraftWithoutRawError => ({
    code: "DRAFT_WITHOUT_RAW",
    command,
    message: `${command}: a draft carrying no message.raw, so there is nothing to judge it by`,
  }),

  /**
   * A forwarded message deeper than the bound. `bound` is the guard's own; absent, the parser stopped first.
   *
   * @param bound how many levels the guard opens, when it was the guard's bound that refused
   * @returns a {@link ForwardTooDeepError}
   */
  forwardTooDeep: ({ locus, bound }: { locus: string; bound: number | undefined }): ForwardTooDeepError => {
    let message = `${locus}: a forwarded message nested too deep to open, so it cannot be judged`;
    if (bound !== undefined) {
      message = `${locus}: forwarded messages nested more than ${String(bound)} deep`;
    }
    return { code: "FORWARD_TOO_DEEP", locus, message };
  },

  /** @returns a {@link MimeUnparseableError} carrying the parser's own reason */
  mimeUnparseable: ({ locus, cause }: { locus: string; cause: unknown }): MimeUnparseableError => {
    let why = "an unknown parser failure";
    if (cause instanceof Error) {
      why = cause.message;
    }
    return {
      code: "MIME_UNPARSEABLE",
      locus,
      message: `${locus}: a MIME message the parser refused (${why}), so it cannot be judged`,
    };
  },

  /** @returns a {@link RawNotBase64UrlError} */
  rawNotBase64Url: ({ locus }: { locus: string }): RawNotBase64UrlError => ({
    code: "RAW_NOT_BASE64URL",
    locus,
    message: `${locus}: a raw message that is not base64url, so it cannot be judged`,
  }),

  /** @returns a {@link RawNotCleanError} */
  rawNotClean: ({ locus }: { locus: string }): RawNotCleanError => ({
    code: "RAW_NOT_CLEAN",
    locus,
    message: `${locus}: a raw message whose base64url does not decode cleanly, so it cannot be judged`,
  }),

  /** @returns a {@link RawTooLargeError} naming the ceiling */
  rawTooLarge: ({ locus, maxBytes }: { locus: string; maxBytes: number }): RawTooLargeError => ({
    code: "RAW_TOO_LARGE",
    locus,
    maxBytes,
    message: `${locus}: a raw message over ${String(maxBytes)} bytes, so it cannot be judged`,
  }),

  /**
   * @param reason the transport's own reason, already a sentence a reader acts on
   * @returns a {@link WriteUnreadableError}
   */
  writeUnreadable: ({ command, reason }: { command: string; reason: string }): WriteUnreadableError => ({
    code: "WRITE_UNREADABLE",
    command,
    message: `${command}: ${reason}`,
  }),
} as const;
