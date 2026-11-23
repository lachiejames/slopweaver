/**
 * The typed domain error for every Gmail door verb — see `.claude/rules/error-handling.md` for the shape.
 * Its own union, shared with no other provider: a Gmail failure is a mailbox failure, and folding it into
 * the GitHub/Linear/Notion live unions would be a coincidence of shape rather than a shared domain.
 *
 * The four grant-lifecycle variants come from `../google/credentialErrors.js` rather than being declared
 * here, because the code that produces them — the grant store, the consent flow, the scope check — is
 * shared with the Drive door. That file's header states the line: a variant lives there only when shared
 * code emits it. `HISTORY_EXPIRED` is the worked example of the other side of that line; nothing but the
 * mail lane can produce it.
 */
import { hatchFor } from "../../hatch/lookup.js";
import { hatchRefusal } from "../../hatch/render.js";
import { type GoogleCredentialError, googleCredentialErrors } from "../google/credentialErrors.js";

/** The caller-supplied address is not a Gmail message, thread, or draft identifier. */
export interface InvalidAddressError {
  readonly code: "INVALID_ADDRESS";
  readonly message: string;
}

/**
 * The stored `historyId` is older than the history Google still keeps, so the delta lane cannot resume.
 *
 * Its own variant rather than an {@link ApiFailedError} carrying a 404, because it is the ONE Gmail failure
 * a caller is expected to recover from rather than report: the corpus lane answers it by re-crawling the
 * mailbox by date window and re-anchoring. Google keeps roughly a week, so this is the ordinary outcome of
 * a fortnight away, not an edge case.
 */
export interface HistoryExpiredError {
  readonly code: "HISTORY_EXPIRED";
  readonly message: string;
  /** The `historyId` Google refused. */
  readonly startHistoryId: string;
}

/** The Gmail API call failed (network, rate limit, revoked grant, or a malformed response). */
export interface ApiFailedError {
  readonly code: "API_FAILED";
  readonly message: string;
  readonly cause?: unknown;
}

/**
 * A call Gmail answered as a SUCCESS left out a field every successful answer to it carries — a thread with no
 * `messages`, a mailbox with no `labels` — so the response is malformed and nothing was read from it.
 *
 * Its own variant rather than an {@link ApiFailedError}, because nothing failed on the wire: the call succeeded and
 * its body is the defect, and a caller reading `API_FAILED` would look for a network, quota or grant fault that is
 * not there. Never read as "the thread had no messages" or "the mailbox has no labels", both of which are false.
 */
export interface ResponseFieldMissingError {
  readonly code: "RESPONSE_FIELD_MISSING";
  readonly message: string;
  /** The provider operation that answered, e.g. `gmail.users.threads.get`. */
  readonly operation: string;
  /** The response field that every successful answer carries and this one did not. */
  readonly field: string;
}

/**
 * A call Gmail answered as a SUCCESS carried a field every successful answer carries, but not in the shape the
 * SDK declares — a `labels` that is not a list, a draft `message` that is not an object. Distinct from
 * {@link ResponseFieldMissingError}: the field arrived, so "Gmail left it out" would misdirect whoever reads it.
 */
export interface ResponseFieldMalformedError {
  readonly code: "RESPONSE_FIELD_MALFORMED";
  readonly message: string;
  /** The provider operation that answered, e.g. `gmail.users.labels.list`. */
  readonly operation: string;
  /** The response field that arrived in a shape the SDK does not declare. */
  readonly field: string;
}

/** `gmail attachment` was given neither `--name` nor `--part`, so there is nothing to select a part by. */
export interface AttachmentSelectorMissingError {
  readonly code: "ATTACHMENT_SELECTOR_MISSING";
  readonly message: string;
}

/** No attachment part on the message matched the selector. `candidates` lists what the message does carry. */
export interface AttachmentNotFoundError {
  readonly code: "ATTACHMENT_NOT_FOUND";
  readonly message: string;
  readonly candidates: readonly string[];
}

/** More than one attachment part matched — two parts sharing a filename is ordinary mail, not an edge case. */
export interface AttachmentAmbiguousError {
  readonly code: "ATTACHMENT_AMBIGUOUS";
  readonly message: string;
  readonly candidates: readonly string[];
}

/** The attachment is larger than the caller's ceiling, so it was refused BEFORE any bytes were fetched. */
export interface AttachmentTooLargeError {
  readonly code: "ATTACHMENT_TOO_LARGE";
  readonly message: string;
  readonly sizeBytes: number;
  readonly maxBytes: number;
}

/** Gmail's body is not clean base64url, so a decode would silently drop or truncate bytes. */
export interface AttachmentCorruptError {
  readonly code: "ATTACHMENT_CORRUPT";
  readonly message: string;
}

/**
 * The decoded bytes are not the length Gmail said they would be. It is the second corruption witness, behind
 * the re-encode check: it catches a body that is clean base64url and still not the attachment Gmail described.
 * Nothing is written when it fails.
 */
export interface AttachmentSizeMismatchError {
  readonly code: "ATTACHMENT_SIZE_MISMATCH";
  readonly message: string;
  readonly expectedBytes: number;
  readonly decodedBytes: number;
}

