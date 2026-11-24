/**
 * The typed failures of the `chatgpt` noun: reading the owner's pasted request into a session file, paging one
 * named conversation through ChatGPT's web backend, and listing the account's conversations through it.
 *
 * No variant carries a header value. A message names a header, a status or a URL PATH — never the bearer, the
 * cookie or the account id — because every one of these is printed to a terminal the owner may paste on.
 */

/** The pasted request lacks a header the conversation read cannot be made without. */
export interface ChatgptHeaderMissingError {
  readonly code: "HEADER_MISSING";
  readonly message: string;
  readonly header: string;
}

/** The session file is absent: `chatgpt import-request` has not run on this home. */
export interface ChatgptSessionAbsentError {
  readonly code: "SESSION_ABSENT";
  readonly message: string;
  readonly path: string;
}

/** The session file is present and is not the shape `chatgpt import-request` writes. */
export interface ChatgptSessionMalformedError {
  readonly code: "SESSION_MALFORMED";
  readonly message: string;
  readonly path: string;
}

/** A file the verb had to read or write could not be. */
export interface ChatgptFileFailedError {
  readonly code: "FILE_FAILED";
  readonly message: string;
  readonly path: string;
}

/** The argument is not a conversation id, so no request is made at all. */
export interface ChatgptNotAConversationIdError {
  readonly code: "NOT_A_CONVERSATION_ID";
  readonly message: string;
}

/** The backend answered with a non-2xx status — an expired session reads `401`. */
export interface ChatgptHttpRefusedError {
  readonly code: "HTTP_REFUSED";
  readonly message: string;
  readonly status: number;
  /** Cloudflare marked the answer a challenge (`cf-mitigated: challenge`), whatever its status: never retried. */
  readonly challenged: boolean;
}

/** The request never completed: DNS, TLS, a reset connection. */
export interface ChatgptTransportFailedError {
  readonly code: "TRANSPORT_FAILED";
  readonly message: string;
}

/** A 2xx answer that is not JSON — Cloudflare's challenge page is the one this was written for. */
export interface ChatgptNotJsonError {
  readonly code: "NOT_JSON";
  readonly message: string;
}

/** JSON that is not a page of messages. */
export interface ChatgptPageMalformedError {
  readonly code: "PAGE_MALFORMED";
  readonly message: string;
}

/** The conversation is longer than the page bound allows — refused rather than written half. */
export interface ChatgptPageBoundExceededError {
  readonly code: "PAGE_BOUND_EXCEEDED";
  readonly message: string;
  readonly maxPages: number;
}

/** A page claimed older messages exist and handed back the cursor already asked with. */
export interface ChatgptCursorStalledError {
  readonly code: "CURSOR_STALLED";
  readonly message: string;
  readonly cursor: string;
}

/** A listing lane ran past its page bound — refused rather than reported as the whole account. */
export interface ChatgptListingBoundExceededError {
  readonly code: "LISTING_BOUND_EXCEEDED";
  readonly message: string;
  readonly lane: string;
  readonly maxPages: number;
}

/** A listing lane handed back a page that does not move it forward: the same cursor, or an offset past its total. */
export interface ChatgptListingStalledError {
  readonly code: "LISTING_STALLED";
  readonly message: string;
  readonly lane: string;
}

/** Every way a `chatgpt` verb can stop. */
export type ChatgptError =
  | ChatgptListingBoundExceededError
  | ChatgptListingStalledError
  | ChatgptHeaderMissingError
  | ChatgptSessionAbsentError
  | ChatgptSessionMalformedError
  | ChatgptFileFailedError
  | ChatgptNotAConversationIdError
  | ChatgptHttpRefusedError
  | ChatgptTransportFailedError
  | ChatgptNotJsonError
  | ChatgptPageMalformedError
  | ChatgptPageBoundExceededError
  | ChatgptCursorStalledError;

/**
 * What a refused status asks of the owner: a fresh paste for an expired session, and for a rate limit, nothing
 * sooner than later — the read already stopped, and is never retried in the same run.
 */
function httpRefusalAdvice({ status }: { status: number }): string {
  if (status === 401 || status === 403) {
    return " — the pasted session has expired or been refused; paste a fresh request and run chatgpt import-request again";
  }
  if (status === 429) {
    return " — ChatGPT is rate-limiting this session; the read stopped and is never retried in the same run, so run it again later";
  }
  return "";
}

