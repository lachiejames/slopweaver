/**
 * The typed failures of recording an owner ruling in a row's register.
 *
 * Its own union rather than a member of `./rowEventErrors.ts`, per `.claude/rules/error-handling.md`: these
 * are facts about the RULING and its source — a source event that is not there, an answer that does not say
 * what the caller claims it says, a decision already recorded — and a caller branches on which one it hit to
 * decide what to fix. `rowEventErrors.ts`'s union is about the WRITE (a refused transition, a journal that
 * would not open, a read-back that disagreed), and folding two domains into one union is what that rule
 * exists to prevent.
 *
 * **None of these is a policy refusal, so none of them carries an escape hatch.** A backfilled ruling whose
 * source is missing, ambiguous or says something else is not a rule saying no to something that would
 * otherwise have worked — it is a claim that could not be checked, and overriding it would write a decision
 * nobody can trace back to anything. `docs/constraints.md`'s line between fact and policy is the test, and
 * every variant here is on the fact side of it.
 *
 * Pure: every factory takes already-read values. No filesystem, no clock.
 */

/** A ruling identical in words, anchor and decision instant is already on this row's journal. */
export interface RulingAlreadyRecordedError {
  readonly code: "RULING_ALREADY_RECORDED";
  readonly message: string;
  /** When the standing one was decided, so a caller can print which record it collided with. */
  readonly decidedIso: string;
}

/** A backfilled ruling names a source `answered` event this row's journal already has a ruling for. */
export interface RulingSourceAlreadyRecordedError {
  readonly code: "RULING_SOURCE_ALREADY_RECORDED";
  readonly message: string;
  readonly sourceAtIso: string;
}

/** A backfilled ruling names a source instant no `answered` event on this row carries. */
export interface RulingSourceMissingError {
  readonly code: "RULING_SOURCE_MISSING";
  readonly message: string;
  readonly sourceAtIso: string;
}

/** Two or more `answered` events share the named source instant, so the source is not identified. */
export interface RulingSourceAmbiguousError {
  readonly code: "RULING_SOURCE_AMBIGUOUS";
  readonly message: string;
  readonly sourceAtIso: string;
  readonly found: number;
}

/** The words offered are not what the source `answered` event actually recorded. */
export interface RulingSourceWordsMismatchError {
  readonly code: "RULING_SOURCE_WORDS_MISMATCH";
  readonly message: string;
  readonly sourceAtIso: string;
}

/** A backfilled ruling's decision instant is not its source's own instant. */
export interface RulingSourceTimeInvalidError {
  readonly code: "RULING_SOURCE_TIME_INVALID";
  readonly message: string;
  readonly sourceAtIso: string;
  readonly decidedIso: string;
}

/** Every way recording a ruling can fail on the evidence rather than on the write. */
export type RulingIntegrityError =
  | RulingAlreadyRecordedError
  | RulingSourceAlreadyRecordedError
  | RulingSourceMissingError
  | RulingSourceAmbiguousError
  | RulingSourceWordsMismatchError
  | RulingSourceTimeInvalidError;

/** Build one of this domain's errors — the shape every caller and every test constructs them through. */
export const RulingIntegrityErrors = {
  alreadyRecorded: ({ decidedIso }: { decidedIso: string }): RulingAlreadyRecordedError => ({
    code: "RULING_ALREADY_RECORDED",
    decidedIso,
    message:
      `this row already records that exact ruling, decided ${decidedIso} — a ruling is appended once, and ` +
      "recording it twice would make one decision read as two",
  }),
  sourceAlreadyRecorded: ({ sourceAtIso }: { sourceAtIso: string }): RulingSourceAlreadyRecordedError => ({
    code: "RULING_SOURCE_ALREADY_RECORDED",
    message:
      `this row already carries a ruling reconstructed from the answer of ${sourceAtIso} — ` +
      "one source answer becomes one ruling, so re-running the backfill changes nothing",
    sourceAtIso,
  }),
  sourceAmbiguous: ({ found, sourceAtIso }: { found: number; sourceAtIso: string }): RulingSourceAmbiguousError => ({
    code: "RULING_SOURCE_AMBIGUOUS",
    found,
    message:
      `${String(found)} answered events on this row share the instant ${sourceAtIso}, so the source is not ` +
      "identified — nothing can say which of them this ruling came out of",
    sourceAtIso,
  }),
  sourceMissing: ({ sourceAtIso }: { sourceAtIso: string }): RulingSourceMissingError => ({
    code: "RULING_SOURCE_MISSING",
    message:
      `no answered event on this row carries the instant ${sourceAtIso} — a backfilled ruling is copied out ` +
      "of the journal it is going onto, so a source that is not there is a ruling nobody can check",
    sourceAtIso,
  }),
  sourceTimeInvalid: ({
    decidedIso,
    sourceAtIso,
  }: {
    decidedIso: string;
    sourceAtIso: string;
  }): RulingSourceTimeInvalidError => ({
    code: "RULING_SOURCE_TIME_INVALID",
    decidedIso,
    message:
      `a backfilled ruling is decided when its source was answered, so decidedIso must be ${sourceAtIso}, ` +
      `not ${decidedIso} — otherwise a reconstruction could outrank a decision the owner has given since`,
    sourceAtIso,
  }),
  sourceWordsMismatch: ({ sourceAtIso }: { sourceAtIso: string }): RulingSourceWordsMismatchError => ({
    code: "RULING_SOURCE_WORDS_MISMATCH",
    message:
      `the words offered are not what the answered event of ${sourceAtIso} recorded — a backfill copies an ` +
      "answer whole rather than extracting from it, so anything short of exact equality is a different claim",
    sourceAtIso,
  }),
} as const;
