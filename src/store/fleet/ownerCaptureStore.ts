/**
 * Writing the owner's captured turns into the store — the effectful half of `./ownerCapture.ts`.
 *
 * Every write is `DO NOTHING` on `(source, source_id)`, so a re-import over an unchanged source writes zero rows
 * and nothing stored is ever overwritten; the count a caller reports comes from `.returning()`, never from how
 * many rows it offered. A key that ends up holding a DIFFERENT body is refused and the whole transaction rolled back,
 * never kept quietly: a recording re-processed in its app carries new words under its old id, and keeping the old ones
 * without saying so would leave the store disagreeing with the source.
 */
import { and, eq, inArray } from "drizzle-orm";

import { err, ok, type Result } from "#lib/result.js";

import type { StoreClient } from "../client.js";
import { type StoreError, StoreErrors } from "../errors.js";
import { type NewOwnerCaptureRecord, type OwnerCaptureRecord, ownerCaptureTable } from "../schema/ownerCapture.js";

/** Rows per statement: fourteen columns × 500 is 7,000 bind parameters, far inside postgres's 65,535. */
export const OWNER_CAPTURE_INSERT_BATCH = 500;

/** The columns a key must keep carrying for a repeat to be the same capture — all the drift check reads back. */
const FINGERPRINT_COLUMNS = {
  bodySha256: ownerCaptureTable.bodySha256,
  codexSurface: ownerCaptureTable.codexSurface,
  codexThreadSource: ownerCaptureTable.codexThreadSource,
  cwd: ownerCaptureTable.cwd,
  durationMs: ownerCaptureTable.durationMs,
  saidAt: ownerCaptureTable.saidAt,
  source: ownerCaptureTable.source,
  sourceId: ownerCaptureTable.sourceId,
  targetApplication: ownerCaptureTable.targetApplication,
  threadId: ownerCaptureTable.threadId,
} as const;

/** One stored capture's identity and every field stored beside its body — all the drift check reads back. */
export type StoredCaptureHash = Pick<OwnerCaptureRecord, keyof typeof FINGERPRINT_COLUMNS>;

/**
 * What a key must keep carrying for a repeat to be the same capture: its body, the instant it was said, and every
 * field the source recorded beside them.
 *
 * @param capture a stored or offered row; an offered row's unset optional field reads as the null a stored one holds
 * @returns the fields in a fixed order, serialised
 */
function captureFingerprint({
  capture,
}: {
  capture: Pick<NewOwnerCaptureRecord, Exclude<keyof typeof FINGERPRINT_COLUMNS, "source" | "sourceId">>;
}): string {
  // An array element that is `undefined` serialises as `null`, so an unset field and a stored null fingerprint alike.
  return JSON.stringify([
    capture.bodySha256,
    capture.saidAt.getTime(),
    capture.targetApplication,
    capture.durationMs,
    capture.threadId,
    capture.codexSurface,
    capture.codexThreadSource,
    capture.cwd,
  ]);
}

/**
 * The offered rows whose key already carries a different capture — in the table, or earlier in the batch.
 *
 * The batch half matters because `DO NOTHING` collapses two offered rows under one key just as quietly as it skips a
 * stored one: two source records building one `source_id` would leave whichever
 * the insert met second gone. Every field stored beside the body is held to the body's rule, so a same-text repeat
 * said at another time, or one recorded with another app or length, is refused rather than kept
 * as the first one. Two offered rows with one key that agree on every field are one capture offered twice, and pass.
 *
 * @param rows the projected rows about to be written
 * @param stored what the table already holds under any of those keys
 * @returns each conflicting row, in the order offered
 */
export function driftedCaptures({
  rows,
  stored,
}: {
  rows: readonly NewOwnerCaptureRecord[];
  stored: readonly StoredCaptureHash[];
}): NewOwnerCaptureRecord[] {
  const held = new Map(
    stored.map((row) => [`${row.source}\u0000${row.sourceId}`, captureFingerprint({ capture: row })]),
  );
  const drifted: NewOwnerCaptureRecord[] = [];
  for (const row of rows) {
    const key = `${row.source}\u0000${row.sourceId}`;
    const fingerprint = captureFingerprint({ capture: row });
    const heldFingerprint = held.get(key);
    if (heldFingerprint === undefined) {
      held.set(key, fingerprint);
    } else if (heldFingerprint !== fingerprint) {
      drifted.push(row);
    }
  }
  return drifted;
}

