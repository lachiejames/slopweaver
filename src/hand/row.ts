/**
 * The two rows the hand-step register holds, and the fold that answers "what is open right now".
 *
 * Two kinds and no more: a step was POSTED, and a step was SETTLED — a re-cut being one posting that carries the
 * settling of the step it replaces on the SAME line ({@link rowsOfLine}). Taking the note down is deliberately
 * NOT an event — dismissing a window says nothing about whether the step happened, and a register that
 * recorded it would let a closed window read as finished work. A snooze (`hand snooze`, the note's Not now…)
 * closes the panel and writes no row here; the snooze store (`./snoozeStore.ts`) keeps the note down until its
 * time, and nothing more.
 *
 * Pure and total: bytes in, rows out, with every refusal naming the line it came from.
 */
import { isRecord } from "../lib/parsers.js";
import { err, ok, type Result } from "../lib/result.js";

import { type HandStepError, HandStepErrors } from "./errors.js";
import { buildHandStep, DID_CAP, type HandStep, type HandStepDraft } from "./step.js";

/** A step was recorded. */
interface PostedRow {
  readonly kind: "posted";
  readonly step: HandStep;
  /**
   * The settling of the step this posting re-cuts, written on the posting's own line so the two land or tear
   * together: a cut-short line is one torn row, never a new card beside the old one.
   */
  readonly settles?: SettledRow;
}

/** A step was done, in the owner's own hand or in the words of the session that watched it happen. */
export interface SettledRow {
  readonly kind: "settled";
  readonly id: string;
  /**
   * What was actually done, in the words of whoever watched it.
   *
   * Drawn on NO surface: `hand done` echoes it back and the register keeps it, and nothing else reads it —
   * `hand list --json` prints the OPEN postings, which carry no `did` at all. That is why its cap is
   * `../step.ts`'s `DID_CAP` rather than the command-shaped `WITNESS_CAP` it used to borrow.
   */
  readonly did: string;
  readonly settledIso: string;
  readonly bySession: string;
}

/** One line of the register. */
export type HandRow = PostedRow | SettledRow;

/**
 * Whether a row records a settling rather than a posting.
 *
 * Positional, which `.claude/rules/typescript-patterns.md` names as an exception the compiler itself
 * decides: TypeScript error TS1230 forbids a type predicate referencing a binding pattern, so the named
 * object this repository otherwise requires cannot be written here at all.
 *
 * @param row the row to test
 * @returns true when it is a settling
 */
export function isSettledRow(row: HandRow): row is SettledRow {
  return row.kind === "settled";
}

/**
 * A string field off an unvalidated object, or `undefined` when it is not one.
 *
 * @param value the parsed line
 * @param key the field to read
 * @returns the string, or `undefined`
 */
function text({ value, key }: { value: Record<string, unknown>; key: string }): string | undefined {
  const field = value[key];
  return typeof field === "string" ? field : undefined;
}

/**
 * The same read, with an ABSENT field spelled as the empty string rather than left undefined.
 *
 * The empty string is not a default standing in for a value: it is exactly what `../step.ts`'s builder
 * REFUSES by name, so a line missing its `what` fails with `what is required and was empty` rather than
 * failing a type check. Written as an `if` because `no-silent-fallback` bans the `??` that would hide which
 * of the two cases actually ran.
 *
 * @param value the parsed line
 * @param key the field to read
 * @returns the string, or the empty string the builder will refuse
 */
function textOrEmpty({ value, key }: { value: Record<string, unknown>; key: string }): string {
  const found = text({ key, value });
  if (found === undefined) {
    return "";
  }
  return found;
}

/**
 * Build a settled row out of one parsed line.
 *
 * @param value the parsed line
 * @param lineNumber which line it was, for the refusal
 * @returns the row, or why the line is not one
 */
