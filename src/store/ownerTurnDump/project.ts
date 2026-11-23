/**
 * A `pg_dump` of the owner-turn tables, folded line by line into the rows `importOwnerTurns` writes. Pure: the
 * reader (`./read.ts`) feeds it one line at a time, so a dump of any size is never one string.
 *
 * Only the two sections whose column lists are EXACTLY the ones below are read; every other `COPY` section is
 * stepped over to its `\.` terminator, so a data line that happens to look like a header is never mistaken for one.
 * A body is re-hashed from the bytes the dump carried and refused on any disagreement, and a location naming a body
 * the dump does not carry is refused: the load is a faithful copy of a keep, or it is nothing.
 *
 * The dump has no instant the owner SPOKE: `first_imported_at` and `recorded_at` are when a store held the row, and
 * `file_modified_at` is when a seat last wrote the file. They are loaded as exactly those columns and never mapped
 * into a captured turn's `said_at`.
 */
import { createHash } from "node:crypto";

import { parseStrictIsoInstantMs } from "#lib/date.js";
import { err, ok, type Result } from "#lib/result.js";
import { OWNER_TURN_FAMILIES, ownerTurnFamily, ownerTurnLabel } from "../fleet/ownerTurn.js";
import type { NewOwnerTurnLocationRecord, NewOwnerTurnRecord } from "../schema/ownerTurn.js";

import { readCopyHeader } from "./copyHeader.js";
import { type CopyField, decodeCopyLine } from "./copyText.js";
import { type OwnerTurnDumpError, OwnerTurnDumpErrors } from "./errors.js";

/** The two sections read, each with the exact column list it must declare. */
export const DUMP_SECTIONS = {
  owner_turn: "body_sha256, body, byte_length, first_imported_at",
  owner_turn_location: "relative_path, body_sha256, turn, family, file_modified_at, recorded_at",
} as const;

/** One of {@link DUMP_SECTIONS}. */
type DumpTable = keyof typeof DUMP_SECTIONS;

/** What a whole dump folds to. */
export interface OwnerTurnDumpLoad {
  readonly bodies: readonly NewOwnerTurnRecord[];
  readonly locations: readonly NewOwnerTurnLocationRecord[];
  /** Every row that could not be loaded, each named. A non-empty list means nothing should be written. */
  readonly refused: readonly OwnerTurnDumpError[];
}

/** The fold, fed one line at a time and finished once. */
export interface OwnerTurnDumpFold {
  readonly feed: (args: { line: string; lineNumber: number }) => void;
  readonly finish: () => Result<OwnerTurnDumpLoad, OwnerTurnDumpError>;
}

const SHA256 = /^[0-9a-f]{64}$/u;
const DUMP_TIMESTAMP = /^([0-9]{4}-[0-9]{2}-[0-9]{2}) ([0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,3})?)\+00$/u;

/** Whether a dump table name is one of the two this fold reads. */
function isDumpTable(name: string): name is DumpTable {
  return Object.hasOwn(DUMP_SECTIONS, name);
}

/**
 * A `timestamptz` as `pg_dump` prints it in UTC, as a Date.
 *
 * @param text e.g. `<date> 01:41:34.805+00`
 * @returns the instant, or `undefined` when it is not that shape to the millisecond
 */
function dumpInstant({ text }: { text: string }): Date | undefined {
  const match = DUMP_TIMESTAMP.exec(text);
  if (match === null) {
    return undefined;
  }
  const ms = parseStrictIsoInstantMs({ text: `${match[1]!}T${match[2]!}Z` });
  if (ms === undefined) {
    return undefined;
  }
  return new Date(ms);
}

/**
 * Every field's text, refusing a SQL null — neither table has a nullable column.
 *
 * @returns the texts, or the position of the first null
 */
function texts({ fields }: { fields: readonly CopyField[] }): string[] | number {
  const out: string[] = [];
  for (const [position, field] of fields.entries()) {
    if (field === null) {
      return position + 1;
    }
    out.push(field.text);
  }
  return out;
}

/**
 * One `owner_turn` row.
 *
 * @param fields the decoded fields, in {@link DUMP_SECTIONS} order
 * @param lineNumber the line, named in a refusal
 * @returns the body row, or the refusal
 */
