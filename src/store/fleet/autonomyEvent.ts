/**
 * The one-time import of a legacy `$SLOPWEAVER_HOME/ledgers/autonomy.jsonl` into `autonomy_event`: one line
 * into one row, and the read-back comparison that decides whether the import may be marked complete.
 *
 * Pure: a line, its number and its path in; a row or a typed failure out.
 *
 * ## It decodes through `../../autonomy/decode.ts`, deliberately
 *
 * `autonomy_event` is the ledger itself (`../../autonomy/port.ts`), so a line becomes a row through exactly the
 * decoder and the projection the port writes with (`../../autonomy/storeRecord.ts`): the stored `record` is the
 * validated record whole, and every column is derived from it. A line the record rules refuse is
 * `AUTONOMY_LINE_REFUSED`, never a partial row — a mirror could skip one; an authority that skipped one would
 * be a ledger that quietly lost an act.
 *
 * ## Why an imported key carries a prefix
 *
 * `imported:<ledgerImportKey>`. The table already holds the null-`record` mirror rows earlier imports wrote
 * under the bare line key; a prefixed key cannot collide with one, so a preserved mirror never blocks the row
 * that replaces it as authority.
 */
import { stableStringify } from "#lib/stableStringify.js";

import { parseAutonomyLine } from "../../autonomy/decode.js";
import { autonomyEventRow } from "../../autonomy/storeRecord.js";
import { err, ok, type Result } from "../../lib/result.js";
import type { NewAutonomyEventRecord } from "../schema/ledgers.js";

import { type FleetImportError, FleetImportErrors } from "./errors.js";
import { ledgerImportKey } from "./importKey.js";

/** One register line that became a row, with the line number a divergence names. */
export interface ProjectedAutonomyLine {
  readonly lineNumber: number;
  readonly row: NewAutonomyEventRecord;
}

/** One authority row as the read-back returns it. */
export interface StoredAutonomyImportRow {
  readonly actionId: string;
  readonly entryKind: string;
  readonly importKey: string;
  readonly record: unknown;
}

/**
 * The key one imported line is stored under.
 *
 * @param line the line's exact text
 * @param lineNumber the 1-based physical line number
 * @returns `imported:` and the line's own import key
 */
export function importedAutonomyKey({ line, lineNumber }: { line: string; lineNumber: number }): string {
  return `imported:${ledgerImportKey({ line, lineNumber })}`;
}

/**
 * Project one physical line of the autonomy register into the row an insert takes.
 *
 * @param line the line's exact text, hashed into the import key so a re-apply is a no-op
 * @param lineNumber the 1-based physical line number
 * @param path the register's path, carried into every failure so the operator can go and look
 * @returns the row, or the typed reason the line could not become one
 */
export function projectAutonomyLine({
  line,
  lineNumber,
  path,
}: {
  line: string;
  lineNumber: number;
  path: string;
}): Result<NewAutonomyEventRecord, FleetImportError> {
  const record = parseAutonomyLine({ line, lineNumber });
  if (record.isErr()) {
    return err(FleetImportErrors.autonomyLineRefused({ lineNumber, path, why: record.error.message }));
  }
  const row = autonomyEventRow({ importKey: importedAutonomyKey({ line, lineNumber }), record: record.value });
  if (row.isErr()) {
    return err(FleetImportErrors.autonomyLineRefused({ lineNumber, path, why: row.error.message }));
  }
  return ok(row.value);
}

/**
 * The identity a line and a stored row are compared on. An act is one per id, so it compares with whichever row
 * holds its id; a steer may be given twice, so it compares only with the row its own line wrote.
 */
function logicalKey({
  actionId,
  entryKind,
  importKey,
}: {
  actionId: string;
  entryKind: string;
  importKey: string;
}): string {
  if (entryKind === "action") {
    return `action\u0000${actionId}`;
  }
  return `steer\u0000${importKey}`;
}

/**
 * Every legacy line whose record disagrees with — or is absent from — the row the store holds for it after the
 * insert.
 *
 * The row is the authority and the import never overwrites it, so a disagreement is reported rather than
 * resolved. A line repeating a stored act exactly is no divergence: it is the same fact twice. A row no line
 * produced is not one either — the verbs write rows the file never saw. Records compare by canonical JSON,
 * because `jsonb` does not keep key order.
 *
 * @param path the register, named in every divergence
 * @param projected each line that became a row, in file order
 * @param stored every authority row, read back after the insert
 * @returns one `AUTONOMY_IMPORT_DIVERGED` per disagreeing line, in file order
 */
export function autonomyImportDivergences({
  path,
  projected,
  stored,
}: {
  path: string;
  projected: readonly ProjectedAutonomyLine[];
  stored: readonly StoredAutonomyImportRow[];
}): readonly FleetImportError[] {
  const byKey = new Map<string, string>();
  for (const row of stored) {
    const key = logicalKey(row);
    if (!byKey.has(key)) {
      byKey.set(key, stableStringify({ value: row.record }));
    }
  }
  return projected.flatMap(({ lineNumber, row }) => {
    const held = byKey.get(logicalKey(row));
    if (held === stableStringify({ value: row.record })) {
      return [];
    }
    return [
      FleetImportErrors.autonomyImportDiverged({ actionId: row.actionId, entryKind: row.entryKind, lineNumber, path }),
    ];
  });
}
