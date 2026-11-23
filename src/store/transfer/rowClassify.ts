/**
 * What one imported row is to the live store — new, held identically, or held differently — and which live rows it
 * meets. The plan (`./compare.ts`) counts and asks by this classification, and an apply decides what it writes for a
 * row by the same one, so the two can never disagree about a row. Pure.
 *
 * A standing ask meets live asks by card as well as by id (`./standingCompare.ts`). A memory the store does not hold
 * under its id meets the live memory holding its import key, which the knowledge register holds unique beside the
 * id. Every other row meets the one live row under its key.
 */
import { err, ok, type Result } from "#lib/result.js";

import { type StoreTransferError, StoreTransferErrors } from "./errors.js";
import { STORE_EXPORT_PARTS, type StoreExportPartKind } from "./parts.js";
import { comparisonMetadata, type RetainedEntry } from "./retained.js";
import {
  standingAskConflictIdentity,
  standingAskConflictSides,
  standingAskRelations,
  standingAskStatus,
} from "./standingCompare.js";

/** What one row is to the store: absent under its key, held identically, or held differently. */
export type RowStatus = "new" | "identical" | "conflicting";

/** What a conflicting row's question shows and binds of the live side. */
export interface LiveSide {
  /** The live rows it shows, in order. */
  readonly shown: readonly RetainedEntry[];
  /** The canonical value of the live side its question id binds. */
  readonly identity: unknown;
}

/** What one imported row is to the live store, and which live rows it meets. */
export interface ImportRowStatus {
  readonly part: StoreExportPartKind;
  readonly key: string;
  readonly status: RowStatus;
  /**
   * The live keys it meets: every live ask a standing ask meets by id or card, a memory's import-key holder, else its
   * own key where held.
   */
  readonly meets: readonly string[];
}

/**
 * Entries by key, each a plain snapshot read once.
 *
 * @param side which side the entries came from, which a duplicate's refusal names
 * @returns the entries by key, or the refusal naming the first key one side holds twice
 */
export function byKey({
  entries,
  part,
  side,
}: {
  entries: readonly RetainedEntry[];
  part: StoreExportPartKind;
  side: "export" | "live store";
}): Result<ReadonlyMap<string, RetainedEntry>, StoreTransferError> {
  const keyed = new Map<string, RetainedEntry>();
  for (const entry of entries) {
    // A plain snapshot, each field read once: every later step, the duplicate check included, reads this copy.
    const snapshot: RetainedEntry = {
      fingerprint: entry.fingerprint,
      key: entry.key,
      summary: entry.summary,
      ...comparisonMetadata({ entry }),
    };
    if (keyed.has(snapshot.key)) {
      return err(StoreTransferErrors.duplicateKey({ key: snapshot.key, part, side }));
    }
    keyed.set(snapshot.key, snapshot);
  }
  return ok(keyed);
}

/**
 * Keys in a fixed order that does not depend on the runtime's locale.
 *
 * @returns the keys, in code-unit order
 */
export function sortedKeys({ keyed }: { keyed: ReadonlyMap<string, RetainedEntry> }): readonly string[] {
  return [...keyed.keys()].toSorted((a, b) => {
    if (a === b) {
      return 0;
    }
    return a < b ? -1 : 1;
  });
}

/**
 * One side's rows by import key, for a part whose rows carry one. The register holds an import key unique, so a side
 * holding one twice is refused: on the export side no answer could make both rows writable.
 *
 * @param keyed one side's entries by key, from {@link byKey}
 * @param side which side they came from, which a duplicate's refusal names
 * @returns every entry carrying an import key, under it — empty for a part none of whose rows carries one — or the
 *   refusal naming the first import key the side holds twice and both rows holding it
 */
export function byImportKey({
  keyed,
  part,
  side,
}: {
  keyed: ReadonlyMap<string, RetainedEntry>;
  part: StoreExportPartKind;
  side: "export" | "live store";
}): Result<ReadonlyMap<string, RetainedEntry>, StoreTransferError> {
  const held = new Map<string, RetainedEntry>();
  for (const entry of keyed.values()) {
    if (entry.importKey === undefined) {
      continue;
    }
    const first = held.get(entry.importKey);
    if (first !== undefined) {
      const keys = [first.key, entry.key] as const;
      return err(StoreTransferErrors.duplicateImportKey({ importKey: entry.importKey, keys, part, side }));
    }
    held.set(entry.importKey, entry);
  }
  return ok(held);
}

