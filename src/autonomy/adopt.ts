/**
 * Adopting rows that were hand-appended to the register before `slopweaver autonomy record` existed — the
 * pure half. Text and decoded objects in, wire lines and a change report out; no filesystem, no clock.
 *
 * ## Why this exists at all
 *
 * Until the verb existed, sessions acting under graduated autonomy wrote rows to
 * `$SLOPWEAVER_HOME/ledgers/autonomy.jsonl` by hand, and adoption takes those rows in. It is not a small
 * residue: measured, the live register held **53 acts across 61 physical lines**, of which
 * **twenty carried no `witness` at all** and **nine lines were ONE pretty-printed object** a session had
 * written with an indenting serialiser. Reproduce the shape of that measurement on any register with
 * `slopweaver autonomy adopt --home "$SLOPWEAVER_HOME"`, which reports and writes nothing.
 *
 * Every one of those lines is skipped by {@link ../store.js readAutonomyRecords} and carried out in its
 * `unparsed` list, which every reader reports by count and line number — never silently, because a briefing
 * that rendered "nothing was done under autonomy" over a line it could not read would be the confident wrong
 * answer the section exists to prevent. A skipped line is still an act missing from every page, and a reader
 * whose answer is an absence refuses outright while one stands, so adoption is how such a line comes back.
 *
 * ## What may be changed, and what may not
 *
 * Four transformations, and nothing else:
 *
 * - **A pretty-printed object becomes one line.** Nothing about the act changes; JSONL is the format.
 * - **A missing `witness` becomes a statement of RECORDING PROVENANCE**, never manufactured evidence. The
 *   witness field's contract is "the verb that was run and the line it printed", and no such line was ever
 *   captured for these rows. Inventing one — re-running the act, or inferring success from the `kind` — would
 *   put a lie on the one page built so the owner can trust what the fleet says it did. So the text says exactly what
 *   is true: this row was hand-recorded before the verb existed, here is the preserved original and its
 *   digest, and no command witness exists. See {@link recordingProvenanceWitness}.
 * - **A FIELD whose value this register cannot read may be replaced**, once, by a caller naming the act and
 *   the exact replacement — today `subject` and `doneIso`. The original is quoted in the row's own witness,
 *   so the substitution is visible on the owner's page rather than only in a backup, and a field whose value the
 *   register can ALREADY read is refused rather than replaced: rewriting a subject a reader could follow, or
 *   restamping when an act happened, is editing history under cover of a repair.
 * - **An act with no `said` is given one DERIVED from its own `kind` and `subject`**, or is left without
 *   one. `./derivedSaid.ts` holds the whole derivation and the reason it is this narrow; what matters here
 *   is that it obeys the same rule {@link recordingProvenanceWitness} does. It states what was done and to what, both
 *   read off the row, and then says in the line itself that it was written after the fact — it never infers
 *   why an act mattered, because that is the one thing the record does not hold. A row whose derivation
 *   would still be unreadable keeps no `said` at all, and the console says that absence out loud.
 *   **A line adoption itself wrote may later be REWRITTEN or RETRACTED by it**, which is the one place a
 *   pass touches a field that already has a value: a sharpened derivation has to be able to reach its own
 *   output, or the field this register exists to protect is the one field no fix can correct. A said a
 *   SESSION wrote is still untouchable; {@link patchedSaid} is where the two are told apart.
 *
 * `doneIso` is in that set because the same failure that made the third transformation necessary reached it.
 * Measured: a row was hand-appended carrying `2026-09-14T01:1xZ`,
 * and `../store.ts`'s reader skips and reports that line, so the act is missing from `slopweaver autonomy
 * list` and the Fleet Briefing's "done for you, without asking" section until it is repaired. Appending cannot
 * fix that — the reader still cannot decode the old line, and re-recording
 * under the act's own id is an `ACTION_ID_CONFLICT` because `./query.ts` counts `doneIso` as an identity
 * field — so adoption is the only path, and the instant takes the same named-substitution form the subject
 * already has. Nothing here INFERS an instant from a neighbouring row or from the act's `why`: a caller
 * names the exact value or there is no repair, for the same reason {@link recordingProvenanceWitness} will not
 * manufacture evidence.
 *
 * Everything else is carried through byte-for-byte, unknown fields included — five real rows carry an
 * `outcome` field no type in this repository declares, and an adoption that rebuilt rows from the validated
 * shape would have silently dropped all five. So the wire object is the DECODED object with patches applied,
 * and validation runs over it rather than replacing it.
 */
