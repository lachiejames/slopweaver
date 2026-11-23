/**
 * Writing and reading the measurements in the store — the effectful half of `./measurement.ts`.
 *
 * ## Ordering across two systems: objects first, rows second
 *
 * Postgres is transactional and Storage is not, so the order is what makes a crash harmless. Each NEW
 * `storage` body's object is uploaded first; only then does one transaction insert the bodies and the
 * locations. A crash between the two leaves an object no row names — the next run finds the body not held,
 * uploads the same bytes to the same content-addressed key, and records it. The other order would leave a row
 * naming an object that was never written, which a reader could only discover by failing to read it.
 *
 * ## Every insert is `DO NOTHING`, so a re-run over an unchanged home writes zero
 *
 * The same append-only story `./ownerTurnStore.ts` tells: a body is keyed on its hash, a location on
 * `(path, hash)`, so an edited file is a new key and nothing here overwrites a row. The counts come from
 * `.returning()`, and a held body's object is not uploaded again (`uploadsNeeded`).
 */
import { and, asc, desc, eq, inArray, like, type SQL } from "drizzle-orm";

import { err, ok, type Result } from "#lib/result.js";

import type { StoreClient, StoreWriter } from "../client.js";
import { type StoreError, StoreErrors } from "../errors.js";
import { type ObjectStore, openObjectStore } from "../objects/client.js";
import type { ObjectStoreError } from "../objects/errors.js";
import { storeObjectsSelection } from "../objects/selection.js";
import {
  measurementBlobTable,
  measurementLocationTable,
  type NewMeasurementBlobRecord,
  type NewMeasurementLocationRecord,
} from "../schema/measurement.js";

import {
  type FoldedMeasurements,
  locationsToRecord,
  MEASUREMENT_BUCKET,
  type MeasurementClass,
  uploadsNeeded,
} from "./measurement.js";
import type { MeasurementRef } from "./measurementAnchor.js";

/**
 * Rows per statement. `measurement_blob` is the wider table at six columns, so 500 rows is 3,000 bind
 * parameters — far inside postgres's 65,535 limit, and the same chunk `./ownerTurnStore.ts` uses.
 */
const INSERT_BATCH = 500;

/** Hashes per `IN (…)` when asking which bodies are already held. */
const HELD_BATCH = 1_000;

/** How many rows and objects an import actually wrote. */
export interface MeasurementImportCounts {
  readonly blobs: number;
  readonly locations: number;
  readonly objects: number;
}

/** One stored location, joined to what a reader needs of its body — never the body itself. */
export interface StoredMeasurementLocation {
  readonly relativePath: string;
  readonly measurementClass: string;
  readonly bodySha256: string;
  readonly byteLength: number;
  readonly mediaType: string;
  readonly placement: string;
  readonly fileModifiedAt: Date;
  readonly recordedAt: Date;
}

/** Which locations a list or restore reads. Every field narrows; none set reads the whole class. */
export interface MeasurementFilter {
  readonly measurementClass?: MeasurementClass | undefined;
  /** A home-relative path prefix, matched literally. */
  readonly prefix?: string | undefined;
  readonly ref?: MeasurementRef | undefined;
}

/** Every way a measurement write or a body read can fail. */
export type MeasurementStoreError = StoreError | ObjectStoreError;

/** The rows of one list, in batches this store can actually send. */
function* batched<T>({ rows, size }: { rows: readonly T[]; size: number }): Generator<readonly T[]> {
  for (let start = 0; start < rows.length; start += size) {
    yield rows.slice(start, start + size);
  }
}

/**
 * Which of these body hashes the store already holds.
 *
 * @param client an open store connection
 * @param shas the hashes to ask about
 * @returns the held subset, or the typed database failure
 */
async function heldMeasurementShas({
  client,
  shas,
}: {
  client: StoreClient;
  shas: readonly string[];
}): Promise<Result<ReadonlySet<string>, StoreError>> {
  const held = new Set<string>();
  try {
    for (const batch of batched({ rows: shas, size: HELD_BATCH })) {
      const rows = await client.db
        .select({ sha: measurementBlobTable.bodySha256 })
        .from(measurementBlobTable)
        .where(inArray(measurementBlobTable.bodySha256, [...batch]));
      rows.forEach((row) => held.add(row.sha));
    }
    return ok(held);
  } catch (cause) {
    return err(StoreErrors.queryFailed({ cause, what: "read which measurement bodies the store holds" }));
  }
}

