/**
 * The owner's standing word on a whole CLASS of act — building, naming and decoding one class steer row.
 *
 * Pure, like `./row.ts`. `./decode.ts` routes a steer here when its `actionId` carries the `class.` prefix. The row
 * shape and why it rides inside the steer arm are `./types.ts`'s `AutonomyClassSteerRow`; the owner's words
 * and the recording procedure are `skills/autonomy/reference/class-steers.md`.
 */
import { err, ok, type Result } from "../lib/result.js";

import { type AutonomyError, AutonomyErrors } from "./errors.js";
import { isAutonomyActionId, isAutonomyKind, requireInstant, requireText } from "./fields.js";
import {
  AUTONOMY_ANCHOR_MAX,
  AUTONOMY_CLASS_ID_PREFIX,
  AUTONOMY_CLASS_KINDS_MAX,
  AUTONOMY_SCOPED_CLASS_ID_PREFIX,
  AUTONOMY_SESSION_MAX,
  AUTONOMY_STEER_MAX,
  AUTONOMY_SUBJECT_MAX,
  type AutonomyAction,
  type AutonomyClassSteerRow,
  type AutonomyRecord,
  classIdPrefixOf,
} from "./types.js";

/**
 * What a class's subject scope may be: an https URL reaching at least one path slash past its host, or a
 * `state:` reference with a path — so neither `https://` nor `state:` alone, which would scope nothing while
 * reading as though it did. No whitespace anywhere, for `./subject.ts`'s reason.
 */
const SUBJECT_PREFIX_PATTERN = /^(?:https:\/\/[^/\s]+\/\S*|state:\S+)$/;

/**
 * Validate a class's subject scope: a LITERAL prefix, never a pattern, in one of the two forms a subject opens with.
 *
 * @param subjectPrefix the scope as written
 * @returns the scope, or why it was refused
 */
function requireSubjectPrefix({ subjectPrefix }: { subjectPrefix: string }): Result<string, AutonomyError> {
  if (subjectPrefix.length > AUTONOMY_SUBJECT_MAX || !SUBJECT_PREFIX_PATTERN.test(subjectPrefix)) {
    return err(
      AutonomyErrors.invalidField({
        field: "subjectPrefix",
        why:
          `is "${subjectPrefix}" — a scope is a literal an act's subject starts with: an https URL through at ` +
          `least its host's slash, or state:<path>, no whitespace, at most ${String(AUTONOMY_SUBJECT_MAX)} characters`,
      }),
    );
  }
  return ok(subjectPrefix);
}

/**
 * Whether a class steer settles one act: it names the act's kind, and its scope — when it has one — admits the
 * act's subject.
 *
 * @param row the class steer
 * @param kind the act's kind
 * @param subject the act's subject
 * @returns true when the class covers that act
 */
export function classAdmits({
  row,
  kind,
  subject,
}: {
  row: AutonomyClassSteerRow;
  kind: string;
  subject: string;
}): boolean {
  // Own-field read, for `./decode.ts`'s reason: a polluted prototype must not narrow — or widen — a class.
  const prefix = Object.hasOwn(row, "subjectPrefix") ? row.subjectPrefix : undefined;
  return row.kinds.split(",").includes(kind) && (prefix === undefined || subject.startsWith(prefix));
}

/**
 * The class that settles one act out of every class naming its kind: the LAST one, in governing order, whose
 * scope admits the act's subject.
 *
 * @param classes the classes naming the act's kind, earliest-governing first
 * @param action the act
 * @returns the governing class, or undefined when no class admits it
 */
export function governingClass({
  classes,
  action,
}: {
  classes: readonly AutonomyClassSteerRow[];
  action: AutonomyAction["action"];
}): AutonomyClassSteerRow | undefined {
  return classes.findLast((row) => classAdmits({ kind: action.kind, row, subject: action.subject }));
}

/**
 * The canonical spelling of a class steer's kinds: each trimmed, each a valid kind, none repeated, first-listed
 * order kept, joined by a bare comma.
 *
 * @param kinds the comma-separated list as written — by a caller, or read back off the register
 * @returns the canonical list, or the first rule it broke
 */