import { isRecord } from "../lib/parsers.js";
import { err, ok, type Result } from "../lib/result.js";
import { safeJsonParse, safeJsonStringify } from "../lib/safeJson.js";

import { validateAutonomyRecord } from "./decode.js";
import { saidPatchFor } from "./derivedSaid.js";
import { type AutonomyError, AutonomyErrors } from "./errors.js";
import { isAutonomyInstant, isCheckableSubject } from "./fields.js";
import type { AutonomyRecord } from "./types.js";
import { AUTONOMY_STEER_MAX, AUTONOMY_WHY_MAX, AUTONOMY_WITNESS_MAX } from "./types.js";

/**
 * The longest one candidate object may run before framing refuses it.
 *
 * Derived from the field bounds rather than picked, so it cannot drift away from them: the three uncapped-on-
 * the-page fields are what make a row long, and five times their combined ceiling leaves room for every other
 * field, JSON escaping and whitespace. A candidate past this is not a row — it is a file that never closed a
 * brace, and reading on would accumulate the whole register into one string, which is exactly what
 * `.claude/rules/typescript-patterns.md`'s whole-file-string rule refuses.
 */
export const ADOPT_CANDIDATE_MAX_BYTES = (AUTONOMY_WHY_MAX + AUTONOMY_WITNESS_MAX + AUTONOMY_STEER_MAX) * 5;

/** One JSON object as it stood in the source file, with the physical lines it occupied. */
export interface HandRecordedAutonomyObject {
  readonly firstLine: number;
  readonly lastLine: number;
  readonly value: Readonly<Record<string, unknown>>;
}

/**
 * The fields a caller may replace on a row adoption is repairing.
 *
 * A closed set rather than "any field", because the two here are the only ones whose unreadable value takes
 * the WHOLE register off the page: `../store.ts`'s reader refuses a line whose subject is not a checkable id
 * or whose instant no clock can parse. A `why` that reads badly is a bad row; a `doneIso` that reads
 * `2026-09-14T01:1xZ` is a bad register.
 *
 * The array is what backs both the type below and {@link isAutonomyReplaceableField}, so a refusal asking
 * "is this field one a positional can reach" and the type a replacement is checked against can never drift.
 */
const AUTONOMY_REPLACEABLE_FIELDS = ["subject", "doneIso"] as const;

export type AutonomyReplaceableField = (typeof AUTONOMY_REPLACEABLE_FIELDS)[number];

/**
 * Whether a field name is one `autonomy adopt` can repair.
 *
 * A single-parameter type predicate rather than the repo's named-object form, because TypeScript error
 * TS1230 forbids destructuring in a type-predicate signature.
 *
 * @param field the field a refusal named
 * @returns true when a `<actionId>=<value>` positional would reach it
 */
export function isAutonomyReplaceableField(field: string): field is AutonomyReplaceableField {
  return AUTONOMY_REPLACEABLE_FIELDS.some((known) => known === field);
}

/** A field substitution a caller asked for, naming the act, which field it lands on and what to put there. */
export interface AutonomyFieldReplacement {
  readonly actionId: string;
  readonly field: AutonomyReplaceableField;
  readonly replacement: string;
}

/** One field a substitution landed on, with whatever the row carried there before it. */
export interface AutonomySubstitution {
  readonly field: AutonomyReplaceableField;
  /** The value the row carried, or undefined when it carried nothing at all in that field. */
  readonly original: string | undefined;
}

/** What adoption did to one object, so the report can be read before anything is written. */
export interface AutonomyAdoptionChange {
  readonly actionId: string;
  readonly firstLine: number;
  readonly lastLine: number;
  /** Which fields were patched. Empty when the row was already well formed. */
  readonly fields: readonly ("witness" | "said" | AutonomyReplaceableField)[];
  /** True when the object spanned more than one physical line and was folded onto one. */
  readonly compacted: boolean;
}