/**
 * Upload every new `storage` body, then write bodies and locations in one transaction.
 *
 * @param client an open store connection
 * @param objects opens the bucket — called only when a body actually needs Storage, so a home whose files are all
 *   inline never needs the Storage API selected
 * @param folded the walk's distinct bodies, their uploads, and every location
 * @returns how many rows and objects were NEW, or the typed failure — nothing is inserted when an upload failed
 */
export async function importMeasurements({
  client,
  objects,
  folded,
}: {
  client: StoreClient;
  objects: () => Result<ObjectStore, ObjectStoreError>;
  folded: FoldedMeasurements;
}): Promise<Result<MeasurementImportCounts, MeasurementStoreError>> {
  const held = await heldMeasurementShas({ client, shas: folded.blobs.map((blob) => blob.bodySha256) });
  if (held.isErr()) {
    return err(held.error);
  }
  const uploads = uploadsNeeded({ folded, heldShas: held.value });
  if (uploads.length > 0) {
    const opened = objects();
    if (opened.isErr()) {
      return err(opened.error);
    }
    const bucket = await opened.value.ensureBucket();
    if (bucket.isErr()) {
      return err(bucket.error);
    }
    for (const upload of uploads) {
      const put = await opened.value.put(upload);
      if (put.isErr()) {
        return err(put.error);
      }
    }
  }
  const written = await insertRows({ blobs: folded.blobs, client, locations: folded.locations });
  if (written.isErr()) {
    return err(written.error);
  }
  return ok({ ...written.value, objects: uploads.length });
}

/**
 * Insert bodies then locations in one transaction, bodies first so every location's foreign key resolves.
 *
 * @param client an open store connection
 * @param blobs the distinct bodies
 * @param locations every location
 * @returns how many of each were new, or the typed database failure
 */
async function insertRows({
  client,
  blobs,
  locations,
}: {
  client: StoreClient;
  blobs: readonly NewMeasurementBlobRecord[];
  locations: readonly NewMeasurementLocationRecord[];
}): Promise<Result<{ blobs: number; locations: number }, StoreError>> {
  if (blobs.length === 0 && locations.length === 0) {
    return ok({ blobs: 0, locations: 0 });
  }
  try {
    const counts = await client.db.transaction(async (writer: StoreWriter) => {
      let writtenBlobs = 0;
      for (const batch of batched({ rows: blobs, size: INSERT_BATCH })) {
        const inserted = await writer
          .insert(measurementBlobTable)
          .values([...batch])
          .onConflictDoNothing({ target: measurementBlobTable.bodySha256 })
          .returning({ sha: measurementBlobTable.bodySha256 });
        writtenBlobs += inserted.length;
      }
      const current = await currentBodies({ paths: locations.map((location) => location.relativePath), writer });
      let writtenLocations = 0;
      for (const batch of batched({ rows: locationsToRecord({ current, locations }), size: INSERT_BATCH })) {
        const inserted = await writer
          .insert(measurementLocationTable)
          .values([...batch])
          .returning({ path: measurementLocationTable.relativePath });
        writtenLocations += inserted.length;
      }
      return { blobs: writtenBlobs, locations: writtenLocations };
    });
    return ok(counts);
  } catch (cause) {
    return err(
      StoreErrors.queryFailed({
        cause,
        what: `import ${String(blobs.length)} measurement body(ies) at ${String(locations.length)} location(s)`,
      }),
    );
  }
}

/**
 * The body the store last recorded at each of some paths, read inside the import's own transaction.
 *
 * @param writer the open transaction
 * @param paths the home-relative paths the walk found
 * @returns path → the sha-256 of its newest recorded body, for every path the store holds
 */
async function currentBodies({
  writer,
  paths,
}: {
  writer: StoreWriter;
  paths: readonly string[];
}): Promise<ReadonlyMap<string, string>> {
  const current = new Map<string, string>();
  for (const batch of batched({ rows: paths, size: HELD_BATCH })) {
    const rows = await writer
      .selectDistinctOn([measurementLocationTable.relativePath], {
        path: measurementLocationTable.relativePath,
        sha: measurementLocationTable.bodySha256,
      })
      .from(measurementLocationTable)
      .where(inArray(measurementLocationTable.relativePath, [...batch]))
      .orderBy(measurementLocationTable.relativePath, desc(measurementLocationTable.recordedAt));
    rows.forEach((row) => current.set(row.path, row.sha));
  }
  return current;
}