export function canonicalClassKinds({ kinds }: { kinds: string }): Result<string, AutonomyError> {
  const members = kinds.split(",").map((member) => member.trim());
  const bad = members.find((member) => !isAutonomyKind({ kind: member }));
  if (bad !== undefined) {
    return err(
      AutonomyErrors.invalidField({
        field: "kinds",
        why: `carries "${bad}", which is not a kind slug — name exact kinds, comma-separated, no patterns`,
      }),
    );
  }
  const repeated = members.find((member, index) => members.indexOf(member) !== index);
  if (repeated !== undefined) {
    return err(AutonomyErrors.invalidField({ field: "kinds", why: `names "${repeated}" twice` }));
  }
  const joined = members.join(",");
  if (joined.length > AUTONOMY_CLASS_KINDS_MAX) {
    return err(
      AutonomyErrors.invalidField({
        field: "kinds",
        why: `is ${String(joined.length)} characters, past the ${String(AUTONOMY_CLASS_KINDS_MAX)} a row may carry`,
      }),
    );
  }
  return ok(joined);
}

/**
 * Build a validated class steer: the owner's standing word on every act of the exact kinds it names.
 *
 * Like `./row.ts`'s `buildAutonomySteer`, it does not look at the register — a standing word is valid before the
 * first act of its kind exists.
 *
 * @param classId the class's own name, a slug; the row's `actionId` becomes `class.<classId>`
 * @param kinds the exact kinds it settles, comma-separated
 * @param steer the owner's words, verbatim
 * @param anchor where the owner said them
 * @param steeredIso when it was recorded
 * @param bySession which session wrote it down — provenance, never authentication
 * @param subjectPrefix a literal every settled act's subject must start with, when the owner's word covers one place only
 * @returns the row, or the first rule that refused it
 */
export function buildAutonomyClassSteer({
  classId,
  kinds,
  steer,
  anchor,
  steeredIso,
  bySession,
  subjectPrefix,
}: {
  classId: string;
  kinds: string;
  steer: string;
  anchor: string;
  steeredIso: string;
  bySession: string;
  subjectPrefix?: string | undefined;
}): Result<AutonomyClassSteerRow, AutonomyError> {
  const actionId = classActionId({ classId, scoped: subjectPrefix !== undefined });
  if (actionId.isErr()) {
    return err(actionId.error);
  }
  const members = canonicalClassKinds({ kinds });
  if (members.isErr()) {
    return err(members.error);
  }
  const word = requireText({ field: "steer", max: AUTONOMY_STEER_MAX, value: steer });
  if (word.isErr()) {
    return err(word.error);
  }
  const where = requireText({ field: "anchor", max: AUTONOMY_ANCHOR_MAX, value: anchor });
  if (where.isErr()) {
    return err(where.error);
  }
  const when = requireInstant({ field: "steeredIso", value: steeredIso });
  if (when.isErr()) {
    return err(when.error);
  }
  const session = requireText({ field: "bySession", max: AUTONOMY_SESSION_MAX, value: bySession });
  if (session.isErr()) {
    return err(session.error);
  }
  const row = {
    actionId: actionId.value,
    anchor: where.value,
    bySession: session.value,
    kinds: members.value,
    steer: word.value,
    steeredIso: when.value,
  };
  if (subjectPrefix === undefined) {
    return ok(row);
  }
  return requireSubjectPrefix({ subjectPrefix }).map((scope) => ({ ...row, subjectPrefix: scope }));
}

/** The wire id a class is written under — `class.` unscoped, `class-scoped.` scoped — or why its name was refused. */
function classActionId({ classId, scoped }: { classId: string; scoped: boolean }): Result<string, AutonomyError> {
  const actionId = `${scoped ? AUTONOMY_SCOPED_CLASS_ID_PREFIX : AUTONOMY_CLASS_ID_PREFIX}${classId}`;
  if (!isAutonomyKind({ kind: classId }) || !isAutonomyActionId({ actionId })) {
    return err(
      AutonomyErrors.invalidField({
        field: "classId",
        why: `is "${classId}" — it must be lowercase letters and digits separated by single hyphens or dots`,
      }),
    );
  }
  return ok(actionId);
}