/** How to raise one — the factory the real code calls, so a test built the same way catches a drift. */
export const ChatgptErrors = {
  cursorStalled: ({ cursor }: { cursor: string }): ChatgptCursorStalledError => ({
    code: "CURSOR_STALLED",
    cursor,
    message: `the backend said older messages exist but returned cursor ${cursor} again; stopped rather than loop`,
  }),
  fileFailed: ({ path, cause }: { path: string; cause: unknown }): ChatgptFileFailedError => ({
    code: "FILE_FAILED",
    message: `could not read or write ${path}: ${cause instanceof Error ? cause.message : String(cause)}`,
    path,
  }),
  headerMissing: ({ header }: { header: string }): ChatgptHeaderMissingError => ({
    code: "HEADER_MISSING",
    header,
    message: `the pasted request carries no \`${header}\` header — copy the Request Headers of a signed-in backend-api request again`,
  }),
  httpRefused: ({
    status,
    path,
    challenged,
  }: {
    status: number;
    path: string;
    challenged?: boolean;
  }): ChatgptHttpRefusedError => {
    const isChallenge = challenged === true;
    const advice = isChallenge
      ? " — a Cloudflare challenge; the read stopped and is never retried in the same run"
      : httpRefusalAdvice({ status });
    return {
      challenged: isChallenge,
      code: "HTTP_REFUSED",
      message: `GET ${path} answered HTTP ${String(status)}${advice}`,
      status,
    };
  },
  listingBoundExceeded: ({ lane, maxPages }: { lane: string; maxPages: number }): ChatgptListingBoundExceededError => ({
    code: "LISTING_BOUND_EXCEEDED",
    lane,
    maxPages,
    message: `the ${lane} listing runs past ${String(maxPages)} pages; stopped rather than report part of the account as all of it`,
  }),
  listingStalled: ({ lane, detail }: { lane: string; detail: string }): ChatgptListingStalledError => ({
    code: "LISTING_STALLED",
    lane,
    message: `the ${lane} listing did not move forward (${detail}); stopped rather than loop`,
  }),
  notAConversationId: ({ given }: { given: string }): ChatgptNotAConversationIdError => ({
    code: "NOT_A_CONVERSATION_ID",
    message: `${given} is not a ChatGPT conversation id (a UUID, as in chatgpt.com/c/<id>)`,
  }),
  notJson: ({ path, contentType }: { path: string; contentType: string }): ChatgptNotJsonError => ({
    code: "NOT_JSON",
    message: `GET ${path} answered ${contentType} instead of JSON — most likely a Cloudflare challenge; paste a fresh request`,
  }),
  pageBoundExceeded: ({ maxPages }: { maxPages: number }): ChatgptPageBoundExceededError => ({
    code: "PAGE_BOUND_EXCEEDED",
    maxPages,
    message: `the conversation runs past ${String(maxPages)} pages; nothing was written — raise --max-pages to read it whole`,
  }),
  pageMalformed: ({ path, problems }: { path: string; problems: readonly string[] }): ChatgptPageMalformedError => ({
    code: "PAGE_MALFORMED",
    message: `GET ${path} answered JSON that is not a page of messages: ${problems.join("; ")}`,
  }),
  sessionAbsent: ({ path }: { path: string }): ChatgptSessionAbsentError => ({
    code: "SESSION_ABSENT",
    message: `no ChatGPT session at ${path} — run slopweaver chatgpt import-request --from <pasted request file> first`,
    path,
  }),
  sessionMalformed: ({
    path,
    problems,
  }: {
    path: string;
    problems: readonly string[];
  }): ChatgptSessionMalformedError => ({
    code: "SESSION_MALFORMED",
    message: `${path} is not a session chatgpt import-request wrote: ${problems.join("; ")}`,
    path,
  }),
  transportFailed: ({ path, cause }: { path: string; cause: unknown }): ChatgptTransportFailedError => ({
    code: "TRANSPORT_FAILED",
    message: `GET ${path} failed before an answer: ${cause instanceof Error ? cause.message : String(cause)}`,
  }),
} as const;