/**
 * Every stored location a filter selects, newest observation first within a path.
 *
 * @param client an open store connection
 * @param filter which locations to read
 * @returns the locations with their bodies' metadata, or the typed database failure
 */
export async function readMeasurementLocations({
  client,
  filter,
}: {
  client: StoreClient;
  filter: MeasurementFilter;
}): Promise<Result<readonly StoredMeasurementLocation[], StoreError>> {
  const conditions: SQL[] = [];
  if (filter.measurementClass !== undefined) {
    conditions.push(eq(measurementLocationTable.measurementClass, filter.measurementClass));
  }
  if (filter.prefix !== undefined) {
    conditions.push(like(measurementLocationTable.relativePath, `${escapeLike({ text: filter.prefix })}%`));
  }
  if (filter.ref !== undefined) {
    conditions.push(
      filter.ref.kind === "path"
        ? eq(measurementLocationTable.relativePath, filter.ref.relativePath)
        : eq(measurementLocationTable.bodySha256, filter.ref.bodySha256),
    );
  }
  try {
    const rows = await client.db
      .select({
        bodySha256: measurementLocationTable.bodySha256,
        byteLength: measurementBlobTable.byteLength,
        fileModifiedAt: measurementLocationTable.fileModifiedAt,
        measurementClass: measurementLocationTable.measurementClass,
        mediaType: measurementBlobTable.mediaType,
        placement: measurementBlobTable.placement,
        recordedAt: measurementLocationTable.recordedAt,
        relativePath: measurementLocationTable.relativePath,
      })
      .from(measurementLocationTable)
      .innerJoin(measurementBlobTable, eq(measurementBlobTable.bodySha256, measurementLocationTable.bodySha256))
      .where(and(...conditions))
      .orderBy(
        asc(measurementLocationTable.relativePath),
        desc(measurementLocationTable.recordedAt),
        desc(measurementLocationTable.fileModifiedAt),
      );
    return ok(rows);
  } catch (cause) {
    return err(StoreErrors.queryFailed({ cause, what: "read measurement locations" }));
  }
}

/**
 * One body's exact bytes — from its `text` column when inline, from its verified Storage object otherwise.
 *
 * @param client an open store connection
 * @param objects opens the bucket — called only for a `storage` body
 * @param bodySha256 the body to read
 * @returns the bytes, or the typed failure — a `storage` body with no Storage API selected is a refusal, never empty
 */
export async function readMeasurementBody({
  client,
  objects,
  bodySha256,
}: {
  client: StoreClient;
  objects: () => Result<ObjectStore, ObjectStoreError>;
  bodySha256: string;
}): Promise<Result<Uint8Array, MeasurementStoreError>> {
  let rows: readonly { body: string | null; placement: string }[];
  try {
    rows = await client.db
      .select({ body: measurementBlobTable.body, placement: measurementBlobTable.placement })
      .from(measurementBlobTable)
      .where(eq(measurementBlobTable.bodySha256, bodySha256));
  } catch (cause) {
    return err(StoreErrors.queryFailed({ cause, what: `read measurement body ${bodySha256}` }));
  }
  const row = rows[0];
  if (row === undefined) {
    return err(StoreErrors.queryFailed({ cause: undefined, what: `find measurement body ${bodySha256}` }));
  }
  if (row.body !== null) {
    return ok(Buffer.from(row.body, "utf8"));
  }
  const opened = objects();
  if (opened.isErr()) {
    return err(opened.error);
  }
  return opened.value.get({ key: bodySha256 });
}

/**
 * A literal for a `LIKE` pattern: `%`, `_` and the escape character itself matched as themselves.
 *
 * @param text the prefix as typed
 * @returns the escaped text, using Postgres's default `\` escape
 */
function escapeLike({ text }: { text: string }): string {
  return text.replace(/[\\%_]/gu, (character) => `\\${character}`);
}

/**
 * The measurements bucket on the running local stack's Storage API, its URL and key read off the stack now
 * and stored nowhere. A retired on-disk copy of either is removed by `storeUrlSelection`, which every caller
 * of this has already passed through to open the store.
 *
 * @returns the bucket, or the typed refusal naming the container and what was wrong with it
 */
export function measurementObjects(): Result<ObjectStore, ObjectStoreError> {
  return storeObjectsSelection().map((selection) =>
    openObjectStore({ apiUrl: selection.apiUrl, bucket: MEASUREMENT_BUCKET, serviceKey: selection.serviceKey }),
  );
}
