/**
 * A staged part read back into the entries an import compares, each row re-decoded under the schema its own domain
 * owns — the same parsers an export's part is judged by — and rebuilt by the same entry builder. A stored fingerprint
 * is evidence to check, never a substitute for decoding: a rebuilt row must carry its staged key and fingerprint,
 * in its staged place, or the part is refused. The summary is the staged one, since it is display text a question
 * was asked in, and a steer measurement's names a part line its payload does not carry. Each row's decoded domain
 * value comes back beside its entry, so an apply writes exactly what was compared. Pure.
 */
import { isDeepStrictEqual } from "node:util";

import { isRecord } from "#lib/parsers.js";
import { err, ok, type Result } from "#lib/result.js";

import {
  OWNER_DIRECTIVE_OVERLAY_SCHEMA_VERSION,
  type OwnerCorrection,
  type OwnerDirective,
  parseOwnerDirectiveOverlay,
} from "../../judgement/ownerDirective.js";
import { parseExportedRecall, type RecallRecord } from "../../knowledge/recallRestore.js";
import { parseExportedLine, type RestoredRecording } from "../../knowledge/restore.js";
import { foldStandingAsks, type StandingAsk } from "../../profile/standingAsks.js";
import {
  parseSteerMeasurementEnvelopeV2,
  type SteerMeasurementEnvelopeV2,
} from "../../profile/steerMeasurementTransfer.js";
import { parseVoiceCohort } from "../profile/core.js";
import type { VoiceCohort } from "../profile/types.js";

import { type PortableOwnerProfile, parsePortableOwnerProfile } from "./decode.js";
import { type ImportStagedPayloadInvalidError, StoreImportApplyErrors } from "./importApplyErrors.js";
import type { StoreExportPartKind } from "./parts.js";
import {
  comparisonMetadata,
  directiveEntries,
  memoryEntry,
  ownerEntry,
  type RetainedEntry,
  recallEntry,
  type StagedEntry,
  standingAskEntries,
  steerMeasurementEntry,
  voiceEntry,
} from "./retained.js";

/** One staged row as the store holds it, its payload as the database returned it. */
export interface StagedItemRow {
  readonly part: StoreExportPartKind;
  readonly key: string;
  readonly ordinal: number;
  readonly payload: unknown;
  readonly fingerprint: string;
  readonly summary: string;
}

/** One staged row's decoded domain value, by what it is. */
export type StagedValue =
  | { readonly kind: "memory"; readonly recording: RestoredRecording }
  | { readonly kind: "recall"; readonly recall: RecallRecord }
  | { readonly kind: "owner"; readonly owner: PortableOwnerProfile }
  | { readonly kind: "voice"; readonly cohort: VoiceCohort }
  | { readonly kind: "directive"; readonly directive: OwnerDirective }
  | { readonly kind: "correction"; readonly correction: OwnerCorrection }
  | { readonly kind: "standing-ask"; readonly ask: StandingAsk }
  | { readonly kind: "steer"; readonly envelope: SteerMeasurementEnvelopeV2 };

/** One staged part read back: its entries in staged order, and each row's decoded value by its key. */
export interface StagedPart {
  readonly entries: readonly RetainedEntry[];
  readonly values: ReadonlyMap<string, StagedValue>;
}

/** One row rebuilt: the entry its comparison reads, and the value it was built from. */
interface Rebuilt {
  readonly entry: StagedEntry;
  readonly value: StagedValue;
}

/** Why one row, or the part judged whole (`key` null), does not decode. */
interface Undecodable {
  readonly key: string | null;
  readonly why: string;
}

/** One row decoded from its payload alone, or why it does not decode. */
type RowDecode = (row: StagedItemRow) => Result<Rebuilt, string>;

