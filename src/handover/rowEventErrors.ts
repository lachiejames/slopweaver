/**
 * The typed failures of the board row's write path — one discriminated union, scoped to this one bounded
 * module, per `.claude/rules/error-handling.md`.
 *
 * Every variant here is a DIFFERENT thing a caller may want to do about it, which is the test that earns a
 * union rather than a `readonly string[]`: a schema refusal means the verb built a bad event and the fix is in
 * the code; a forbidden transition means the register already says something incompatible and the fix is to
 * read it first; a read-back mismatch means the file on disk is not what was just written and NOTHING should
 * proceed on the assumption the event was recorded.
 *
 * Pure: every factory builds a value. No filesystem, no clock.
 */

import type { IngestError } from "#lib/ingestError.js";
import type { RunEvent, RunPhase } from "./ledger.js";
import type { RulingIntegrityError } from "./rulingErrors.js";

/** The event did not satisfy its own kind's schema. The write never reached the disk. */
export interface InvalidEventError {
  readonly code: "INVALID_EVENT";
  readonly message: string;
  /** Every rule the event broke, so one refusal reports the whole shape rather than the first defect. */
  readonly issues: readonly string[];
}

/** The register already says something this event cannot follow. */
export interface ForbiddenTransitionError {
  readonly code: "FORBIDDEN_TRANSITION";
  readonly message: string;
  readonly kind: RunEvent["kind"];
  readonly phase: RunPhase;
}

/** The journal could not be read, appended to, or re-read. Carries the boundary's own typed error. */
export interface JournalIoError {
  readonly code: "JOURNAL_IO";
  readonly message: string;
  readonly cause: IngestError;
}

/**
 * The append landed but the file does not read back as the event that was written.
 *
 * The one failure a caller must never treat as a warning: the whole value of an append-only register is that
 * what a later reader sees is what a writer meant, and a mismatch here says that guarantee just broke.
 */
export interface ReadBackMismatchError {
  readonly code: "READ_BACK_MISMATCH";
  readonly message: string;
  /** The event as it was written. */
  readonly wrote: string;
  /** The last event as the file reads back, or the reason there was none to compare against. */
  readonly read: string;
}

/**
 * The evidence a ruling rests on did not survive being checked against the journal it is going onto.
 *
 * Wraps `./rulingErrors.ts`'s own union rather than restating its variants, per the same rule that keeps the
 * two domains apart: what went wrong is a fact about the RULING, and a caller that wants to act on which
 * fact branches on `cause.code` rather than on a string this file invented.
 */
export interface RulingIntegrityFailedError {
  readonly code: "RULING_INTEGRITY_FAILED";
  readonly message: string;
  readonly cause: RulingIntegrityError;
}

/**
 * A ruling or a tag was offered for a journal with lines this build cannot decode.
 *
 * Refused rather than appended, and only for these two kinds. Every integrity check a ruling carries is a claim
 * ABOUT the journal — that no earlier ruling records the same decision, that exactly one `answered` event
 * carries the named source — and a line that did not decode could be either of those. A tag is judged against
 * what the row already holds, and an undecodable line could be a tag that write would repeat or contradict.
 * Checking against the lines that did parse would report clean while looking past the evidence.
 */
export interface JournalIncompleteError {
  readonly code: "JOURNAL_INCOMPLETE";
  readonly message: string;
  readonly unreadableLines: readonly number[];
  /** Which kind of event was refused. */
  readonly recording: IncompleteRecording;
}

/** The kinds refused onto a journal holding a line this build cannot read. */
type IncompleteRecording = "ruling" | "tagged" | "question-shaped" | "park-cleared" | "park-wake-suspended";

/** Why each of them is refused there — what a line nothing can read might be. */
const INCOMPLETE_WHY: { readonly [K in IncompleteRecording]: string } = {
  "park-cleared":
    "clear a park on a journal with undecodable line(s) {lines} — one of them could re-open the row the clear retires, and the park's position is counted over decoded lines only",
  "park-wake-suspended":
    "suspend a park's wake on a journal with undecodable line(s) {lines} — one of them could be the answer that leaves nothing to wait on, and the park's position is counted over decoded lines only",
  "question-shaped":
    "reshape a question on a journal with undecodable line(s) {lines} — one of them could be the shape or draft that makes the waiting question not one a reshape may replace",
  ruling:
    "reconstruct a ruling on a journal with undecodable line(s) {lines} — one of them could be the answer it rebuilds from, or a reconstruction of it already",
  tagged:
    "record a tag on a journal with undecodable line(s) {lines} — one of them could be a tag this write repeats or contradicts",
};

/** Every way {@link ../handover/rowEvent.applyRowEvent} can refuse or fail. */
export type RowWriteError =
  | InvalidEventError
  | ForbiddenTransitionError
  | JournalIoError
  | JournalIncompleteError
  | ReadBackMismatchError
  | RulingIntegrityFailedError;

/** The factories the write path builds its refusals with — the shape tests construct too. */
export const RowWriteErrors = {
  forbiddenTransition: ({
    kind,
    phase,
    why,
  }: {
    kind: RunEvent["kind"];
    phase: RunPhase;
    why: string;
  }): ForbiddenTransitionError => ({
    code: "FORBIDDEN_TRANSITION",
    kind,
    message: `refusing to record "${kind}" on a run that is ${phase} — ${why}`,
    phase,
  }),
  invalidEvent: ({ kind, issues }: { kind: string; issues: readonly string[] }): InvalidEventError => ({
    code: "INVALID_EVENT",
    issues,
    message: `"${kind}" does not satisfy its own schema: ${issues.join("; ")}`,
  }),
  journalIncomplete: ({
    unreadableLines,
    recording,
  }: {
    unreadableLines: readonly number[];
    recording: IncompleteRecording;
  }): JournalIncompleteError => ({
    code: "JOURNAL_INCOMPLETE",
    message: `refusing to ${INCOMPLETE_WHY[recording].replace("{lines}", unreadableLines.join(", "))}`,
    recording,
    unreadableLines,
  }),
  journalIo: ({ cause }: { cause: IngestError }): JournalIoError => ({
    cause,
    code: "JOURNAL_IO",
    message: cause.message,
  }),
  readBackMismatch: ({ wrote, read }: { wrote: string; read: string }): ReadBackMismatchError => ({
    code: "READ_BACK_MISMATCH",
    message: `the journal does not read back as what was just written — wrote ${wrote}, read ${read}`,
    read,
    wrote,
  }),
  rulingIntegrityFailed: ({ cause }: { cause: RulingIntegrityError }): RulingIntegrityFailedError => ({
    cause,
    code: "RULING_INTEGRITY_FAILED",
    message: `refusing to record this ruling: ${cause.message}`,
  }),
} as const;
