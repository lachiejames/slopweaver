/**
 * The `talk` domain's typed error union — one per bounded module, never shared across domains
 * (`.claude/rules/error-handling.md`).
 *
 * One of these variants exists because of a distinction this domain has to keep sharp, and stating it here
 * rather than at each call site is the point of the file.
 *
 * **`PATH_ALIASED` is separate from `PATH_OUTSIDE` because a tracked PATH is not bounded BYTES.** A name
 * `git ls-files` reports, inside the checkout, passing every containment check, can still be a symlink to an
 * untracked file or a hard link to a file on the other side of the machine. A pre-mortem reproduced both.
 * `src/lib/pathContainment.ts` had already met the hard-link half on the WRITE
 * side and checks `nlink > 1` for it; this union is the read side of the same idea.
 */
import { isRecord } from "../lib/parsers.js";

import { type RelayDraftError, RelayDraftErrors } from "./relayDraftErrors.js";

/** The serving checkout's root could not be resolved, so there is no bounded tree to read from. */
export interface CheckoutUnresolvedError {
  readonly code: "CHECKOUT_UNRESOLVED";
  readonly message: string;
  readonly cwd: string;
}

/** `git ls-files` could not enumerate the checkout. Distinct from "the checkout has no files". */
export interface EnumerationFailedError {
  readonly code: "ENUMERATION_FAILED";
  readonly message: string;
  readonly root: string;
}

/** The requested path is not one `git ls-files` reports at the resolved root. */
export interface PathNotTrackedError {
  readonly code: "PATH_NOT_TRACKED";
  readonly message: string;
  readonly path: string;
}

/** The requested path resolves outside the checkout root. */
export interface PathOutsideError {
  readonly code: "PATH_OUTSIDE";
  readonly message: string;
  readonly path: string;
}

/** The requested path is a second NAME for some other file — a symlink, or a hard link. */
export interface PathAliasedError {
  readonly code: "PATH_ALIASED";
  readonly message: string;
  readonly path: string;
  readonly alias: "symlink" | "hard-link" | "not-a-regular-file" | "case-folded";
}

/** The path could not be opened or read. */
export interface PathUnreadableError {
  readonly code: "PATH_UNREADABLE";
  readonly message: string;
  readonly path: string;
  readonly cause: unknown;
}

/** A continuation offset or a budget that cannot describe a window of this file. */
export interface WindowInvalidError {
  readonly code: "WINDOW_INVALID";
  readonly message: string;
  readonly from: number;
  readonly size: number;
}

/** A relay picture that is not a bounded WebP this verb can store, or that differs from the one the turn holds. */
export interface PictureInvalidError {
  readonly code: "PICTURE_INVALID";
  readonly message: string;
  readonly path: string;
}

/** A `talk row` slug that is not a board slug — the shape check that keeps the read inside the board. */
export interface SlugInvalidError {
  readonly code: "SLUG_INVALID";
  readonly message: string;
  readonly slug: string;
}

/** No board row carries that slug. */
export interface RowMissingError {
  readonly code: "ROW_MISSING";
  readonly message: string;
  readonly slug: string;
}

/** The same turn id has already been staged or relayed, carrying DIFFERENT words. */
export interface RelayConflictError {
  readonly code: "RELAY_CONFLICT";
  readonly message: string;
  readonly turnId: string;
}

/** Another live process is relaying the same turn right now, so this run wrote and typed nothing. */
export interface RelayInFlightError {
  readonly code: "RELAY_IN_FLIGHT";
  readonly message: string;
  readonly turnId: string;
  /** The live holder's pid, or `null` when the lease was taken between two reads and named none yet. */
  readonly pid: number | null;
}

/** Which session is the supervisor could not be settled: no pin, or a pin naming a session that is not live. */
export interface SupervisorUnresolvedError {
  readonly code: "SUPERVISOR_UNRESOLVED";
  readonly message: string;
}

/** The supervisor's session has no transcript under `~/.claude/projects/`. */
export interface TranscriptMissingError {
  readonly code: "TRANSCRIPT_MISSING";
  readonly message: string;
  readonly sessionId: string;
}

/** A call id that is not a v4 UUID — the shape check that keeps a call file inside `talk/calls`. */
export interface CallInvalidError {
  readonly code: "CALL_INVALID";
  readonly message: string;
  readonly callId: string;
}

/** A call-transcript batch that is not lines this verb can append — a malformed line, or too many. */
export interface CallEntriesInvalidError {
  readonly code: "CALL_ENTRIES_INVALID";
  readonly message: string;
  readonly path: string;
}

/**
 * A batch for a call whose loss `talk quarantine` accepted: `talk unread` reads past that id while no file sits at
 * its path, so a line appended now could be removed again unread.
 */
export interface CallQuarantinedError {
  readonly code: "CALL_QUARANTINED";
  readonly message: string;
  readonly callId: string;
}