/** Each row decoded on its own, the first that does not refusing the part. */
function eachRow({
  rows,
  decode,
}: {
  rows: readonly StagedItemRow[];
  decode: RowDecode;
}): Result<readonly Rebuilt[], Undecodable> {
  const decodedRows: Rebuilt[] = [];
  for (const row of rows) {
    const decoded = decode(row);
    if (decoded.isErr()) {
      return err({ key: row.key, why: decoded.error });
    }
    decodedRows.push(decoded.value);
  }
  return ok(decodedRows);
}

/** A memory, read as the line its export wrote. */
const memoryRow: RowDecode = (row) =>
  parseExportedLine({ line: JSON.stringify(row.payload), lineNumber: row.ordinal + 1 })
    .map((recording) => ({ entry: memoryEntry({ recording }), value: { kind: "memory", recording } as const }))
    .mapErr((error) => error.message);

/** A recall, read as the line its export wrote. */
const recallRow: RowDecode = (row) =>
  parseExportedRecall({ line: JSON.stringify(row.payload), lineNumber: row.ordinal + 1 })
    .map((recall) => ({ entry: recallEntry({ recall }), value: { kind: "recall", recall } as const }))
    .mapErr((error) => error.message);

/** The owner profile's portable fields. */
const ownerRow: RowDecode = (row) =>
  parsePortableOwnerProfile({ value: row.payload }).map((owner) => ({
    entry: ownerEntry({ owner }),
    value: { kind: "owner", owner } as const,
  }));

/** One voice cohort. */
const voiceRow: RowDecode = (row) =>
  parseVoiceCohort({ value: row.payload })
    .map((cohort) => ({ entry: voiceEntry({ cohort }), value: { cohort, kind: "voice" } as const }))
    .mapErr((error) => error.message);

/** One steer measurement, its sequence the staged ordinal. */
const steerRow: RowDecode = (row) =>
  parseSteerMeasurementEnvelopeV2({ value: row.payload })
    .map((envelope) => ({
      entry: steerMeasurementEntry({ measurement: { envelope, sequence: row.ordinal + 1 } }),
      value: { envelope, kind: "steer" } as const,
    }))
    .mapErr((issues) => issues.join("; "));

/** Each entry beside the value it was built from; the two lists are built in one order. */
function paired({
  entries,
  values,
}: {
  entries: readonly StagedEntry[];
  values: readonly StagedValue[];
}): readonly Rebuilt[] {
  return entries.map((entry, at) => ({ entry, value: values[at]! }));
}

/** The directive overlay the part's directives and corrections were flattened from, judged whole. */
function directiveRows({ rows }: { rows: readonly StagedItemRow[] }): Result<readonly Rebuilt[], Undecodable> {
  const overlay = parseOwnerDirectiveOverlay({
    value: {
      corrections: rows.filter((row) => row.key.startsWith("correction:")).map((row) => row.payload),
      directives: rows.filter((row) => row.key.startsWith("directive:")).map((row) => row.payload),
      schemaVersion: OWNER_DIRECTIVE_OVERLAY_SCHEMA_VERSION,
    },
  });
  if (overlay.isErr()) {
    return err({ key: null, why: overlay.error.message });
  }
  const values: StagedValue[] = [
    ...overlay.value.directives.map((directive): StagedValue => ({ directive, kind: "directive" })),
    ...overlay.value.corrections.map((correction): StagedValue => ({ correction, kind: "correction" })),
  ];
  return ok(paired({ entries: directiveEntries({ overlay: overlay.value }), values }));
}

/** The standing asks, folded as the journal that records each in its staged order, so the register is judged whole. */
function standingAskRows({ rows }: { rows: readonly StagedItemRow[] }): Result<readonly Rebuilt[], Undecodable> {
  const lines: string[] = [];
  for (const row of rows) {
    if (!isRecord(row.payload)) {
      return err({ key: row.key, why: "it is not an object" });
    }
    // A staged ask is the ask alone; the journal kind is added here, so one already present would be masked.
    if ("kind" in row.payload) {
      return err({ key: row.key, why: "it carries a journal kind, which a staged ask never does" });
    }
    lines.push(JSON.stringify({ ...row.payload, kind: "recorded" }));
  }
  const folded = foldStandingAsks({ lines });
  if (folded.isErr()) {
    return err({ key: null, why: folded.error.message });
  }
  const values = folded.value.map((ask): StagedValue => ({ ask, kind: "standing-ask" }));
  return ok(paired({ entries: standingAskEntries({ asks: folded.value }), values }));
}

