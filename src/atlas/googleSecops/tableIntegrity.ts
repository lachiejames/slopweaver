/**
 * Whether the committed `generated/surfaces.ts`, and the per-file counts the lock pins beside it, are
 * byte-for-byte what the generator last wrote.
 *
 * The census in `protoLock.ts` counts rows per axis, so it cannot see a path changed, a scope dropped from
 * one row's list, or two rows swapped — an adversarial review made all three edits and every check still
 * passed. A second review then moved one `declared` count between two pins and one unpublished service's
 * rpc count between two services, keeping every total, and that passed too. So the generator writes a
 * sha256 over the table's canonical serialisation AND every pin's `declared` AND the unpublished list into
 * the lock, and this module recomputes it from the imports. It is ORDER-SENSITIVE on purpose, and the table
 * must also be strictly sorted by id, so a reorder is named as one rather than reported as an unexplained
 * hash.
 *
 * What it does not close: somebody editing a value AND the digest by hand. That is a deliberate act, visible
 * in the lock's diff, and `--verify --spec-dir` recompiles everything from the pinned bytes to catch it.
 */
import { createHash } from "node:crypto";

import { err, ok, type Result } from "#lib/result.js";

import { type GoogleSecopsInventoryError, GoogleSecopsInventoryErrors } from "./errors.js";
import type { GoogleSecopsUnpublishedService } from "./inventory.js";
import type { GoogleSecopsSurfaceRow } from "./surfaceRow.js";

/** Everything the inventory digest covers: what the generator derives from the pinned bytes. */
export interface GoogleSecopsDigestInput {
  /** The table, in the order it is written. */
  readonly rows: readonly GoogleSecopsSurfaceRow[];
  /** Every pin's id and how many methods it declares, in the lock's order. */
  readonly declared: readonly { readonly id: string; readonly declared: number }[];
  /** The declared-but-unpublished services, in the lock's order. */
  readonly unpublished: readonly GoogleSecopsUnpublishedService[];
}

/**
 * Order two ids by UTF-16 code unit, the one ordering that does not depend on the machine's locale.
 *
 * @param left one id
 * @param right the other id
 * @returns negative when `left` sorts first, positive when `right` does, zero when equal
 */
export function compareGoogleSecopsIds({ left, right }: { left: string; right: string }): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

/** Every row field, so a field added to the row type fails to compile here instead of going unhashed. */
const ROW_FIELD_SET: Record<keyof GoogleSecopsSurfaceRow, true> = {
  disposition: true,
  dispositionBecause: true,
  document: true,
  exclusionReason: true,
  httpMethod: true,
  id: true,
  pathTemplate: true,
  rpc: true,
  scopes: true,
  service: true,
};

/** The row fields in the fixed order the digest reads them. */
const ROW_FIELDS = Object.keys(ROW_FIELD_SET)
  .filter((key): key is keyof GoogleSecopsSurfaceRow => Object.hasOwn(ROW_FIELD_SET, key))
  .toSorted();

/**
 * One row as JSON, built by READING each declared field in a fixed order, so the digest does not depend on
 * how a row literal was written and hashes exactly the values a consumer of the table reads. Serialising the
 * row object itself would let a hand-added `toJSON` member show the digest one path while the table
 * served another — an adversarial review did exactly that and every check without the pinned bytes passed.
 *
 * @param row the row
 * @returns its canonical JSON
 */
function canonicalRow({ row }: { row: GoogleSecopsSurfaceRow }): string {
  return JSON.stringify(
    ROW_FIELDS.map((field) => {
      const value = row[field];
      return Array.isArray(value) ? [...value] : value;
    }),
  );
}

/**
 * The sha256 of the inventory's canonical serialisation: each row's canonical JSON, then each pin's
 * declared count, then each unpublished service's rpc count, one per line, each in its written order.
 *
 * @returns the hex digest
 */
export function googleSecopsInventoryDigest({ rows, declared, unpublished }: GoogleSecopsDigestInput): string {
  const hash = createHash("sha256");
  for (const row of rows) {
    hash.update(`${canonicalRow({ row })}\n`, "utf8");
  }
  for (const pin of declared) {
    hash.update(`declared ${pin.id} ${String(pin.declared)}\n`, "utf8");
  }
  for (const service of unpublished) {
    hash.update(`unpublished ${service.service} ${String(service.rpcs)}\n`, "utf8");
  }
  return hash.digest("hex");
}

/**
 * Check a table is strictly sorted by id and, with the lock's per-file counts, hashes to the pinned digest.
 *
 * @param pinnedSha256 `GOOGLE_SECOPS_INVENTORY_SHA256` from the lock
 * @returns ok, `TABLE_UNSORTED` naming the first pair out of order, or `TABLE_DIGEST_MISMATCH`
 */
export function googleSecopsInventoryMatchesLock({
  rows,
  declared,
  unpublished,
  pinnedSha256,
}: GoogleSecopsDigestInput & { pinnedSha256: string }): Result<void, GoogleSecopsInventoryError> {
  const outOfOrder = rows.findIndex(
    (row, index) => index > 0 && compareGoogleSecopsIds({ left: rows[index - 1]!.id, right: row.id }) >= 0,
  );
  if (outOfOrder !== -1) {
    return err(
      GoogleSecopsInventoryErrors.tableUnsorted({ after: rows[outOfOrder]!.id, before: rows[outOfOrder - 1]!.id }),
    );
  }
  const read = googleSecopsInventoryDigest({ declared, rows, unpublished });
  if (read !== pinnedSha256) {
    return err(GoogleSecopsInventoryErrors.tableDigestMismatch({ pinned: pinnedSha256, read }));
  }
  return ok(undefined);
}
