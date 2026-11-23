/**
 * Projecting one line of `$SLOPWEAVER_HOME/grants/journal.jsonl` into one `grant_row`.
 *
 * Pure: a line, its number and its path in; a row or a typed failure out.
 *
 * ## It decodes through `../../grants/grant.ts`, deliberately
 *
 * The journal's lines are a TAGGED envelope — `{kind: "grant", grant: {…}}`, `{kind: "performance", …}`,
 * `{kind: "refusal", …}` — and `parseGrantLine` is the one decoder for them. Reading the fields out here
 * by hand would be a second copy of that shape, and the first draft of this module proved the point by
 * getting it wrong: it read `id`, `changeKind` and `anchor` off the envelope, where they sit one level
 * down inside `grant`. So the envelope is decoded by its owner and this module only FLATTENS it.
 *
 * ## Two callers, one projection
 *
 * `grant_row` is the journal itself (`../../grants/port.ts`), so {@link grantEntryRow} serves both the verbs
 * that write a row today and {@link projectGrantLine}, the one-time import of a legacy
 * `$SLOPWEAVER_HOME/grants/journal.jsonl`. Only the import key and the `entry` column's source differ.
 *
 * `entry` carries the envelope whole beside the flattened columns, for `./codexPass.ts`'s reason: a field this
 * projection does not name stays recoverable, and it is what a read decodes back into a `GrantEntry`.
 */
import { isRecord } from "#lib/parsers.js";
import { stableStringify } from "#lib/stableStringify.js";

import { type GrantEntry, parseGrantLine } from "../../grants/grant.js";
import { err, ok, type Result } from "../../lib/result.js";
import type { NewGrantRowRecord } from "../schema/ledgers.js";

import { type FleetImportError, FleetImportErrors } from "./errors.js";
import { ledgerImportKey } from "./importKey.js";

/** The flat fields one envelope contributes, before the import key and the verbatim line are added. */
interface FlatEntry {
  readonly grantId: string;
  readonly entryKind: string;
  readonly atIso: string;
  readonly bySession: string;
  readonly targetFile: string | null;
  readonly changeKind: string | null;
  readonly change: string | null;
  readonly anchor: string | null;
  readonly refusalCode: string | null;
  readonly detail: string | null;
}

/**
 * Flatten one decoded envelope into the row's columns.
 *
 * A `switch` over the discriminator with every arm spelled, rather than a merge of optional fields: the
 * three shapes carry disjoint facts and a reader of this function should be able to see which column comes
 * from which shape without holding the union in their head.
 *
 * @param entry the decoded envelope
 * @returns the flat fields it contributes
 */
function flatten({ entry }: { entry: GrantEntry }): FlatEntry {
  switch (entry.kind) {
    case "grant":
      return {
        anchor: entry.grant.anchor,
        atIso: entry.grant.recordedAtIso,
        bySession: entry.grant.recordedBySessionId,
        change: entry.grant.change,
        changeKind: entry.grant.changeKind,
        detail: null,
        entryKind: "grant",
        grantId: entry.grant.id,
        refusalCode: null,
        // A `system` target has a name and no path, and writing its name into a column called
        // `target_file` would make the two indistinguishable in the table.
        targetFile: entry.grant.target.kind === "file" ? entry.grant.target.path : null,
      };
    case "performance":
      return {
        anchor: null,
        atIso: entry.performance.performedAtIso,
        bySession: entry.performance.performedBySessionId,
        change: null,
        changeKind: null,
        detail: entry.performance.wrote,
        entryKind: "performance",
        grantId: entry.performance.grantId,
        refusalCode: null,
        targetFile: null,
      };
    case "refusal":
      return {
        anchor: null,
        atIso: entry.refusal.refusedAtIso,
        bySession: entry.refusal.refusedBySessionId,
        change: null,
        changeKind: null,
        detail: entry.refusal.why,
        entryKind: "refusal",
        grantId: entry.refusal.grantId,
        refusalCode: entry.refusal.code,
        targetFile: null,
      };
  }
}

/**
 * The row one decoded entry becomes — the ONE projection both the runtime writer (`../../grants/storePort.ts`)
 * and the legacy import use, so a row written today and a row imported from the file cannot differ in shape.
 *
 * @param entry the decoded envelope, which decides every flat column
 * @param verbatim what the `entry` column holds: the line's own parse on import, the envelope itself at runtime
 * @param importKey the row's idempotence key — a line hash on import, a derived key at runtime
 * @returns the row, or the entry's own instant text when it is not a readable instant
 */