/** One part's rows rebuilt from their payloads alone. */
function rebuilt({
  part,
  rows,
}: {
  part: StoreExportPartKind;
  rows: readonly StagedItemRow[];
}): Result<readonly Rebuilt[], Undecodable> {
  switch (part) {
    case "memories":
      return eachRow({ decode: memoryRow, rows });
    case "memory-recalls":
      return eachRow({ decode: recallRow, rows });
    case "owner-profile":
      return eachRow({ decode: ownerRow, rows });
    case "owner-voice":
      return eachRow({ decode: voiceRow, rows });
    case "owner-directives":
      return directiveRows({ rows });
    case "standing-asks":
      return standingAskRows({ rows });
    case "steer-verdicts":
      return eachRow({ decode: steerRow, rows });
    default: {
      const unhandled: never = part;
      return unhandled;
    }
  }
}

/**
 * One staged part read back into the entries its plan compared, each checked against what was staged, and the
 * domain value each was decoded to.
 *
 * @param part the part, which decides the schema its rows are judged by
 * @param rows every staged row of that part, in any order: they are read in their staged order
 * @returns the entries in staged order, carrying their staged summaries, and each row's value by key, or
 *   `IMPORT_STAGED_PAYLOAD_INVALID` naming the first row that does not decode, or decodes to a row other than the
 *   one staged in its place
 */
export function stagedPartEntries({
  part,
  rows,
}: {
  part: StoreExportPartKind;
  rows: readonly StagedItemRow[];
}): Result<StagedPart, ImportStagedPayloadInvalidError> {
  const ordered = rows.toSorted((left, right) => left.ordinal - right.ordinal);
  const decoded = rebuilt({ part, rows: ordered });
  if (decoded.isErr()) {
    return err(StoreImportApplyErrors.payloadInvalid({ key: decoded.error.key, part, why: decoded.error.why }));
  }
  if (decoded.value.length !== ordered.length) {
    const why = `${String(ordered.length)} staged rows decode to ${String(decoded.value.length)}`;
    return err(StoreImportApplyErrors.payloadInvalid({ key: null, part, why }));
  }
  const entries: RetainedEntry[] = [];
  const values = new Map<string, StagedValue>();
  for (const [at, row] of ordered.entries()) {
    const { entry, value } = decoded.value[at]!;
    if (entry.key !== row.key || entry.fingerprint !== row.fingerprint) {
      const why = `it decodes to ${entry.key} under ${entry.fingerprint}, staged as ${row.key} under ${row.fingerprint}`;
      return err(StoreImportApplyErrors.payloadInvalid({ key: row.key, part, why }));
    }
    // A strict parser may still ignore a field it does not read, so the payload must BE the row it rebuilds, key order
    // aside as jsonb keeps none: nothing staged rides along unread.
    if (!isDeepStrictEqual(row.payload, entry.payload)) {
      const why = "its payload is not the row it decodes to: it carries a field, or a spelling, the export never wrote";
      return err(StoreImportApplyErrors.payloadInvalid({ key: row.key, part, why }));
    }
    // The payload digest is the rebuilt row's, so the fresh plan's digest moves with any staged field the
    // fingerprint leaves out, a memory's `seq` among them.
    entries.push({
      fingerprint: row.fingerprint,
      key: row.key,
      summary: row.summary,
      ...comparisonMetadata({ entry }),
    });
    values.set(row.key, value);
  }
  return ok({ entries, values });
}