function settledRowOf({
  value,
  lineNumber,
}: {
  value: Record<string, unknown>;
  lineNumber: number;
}): Result<HandRow, HandStepError> {
  const id = text({ key: "id", value });
  const did = text({ key: "did", value });
  const settledIso = text({ key: "settledIso", value });
  const bySession = text({ key: "bySession", value });
  if (id === undefined || did === undefined || settledIso === undefined || bySession === undefined) {
    return err(
      HandStepErrors.corruptRow({
        lineNumber,
        why: "a settled row carries id, did, settledIso and bySession, and one of them is missing or not a string",
      }),
    );
  }
  const checked = checkedDid({ did });
  if (checked.isErr()) {
    return err(HandStepErrors.corruptRow({ lineNumber, why: checked.error.message }));
  }
  return ok({ bySession, did: checked.value, id, kind: "settled", settledIso });
}

/**
 * A settling account, checked against its own cap.
 *
 * One function because the WRITER and the READER have to apply the same rule: `slopweaver hand done` once wrote
 * a 486-character `did` into the live register with no check at all, and every read
 * afterwards refused on that line — an append-only file bricked by one ordinary command. {@link
 * buildSettledRow} is the write side and {@link settledRowOf} is the read side, and they now share this.
 *
 * The two failures are NAMED SEPARATELY rather than reported as "empty or past its cap", which is what the
 * operator met and could not act on without opening the file by hand.
 *
 * @param did the account as the caller has it
 * @returns the trimmed account, or which of the two rules refused it
 */
function checkedDid({ did }: { did: string }): Result<string, HandStepError> {
  const trimmed = did.trim();
  if (trimmed.length === 0) {
    return err(HandStepErrors.invalidField({ field: "did", why: "is required and was empty" }));
  }
  if (trimmed.length > DID_CAP) {
    return err(
      HandStepErrors.invalidField({
        field: "did",
        why: `is ${String(trimmed.length)} characters and the cap is ${String(DID_CAP)} — it is refused rather than truncated, because a register that trimmed an account of what happened would keep half of it forever`,
      }),
    );
  }
  return ok(trimmed);
}

/**
 * Build one validated settling, or say exactly which rule refused it.
 *
 * The same boundary `../step.ts`'s `buildHandStep` draws for a posting, and it did not exist for a settling
 * until the register was bricked by its absence: `../../cli/commands/hand/done.ts` handed `--did` straight
 * to `appendHandRow`, so the writer could write what the reader refuses.
 *
 * @param draft the settling as the caller has it
 * @returns the validated row, or the first refusal
 */
export function buildSettledRow({
  draft,
}: {
  draft: { id: string; did: string; settledIso: string; bySession: string };
}): Result<SettledRow, HandStepError> {
  const did = checkedDid({ did: draft.did });
  if (did.isErr()) {
    return err(did.error);
  }
  return ok({
    bySession: draft.bySession,
    did: did.value,
    id: draft.id,
    kind: "settled",
    settledIso: draft.settledIso,
  });
}

/**
 * The draft fields a posted line is read for as OWN fields only: an inherited one would draw, tie or retire
 * something the line never carried.
 *
 * @param step the line's `step` object
 * @returns each own-field value, `undefined` where the line does not carry it
 */
function ownFieldsOf({
  step,
}: {
  step: Record<string, unknown>;
}): Pick<
  HandStepDraft,
  "checklist" | "details" | "ifIgnored" | "notice" | "quotes" | "recheck" | "row" | "shot" | "stopsWork" | "unaddressed"
> {
  const own = ({ key }: { key: string }): unknown => (Object.hasOwn(step, key) ? step[key] : undefined);
  return {
    // An inherited `checklist` would draw a script the line never carried.
    checklist: own({ key: "checklist" }),
    // An inherited `details` would draw a list the line never carried.
    details: own({ key: "details" }),
    // An inherited `ifIgnored` would draw a cost the line never carried.
    ifIgnored: own({ key: "ifIgnored" }),
    // An inherited `notice` would take a waiting step off every list.
    notice: own({ key: "notice" }),
    // Inherited `quotes` would draw words the line never carried.
    quotes: own({ key: "quotes" }),
    recheck: own({ key: "recheck" }),
    // An inherited `row` would tie a step that never named one to a board row.
    row: own({ key: "row" }),
    // An inherited `shot` would draw a picture the line never carried.
    shot: own({ key: "shot" }),
    // An inherited `stopsWork` would lead the owner's queue with a step that never stopped them.
    stopsWork: own({ key: "stopsWork" }),
    // An inherited `unaddressed` would refuse a legacy line that never carried one.
    unaddressed: own({ key: "unaddressed" }),
  };
}