export function grantEntryRow({
  entry,
  verbatim,
  importKey,
}: {
  entry: GrantEntry;
  verbatim: Readonly<Record<string, unknown>>;
  importKey: string;
}): Result<NewGrantRowRecord, string> {
  const flat = flatten({ entry });
  const recordedAt = new Date(flat.atIso);
  if (Number.isNaN(recordedAt.getTime())) {
    return err(flat.atIso);
  }
  return ok({
    anchor: flat.anchor,
    bySession: flat.bySession,
    change: flat.change,
    changeKind: flat.changeKind,
    detail: flat.detail,
    entry: verbatim,
    entryKind: flat.entryKind,
    grantId: flat.grantId,
    importKey,
    recordedAt,
    refusalCode: flat.refusalCode,
    targetFile: flat.targetFile,
  });
}

/** One stored grant row as the import's read-back compares it. */
export interface StoredGrantImportRow {
  readonly entryKind: string;
  readonly grantId: string;
  readonly importKey: string;
  readonly entry: unknown;
}

/** One legacy line that became a row, with the line number a divergence names. */
export interface ProjectedGrantLine {
  readonly lineNumber: number;
  readonly row: NewGrantRowRecord;
}

/**
 * The key a row is the ONE row for: a grant or a performance is one per grant id, which the partial unique
 * indexes enforce, while refusals are many and each is its own import key.
 *
 * So a refusal line edited after an earlier import is a NEW refusal, not a divergence: its import key hashes the
 * line's bytes (the key every earlier import already wrote, so it cannot change without duplicating each stored
 * refusal), and no row records which physical line it came from. Nothing stored is overwritten either way.
 */
function logicalKey({
  entryKind,
  grantId,
  importKey,
}: {
  entryKind: string;
  grantId: string;
  importKey: string;
}): string {
  return entryKind === "refusal" ? `refusal\u0000${importKey}` : `${entryKind}\u0000${grantId}`;
}

/**
 * Every legacy line whose entry disagrees with the row the store holds for it after the import.
 *
 * The row is the authority and the import never overwrites it, so a disagreement is reported rather than
 * resolved. A legacy line that repeats a stored entry exactly is no divergence: it is the same fact twice. A row
 * the store holds that no line produced is not one either — the verbs write rows the file never saw. Entries
 * compare by canonical JSON, so key order is not a difference.
 *
 * @param path the journal, named in every divergence
 * @param projected each line that became a row, in file order
 * @param stored every row the store holds, read back after the insert
 * @returns one `GRANT_IMPORT_DIVERGED` per disagreeing line, in file order
 */
export function grantImportDivergences({
  path,
  projected,
  stored,
}: {
  path: string;
  projected: readonly ProjectedGrantLine[];
  stored: readonly StoredGrantImportRow[];
}): readonly FleetImportError[] {
  const byKey = new Map(stored.map((row) => [logicalKey(row), stableStringify({ value: row.entry })]));
  return projected.flatMap(({ lineNumber, row }) => {
    const held = byKey.get(logicalKey(row));
    if (held === stableStringify({ value: row.entry })) {
      return [];
    }
    return [
      FleetImportErrors.grantImportDiverged({ entryKind: row.entryKind, grantId: row.grantId, lineNumber, path }),
    ];
  });
}

/**
 * Project one physical line of the legacy grant journal into the row an insert takes.
 *
 * @param line the line's exact text, hashed into the import key so a re-apply is a no-op
 * @param lineNumber the 1-based physical line number
 * @param path the journal's path, carried into every failure so the operator can go and look
 * @returns the row, or the typed reason the line could not become one
 */
export function projectGrantLine({
  line,
  lineNumber,
  path,
}: {
  line: string;
  lineNumber: number;
  path: string;
}): Result<NewGrantRowRecord, FleetImportError> {
  const entry = parseGrantLine({ line });
  if (entry === undefined) {
    return err(FleetImportErrors.unreadableLine({ lineNumber, path }));
  }
  // The envelope is re-parsed rather than reconstructed from `entry`, so `entry` holds the line's own
  // bytes and not this module's idea of them. `parseGrantLine` already proved it decodes.
  const verbatim: unknown = JSON.parse(line);
  if (!isRecord(verbatim)) {
    return err(FleetImportErrors.unreadableLine({ lineNumber, path }));
  }
  return grantEntryRow({ entry, importKey: ledgerImportKey({ line, lineNumber }), verbatim }).mapErr((value) =>
    FleetImportErrors.unreadableInstant({ lineNumber, path, value }),
  );
}
