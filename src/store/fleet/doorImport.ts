/**
 * The pure half of the door ledger's one-time import: what a live row's key looks like, and the read-back that
 * compares the legacy file with `door_event` in BOTH directions before the import may be marked done.
 *
 * The ledger is two hundred thousand rows, so the comparison never holds both sides whole. The file's side is a
 * map from import key to a digest of the line's record (a stable serialisation, because `jsonb` reorders keys);
 * the store's side arrives in `seq`-ordered pages, and each page is folded against the map and struck off it.
 * Whatever is left in the map once the last page is folded is a line with no row.
 */
import { createHash } from "node:crypto";

import { stableStringify } from "../../lib/stableStringify.js";

import { type FleetImportError, FleetImportErrors } from "./errors.js";

/**
 * The prefix of every import key the door writes LIVE (`written:<nonce>`). A legacy line's key is a content hash
 * (`./importKey.ts`), which never carries it, so the read-back can tell the two apart without another column.
 */
export const DOOR_WRITTEN_KEY_PREFIX = "written:";

/**
 * Whether any string anywhere in a value — a key included — carries a NUL character, which `jsonb` cannot hold.
 * Shared by the live writer and the import, so neither strips one: that would change what the trail says.
 *
 * @param value the record, or a part of it
 * @returns true on the first NUL found
 */
export function holdsNul({ value }: { value: unknown }): boolean {
  if (typeof value === "string") {
    return value.includes("\u0000");
  }
  if (Array.isArray(value)) {
    return value.some((item) => holdsNul({ value: item }));
  }
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).some(([key, item]) => key.includes("\u0000") || holdsNul({ value: item }));
  }
  return false;
}

/** One stored row as the read-back sees it: its key, its order, and its record — `null` on an unfilled mirror row. */
export interface StoredDoorImportRow {
  readonly importKey: string;
  readonly seq: number;
  readonly record: Readonly<Record<string, unknown>> | null;
}

/**
 * The digest a record is compared by: sha256 of its stable serialisation, so key order cannot fake a difference.
 *
 * @param record the decoded line, or the stored `record`
 * @returns the hex digest
 */
export function doorRecordDigest({ record }: { record: unknown }): string {
  return createHash("sha256")
    .update(stableStringify({ value: record }))
    .digest("hex");
}

/**
 * Fold one page of stored rows against the file's digests, striking each matched key off the map.
 *
 * @param expected the file's digests by import key, still unmatched — mutated: a matched key is removed
 * @param page one page of stored rows, live-written rows already excluded
 * @param path the legacy file, named in every failure
 * @returns one divergence per row the file does not account for exactly
 */
export function foldStoredDoorPage({
  expected,
  page,
  path,
}: {
  expected: Map<string, string>;
  page: readonly StoredDoorImportRow[];
  path: string;
}): readonly FleetImportError[] {
  const diverged: FleetImportError[] = [];
  for (const row of page) {
    const digest = expected.get(row.importKey);
    if (digest === undefined) {
      diverged.push(
        FleetImportErrors.doorImportDiverged({
          importKey: row.importKey,
          path,
          why: "the store holds a row the file has no line for",
        }),
      );
      continue;
    }
    expected.delete(row.importKey);
    if (row.record === null) {
      diverged.push(
        FleetImportErrors.doorImportDiverged({
          importKey: row.importKey,
          path,
          why: "the row's record was never filled",
        }),
      );
      continue;
    }
    if (doorRecordDigest({ record: row.record }) !== digest) {
      diverged.push(
        FleetImportErrors.doorImportDiverged({
          importKey: row.importKey,
          path,
          why: "the stored record differs from the line",
        }),
      );
    }
  }
  return diverged;
}

/**
 * Every file line no stored row matched, once the last page has been folded.
 *
 * @param expected the digests {@link foldStoredDoorPage} left unmatched
 * @param path the legacy file
 * @returns one divergence per line with no row
 */
function unmatchedDoorLines({
  expected,
  path,
}: {
  expected: ReadonlyMap<string, string>;
  path: string;
}): readonly FleetImportError[] {
  return [...expected.keys()].map((importKey) =>
    FleetImportErrors.doorImportDiverged({ importKey, path, why: "the file's line has no row" }),
  );
}

/** A read-back's divergences, the file lines with no row kept apart from every other kind. */
export interface DoorReadBackSplit {
  /** The unmatched lines' import keys, in file order. */
  readonly unmatchedKeys: readonly string[];
  /** One divergence per unmatched line, as {@link unmatchedDoorLines} names it. */
  readonly unmatched: readonly FleetImportError[];
  /** Everything else the fold or the store reported: a row with no line, an unfilled row, a differing record. */
  readonly other: readonly FleetImportError[];
}

/**
 * Split a finished read-back so a caller can tell "only lines with no row" from anything worse by STRUCTURE, never
 * by matching a message — the adoption route depends on that distinction being exact.
 *
 * @param expected the digests the fold left unmatched, in file order
 * @param other every divergence the fold or the store reported
 * @returns the split
 */
export function splitUnmatchedDoorKeys({
  expected,
  other,
  path,
}: {
  expected: ReadonlyMap<string, string>;
  other: readonly FleetImportError[];
  path: string;
}): DoorReadBackSplit {
  return { other, unmatched: unmatchedDoorLines({ expected, path }), unmatchedKeys: [...expected.keys()] };
}