/** The local destination for an attachment is not a usable, contained, real directory. */
export interface DestinationUnusableError {
  readonly code: "DESTINATION_UNUSABLE";
  readonly message: string;
  readonly destination: string;
}

/**
 * A reply draft opens by quoting back the whole of the message it answers, so the quote selects nothing.
 * A POLICY refusal carrying its hatch's four lines in `message`; `quote` is what was quoted.
 */
export interface RedundantOpeningQuoteError {
  readonly code: "REDUNDANT_OPENING_QUOTE";
  readonly message: string;
  readonly quote: string;
}

/**
 * A reply names a subject that is not its parent's, and Gmail only threads a draft whose subject matches, so
 * the draft would land outside the conversation it claims to answer.
 */
export interface ReplySubjectMismatchError {
  readonly code: "REPLY_SUBJECT_MISMATCH";
  readonly message: string;
  readonly subject: string;
  /** Undefined when the parent carries no `Subject` header at all. */
  readonly parentSubject: string | undefined;
}

/** Gmail stored a reply draft, but in a thread other than its parent's, so it is not the reply it claims. */
export interface ReplyDetachedError {
  readonly code: "REPLY_DETACHED";
  readonly message: string;
  /** The draft that now exists, outside the thread. */
  readonly draftId: string;
  readonly expected: string;
  readonly threadId: string | undefined;
}

/** Every failure a Gmail door verb can produce. */
export type GmailError =
  | GoogleCredentialError
  | InvalidAddressError
  | RedundantOpeningQuoteError
  | ReplySubjectMismatchError
  | ReplyDetachedError
  | HistoryExpiredError
  | ApiFailedError
  | ResponseFieldMissingError
  | ResponseFieldMalformedError
  | AttachmentSelectorMissingError
  | AttachmentNotFoundError
  | AttachmentAmbiguousError
  | AttachmentTooLargeError
  | AttachmentSizeMismatchError
  | AttachmentCorruptError
  | DestinationUnusableError;

