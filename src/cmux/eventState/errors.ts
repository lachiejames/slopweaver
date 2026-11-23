/**
 * The typed failure kinds of the CMUX EVENT STATE — the store's `cmux_event_state` rows that say how far each
 * reader of cmux's event stream has got, `session watch`'s fold beside its cursor, and the one-time import from
 * the two home files they replace.
 *
 * Per `.claude/rules/error-handling.md` this union stands alone: it shares no base type with `CmuxError`,
 * which is about the cmux socket, nor with the plan register's union, which it resembles only in shape.
 *
 * ## Nothing here is an empty fold
 *
 * The files these rows replace answered a damaged snapshot with `{}`, silently, so an unanswered attention a
 * session raised before the damage simply vanished from the supervisor's view. Every variant below is a
 * refusal instead: a store that cannot be reached, a stored row that does not decode, an import file that is
 * there but unbelievable. {@link CmuxEventStoreUnavailableError} is its own code so no reader can mistake "the
 * store could not be read" for "no event has been folded yet" — the second replays cmux's whole retained buffer
 * into a fold that already counted it.
 *
 * **No variant carries a credential.** A store message never carries the connection string, and these
 * messages are printed into logs and transcripts.
 */

/** Which reader's row is meant: `session watch`'s cursor-and-fold, or `cmux events`'s cursor alone. */
export type CmuxEventConsumer = "session-watch" | "cmux-events";

/** The store holding the rows could not be selected, reached, or queried. Nothing was read or written. */
export interface CmuxEventStoreUnavailableError {
  readonly code: "CMUX_EVENT_STORE_UNAVAILABLE";
  readonly message: string;
}

/** A stored row is there and does not decode — a fold entry of the wrong shape, a key naming another workspace. */
export interface CmuxEventStoredInvalidError {
  readonly code: "CMUX_EVENT_STORED_INVALID";
  readonly message: string;
  readonly consumer: CmuxEventConsumer;
  /** Every problem found at once, so the reader sees the whole damage rather than the first entry of it. */
  readonly problems: readonly string[];
}

/** An import file is PRESENT and could not be read — a permission error, a directory, an I/O failure. */
export interface CmuxEventImportUnreadableError {
  readonly code: "CMUX_EVENT_IMPORT_UNREADABLE";
  readonly message: string;
  readonly path: string;
}

/** The import files read fine and are not a state this version can adopt — damaged, or only half of a pair. */
export interface CmuxEventImportInvalidError {
  readonly code: "CMUX_EVENT_IMPORT_INVALID";
  readonly message: string;
  readonly consumer: CmuxEventConsumer;
  readonly problems: readonly string[];
}

/**
 * Another writer committed between this writer's read and its compare-and-set. Nothing was written, and nothing
 * retries: the events this writer folded are still after the winner's cursor, so a later run sees them again.
 */
export interface CmuxEventRevisionConflictError {
  readonly code: "CMUX_EVENT_REVISION_CONFLICT";
  readonly message: string;
  readonly consumer: CmuxEventConsumer;
  /** The revision this writer pinned its update to; `0` when it expected no row at all. */
  readonly expectedRevision: number;
}

/**
 * `session watch --since N` named a start the stored fold does not stand at. Folding from N into a fold built up
 * to a different cursor would count some events twice or skip some, so it is refused rather than guessed.
 */
export interface CmuxEventSinceConflictError {
  readonly code: "CMUX_EVENT_SINCE_CONFLICT";
  readonly message: string;
  readonly since: number;
  readonly storedSeq: number;
}

/** Every way reading or writing a cmux event-stream reader's state can fail. */
export type CmuxEventStateError =
  | CmuxEventStoreUnavailableError
  | CmuxEventStoredInvalidError
  | CmuxEventImportUnreadableError
  | CmuxEventImportInvalidError
  | CmuxEventRevisionConflictError
  | CmuxEventSinceConflictError;

/** The escape every refusal about `session watch`'s fold names: start a fresh fold at a chosen sequence. */
const RESET_ESCAPE = "`slopweaver session watch --reset-state --since <seq>` starts a fresh fold at that sequence";

/**
 * The escape a refusal names for one consumer.
 *
 * @param consumer whose row the refusal is about
 * @returns the sentence naming the way past it
 */
function escapeFor({ consumer }: { consumer: CmuxEventConsumer }): string {
  if (consumer === "session-watch") {
    return RESET_ESCAPE;
  }
  return "`slopweaver cmux events --since <seq>` starts its cursor at that sequence instead";
}