/** One adopted row: the exact line to write, the record it validates as, and what was done to it. */
export interface AdoptedAutonomyRow {
  readonly wire: string;
  readonly record: AutonomyRecord;
  readonly change: AutonomyAdoptionChange;
}

/**
 * Whether a buffered candidate is a complete JSON object yet.
 *
 * A brace count would be wrong the moment a `why` contains one, and every real row's prose does. So this
 * asks the parser: a candidate that decodes is complete, and one that does not is either still open or
 * broken — and the caller tells those apart by whether the source has more lines.
 *
 * @param text the candidate's accumulated text
 * @returns the decoded object, or undefined when the text is not (yet) one complete JSON object
 */
export function decodeCandidate({ text }: { text: string }): Readonly<Record<string, unknown>> | undefined {
  let parsed: unknown;
  try {
    parsed = safeJsonParse({ label: "an autonomy ledger row", text });
  } catch {
    return undefined;
  }
  return isRecord(parsed) ? parsed : undefined;
}

/**
 * The witness written for a row that never had one.
 *
 * It is a statement about the RECORD, not about the act: everything in it can be checked against the
 * preserved original, and nothing in it claims the act succeeded. The `outcome` a few rows carry is quoted as
 * the acting session's own assertion, in those words, because it is exactly that — a field the session wrote
 * about its own work, with no command output behind it.
 *
 * @param actionId the act this witness belongs to
 * @param backupReference where the preserved original can be read, as a `state:` reference
 * @param sha256 the digest of the preserved original
 * @param source the object as it stood in the file — its line span, and its own `outcome` when it has one
 * @param substitutions every field this adoption replaced, with what the row carried there before
 * @returns the witness text
 */
export function recordingProvenanceWitness({
  actionId,
  backupReference,
  sha256,
  source,
  substitutions,
}: {
  actionId: string;
  backupReference: string;
  sha256: string;
  source: HandRecordedAutonomyObject;
  substitutions: readonly AutonomySubstitution[];
}): string {
  const { firstLine, lastLine } = source;
  const outcome = outcomeOf({ value: source.value });
  const lines = firstLine === lastLine ? `line ${String(firstLine)}` : `lines ${String(firstLine)}-${String(lastLine)}`;
  const base =
    `Hand-recorded row only, no command witness was captured: this act was hand-appended as ${actionId} ` +
    `before \`slopweaver autonomy record\` existed. Preserved original ${backupReference}, sha256 ${sha256}, ` +
    `${lines}.`;
  const assertion = outcome === undefined ? "" : ` Recorded outcome (the acting session's own assertion): ${outcome}.`;
  return `${base}${assertion}${substitutionClauses({ substitutions })}`;
}

/**
 * What every substitution adds to the patched row's witness, so the original is on the owner's page rather than only
 * in a backup file.
 *
 * A field the row carried NOTHING in is said out loud rather than left silent: a change report naming
 * `doneIso` against a witness that quotes no original reads as a lost value, and "the row carried no
 * doneIso" is the fact. Nothing is ever dropped to make room — when the clauses push `witness` past
 * {@link AUTONOMY_WITNESS_MAX}, {@link adoptHandRecordedAutonomyObject}'s validation refuses the whole adoption
 * and names the field, because truncating what a session recorded to fit a provenance note would put a
 * shortened version of its own evidence on the one page built so the owner can trust it.
 *
 * **The value is QUOTED and the clause is terminated**, and that is a delimiter rather than decoration.
 * Measured on a row whose subject and doneIso were repaired in one pass: the two clauses ran
 * together as `Original doneIso: <instant> Original subject: <subject>`,
 * so a reader of the owner's page could not tell where the first value ended. Neither field's value is punctuated
 * at its own end, and an instant against a bare subject is exactly where the join is invisible. A trace
 * present but illegible fails the half of this function's contract that matters.
 * Repro: `slopweaver autonomy adopt --home <d> --apply '<id>=<iso>' '<id>=<url>'`, then read the witness.
 * The quoting is `JSON.stringify` rather than two literal quotes, because the ORIGINAL is by definition
 * the value the register could not read, so it is arbitrary text: one that carries a double quote would
 * close the clause early and put the delimiter back where it started.
 *
 * @param substitutions every field this adoption replaced, in the order they were applied
 * @returns the clauses, each already opening with a space, or the empty string when nothing was replaced
 */