/** Factories for every {@link GmailError} variant — the shape real code and its tests both construct through. */
export const GmailErrors = {
  ...googleCredentialErrors({ connectVerb: "slopweaver gmail connect", productName: "Gmail" }),

  /** @returns an {@link ApiFailedError} wrapping the underlying provider failure */
  apiFailed: ({ message, cause }: { message: string; cause?: unknown }): ApiFailedError => ({
    code: "API_FAILED",
    message,
    ...(cause !== undefined ? { cause } : {}),
  }),

  /** @returns an {@link AttachmentAmbiguousError} listing every part that matched, each with its part id */
  attachmentAmbiguous: ({ candidates }: { candidates: readonly string[] }): AttachmentAmbiguousError => ({
    candidates,
    code: "ATTACHMENT_AMBIGUOUS",
    message:
      `${String(candidates.length)} attachments match; add --part <partId> to pick one: ` + candidates.join("; "),
  }),

  /** @returns an {@link AttachmentCorruptError} */
  attachmentCorrupt: (): AttachmentCorruptError => ({
    code: "ATTACHMENT_CORRUPT",
    message:
      "Gmail's attachment body is not clean base64url, so decoding it would silently drop bytes; nothing was written",
  }),

  /** @returns an {@link AttachmentNotFoundError} listing the attachments the message does carry */
  attachmentNotFound: ({
    selector,
    candidates,
  }: {
    selector: string;
    candidates: readonly string[];
  }): AttachmentNotFoundError => ({
    candidates,
    code: "ATTACHMENT_NOT_FOUND",
    message:
      candidates.length === 0
        ? `no attachment matches ${selector}: this message carries no attachments`
        : `no attachment matches ${selector}; the message carries: ${candidates.join("; ")}`,
  }),

  /** @returns an {@link AttachmentSelectorMissingError} */
  attachmentSelectorMissing: (): AttachmentSelectorMissingError => ({
    code: "ATTACHMENT_SELECTOR_MISSING",
    message: "name the attachment: give --name <filename>, --part <partId>, or both",
  }),

  /** @returns an {@link AttachmentSizeMismatchError} naming both lengths */
  attachmentSizeMismatch: ({
    expectedBytes,
    decodedBytes,
  }: {
    expectedBytes: number;
    decodedBytes: number;
  }): AttachmentSizeMismatchError => ({
    code: "ATTACHMENT_SIZE_MISMATCH",
    decodedBytes,
    expectedBytes,
    message:
      `Gmail reported ${String(expectedBytes)} bytes but ${String(decodedBytes)} decoded; ` +
      "nothing was written, because a short or corrupted file would read as the real one",
  }),

  /** @returns an {@link AttachmentTooLargeError} naming the size and the ceiling it exceeded */
  attachmentTooLarge: ({ sizeBytes, maxBytes }: { sizeBytes: number; maxBytes: number }): AttachmentTooLargeError => ({
    code: "ATTACHMENT_TOO_LARGE",
    maxBytes,
    message:
      `the attachment is ${String(sizeBytes)} bytes, over the ${String(maxBytes)}-byte ceiling; ` +
      "nothing was fetched — raise --max-file-mb to take it",
    sizeBytes,
  }),

  /** @returns a {@link DestinationUnusableError} naming the path that could not be used */
  destinationUnusable: ({
    destination,
    reason,
  }: {
    destination: string;
    reason: string;
  }): DestinationUnusableError => ({
    code: "DESTINATION_UNUSABLE",
    destination,
    message: `cannot write the attachment under ${destination}: ${reason}`,
  }),

  /** @returns a {@link HistoryExpiredError} naming the `historyId` Google would not resume from */
  historyExpired: ({ startHistoryId }: { startHistoryId: string }): HistoryExpiredError => ({
    code: "HISTORY_EXPIRED",
    message:
      `Gmail no longer holds history from ${startHistoryId} — it keeps roughly a week, so this cursor has ` +
      "aged out and the mailbox must be re-crawled by date window",
    startHistoryId,
  }),

  /** @returns an {@link InvalidAddressError} carrying the caller-facing reason */
  invalidAddress: ({ message }: { message: string }): InvalidAddressError => ({
    code: "INVALID_ADDRESS",
    message,
  }),

  /**
   * @param operation the provider operation that answered
   * @param subject what was asked for, in words a reader recognises — `thread 18c2…`, `this mailbox`
   * @param field the response field the answer left out
   * @returns a {@link ResponseFieldMissingError} naming the call, its subject and the missing field
   */
  responseFieldMissing: ({
    operation,
    subject,
    field,
  }: {
    operation: string;
    subject: string;
    field: string;
  }): ResponseFieldMissingError => ({
    code: "RESPONSE_FIELD_MISSING",
    field,
    message:
      `Gmail answered ${operation} for ${subject} with no \`${field}\`, which every successful answer carries, ` +
      "so the response is malformed and nothing was read from it",
    operation,
  }),

  /**
   * @param operation the provider operation that answered
   * @param subject what was asked for, in words a reader recognises — `draft r-12…`, `this mailbox`
   * @param field the response field that arrived in the wrong shape
   * @param expected the shape the SDK declares for it, e.g. `a list`
   * @returns a {@link ResponseFieldMalformedError} naming the call, its subject, the field and its declared shape
   */
  responseFieldMalformed: ({
    operation,
    subject,
    field,
    expected,
  }: {
    operation: string;
    subject: string;
    field: string;
    expected: string;
  }): ResponseFieldMalformedError => ({
    code: "RESPONSE_FIELD_MALFORMED",
    field,
    message:
      `Gmail answered ${operation} for ${subject} with a \`${field}\` that is not ${expected}, ` +
      "so the response is malformed and nothing was read from it",
    operation,
  }),

  /** @returns a {@link RedundantOpeningQuoteError} whose message is the `redundant-quote` hatch's refusal */
  redundantOpeningQuote: ({ quote }: { quote: string }): RedundantOpeningQuoteError => ({
    code: "REDUNDANT_OPENING_QUOTE",
    message: hatchRefusal({
      detail: `the draft opens "> ${quote}", which is everything the parent message said`,
      hatch: hatchFor({ id: "redundant-quote" }),
    }),
    quote,
  }),

  /** @returns a {@link ReplyDetachedError} naming the stray draft and both threads */
  replyDetached: ({
    draftId,
    expected,
    threadId,
  }: {
    draftId: string;
    expected: string;
    threadId: string | undefined;
  }): ReplyDetachedError => {
    let landed = "no thread at all";
    if (threadId !== undefined) {
      landed = `thread ${threadId}`;
    }
    return {
      code: "REPLY_DETACHED",
      draftId,
      expected,
      message:
        `Gmail stored draft ${draftId} in ${landed}, not the reply's thread ${expected}, so it is not a reply; ` +
        "delete that draft in Gmail before drafting again",
      threadId,
    };
  },

  /** @returns a {@link ReplySubjectMismatchError} naming both subjects and the way past it */
  replySubjectMismatch: ({
    subject,
    parentSubject,
  }: {
    subject: string;
    parentSubject: string | undefined;
  }): ReplySubjectMismatchError => {
    let parent = "no subject at all";
    if (parentSubject !== undefined) {
      parent = `"${parentSubject}"`;
    }
    return {
      code: "REPLY_SUBJECT_MISMATCH",
      message:
        `the reply's subject "${subject}" is not the subject of the message it answers (${parent}), so Gmail ` +
        "would draft it outside that thread; leave the subject empty to take the parent's, or match it",
      parentSubject,
      subject,
    };
  },

  /**
   * A compose form's validation problems folded into one error. Every problem is carried, joined into the
   * `message` a typed Gmail error has. A new variant holding a string array was rejected: the list is not
   * something a caller branches on, it is something a caller prints, which is what `message` is for.
   *
   * @returns an {@link InvalidAddressError} listing every problem, one per line
   */
  composeFormRefused: ({ problems }: { problems: readonly string[] }): InvalidAddressError => ({
    code: "INVALID_ADDRESS",
    message: `the compose form was refused:\n  - ${problems.join("\n  - ")}`,
  }),
} as const;
