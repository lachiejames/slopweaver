/**
 * Why the Gmail transport guard (`./guardedFetch.ts`) could not read what it is about to send: a body it cannot
 * judge as text, or a send whose draft it could not re-read. Its own union, not `./errors.ts`'s `GmailError`: these are
 * failures of the guard reading the wire, never of a door verb, and every one ends in a refusal with nothing sent.
 * The refusal itself is `../../outbound/gmail/writePrivacy.ts`'s, which carries `message` forward.
 */

/** A request body that is bytes, a Blob or a Request, and not valid UTF-8. */
export interface GuardBodyNotUtf8Error {
  readonly code: "BODY_NOT_UTF8";
  readonly message: string;
}

/** A streamed request body, which the guard cannot read without consuming what is about to be sent. */
export interface GuardBodyStreamedError {
  readonly code: "BODY_STREAMED";
  readonly message: string;
}

/** A `drafts.send` whose body names no draft id, so there is no draft to re-read. */
export interface GuardSendWithoutDraftIdError {
  readonly code: "SEND_WITHOUT_DRAFT_ID";
  readonly message: string;
}

/** The re-read of a draft before its send answered a status that is not success. */
export interface GuardDraftReReadRefusedError {
  readonly code: "DRAFT_REREAD_REFUSED";
  readonly message: string;
  readonly status: number;
}

/** The re-read of a draft before its send never answered: the transport threw. */
export interface GuardDraftReReadFailedError {
  readonly code: "DRAFT_REREAD_FAILED";
  readonly message: string;
  readonly cause: unknown;
}

/** The re-read answered, in a shape this version does not read. */
export interface GuardDraftReReadMalformedError {
  readonly code: "DRAFT_REREAD_MALFORMED";
  readonly message: string;
}

/** The re-read answered a draft carrying no `message.raw`, so there is no message to judge. */
export interface GuardDraftWithoutRawError {
  readonly code: "DRAFT_WITHOUT_RAW";
  readonly message: string;
}

/** Every reason the Gmail transport guard could not read a write it is about to send. */
export type GmailGuardError =
  | GuardBodyNotUtf8Error
  | GuardBodyStreamedError
  | GuardSendWithoutDraftIdError
  | GuardDraftReReadRefusedError
  | GuardDraftReReadFailedError
  | GuardDraftReReadMalformedError
  | GuardDraftWithoutRawError;

/** The one place each {@link GmailGuardError} is built. */
export const GmailGuardErrors = {
  /** @returns a {@link GuardBodyNotUtf8Error} */
  bodyNotUtf8: (): GuardBodyNotUtf8Error => ({
    code: "BODY_NOT_UTF8",
    message: "a request body that is not valid UTF-8, so what would be sent cannot be judged as text",
  }),

  /** @returns a {@link GuardBodyStreamedError} */
  bodyStreamed: (): GuardBodyStreamedError => ({
    code: "BODY_STREAMED",
    message: "a streamed request body, which cannot be judged without consuming it",
  }),

  /** @returns a {@link GuardDraftReReadFailedError} carrying what the transport threw */
  draftReReadFailed: ({ cause }: { cause: unknown }): GuardDraftReReadFailedError => {
    let why = "an unknown transport failure";
    if (cause instanceof Error) {
      why = cause.message;
    }
    return {
      cause,
      code: "DRAFT_REREAD_FAILED",
      message: `the draft could not be re-read before sending (${why})`,
    };
  },

  /**
   * @param reason the boundary's own refusal, naming the field that drifted
   * @returns a {@link GuardDraftReReadMalformedError}
   */
  draftReReadMalformed: ({ reason }: { reason: string }): GuardDraftReReadMalformedError => ({
    code: "DRAFT_REREAD_MALFORMED",
    message: `the draft re-read before sending could not be read: ${reason}`,
  }),

  /** @returns a {@link GuardDraftReReadRefusedError} naming the status Gmail answered */
  draftReReadRefused: ({ status }: { status: number }): GuardDraftReReadRefusedError => ({
    code: "DRAFT_REREAD_REFUSED",
    message: `the draft could not be re-read before sending: Gmail answered HTTP ${String(status)}`,
    status,
  }),

  /** @returns a {@link GuardDraftWithoutRawError} */
  draftWithoutRaw: (): GuardDraftWithoutRawError => ({
    code: "DRAFT_WITHOUT_RAW",
    message: "the draft re-read before sending carried no message.raw",
  }),

  /**
   * @param reason why the send body named no draft, the boundary's refusal or its absence
   * @returns a {@link GuardSendWithoutDraftIdError}
   */
  sendWithoutDraftId: ({ reason }: { reason: string }): GuardSendWithoutDraftIdError => ({
    code: "SEND_WITHOUT_DRAFT_ID",
    message: `a send naming no draft id, so the draft cannot be re-read (${reason})`,
  }),
} as const;