/** The factories for every {@link CmuxEventStateError} variant. */
export const CmuxEventStateErrors = {
  importInvalid: ({
    consumer,
    problems,
  }: {
    consumer: CmuxEventConsumer;
    problems: readonly string[];
  }): CmuxEventImportInvalidError => ({
    code: "CMUX_EVENT_IMPORT_INVALID",
    consumer,
    message: `the ${consumer} state in the home cannot be imported into the store (${problems.join("; ")}) — ${escapeFor({ consumer })}`,
    problems,
  }),
  importUnreadable: ({ path, reason }: { path: string; reason: string }): CmuxEventImportUnreadableError => ({
    code: "CMUX_EVENT_IMPORT_UNREADABLE",
    message: `${path} is there but could not be read for its one-time import into the store (${reason})`,
    path,
  }),
  revisionConflict: ({
    consumer,
    expectedRevision,
  }: {
    consumer: CmuxEventConsumer;
    expectedRevision: number;
  }): CmuxEventRevisionConflictError => ({
    code: "CMUX_EVENT_REVISION_CONFLICT",
    consumer,
    expectedRevision,
    message:
      `another ${consumer} committed its state first (this one expected revision ${String(expectedRevision)}) — ` +
      "nothing was written and nothing retries; the events this run read are still after the stored cursor",
  }),
  sinceConflict: ({ since, storedSeq }: { since: number; storedSeq: number }): CmuxEventSinceConflictError => ({
    code: "CMUX_EVENT_SINCE_CONFLICT",
    message:
      `--since ${String(since)} does not match the stored fold's cursor (${String(storedSeq)}), and folding from one ` +
      `into a fold built to the other would count or skip events — drop --since to resume, or ${RESET_ESCAPE}`,
    since,
    storedSeq,
  }),
  storeUnavailable: ({ doing, reason }: { doing: string; reason: string }): CmuxEventStoreUnavailableError => ({
    code: "CMUX_EVENT_STORE_UNAVAILABLE",
    message:
      `the store could not ${doing} (${withoutCredentials({ text: reason })}) — nothing was read or written; ` +
      "`slopweaver store status` says why",
  }),
  storedInvalid: ({
    consumer,
    problems,
  }: {
    consumer: CmuxEventConsumer;
    problems: readonly string[];
  }): CmuxEventStoredInvalidError => ({
    code: "CMUX_EVENT_STORED_INVALID",
    consumer,
    message: `the stored ${consumer} state cannot be trusted (${problems.join("; ")}) — ${escapeFor({ consumer })}`,
    problems,
  }),
} as const;

/**
 * One URL token after its `scheme://`, with its userinfo and its whole query and fragment replaced.
 *
 * Judged on the WHOLE token, because the two halves cannot be told apart one pattern at a time: a password may
 * carry an unencoded `@`, `/`, `?` or `#`, and a query value may carry an `@`. When the token's last `@` sits
 * before its first `?` or `#`, everything up to that `@` is userinfo, and the query after it goes too. When an
 * `@` sits after the query starts, either reading is possible — a query value holding `@`, or a password holding
 * `?` — so nothing after the scheme survives.
 *
 * @param rest the token after `scheme://`, up to the next whitespace
 * @returns what of it an outage message may print
 */
function urlRestWithoutCredentials({ rest }: { rest: string }): string {
  const queryAt = rest.search(/[?#]/);
  const authorityEnd = queryAt === -1 ? rest.length : queryAt;
  const lastAt = rest.lastIndexOf("@");
  if (lastAt > authorityEnd) {
    return "[redacted]";
  }
  const query = queryAt === -1 ? "" : "?[redacted]";
  if (lastAt === -1) {
    return `${rest.slice(0, authorityEnd)}${query}`;
  }
  return `[redacted]@${rest.slice(lastAt + 1, authorityEnd)}${query}`;
}

/**
 * A driver's reason with any credential a connection string carried replaced, so an outage message never prints
 * the store URL's secret half. A URL loses its userinfo and its WHOLE query and fragment, rather than any one
 * parameter: a query key may be percent-encoded (`pass%77ord`), so no list of spellings is complete, and an outage
 * reader needs only the scheme, host and path — and a token too ambiguous to split keeps only its scheme
 * ({@link urlRestWithoutCredentials}). A libpq key/value string loses EVERYTHING from its first `password`
 * or `sslpassword` keyword to the end of the message, for the same reason: quoting and backslash escapes (an
 * escaped newline included) let a value run past any pattern for where it ends, and the cost is only the trailing
 * detail of a message that named a password. Every `CMUX_EVENT_STORE_UNAVAILABLE` message passes through here,
 * whichever seam produced the reason.
 *
 * @param text the reason as the driver or a seam worded it
 * @returns the same reason with every credential replaced by `[redacted]`
 */
export function withoutCredentials({ text }: { text: string }): string {
  const urlsRedacted = text.replace(
    /([a-z][a-z0-9+.-]*:\/\/)(\S*)/gi,
    (_whole, scheme: string, rest: string) => `${scheme}${urlRestWithoutCredentials({ rest })}`,
  );
  // A cut at the keyword rather than a pattern running to the end: a `[\s\S]*$` tail after `\s*` backtracks.
  const keyword = /password\s*=\s*/i.exec(urlsRedacted);
  if (keyword === null) {
    return urlsRedacted;
  }
  return `${urlsRedacted.slice(0, keyword.index + keyword[0].length)}[redacted]`;
}

/**
 * Name a thrown value for a message, without ever printing more than its own message.
 *
 * @param cause what was thrown
 * @returns its message, or a fixed phrase when it is not an Error
 */
export function describeCmuxEventCause({ cause }: { cause: unknown }): string {
  if (cause instanceof Error) {
    return cause.message;
  }
  return "a failure that is not an Error";
}
