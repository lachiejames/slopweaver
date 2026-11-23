/**
 * The typed domain error for every Calendar door verb — see `.claude/rules/error-handling.md` for the shape.
 * Its own union, shared with no other provider: the doors hold separate grants and separate scopes, so a
 * caller genuinely does branch on them separately.
 *
 * The four grant-lifecycle variants come from `../google/credentialErrors.js` rather than being declared
 * here, for the reason that file's header gives. What is this door's own is the two failures nothing shared
 * can emit: an address that is not an event this door can reach, and a sync token Google will not honour.
 */
import { type GoogleCredentialError, googleCredentialErrors } from "../google/credentialErrors.js";

/** The caller-supplied address is not a calendar id or an event id this door can address. */
export interface InvalidAddressError {
  readonly code: "INVALID_ADDRESS";
  readonly message: string;
}

/**
 * The stored `syncToken` is no longer accepted, so a delta read cannot resume from it.
 *
 * Its own variant rather than an {@link ApiFailedError} carrying a 410, because it is the ONE Calendar
 * failure a caller is expected to recover from rather than report: the answer is to re-crawl the window and
 * re-anchor, and only a caller holding a stored token can decide that. Google invalidates a sync token
 * whenever its own retention or the request's parameters change, which it documents as an ordinary event
 * rather than an error condition, so this is the expected outcome of a long gap and not an edge case.
 */
export interface SyncTokenExpiredError {
  readonly code: "SYNC_TOKEN_EXPIRED";
  readonly message: string;
  /** The calendar whose token Google refused. */
  readonly calendarId: string;
}

/** The Calendar API call failed (network, rate limit, revoked grant, or a malformed response). */
export interface ApiFailedError {
  readonly code: "API_FAILED";
  readonly message: string;
  readonly cause?: unknown;
}

/** Google refused a conditional write: the event moved since the ETag the approval was computed over. */
export interface VersionConflictError {
  readonly code: "VERSION_CONFLICT";
  readonly message: string;
}

/** Google already holds an event with the id this insert carried — the write reached it once before. */
export interface AlreadyAppliedError {
  readonly code: "ALREADY_APPLIED";
  readonly message: string;
}

/** A write form or its target was refused before any call — the caller-facing reasons, all of them. */
export interface InvalidWriteError {
  readonly code: "INVALID_WRITE";
  readonly message: string;
  readonly problems: readonly string[];
}

/**
 * The stored intent names an account or a calendar this session is not writing to.
 *
 * Its own variant rather than an {@link InvalidWriteError}, because the recovery is different in kind: the
 * form was fine and the event exists — what moved is WHOSE diary the door is bound to, so the answer is to
 * re-connect or re-prepare, never to correct the form.
 */
export interface WriteTargetMismatchError {
  readonly code: "WRITE_TARGET_MISMATCH";
  readonly message: string;
  /** The account and calendar the intent was prepared against. */
  readonly intended: { readonly account: string; readonly calendarId: string };
  /** The account this session is actually bound to. */
  readonly bound: string;
}

/** No pending intent carries that id under this home, or it is spent. */
export interface IntentUnknownError {
  readonly code: "INTENT_UNKNOWN";
  readonly message: string;
  readonly intentId: string;
}

/**
 * The outbound privacy check stopped a mutation before its provider call started (`../../outbound/calendar/writePrivacy.ts`).
 *
 * Its own variant rather than an {@link ApiFailedError}, because the two mean opposite things about the intent: an
 * API failure MAY have reached Google, so the intent is marked `uncertain` and never re-sent, while this one
 * definitely did not, so the intent stays `pending` — a repaired terms file retries the same commit, and a reworded
 * one is a fresh prepare.
 */
export interface PrivacyRefusedError {
  readonly code: "PRIVACY_REFUSED";
  /** The whole refusal: what was stopped, one redacted line per finding, and that there is no override. */
  readonly message: string;
  readonly refusedBeforeWire: true;
}