function substitutionClauses({ substitutions }: { substitutions: readonly AutonomySubstitution[] }): string {
  return substitutions
    .map(({ field, original }) => {
      if (original === undefined) {
        return ` The row carried no ${field}.`;
      }
      return ` Original ${field}: ${JSON.stringify(original)}.`;
    })
    .join("");
}

/**
 * The first field whose value adoption cannot promise to carry through unchanged, or undefined when none.
 *
 * Every field the register declares is a string, and so is every unknown field the live rows carry. A value
 * of any other type goes through `JSON.parse` and `JSON.stringify` on its way to the adopted file, and those
 * are not lossless: `9007199254740993` comes back `…992` and `1e400` comes back `null`, silently, while the
 * change report says only that a witness was added.
 *
 * So a row carrying one is REFUSED rather than adopted. The claim this verb makes — that everything it does
 * not patch is carried through — is then true rather than nearly true, and the operator is told which field
 * to look at instead of discovering the change later in a backup.
 */
function unpreservableField({ value }: { value: Readonly<Record<string, unknown>> }): string | undefined {
  return Object.keys(value).find((key) => typeof value[key] !== "string");
}

/** {@link unpreservableField}'s refusal, shaped for the caller, or undefined when every field is a string. */
function checkPreservable({ source }: { source: HandRecordedAutonomyObject }): AutonomyError | undefined {
  const field = unpreservableField({ value: source.value });
  if (field === undefined) {
    return undefined;
  }
  return AutonomyErrors.corruptRow({
    lineNumber: source.firstLine,
    why:
      `carries "${field}", which is not a string. Every field this register declares is one, and a number or ` +
      "a nested value cannot be carried through a JSON round trip unchanged — so this row is refused rather " +
      "than adopted with a value silently different from what the session wrote",
  });
}

/** The `outcome` field's value when the row carries one as a string, otherwise undefined. */
function outcomeOf({ value }: { value: Readonly<Record<string, unknown>> }): string | undefined {
  const outcome = value["outcome"];
  return typeof outcome === "string" && outcome.length > 0 ? outcome : undefined;
}

/** The `actionId` a candidate carries, or the refusal when it carries none a report could name it by. */
function actionIdOf({ source }: { source: HandRecordedAutonomyObject }): Result<string, AutonomyError> {
  const actionId = source.value["actionId"];
  if (typeof actionId !== "string" || actionId.length === 0) {
    return err(
      AutonomyErrors.corruptRow({
        lineNumber: source.firstLine,
        why: "carries no actionId, so adoption cannot name it in a report or match a replacement to it",
      }),
    );
  }
  return ok(actionId);
}

/**
 * One field of a decoded object, read ONLY if the object owns it.
 *
 * `Object.hasOwn` rather than a plain index for `./decode.ts`'s reason, applied to the questions this
 * module asks: a polluted `Object.prototype.doneIso` holding a readable instant would make every row that
 * carries none look already-repaired, and adoption would refuse the one replacement that fixes the register.
 */
function ownValue({ value, field }: { value: Readonly<Record<string, unknown>>; field: string }): unknown {
  return Object.hasOwn(value, field) ? value[field] : undefined;
}

/** Whether the value a row carries in one field is already one this register can read. */
function alreadyReadable({ field, current }: { field: AutonomyReplaceableField; current: unknown }): boolean {
  if (typeof current !== "string") {
    return false;
  }
  if (field === "subject") {
    return isCheckableSubject({ subject: current });
  }
  return isAutonomyInstant({ value: current });
}

/** How a refusal names what the row already carries, in the words a reader of that field would use. */
const ALREADY_READABLE: Readonly<Record<AutonomyReplaceableField, string>> = {
  doneIso: "doneIso a clock can parse",
  subject: "checkable subject",
};

/** One planned substitution: the field, what goes there, and what the row carried before. */
interface PlannedSwap extends AutonomySubstitution {
  readonly replacement: string;
}