/** The transaction handle `client.db.transaction` passes its callback. */
type CaptureWriterTx = Parameters<Parameters<StoreClient["db"]["transaction"]>[0]>[0];

/**
 * Read back the stored hash of every offered key, a batch at a time.
 *
 * @param writer the open transaction
 * @param rows the offered rows
 * @returns what the table holds under those keys
 */
async function storedHashes({
  writer,
  rows,
}: {
  writer: CaptureWriterTx;
  rows: readonly NewOwnerCaptureRecord[];
}): Promise<StoredCaptureHash[]> {
  const stored: StoredCaptureHash[] = [];
  const sources = [...new Set(rows.map((row) => row.source))];
  for (const source of sources) {
    const ids = rows.filter((row) => row.source === source).map((row) => row.sourceId);
    for (let start = 0; start < ids.length; start += OWNER_CAPTURE_INSERT_BATCH) {
      const found = await writer
        .select(FINGERPRINT_COLUMNS)
        .from(ownerCaptureTable)
        .where(
          and(
            eq(ownerCaptureTable.source, source),
            inArray(ownerCaptureTable.sourceId, ids.slice(start, start + OWNER_CAPTURE_INSERT_BATCH)),
          ),
        );
      stored.push(...found);
    }
  }
  return stored;
}

/** Thrown inside the transaction to roll it back when a stored key's body has drifted. */
class CaptureDriftAbort extends Error {
  /** The first drifted row, named in the refusal. */
  readonly first: NewOwnerCaptureRecord;
  /** How many offered rows drifted. */
  readonly count: number;

  /**
   * @param drifted every drifted row, at least one
   */
  constructor({ drifted }: { drifted: readonly NewOwnerCaptureRecord[] }) {
    super("owner capture drift");
    this.first = drifted[0]!;
    this.count = drifted.length;
  }
}

/**
 * Write captured turns, each one once, or none when any key is already stored with a different body.
 *
 * @param client an open store connection, never touched when there is nothing to write
 * @param rows the projected rows
 * @returns how many rows were NEW, a `ROW_REFUSED` naming the first drifted key, or the typed database failure
 */
export async function importOwnerCaptures({
  client,
  rows,
}: {
  client: StoreClient;
  rows: readonly NewOwnerCaptureRecord[];
}): Promise<Result<number, StoreError>> {
  if (rows.length === 0) {
    return ok(0);
  }
  try {
    const written = await client.db.transaction(async (writer): Promise<number> => {
      let count = 0;
      for (let start = 0; start < rows.length; start += OWNER_CAPTURE_INSERT_BATCH) {
        const inserted = await writer
          .insert(ownerCaptureTable)
          .values(rows.slice(start, start + OWNER_CAPTURE_INSERT_BATCH))
          .onConflictDoNothing({ target: [ownerCaptureTable.source, ownerCaptureTable.sourceId] })
          .returning({ id: ownerCaptureTable.id });
        count += inserted.length;
      }
      // Checked AFTER the insert, inside the same transaction, never before it: a concurrent import committing the
      // same key between a read and the insert would otherwise be skipped by `DO NOTHING` unseen.
      // An insert that meets a conflicting uncommitted row waits for that writer, so by now every
      // offered key holds a committed or own body, and the read-back sees it; a mismatch throws, rolling back the lot.
      const drifted = driftedCaptures({ rows, stored: await storedHashes({ rows, writer }) });
      if (drifted.length > 0) {
        throw new CaptureDriftAbort({ drifted });
      }
      return count;
    });
    return ok(written);
  } catch (cause) {
    if (cause instanceof CaptureDriftAbort) {
      return err(
        StoreErrors.rowRefused({
          reason: `its key already carries a different body, instant or recorded field (stored, or offered twice), as do ${String(cause.count - 1)} other row(s); nothing written`,
          source: cause.first.source,
          sourceId: cause.first.sourceId,
        }),
      );
    }
    return err(StoreErrors.queryFailed({ cause, what: `import ${String(rows.length)} owner capture(s)` }));
  }
}