/**
 * A `talk transcript` run whose route handoff (`./callWriteIntent.ts`'s `handoffOpen`) had lapsed by the time the run
 * announced itself: a fence may already have passed it unseen, so the run writes nothing.
 */
export interface HandoffLapsedError {
  readonly code: "HANDOFF_LAPSED";
  readonly message: string;
  readonly intent: string;
}

/**
 * A record the owner's words are read off — a call file or the card landing ledger — that an approval could not hold
 * still while it read and recorded them, so nothing was recorded (`./callFence.ts`).
 */
export interface CallFenceUnheldError {
  readonly code: "CALL_FENCE_UNHELD";
  readonly message: string;
  /** What could not be held still, as a refusal names it. */
  readonly subject: string;
}

/** Every way `slopweaver talk` fails. */
export type TalkError =
  | CallFenceUnheldError
  | HandoffLapsedError
  | CheckoutUnresolvedError
  | EnumerationFailedError
  | PathNotTrackedError
  | PathOutsideError
  | PathAliasedError
  | PathUnreadableError
  | WindowInvalidError
  | RelayDraftError
  | PictureInvalidError
  | SlugInvalidError
  | RowMissingError
  | RelayConflictError
  | RelayInFlightError
  | SupervisorUnresolvedError
  | TranscriptMissingError
  | CallInvalidError
  | CallEntriesInvalidError
  | CallOriginUnopenedError
  | CallQuarantinedError
  | SlackAnswerOverCeilingError;

/**
 * A Slack read whose own sentence, names and warnings are over the answer ceiling with no message in them, so not
 * even an empty read fits the page's tool cap (`./slackMessageFit.ts`).
 */
export interface SlackAnswerOverCeilingError {
  readonly code: "SLACK_ANSWER_OVER_CEILING";
  readonly message: string;
  /** The whole serialised answer's UTF-8 bytes. */
  readonly bytes: number;
  /** The ceiling it is over, in UTF-8 bytes. */
  readonly ceilingBytes: number;
}

/**
 * A batch from a console that is not the owner's, carrying no open line, for a call no open line of that same console
 * opened: appended, its speech would sit under no origin or another console's, and read as the owner's.
 */
export interface CallOriginUnopenedError {
  readonly code: "CALL_ORIGIN_UNOPENED";
  readonly message: string;
  readonly callId: string;
}