/**
 * Every swap this object will take, in the order the caller named them, or empty when none names it.
 *
 * A replacement for a field whose value the register can ALREADY read is refused rather than applied:
 * adoption exists to make a register readable, and rewriting a subject a reader could already follow — or
 * restamping when an act happened — is editing history under cover of a repair.
 *
 * **A STEER row is never repaired, and that is the common case rather than an edge.** The register keeps
 * acts and the owner's steers in ONE file, and a steer carries the ACT's own `actionId` (`./decode.ts`'s file
 * overview), so matching on the id alone reaches two rows. Patching `doneIso` into the steer makes the
 * hybrid `ACTION_ONLY_FIELDS` refuses, and the whole adoption then fails. Measured against a
 * register holding one act and the owner's steer of it: `autonomy adopt --apply '<id>=<iso>'` exited 1 with
 * `doneIso may not sit beside steeredIso`, so every act the owner had already spoken about was unrepairable.
 * {@link patchedWitness} already guarded on this field; the two halves now agree about what a steer row is.
 *
 * Two replacements naming one act and one field are refused too. `find` would have taken the first and said
 * nothing about the second, and picking one of two contradictory instants on a caller's behalf is exactly
 * the silent substitution this register cannot afford.
 */
function plannedSwaps({
  actionId,
  replacements,
  source,
}: {
  actionId: string;
  replacements: readonly AutonomyFieldReplacement[];
  source: HandRecordedAutonomyObject;
}): Result<readonly PlannedSwap[], AutonomyError> {
  if (ownValue({ field: "steeredIso", value: source.value }) !== undefined) {
    return ok([]);
  }
  const swaps: PlannedSwap[] = [];
  for (const named of replacements.filter((candidate) => candidate.actionId === actionId)) {
    const { field } = named;
    if (swaps.some((swap) => swap.field === field)) {
      return err(
        AutonomyErrors.corruptRow({
          lineNumber: source.firstLine,
          why: `${actionId} is named twice for \`${field}\`, and adoption will not choose one of two replacements`,
        }),
      );
    }
    const current = ownValue({ field, value: source.value });
    if (alreadyReadable({ current, field })) {
      return err(
        AutonomyErrors.corruptRow({
          lineNumber: source.firstLine,
          why: `${actionId} already carries a ${ALREADY_READABLE[field]}, so a replacement for it would rewrite history`,
        }),
      );
    }
    swaps.push({ field, original: typeof current === "string" ? current : undefined, replacement: named.replacement });
  }
  return ok(swaps);
}

/**
 * The witness the patched object takes, or undefined when this row's witness is not adoption's business.
 *
 * Two shapes, one rule — the original must be readable in the row's OWN witness rather than only in the
 * backup. A row with no witness is given the provenance statement, substitutions included. A row that
 * already has one keeps every word of it and takes the clauses on the end, which is what makes a
 * substitution visible on a row a session did witness; before that, a replaced subject on such a row left
 * its original nowhere but the preserved file. A steer row legitimately carries no witness and takes none.
 */
function patchedWitness({
  actionId,
  backupReference,
  sha256,
  source,
  swaps,
}: {
  actionId: string;
  backupReference: string;
  sha256: string;
  source: HandRecordedAutonomyObject;
  swaps: readonly AutonomySubstitution[];
}): string | undefined {
  const existing = ownValue({ field: "witness", value: source.value });
  if (typeof existing === "string") {
    if (swaps.length === 0) {
      return undefined;
    }
    return `${existing}${substitutionClauses({ substitutions: swaps })}`;
  }
  if (ownValue({ field: "steeredIso", value: source.value }) !== undefined) {
    return undefined;
  }
  return recordingProvenanceWitness({ actionId, backupReference, sha256, source, substitutions: swaps });
}

/**
 * Apply every patch this verb may make to one decoded object, in the order they depend on each other.
 *
 * The order is the contract rather than a convenience: a field SUBSTITUTION lands first because both of the
 * other two read what it wrote — the witness quotes the original value beside its replacement, and the
 * derived `said` names the repaired subject rather than the unreadable one it replaced.
 *
 * @param source the object as it stood in the file, with its physical line span
 * @param backupReference where the preserved original can be read, as a `state:` reference
 * @param sha256 the digest of the preserved original
 * @param swaps the field substitutions this act was asked for, already checked
 * @returns the patched object and every field this verb changed, in the order a report names them
 */