/**
 * Build a posted row out of one parsed line, running every rule the builder runs.
 *
 * Re-validating on READ rather than trusting the write is the same decision `../autonomy/importRegister.ts` makes:
 * the first rows of a register in this repository have been written by a shell redirect before now, and a
 * reader that trusts them renders a step nobody checked. `recheck` is read as an own field, as `row` is: an inherited
 * one would retire a step on a check it never named.
 *
 * @param value the parsed line
 * @param lineNumber which line it was, for the refusal
 * @returns the row, or why the line is not one
 */
function postedRowOf({
  value,
  lineNumber,
}: {
  value: Record<string, unknown>;
  lineNumber: number;
}): Result<HandRow, HandStepError> {
  const step = value["step"];
  if (!isRecord(step)) {
    return err(
      HandStepErrors.corruptRow({ lineNumber, why: "a posted row carries a `step` object and this one does not" }),
    );
  }
  const built = buildHandStep({
    draft: {
      // The RAW value, not a string read: `context` is the one field whose validator has to see a number or
      // a null for what it is. Reading it through `text` would turn a corrupt line into a silently
      // context-free step, which is the loss `postedRowOf` re-validates on read to prevent.
      context: step["context"],
      checkIn: step["checkIn"],
      cites: step["cites"],
      decision: step["decision"],
      id: textOrEmpty({ key: "id", value: step }),
      literal: text({ key: "literal", value: step }),
      opened: text({ key: "opened", value: step }),
      postedBy: textOrEmpty({ key: "postedBy", value: step }),
      postedIso: textOrEmpty({ key: "postedIso", value: step }),
      ...ownFieldsOf({ step }),
      unblocks: textOrEmpty({ key: "unblocks", value: step }),
      url: text({ key: "url", value: step }),
      what: textOrEmpty({ key: "what", value: step }),
      where: text({ key: "where", value: step }),
      witness: textOrEmpty({ key: "witness", value: step }),
    },
  });
  if (built.isErr()) {
    return err(HandStepErrors.corruptRow({ lineNumber, why: built.error.message }));
  }
  return settlesOf({ lineNumber, step: built.value, value: value["settles"] }).map((settles) => ({
    kind: "posted" as const,
    step: built.value,
    ...(settles === undefined ? {} : { settles }),
  }));
}

/**
 * The settling a re-cut posting carries, read with the same rules as a settled row of its own — or honestly absent.
 *
 * It settles another step, never the posting it rides on: a line settling its own step would post a card and take
 * it down in one write.
 *
 * @param value the raw `settles` field
 * @param step the posting it rides on
 * @param lineNumber which line it was, for the refusal
 * @returns the settling, `undefined` when the line carries none, or why the line is not a row
 */
function settlesOf({
  value,
  step,
  lineNumber,
}: {
  value: unknown;
  step: HandStep;
  lineNumber: number;
}): Result<SettledRow | undefined, HandStepError> {
  if (value === undefined) {
    return ok(undefined);
  }
  if (!isRecord(value) || value["kind"] !== "settled") {
    return err(HandStepErrors.corruptRow({ lineNumber, why: "a posting's `settles` is a settled row, or absent" }));
  }
  const settles = settledRowOf({ lineNumber, value });
  if (settles.isErr()) {
    return err(settles.error);
  }
  if (!isSettledRow(settles.value) || settles.value.id === step.id) {
    return err(HandStepErrors.corruptRow({ lineNumber, why: `a posting of ${step.id} cannot settle itself` }));
  }
  return ok(settles.value);
}

