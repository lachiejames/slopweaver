/**
 * Building one line of the autonomy ledger — the pure half of the register's write path.
 *
 * No filesystem, no clock, no network: every instant is passed in, exactly like `../knowledge/row.ts` and
 * `../reflect/finding.ts`, so every check here is testable without a seam.
 *
 * How the row shapes are told apart, and decoding a stored line back into one, is `./decode.ts`.
 */
import { err, ok, type Result } from "../lib/result.js";

import { type AutonomyError, AutonomyErrors } from "./errors.js";
import {
  isAutonomyActionId,
  isAutonomyKind,
  isCheckableSubject,
  requireInstant,
  requireSaid,
  requireText,
} from "./fields.js";
import {
  AUTONOMY_ACTION_ID_MAX,
  AUTONOMY_ACTION_ID_MIN,
  AUTONOMY_RUN_MAX,
  AUTONOMY_SESSION_MAX,
  AUTONOMY_STEER_MAX,
  AUTONOMY_WHY_MAX,
  AUTONOMY_WITNESS_MAX,
  type AutonomyActionRow,
  type AutonomyRecord,
  type AutonomySteerRow,
  classIdPrefixOf,
} from "./types.js";

/** Attach `said`, `run` and `steer` when they carry something, refusing any that is present and unusable. */
function withOptionals({
  base,
  said,
  run,
  steer,
}: {
  base: AutonomyActionRow;
  said: string | undefined;
  run: string | undefined;
  steer: string | undefined;
}): Result<AutonomyActionRow, AutonomyError> {
  let row = base;
  if (said !== undefined) {
    const plain = requireSaid({ said });
    if (plain.isErr()) {
      return err(plain.error);
    }
    row = { ...row, said: plain.value };
  }
  if (run !== undefined) {
    const slug = requireText({ field: "run", max: AUTONOMY_RUN_MAX, value: run });
    if (slug.isErr()) {
      return err(slug.error);
    }
    row = { ...row, run: slug.value };
  }
  if (steer === undefined) {
    return ok(row);
  }
  const word = requireText({ field: "steer", max: AUTONOMY_STEER_MAX, value: steer });
  if (word.isErr()) {
    return err(word.error);
  }
  return ok({ ...row, steer: word.value });
}

/** The three SHAPE rules an act's identity fields carry, or undefined when all three hold. */
function checkActionShape({
  actionId,
  kind,
  subject,
}: {
  actionId: string;
  kind: string;
  subject: string;
}): AutonomyError | undefined {
  if (!isAutonomyActionId({ actionId })) {
    return AutonomyErrors.invalidField({
      field: "actionId",
      why:
        `is "${actionId}" — it must be lowercase letters and digits separated by single hyphens or dots, ` +
        `${String(AUTONOMY_ACTION_ID_MIN)}-${String(AUTONOMY_ACTION_ID_MAX)} characters`,
    });
  }
  const classPrefix = classIdPrefixOf({ actionId });
  if (classPrefix !== undefined) {
    return AutonomyErrors.invalidField({
      field: "actionId",
      why: `is "${actionId}" — the ${classPrefix} prefix names the owner's standing word on a class of act, never an act`,
    });
  }
  if (!isAutonomyKind({ kind })) {
    return AutonomyErrors.invalidKind({ kind });
  }
  if (!isCheckableSubject({ subject })) {
    return AutonomyErrors.uncheckableSubject({ subject });
  }
  return undefined;
}

/**
 * Build a validated act row.
 *
 * Every rule is checked here rather than at the CLI edge, so a caller that is not the CLI cannot skip one,
 * and {@link parseAutonomyRecord} runs this same builder over a decoded line rather than re-stating its
 * invariants — a parser that only type-checked its fields would admit rows the writer could never produce.
 *
 * @param actionId the occurrence's id, chosen by the acting session and reused on a retry
 * @param kind what was done, as a slug
 * @param subject the checkable id of the thing acted on
 * @param doneIso when the act was taken
 * @param bySession which session did it
 * @param why what made it obvious the owner would want it — the fleet's own note, never the owner's line
 * @param said what was done, to what and why it mattered, in words the owner reads; optional on the TYPE, and
 *   required by `slopweaver autonomy record` — see `./types.ts`
 * @param witness the verb that was run and the line it printed
 * @param run the board row it was done on, when there was one
 * @param steer the owner's word about it, when the acting session already had one
 * @returns the row, or the first rule that refused it
 */
