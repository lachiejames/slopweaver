/**
 * The monitor lane's typed failures — one union, scoped to this directory, per `.claude/rules/error-handling.md`.
 *
 * There is deliberately NO ledger-read failure here: this lane keeps no record of what the owner has been told, because the
 * hand register already does and a second copy would be the surface the two eventually disagree on. What it does
 * keep is the owner's two kind answers (`./noteMutes.ts`, `./escalationHolds.ts`) — what they SAID about a kind's note, which
 * no register row carries — so those stores' failures and a kind answer this lane will not honour are here.
 *
 * Pure: shapes and factories, no I/O.
 */

/** A monitor's source was read but carried a shape this lane does not understand. */
export interface SourceShapeError {
  readonly code: "SOURCE_SHAPE";
  readonly message: string;
  readonly monitorId: string;
}

/** A value destined for the emitted filter script cannot be safely quoted into it. */
export interface ScriptUnsafeError {
  readonly code: "SCRIPT_UNSAFE";
  readonly message: string;
  readonly value: string;
}

/** A card's line is longer than the hand register allows. Rule 7: refuse, never truncate. */
export interface CardTooLongError {
  readonly code: "CARD_TOO_LONG";
  readonly message: string;
  readonly field: string;
}

/** The emitted filter script could not be written where the caller asked for it. */
export interface FilterUnwritableError {
  readonly code: "FILTER_UNWRITABLE";
  readonly message: string;
  readonly path: string;
}

/**
 * The mute store or the escalation hold store would not write, list or read one record. Every reader fails CLOSED
 * on it — an unreadable record keeps the note down — because a note the owner asked never to see again coming back is the
 * louder wrong, and the card is still on the Queue either way.
 */
export interface KindAnswerStoreError {
  readonly code: "KIND_ANSWER_STORE";
  readonly message: string;
  readonly path: string;
  readonly cause: string;
}

/**
 * A kind answer this lane will not honour: the step is no monitor's card, the kind is a notice whose note is its only
 * delivery, the monitor declares no `worsens`, the press carries no instant, or the kind is not one declared.
 */
export interface KindAnswerRefusedError {
  readonly code: "KIND_ANSWER_REFUSED";
  readonly message: string;
  /** The step or the kind the answer named. */
  readonly subject: string;
  readonly why: string;
}

/** Every way the monitor lane fails. */
export type MonitorError =
  | CardTooLongError
  | FilterUnwritableError
  | KindAnswerRefusedError
  | KindAnswerStoreError
  | ScriptUnsafeError
  | SourceShapeError;

/**
 * The factories every monitor failure is built through — tests construct fixtures with these too, so a
 * factory that stops matching its own type fails a test rather than a reader.
 */
export const MonitorErrors = {
  cardTooLong: ({ field, length, cap }: { field: string; length: number; cap: number }): CardTooLongError => ({
    code: "CARD_TOO_LONG",
    field,
    message:
      `a monitor card's ${field} is ${String(length)} characters against a cap of ${String(cap)} — the ` +
      `register refuses rather than truncating, because a line that stops mid-sentence is the failure rule 7 names`,
  }),
  filterUnwritable: ({ path, detail }: { path: string; detail: string }): FilterUnwritableError => ({
    code: "FILTER_UNWRITABLE",
    message: `the cmux notification filter could not be written to ${path}: ${detail}`,
    path,
  }),
  kindAnswerRefused: ({ subject, why }: { subject: string; why: string }): KindAnswerRefusedError => ({
    code: "KIND_ANSWER_REFUSED",
    message: `the kind answer on ${subject} was not honoured: ${why}`,
    subject,
    why,
  }),
  kindAnswerStore: ({ path, cause }: { path: string; cause: string }): KindAnswerStoreError => ({
    cause,
    code: "KIND_ANSWER_STORE",
    message: `the kind answer store at ${path} failed: ${cause} — the note stays down rather than read as unmuted`,
    path,
  }),
  scriptUnsafe: ({ value }: { value: string }): ScriptUnsafeError => ({
    code: "SCRIPT_UNSAFE",
    message:
      `the value ${value} cannot be quoted into the notification filter script — refusing to emit a script ` +
      `whose behaviour depends on how a shell parses it`,
    value,
  }),
  sourceShape: ({ monitorId, detail }: { monitorId: string; detail: string }): SourceShapeError => ({
    code: "SOURCE_SHAPE",
    message: `monitor ${monitorId} read its source but did not understand it: ${detail}`,
    monitorId,
  }),
} as const;