/** The factories every `talk` failure is constructed through — tests build fixtures from these too. */
export const TalkErrors = {
  ...RelayDraftErrors,
  callEntriesInvalid: ({ path, why }: { path: string; why: string }): CallEntriesInvalidError => ({
    code: "CALL_ENTRIES_INVALID",
    message: `${path} is not a call-transcript batch this verb appends — ${why}; nothing was written`,
    path,
  }),
  callOriginUnopened: ({ callId }: { callId: string }): CallOriginUnopenedError => ({
    callId,
    code: "CALL_ORIGIN_UNOPENED",
    message:
      `call ${callId} was not opened by this console, and a console that is not the owner's only appends to a call it ` +
      `opened — its speech would otherwise read as the owner's`,
  }),
  callQuarantined: ({ callId }: { callId: string }): CallQuarantinedError => ({
    callId,
    code: "CALL_QUARANTINED",
    message:
      `call ${callId}'s loss is accepted on the record (talk/call-quarantine.jsonl), so it is closed and nothing ` +
      "more is appended to it — a call that is still running starts a new id",
  }),
  callFenceUnheld: ({ subject, why }: { subject: string; why: string }): CallFenceUnheldError => ({
    code: "CALL_FENCE_UNHELD",
    message: `${subject} could not be held still while the approval was recorded: ${why}`,
    subject,
  }),
  handoffLapsed: ({ intent }: { intent: string }): HandoffLapsedError => ({
    code: "HANDOFF_LAPSED",
    intent,
    message: `the route's handoff ${intent} was gone or stale when this run announced itself — nothing was written; post the batch again`,
  }),
  callInvalid: ({ callId }: { callId: string }): CallInvalidError => ({
    callId,
    code: "CALL_INVALID",
    message: `${callId} is not a call id — a call is a v4 UUID the console mints, and its file is named by it`,
  }),
  checkoutUnresolved: ({ cwd }: { cwd: string }): CheckoutUnresolvedError => ({
    code: "CHECKOUT_UNRESOLVED",
    cwd,
    message:
      `could not resolve a git checkout root from ${cwd} — refusing to read, because falling back to the ` +
      "working directory would read whatever tree the server happened to start in",
  }),
  enumerationFailed: ({ root, cause }: { root: string; cause: unknown }): EnumerationFailedError => ({
    code: "ENUMERATION_FAILED",
    message:
      `could not list the tracked files of ${root} (${describe({ cause })}) — refusing, because an ` +
      "enumeration that failed and one that found nothing are not the same answer",
    root,
  }),
  pathAliased: ({ path, alias }: { path: string; alias: PathAliasedError["alias"] }): PathAliasedError => ({
    alias,
    code: "PATH_ALIASED",
    message:
      `${path} is ${aliasPhrase({ alias })} — refusing to read through it, because a tracked NAME is not ` +
      "the same claim as bounded bytes",
    path,
  }),
  pathNotTracked: ({ path }: { path: string }): PathNotTrackedError => ({
    code: "PATH_NOT_TRACKED",
    message: `${path} is not a tracked file in this checkout — the console voice can read tracked files only`,
    path,
  }),
  pathOutside: ({ path }: { path: string }): PathOutsideError => ({
    code: "PATH_OUTSIDE",
    message: `${path} resolves outside the checkout root`,
    path,
  }),
  pathUnreadable: ({ path, cause }: { path: string; cause: unknown }): PathUnreadableError => ({
    cause,
    code: "PATH_UNREADABLE",
    message: `could not read ${path}: ${describe({ cause })}`,
    path,
  }),
  pictureInvalid: ({ path, why }: { path: string; why: string }): PictureInvalidError => ({
    code: "PICTURE_INVALID",
    message: `the relay picture at ${path} ${why}`,
    path,
  }),
  relayConflict: ({ turnId, registered }: { turnId: string; registered: boolean }): RelayConflictError => ({
    code: "RELAY_CONFLICT",
    message:
      `turn ${turnId} was already ${registered ? "relayed" : "staged"}, carrying different words, a different picture, ` +
      "a different ruling on a candidate or a different copy-tray offer — " +
      "refusing rather than writing a second row or returning a receipt for a relay nobody made",
    turnId,
  }),
  relayInFlight: ({ turnId, pid }: { turnId: string; pid: number | null }): RelayInFlightError => ({
    code: "RELAY_IN_FLIGHT",
    message: `turn ${turnId} is still being relayed by ${pid === null ? "another run" : `pid ${String(pid)}`} — this run wrote and typed nothing; run it again once that one finishes, and it replays that run's outcome`,
    pid,
    turnId,
  }),
  rowMissing: ({ slug }: { slug: string }): RowMissingError => ({
    code: "ROW_MISSING",
    message: `no board row is named ${slug}`,
    slug,
  }),
  supervisorUnresolved: ({ why }: { why: readonly string[] }): SupervisorUnresolvedError => ({
    code: "SUPERVISOR_UNRESOLVED",
    message: why.join("; "),
  }),
  transcriptMissing: ({ sessionId }: { sessionId: string }): TranscriptMissingError => ({
    code: "TRANSCRIPT_MISSING",
    message: `no transcript was found for session ${sessionId}`,
    sessionId,
  }),
  slackAnswerOverCeiling: ({
    bytes,
    ceilingBytes,
  }: {
    bytes: number;
    ceilingBytes: number;
  }): SlackAnswerOverCeilingError => ({
    bytes,
    ceilingBytes,
    code: "SLACK_ANSWER_OVER_CEILING",
    message:
      `the read's own sentence, names and warnings come to ${String(bytes)} bytes with no message in them, ` +
      `over the ${String(ceilingBytes)}-byte answer ceiling, so nothing could be carried`,
  }),
  slugInvalid: ({ slug }: { slug: string }): SlugInvalidError => ({
    code: "SLUG_INVALID",
    message: `${slug} is not a board slug — lowercase letters, digits and hyphens, at most 160 characters`,
    slug,
  }),
  windowInvalid: ({ from, size }: { from: number; size: number }): WindowInvalidError => ({
    code: "WINDOW_INVALID",
    from,
    message: `byte offset ${String(from)} does not describe a window of a ${String(size)}-byte file`,
    size,
  }),
} as const;

/** How an alias reads in a refusal, so the message names the specific mechanism rather than "an alias". */
function aliasPhrase({ alias }: { alias: PathAliasedError["alias"] }): string {
  if (alias === "symlink") {
    return "a symlink to another file";
  }
  if (alias === "hard-link") {
    return "a hard link, so a second name for its bytes exists outside this checkout's control";
  }
  if (alias === "case-folded") {
    return "not the name this directory actually lists, so the filesystem folded it onto a different entry";
  }
  return "not a regular file";
}

/**
 * An unknown thrown value as one clause of a message.
 *
 * A boundary failure arrives as an `IngestError`, a plain record rather than an `Error`, and `String()` of
 * one is `[object Object]` — which is exactly what the console voice showed for every refused mint until the
 * record's own `message` was read here.
 */
function describe({ cause }: { cause: unknown }): string {
  if (cause instanceof Error) {
    return cause.message;
  }
  if (isRecord(cause) && typeof cause["message"] === "string") {
    return cause["message"];
  }
  return String(cause);
}