export function buildAutonomyAction({
  actionId,
  kind,
  subject,
  doneIso,
  bySession,
  why,
  said,
  witness,
  run,
  steer,
}: {
  actionId: string;
  kind: string;
  subject: string;
  doneIso: string;
  bySession: string;
  why: string;
  said: string | undefined;
  witness: string;
  run: string | undefined;
  steer: string | undefined;
}): Result<AutonomyActionRow, AutonomyError> {
  const shape = checkActionShape({ actionId, kind, subject });
  if (shape !== undefined) {
    return err(shape);
  }
  const when = requireInstant({ field: "doneIso", value: doneIso });
  if (when.isErr()) {
    return err(when.error);
  }
  const session = requireText({ field: "bySession", max: AUTONOMY_SESSION_MAX, value: bySession });
  if (session.isErr()) {
    return err(session.error);
  }
  const reason = requireText({ field: "why", max: AUTONOMY_WHY_MAX, value: why });
  if (reason.isErr()) {
    return err(reason.error);
  }
  const evidence = requireText({ field: "witness", max: AUTONOMY_WITNESS_MAX, value: witness });
  if (evidence.isErr()) {
    return err(evidence.error);
  }
  const base: AutonomyActionRow = {
    actionId,
    bySession: session.value,
    doneIso: when.value,
    kind,
    subject,
    why: reason.value,
    witness: evidence.value,
  };
  return withOptionals({ base, run, said, steer });
}

/**
 * Build a validated steer row.
 *
 * It does NOT check that the act exists — that is a property of the whole register rather than of one line,
 * so it belongs to `./query.ts`'s fold and to the verb that reads before it writes. Keeping the two apart is
 * what lets this function stay pure.
 *
 * @param actionId the act being steered
 * @param steer the owner's word about it
 * @param steeredIso when it was recorded
 * @param bySession which session wrote it down — provenance, never authentication
 * @returns the row, or the first rule that refused it
 */
export function buildAutonomySteer({
  actionId,
  steer,
  steeredIso,
  bySession,
}: {
  actionId: string;
  steer: string;
  steeredIso: string;
  bySession: string;
}): Result<AutonomySteerRow, AutonomyError> {
  if (!isAutonomyActionId({ actionId }) || classIdPrefixOf({ actionId }) !== undefined) {
    return err(AutonomyErrors.unknownAction({ actionId }));
  }
  const word = requireText({ field: "steer", max: AUTONOMY_STEER_MAX, value: steer });
  if (word.isErr()) {
    return err(word.error);
  }
  const when = requireInstant({ field: "steeredIso", value: steeredIso });
  if (when.isErr()) {
    return err(when.error);
  }
  const session = requireText({ field: "bySession", max: AUTONOMY_SESSION_MAX, value: bySession });
  if (session.isErr()) {
    return err(session.error);
  }
  return ok({ actionId, bySession: session.value, steer: word.value, steeredIso: when.value });
}

// A single-parameter type predicate rather than the repo's named-object form, because TypeScript error
// TS1230 forbids destructuring in a type-predicate signature — the compiler's decision, which is why
// `named-object-params` exempts it.

/**
 * Whether a decoded record is the owner's steer rather than a session's act.
 *
 * Reads `steeredIso`, which only the steer arm carries and which the action arm refuses — never `steer`,
 * which an act may legitimately hold (see `./decode.ts`'s overview).
 *
 * @param record either record the register may carry
 * @returns true when it is a steer
 */
export function isSteerRecord(record: AutonomyRecord): record is AutonomySteerRow {
  // `Object.hasOwn`, never `in`: `in` walks the prototype chain, so a polluted `Object.prototype.steeredIso`
  // would make every act in the register read as one of the owner's steers. Same reason `./query.ts`'s `steerOf`
  // asks the same way — those two functions are what decide whether the owner has spoken about an act.
  return Object.hasOwn(record, "steeredIso");
}