/** One part's two sides indexed for classification. */
export interface IndexedSides {
  /** The export's entries by key. */
  readonly exported: ReadonlyMap<string, RetainedEntry>;
  /** The live store's entries by key. */
  readonly current: ReadonlyMap<string, RetainedEntry>;
  /** The live store's entries by import key, which {@link classify} meets a memory by. */
  readonly importKeys: ReadonlyMap<string, RetainedEntry>;
}

/**
 * One part's export and live entries indexed by key and import key, each side refused whole when it holds either twice.
 * The export's import-key index is built only to prove its keys unique; classification meets the live one.
 *
 * @param fromExport the part's entries as the export holds them
 * @param fromLive the part's entries as the live store holds them
 * @returns both sides indexed, or the first duplicate key or import key either side holds
 */
export function indexedSides({
  fromExport,
  fromLive,
  part,
}: {
  fromExport: readonly RetainedEntry[];
  fromLive: readonly RetainedEntry[];
  part: StoreExportPartKind;
}): Result<IndexedSides, StoreTransferError> {
  return byKey({ entries: fromExport, part, side: "export" }).andThen((exported) =>
    byKey({ entries: fromLive, part, side: "live store" }).andThen((current) =>
      byImportKey({ keyed: exported, part, side: "export" })
        .andThen(() => byImportKey({ keyed: current, part, side: "live store" }))
        .map((importKeys) => ({ current, exported, importKeys })),
    ),
  );
}

/** One row's {@link RowStatus} against the live row under its key. */
function rowStatus({ row, there }: { row: RetainedEntry; there: RetainedEntry | undefined }): RowStatus {
  if (there === undefined) {
    return "new";
  }
  return there.fingerprint === row.fingerprint ? "identical" : "conflicting";
}

/**
 * One row's status and, when it conflicts, the live side its question shows.
 *
 * @param current the live part's entries by key
 * @param importKeys the live part's entries by import key, from {@link byImportKey} over the live side
 * @returns the status, and the live side it meets where it meets one
 */
export function classify({
  part,
  row,
  current,
  importKeys,
}: {
  part: StoreExportPartKind;
  row: RetainedEntry;
  current: ReadonlyMap<string, RetainedEntry>;
  importKeys: ReadonlyMap<string, RetainedEntry>;
}): { readonly status: RowStatus; readonly liveSide: LiveSide | undefined } {
  if (part === "standing-asks") {
    const relations = standingAskRelations({ live: current, row });
    return {
      liveSide: {
        identity: standingAskConflictIdentity({ relations }),
        shown: standingAskConflictSides({ relations }),
      },
      status: standingAskStatus({ relations, row }),
    };
  }
  const there = current.get(row.key);
  const holder = row.importKey === undefined ? undefined : importKeys.get(row.importKey);
  if (there === undefined && holder !== undefined) {
    const identity = { importKey: row.importKey, key: holder.key, live: holder.fingerprint };
    return { liveSide: { identity, shown: [holder] }, status: "conflicting" };
  }
  const status = rowStatus({ row, there });
  if (there === undefined) {
    return { liveSide: undefined, status };
  }
  return { liveSide: { identity: there.fingerprint, shown: [there] }, status };
}

/**
 * Every imported row's status against the live store, by the very classification the plan counts, so what an apply
 * writes for a row is decided by what its plan made of it.
 *
 * @param imported each part the export held, as entries; a part it did not hold is absent
 * @param live each part of the live store, as entries
 * @returns one status per imported row, part by part in export order and key order inside each, or the first part
 *   either side holds a key or an import key in twice
 */
export function importRowStatuses({
  imported,
  live,
}: {
  imported: ReadonlyMap<StoreExportPartKind, readonly RetainedEntry[]>;
  live: ReadonlyMap<StoreExportPartKind, readonly RetainedEntry[]>;
}): Result<readonly ImportRowStatus[], StoreTransferError> {
  const statuses: ImportRowStatus[] = [];
  for (const spec of STORE_EXPORT_PARTS) {
    const fromExport = imported.get(spec.kind);
    if (fromExport === undefined) {
      continue;
    }
    const sides = indexedSides({ fromExport, fromLive: live.get(spec.kind)!, part: spec.kind });
    if (sides.isErr()) {
      return err(sides.error);
    }
    const { current, exported, importKeys } = sides.value;
    for (const key of sortedKeys({ keyed: exported })) {
      const row = exported.get(key)!;
      const { status, liveSide } = classify({ current, importKeys, part: spec.kind, row });
      const meets = liveSide === undefined ? [] : liveSide.shown.map((entry) => entry.key);
      statuses.push({ key, meets, part: spec.kind, status });
    }
  }
  return ok(statuses);
}