function bodyRow({
  fields,
  lineNumber,
}: {
  fields: readonly CopyField[];
  lineNumber: number;
}): Result<NewOwnerTurnRecord, OwnerTurnDumpError> {
  const table = "owner_turn";
  const values = texts({ fields });
  if (typeof values === "number") {
    return err(OwnerTurnDumpErrors.rowMalformed({ lineNumber, reason: `field ${String(values)} is null`, table }));
  }
  // `decodeCopyLine` already held the row to the section's four columns.
  const [bodySha256, body, byteLengthText, importedText] = [values[0]!, values[1]!, values[2]!, values[3]!];
  const firstImportedAt = dumpInstant({ text: importedText });
  if (!SHA256.test(bodySha256) || !/^[0-9]+$/u.test(byteLengthText) || firstImportedAt === undefined) {
    return err(
      OwnerTurnDumpErrors.rowMalformed({
        lineNumber,
        reason: "its sha, byte length or first_imported_at is not the column's shape",
        table,
      }),
    );
  }
  const bytes = fields[1]!.bytes;
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== bodySha256) {
    return err(OwnerTurnDumpErrors.bodyMismatch({ bodySha256, lineNumber, reason: `its bytes hash to ${actual}` }));
  }
  if (bytes.length !== Number(byteLengthText)) {
    return err(
      OwnerTurnDumpErrors.bodyMismatch({
        bodySha256,
        lineNumber,
        reason: `it is ${String(bytes.length)} bytes, not the ${byteLengthText} its row says`,
      }),
    );
  }
  return ok({ body, bodySha256, byteLength: bytes.length, firstImportedAt });
}

/**
 * One `owner_turn_location` row.
 *
 * @param fields the decoded fields, in {@link DUMP_SECTIONS} order
 * @param lineNumber the line, named in a refusal
 * @returns the location row, or the refusal
 */
function locationRow({
  fields,
  lineNumber,
}: {
  fields: readonly CopyField[];
  lineNumber: number;
}): Result<NewOwnerTurnLocationRecord, OwnerTurnDumpError> {
  const table = "owner_turn_location";
  const values = texts({ fields });
  if (typeof values === "number") {
    return err(OwnerTurnDumpErrors.rowMalformed({ lineNumber, reason: `field ${String(values)} is null`, table }));
  }
  // `decodeCopyLine` already held the row to the section's six columns.
  const [relativePath, bodySha256, turn, family] = [values[0]!, values[1]!, values[2]!, values[3]!];
  const fileModifiedAt = dumpInstant({ text: values[4]! });
  const recordedAt = dumpInstant({ text: values[5]! });
  const knownFamily = OWNER_TURN_FAMILIES.some((candidate) => candidate === family);
  if (relativePath === "" || turn === "" || !SHA256.test(bodySha256) || !knownFamily) {
    return err(
      OwnerTurnDumpErrors.rowMalformed({
        lineNumber,
        reason: "its path, turn, sha or family is not the column's shape",
        table,
      }),
    );
  }
  // A location's turn and family are what its own path names, exactly as the file walk derives them
  // (`projectOwnerTurnFile`). Holding a dump row to that means one `(relative_path, body_sha256)` key can only ever
  // carry one turn and family, so the writer's conflict-do-nothing never keeps a stored row over a dump row that
  // disagrees with it.
  const fileName = relativePath.split("/").at(-1)!;
  if (ownerTurnLabel({ fileName }) !== turn || ownerTurnFamily({ relativePath }) !== family) {
    return err(
      OwnerTurnDumpErrors.rowMalformed({
        lineNumber,
        reason: "its turn or family is not the one its path names",
        table,
      }),
    );
  }
  if (fileModifiedAt === undefined || recordedAt === undefined) {
    return err(
      OwnerTurnDumpErrors.rowMalformed({
        lineNumber,
        reason: "its file_modified_at or recorded_at is not a UTC instant",
        table,
      }),
    );
  }
  return ok({ bodySha256, family, fileModifiedAt, recordedAt, relativePath, turn });
}

/** Everything one fold has read so far. */
interface FoldState {
  readonly bodies: NewOwnerTurnRecord[];
  readonly locations: { row: NewOwnerTurnLocationRecord; lineNumber: number }[];
  readonly refused: OwnerTurnDumpError[];
  readonly terminated: Set<DumpTable>;
  /** Each row key already read, and the line that carried it first. */
  readonly seenKeys: Map<string, number>;
  readonly problems: OwnerTurnDumpError[];
  /** `undefined` outside any COPY section; `"other"` inside a section this fold steps over. */
  section: DumpTable | "other" | undefined;
}

/**
 * The section a line outside any section opens, recording a mis-declared one of ours as a problem.
 *
 * @param line the line
 * @param problems the fold's whole-dump problems, mutated
 * @returns the section it opens, or `undefined` when it is no COPY header
 */
function openSection({ line, problems }: { line: string; problems: OwnerTurnDumpError[] }): FoldState["section"] {
  const header = readCopyHeader({ line });
  if (header.kind === "none") {
    return undefined;
  }
  if (header.kind === "unparsed") {
    // Stepped over, so its rows cannot be read as ours, and refused, so a table it might have named is never skipped.
    const reason = `its table name will not parse as a PostgreSQL identifier: ${line}`;
    problems.push(OwnerTurnDumpErrors.sectionMissing({ reason, table: "a COPY header" }));
    return "other";
  }
  const { table } = header;
  // Only `public` holds ours: a same-named table in another schema is another table.
  if ((header.schema !== undefined && header.schema !== "public") || !isDumpTable(table)) {
    return "other";
  }
  if (header.columns !== DUMP_SECTIONS[table]) {
    const reason = `its COPY declares (${String(header.columns)}), not (${DUMP_SECTIONS[table]})`;
    problems.push(OwnerTurnDumpErrors.sectionMissing({ reason, table }));
    return "other";
  }
  return table;
}