function applyPatches({
  actionId,
  backupReference,
  sha256,
  source,
  swaps,
}: {
  actionId: string;
  backupReference: string;
  sha256: string;
  source: HandRecordedAutonomyObject;
  swaps: readonly PlannedSwap[];
}): { patched: Record<string, unknown>; fields: readonly ("witness" | "said" | AutonomyReplaceableField)[] } {
  const patched: Record<string, unknown> = { ...source.value };
  const fields: ("witness" | "said" | AutonomyReplaceableField)[] = [];
  for (const swap of swaps) {
    patched[swap.field] = swap.replacement;
    fields.push(swap.field);
  }
  const witness = patchedWitness({ actionId, backupReference, sha256, source, swaps });
  if (witness !== undefined) {
    patched["witness"] = witness;
    fields.push("witness");
  }
  const plainWords = saidPatchFor({
    kind: ownValue({ field: "kind", value: patched }),
    standing: ownValue({ field: "said", value: patched }),
    steered: ownValue({ field: "steeredIso", value: patched }) !== undefined,
    subject: ownValue({ field: "subject", value: patched }),
  });
  if (plainWords.kind === "write") {
    patched["said"] = plainWords.said;
    fields.push("said");
  }
  if (plainWords.kind === "remove") {
    // `delete` rather than assigning `undefined`: the object is serialised with `JSON.stringify`, which
    // drops an `undefined`-valued key anyway, and a key that is present-but-undefined reads as a field to
    // the `ownValue` checks above on any later pass.
    delete patched["said"];
    fields.push("said");
  }
  return { fields, patched };
}

/**
 * Adopt one decoded object: patch what may be patched, validate the result, and say what was done.
 *
 * The patches are applied to the DECODED object rather than to a rebuilt record, so an unknown field survives
 * — see this file's overview on the five `outcome` rows. Validation then runs over the patched object, which
 * is the same check the store's own write boundary makes, so an object this function accepts is one the
 * register will read back.
 *
 * @param source the object as it stood in the file, with its physical line span
 * @param backupReference where the preserved original can be read, as a `state:` reference
 * @param sha256 the digest of the preserved original
 * @param replacements every field substitution the caller asked for, across every act
 * @returns the wire line, the validated record and the change, or the first rule that refused it
 */
export function adoptHandRecordedAutonomyObject({
  source,
  backupReference,
  sha256,
  replacements,
}: {
  source: HandRecordedAutonomyObject;
  backupReference: string;
  sha256: string;
  replacements: readonly AutonomyFieldReplacement[];
}): Result<AdoptedAutonomyRow, AutonomyError> {
  const named = actionIdOf({ source });
  if (named.isErr()) {
    return err(named.error);
  }
  const actionId = named.value;
  const preservable = checkPreservable({ source });
  if (preservable !== undefined) {
    return err(preservable);
  }
  const planned = plannedSwaps({ actionId, replacements, source });
  if (planned.isErr()) {
    return err(planned.error);
  }
  const { fields, patched } = applyPatches({
    actionId,
    backupReference,
    sha256,
    source,
    swaps: planned.value,
  });
  const validated = validateAutonomyRecord({ value: patched });
  if (validated.isErr()) {
    return err(validated.error);
  }
  // The prototype is detached before serialising for `../store.ts`'s reason:
  // `JSON.stringify` reaches a `toJSON` through the prototype chain, so a polluted
  // `Object.prototype.toJSON` could rewrite a row that has just passed every rule — and on this register the
  // field that would forge is the owner's own word.
  Object.setPrototypeOf(patched, null);
  return ok({
    change: {
      actionId,
      compacted: source.lastLine > source.firstLine,
      fields,
      firstLine: source.firstLine,
      lastLine: source.lastLine,
    },
    record: validated.value,
    wire: safeJsonStringify({ label: "an adopted autonomy ledger row", value: patched }),
  });
}