/**
 * The class a class steer names — its `actionId` with its `class.` or `class-scoped.` prefix taken off.
 *
 * One name across both prefixes, so re-recording a class with a scope — or without one — REPLACES it rather
 * than leaving the old spelling in force beside the new one (`./query.ts`'s `classCoverage`).
 *
 * @param row the class steer
 * @returns the class's own name
 */
export function classIdOf({ row }: { row: AutonomyClassSteerRow }): string {
  const prefix = classIdPrefixOf({ actionId: row.actionId });
  return prefix === undefined ? row.actionId : row.actionId.slice(prefix.length);
}

// A single-parameter type predicate, because TypeScript error TS1230 forbids destructuring in one.

/**
 * Whether a decoded record is the owner's standing word on a CLASS of act, rather than their word on one.
 *
 * Every class steer is also a steer ({@link isSteerRecord} answers true for it), so a reader that treats the
 * two differently asks this first. The `class.` or `class-scoped.` prefix decides, because no act may carry either.
 *
 * @param record either record the register may carry
 * @returns true when it is a class steer
 */
export function isClassSteerRecord(record: AutonomyRecord): record is AutonomyClassSteerRow {
  return (
    Object.hasOwn(record, "steeredIso") &&
    Object.hasOwn(record, "actionId") &&
    classIdPrefixOf({ actionId: record.actionId }) !== undefined
  );
}

/**
 * Decode the class-steer arm completely: every field it needs present, and an `actionId` carrying the prefix.
 *
 * A class id missing `kinds` or `anchor` is refused — a steer on a class it cannot name the kinds of settles
 * nothing checkable. A per-act steer carrying either field is NOT routed here: it reads exactly as it did
 * before class steers existed, the extra field ignored.
 *
 * Every field arrives already read off the decoded record through `./decode.ts`'s own-field guard, so a polluted
 * prototype can supply none of them.
 *
 * @returns the class steer, or the first rule that refused it
 */
export function parseClassSteer({
  actionId,
  anchor,
  bySession,
  kinds,
  steer,
  steeredIso,
  subjectPrefix,
}: {
  actionId: unknown;
  anchor: unknown;
  bySession: unknown;
  kinds: unknown;
  steer: unknown;
  steeredIso: unknown;
  subjectPrefix: unknown;
}): Result<AutonomyRecord, AutonomyError> {
  const wirePrefix = typeof actionId === "string" ? classIdPrefixOf({ actionId }) : undefined;
  const shaped =
    typeof actionId === "string" &&
    wirePrefix !== undefined &&
    typeof kinds === "string" &&
    typeof anchor === "string" &&
    typeof steer === "string" &&
    typeof steeredIso === "string" &&
    typeof bySession === "string";
  if (!shaped) {
    return err(
      AutonomyErrors.invalidField({
        field: "kinds",
        why:
          `a class steer must carry an actionId starting ${AUTONOMY_CLASS_ID_PREFIX} or ` +
          `${AUTONOMY_SCOPED_CLASS_ID_PREFIX}, kinds, anchor, steer, steeredIso and bySession as strings`,
      }),
    );
  }
  // The prefix and the scope must agree, both ways. A scoped id with no readable scope would otherwise be built
  // as unscoped and settle every subject of its kinds, and an unscoped id carrying one is exactly the row an
  // older build reads as unscoped — so neither is ever read as meaning what it might have.
  const scoped = wirePrefix === AUTONOMY_SCOPED_CLASS_ID_PREFIX;
  if (scoped !== (typeof subjectPrefix === "string") || (!scoped && subjectPrefix !== undefined)) {
    return err(
      AutonomyErrors.invalidField({
        field: "subjectPrefix",
        why:
          `must be a string on a ${AUTONOMY_SCOPED_CLASS_ID_PREFIX} row and absent on a ` +
          `${AUTONOMY_CLASS_ID_PREFIX} row — "${actionId}" breaks that`,
      }),
    );
  }
  return buildAutonomyClassSteer({
    anchor,
    bySession,
    classId: actionId.slice(wirePrefix.length),
    kinds,
    steer,
    steeredIso,
    subjectPrefix: typeof subjectPrefix === "string" ? subjectPrefix : undefined,
  });
}