/**
 * Parse one line of the register.
 *
 * @param line the raw line
 * @param lineNumber which line it was, for the refusal
 * @returns the row, or why the line is not one
 */
export function parseHandLine({
  line,
  lineNumber,
}: {
  line: string;
  lineNumber: number;
}): Result<HandRow, HandStepError> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return err(HandStepErrors.corruptRow({ lineNumber, why: "it is not JSON" }));
  }
  if (!isRecord(parsed)) {
    return err(HandStepErrors.corruptRow({ lineNumber, why: "it is not a JSON object" }));
  }
  const kind = text({ key: "kind", value: parsed });
  if (kind === "settled") {
    return settledRowOf({ lineNumber, value: parsed });
  }
  if (kind === "posted") {
    return postedRowOf({ lineNumber, value: parsed });
  }
  return err(HandStepErrors.corruptRow({ lineNumber, why: 'a row\'s `kind` is "posted" or "settled"' }));
}

/**
 * The rows one line of the register records, in order: the row itself, then the settling a re-cut posting carries.
 *
 * Every reader folds these rather than the line, so a one-line re-cut reads exactly as a posting followed by the
 * settling of the step it replaces — the two rows an earlier build wrote as two lines.
 *
 * @param line the raw line
 * @param lineNumber which line it was, for the refusal
 * @returns the rows, or why the line is not one
 */
export function rowsOfLine({
  line,
  lineNumber,
}: {
  line: string;
  lineNumber: number;
}): Result<readonly HandRow[], HandStepError> {
  return parseHandLine({ line, lineNumber }).map((row) => {
    if (isSettledRow(row) || row.settles === undefined) {
      return [row];
    }
    return [row, row.settles];
  });
}

/**
 * Which field two postings of one id first disagree about.
 *
 * The order of `keys` is the order a conflict is reported in, so the first difference a reader is told about
 * is the sentence itself rather than a timestamp that differs on every retry.
 *
 * `context` is in the list because an omitted context and a stated one are DIFFERENT postings: without it, a
 * re-post that only adds `--context work` would read as identical to the row already on disk and be accepted
 * as a no-op, turning this register into an amendment mechanism it has never been.
 *
 * @returns the first field whose values differ, or `undefined` when the two postings are identical
 */
export function conflictingField({ first, second }: { first: HandStep; second: HandStep }): string | undefined {
  const keys: readonly (keyof HandStep)[] = [
    "what",
    "literal",
    "checklist",
    "where",
    "url",
    "opened",
    "unaddressed",
    "unblocks",
    "ifIgnored",
    "witness",
    "context",
    "checkIn",
    "notice",
    "cites",
    "decision",
    "row",
    "details",
    "quotes",
    "shot",
    "recheck",
    "postedIso",
    "postedBy",
  ];
  // `cites` is a list, so it is compared by what it says rather than by which array holds it.
  return keys.find((key) => JSON.stringify(first[key]) !== JSON.stringify(second[key]));
}

/**
 * Every step still waiting on the owner, OLDEST FIRST and by no other key.
 *
 * There is no priority and no age bound here on purpose. A wait on a person is a STATE and
 * not a countdown, and that governs this register the same way it governs `../live/turn/blockedOnHuman.ts`'s list:
 * a sort that ranked a week-old sign-in below a fresh one would be a clock deciding what the owner sees.
 *
 * @param rows every row the register holds, in the order they were written
 * @returns the open steps, oldest posting first
 */
export function openHandSteps({ rows }: { rows: readonly HandRow[] }): readonly HandStep[] {
  const settled = new Set<string>();
  for (const row of rows) {
    if (isSettledRow(row)) {
      settled.add(row.id);
    }
  }
  const open = new Map<string, HandStep>();
  for (const row of rows) {
    if (!isSettledRow(row) && !settled.has(row.step.id)) {
      open.set(row.step.id, row.step);
    }
  }
  return [...open.values()].toSorted((a, b) => a.postedIso.localeCompare(b.postedIso));
}