/** Every failure a Calendar door verb can produce. */
export type CalendarError =
  | GoogleCredentialError
  | InvalidAddressError
  | SyncTokenExpiredError
  | ApiFailedError
  | VersionConflictError
  | AlreadyAppliedError
  | InvalidWriteError
  | IntentUnknownError
  | PrivacyRefusedError
  | WriteTargetMismatchError;

/**
 * Factories for every {@link CalendarError} variant — the shape real code and its tests both construct
 * through.
 */
export const CalendarErrors = {
  ...googleCredentialErrors({ connectVerb: "slopweaver calendar connect", productName: "Google Calendar" }),

  /** @returns an {@link ApiFailedError} wrapping the underlying provider failure */
  apiFailed: ({ message, cause }: { message: string; cause?: unknown }): ApiFailedError => ({
    code: "API_FAILED",
    message,
    ...(cause !== undefined ? { cause } : {}),
  }),

  /** @returns an {@link AlreadyAppliedError} for the 409 a repeated idempotent insert earns */
  alreadyApplied: (): AlreadyAppliedError => ({
    code: "ALREADY_APPLIED",
    message:
      "Google already holds an event with this id — the write reached it once before. Read the event back rather " +
      "than sending it again",
  }),

  /** @returns an {@link IntentUnknownError} naming the id no pending intent carries */
  intentUnknown: ({ intentId }: { intentId: string }): IntentUnknownError => ({
    code: "INTENT_UNKNOWN",
    intentId,
    message: `no pending calendar intent ${intentId} under this home — it was never prepared, or it has been committed`,
  }),

  /** @returns an {@link InvalidAddressError} carrying the caller-facing reason */
  invalidAddress: ({ message }: { message: string }): InvalidAddressError => ({
    code: "INVALID_ADDRESS",
    message,
  }),

  /** @returns an {@link InvalidWriteError} carrying every reason the form or target was refused */
  invalidWrite: ({ problems }: { problems: readonly string[] }): InvalidWriteError => ({
    code: "INVALID_WRITE",
    message: problems.join("; "),
    problems,
  }),

  /** @returns a {@link PrivacyRefusedError} carrying the privacy check's whole refusal text */
  privacyRefused: ({ message }: { message: string }): PrivacyRefusedError => ({
    code: "PRIVACY_REFUSED",
    message,
    refusedBeforeWire: true,
  }),

  /** @returns a {@link WriteTargetMismatchError} naming both the intended target and the bound account */
  writeTargetMismatch: ({
    intended,
    bound,
  }: {
    intended: { account: string; calendarId: string };
    bound: string;
  }): WriteTargetMismatchError => ({
    bound,
    code: "WRITE_TARGET_MISMATCH",
    intended,
    message:
      `this intent was prepared for ${intended.account}'s ${intended.calendarId} calendar and this session is ` +
      `bound to ${bound} — re-connect the account it was prepared under, or prepare the write again. A write ` +
      "is only ever made to the bound account's own primary calendar",
  }),

  /** @returns a {@link VersionConflictError} for the 412 a stale If-Match earns */
  versionConflict: (): VersionConflictError => ({
    code: "VERSION_CONFLICT",
    message:
      "the event changed since it was previewed (Google refused the If-Match) — re-run the verb to preview it " +
      "again; an approval never carries over a change nobody read",
  }),

  /** @returns a {@link SyncTokenExpiredError} naming the calendar Google would not resume */
  syncTokenExpired: ({ calendarId }: { calendarId: string }): SyncTokenExpiredError => ({
    calendarId,
    code: "SYNC_TOKEN_EXPIRED",
    message:
      `Google will no longer resume ${calendarId} from the stored sync token. It invalidates one whenever ` +
      "its retention or the request's own parameters change, so this calendar must be re-crawled by window",
  }),
} as const;