/**
 * Decode one data line of one of our sections and keep its row, refusing a malformed row or a repeated key.
 *
 * @param state the fold, mutated
 * @param table the section the line sits in
 * @param line the data line
 * @param lineNumber where it sits in the dump
 */
function foldRow({
  state,
  table,
  line,
  lineNumber,
}: {
  state: FoldState;
  table: DumpTable;
  line: string;
  lineNumber: number;
}): void {
  const decoded = decodeCopyLine({ columns: DUMP_SECTIONS[table].split(", ").length, line });
  if (decoded.isErr()) {
    state.refused.push(OwnerTurnDumpErrors.rowMalformed({ lineNumber, reason: decoded.error.message, table }));
    return;
  }
  // A repeated key is refused, never stored once: the insert skips a key it already holds, so the second row of a
  // pair would vanish from a load that reported success.
  const fresh = ({ key }: { key: string }): boolean => {
    const firstLineNumber = state.seenKeys.get(key);
    if (firstLineNumber !== undefined) {
      state.refused.push(OwnerTurnDumpErrors.duplicateKey({ firstLineNumber, lineNumber, table }));
      return false;
    }
    state.seenKeys.set(key, lineNumber);
    return true;
  };
  if (table === "owner_turn") {
    const body = bodyRow({ fields: decoded.value, lineNumber });
    if (body.isErr()) {
      state.refused.push(body.error);
    } else if (fresh({ key: `owner_turn\u0000${body.value.bodySha256}` })) {
      state.bodies.push(body.value);
    }
    return;
  }
  const location = locationRow({ fields: decoded.value, lineNumber });
  if (location.isErr()) {
    state.refused.push(location.error);
  } else if (
    fresh({ key: `owner_turn_location\u0000${location.value.relativePath}\u0000${location.value.bodySha256}` })
  ) {
    state.locations.push({ lineNumber, row: location.value });
  }
}

/**
 * Fold one line of the dump into the state.
 *
 * @param state the fold, mutated
 * @param line the line, without its break
 * @param lineNumber where it sits in the dump
 */
function feedLine({ state, line, lineNumber }: { state: FoldState; line: string; lineNumber: number }): void {
  if (state.section === undefined) {
    state.section = openSection({ line, problems: state.problems });
    return;
  }
  if (line === "\\.") {
    if (state.section !== "other") {
      state.terminated.add(state.section);
    }
    state.section = undefined;
    return;
  }
  if (state.section !== "other") {
    foldRow({ line, lineNumber, state, table: state.section });
  }
}

/**
 * Close the fold: refuse a truncated or missing section, then refuse every location whose body the dump never carried.
 *
 * @param state the fold, its refusals mutated
 * @returns the load, or the first whole-dump problem
 */
function finishFold({ state }: { state: FoldState }): Result<OwnerTurnDumpLoad, OwnerTurnDumpError> {
  if (state.problems.length > 0) {
    return err(state.problems[0]!);
  }
  // A section still open at the end is a truncated dump, even when an EARLIER section for the same table reached
  // its terminator: the rows read from the open one may be only part of it.
  if (state.section !== undefined && state.section !== "other") {
    const reason = "its last COPY section never reaches \\.";
    return err(OwnerTurnDumpErrors.sectionMissing({ reason, table: state.section }));
  }
  // So is one still open in a table this load steps over: the file was cut, and a cut file is not loaded on the
  // strength of the sections that happen to precede the cut.
  if (state.section === "other") {
    const reason = "the dump ends inside a COPY section this load steps over, so the file was cut";
    return err(OwnerTurnDumpErrors.sectionMissing({ reason, table: "a table this load skips" }));
  }
  for (const table of Object.keys(DUMP_SECTIONS).filter(isDumpTable)) {
    if (!state.terminated.has(table)) {
      return err(OwnerTurnDumpErrors.sectionMissing({ reason: "no COPY section reaches its \\. terminator", table }));
    }
  }
  const carried = new Set(state.bodies.map((body) => body.bodySha256));
  for (const { lineNumber, row } of state.locations) {
    if (!carried.has(row.bodySha256)) {
      state.refused.push(OwnerTurnDumpErrors.orphanLocation({ bodySha256: row.bodySha256, lineNumber }));
    }
  }
  return ok({ bodies: state.bodies, locations: state.locations.map(({ row }) => row), refused: state.refused });
}

/**
 * A fresh fold over one dump.
 *
 * @returns the fold: `feed` every line in order, then `finish` once
 */
export function createOwnerTurnDumpFold(): OwnerTurnDumpFold {
  const state: FoldState = {
    bodies: [],
    locations: [],
    problems: [],
    refused: [],
    section: undefined,
    seenKeys: new Map(),
    terminated: new Set(),
  };
  return {
    feed: (input) => {
      feedLine({ ...input, state });
    },
    finish: () => finishFold({ state }),
  };
}
