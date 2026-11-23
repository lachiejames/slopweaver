/**
 * Writing and reading authored working state in the store — the effectful half of `./authoredFile.ts`.
 *
 * ## Every write is `DO NOTHING`, exactly as `./ownerTurnStore.ts`'s are
 *
 * A body is keyed by the hash of its bytes and a location by `(path, body hash)`, so nothing here can
 * overwrite anything and a re-import over an unchanged home writes zero rows — the convergence proof. The
 * counts come from `.returning()`, never from what was offered.
 *
 * ## Streamed, where the owner-turn leg folds
 *
 * The owner-turn leg holds every DISTINCT body in memory before one write, because 30,125 files carried 747
 * bodies. This class is the other way round — nearly every file is its own body, a few hundred megabytes of
 * them — so bodies are flushed in batches bounded by bytes as well as rows, inside the one transaction, and
 * only the set of hashes already sent stays resident.
 */
import { and, asc, eq, inArray, type SQL } from "drizzle-orm";

import { err, ok, type Result } from "#lib/result.js";

import type { StoreClient, StoreWriter } from "../client.js";
import { type StoreError, StoreErrors } from "../errors.js";
import {
  authoredAbsentTable,
  authoredBodyTable,
  authoredFileTable,
  type NewAuthoredBodyRecord,
  type NewAuthoredFileRecord,
} from "../schema/authored.js";

import type { ProjectedAuthoredFile, StoredAuthoredVersion } from "./authoredFile.js";

/** Rows per statement: five columns, so 2,500 bind parameters — far inside postgres's 65,535. */
const INSERT_ROWS = 500;

/**
 * Body bytes per statement. The largest authored file measured is 6.7 MB (`./authoredFile.ts`), so a batch
 * that closes at 16 MiB holds a few of the largest and many of the ordinary ones, and one statement never
 * carries the whole class.
 */
const INSERT_BYTES = 16 * 1024 * 1024;

/** How many rows an import actually wrote to each table. */
export interface AuthoredImportCounts {
  readonly bodies: number;
  readonly locations: number;
}

/** One statement's worth of rows: bodies not yet sent, then the locations naming them. */
export interface AuthoredInsertBatch {
  readonly bodies: NewAuthoredBodyRecord[];
  readonly locations: NewAuthoredFileRecord[];
  bytes: number;
}

/**
 * The projected files as insert batches, each distinct body in only the first batch that meets it, a batch
 * closing at `maxRows` rows in either table or `maxBytes` of body. A body's batch always carries it before
 * any location naming it, so each foreign key resolves in order. Only the set of hashes already sent stays
 * resident; every closed batch is handed off.
 *
 * @param files the projected files, read lazily
 * @param maxRows the most rows either table takes in one statement
 * @param maxBytes the body bytes at which a batch closes
 * @returns the batches, in order, the last one closed by the end of the files
 */
export function* authoredInsertBatches({
  files,
  maxRows = INSERT_ROWS,
  maxBytes = INSERT_BYTES,
}: {
  files: Iterable<ProjectedAuthoredFile>;
  maxRows?: number;
  maxBytes?: number;
}): Generator<AuthoredInsertBatch> {
  const sent = new Set<string>();
  let pending: AuthoredInsertBatch = { bodies: [], bytes: 0, locations: [] };
  for (const file of files) {
    if (!sent.has(file.body.bodySha256)) {
      sent.add(file.body.bodySha256);
      pending.bodies.push(file.body);
      pending.bytes += file.body.byteLength;
    }
    pending.locations.push(file.location);
    if (pending.bytes >= maxBytes || pending.bodies.length >= maxRows || pending.locations.length >= maxRows) {
      yield pending;
      pending = { bodies: [], bytes: 0, locations: [] };
    }
  }
  if (pending.locations.length > 0) {
    yield pending;
  }
}

/**
 * Write every projected file in one transaction, bodies of a batch before its locations so each foreign key
 * resolves.
 *
 * @param client an open store connection
 * @param files the projected files, read lazily — the generator is drained inside the transaction
 * @returns how many rows of each were NEW, or the typed database failure
 */
export async function importAuthoredFiles({
  client,
  files,
}: {
  client: StoreClient;
  files: Iterable<ProjectedAuthoredFile>;
}): Promise<Result<AuthoredImportCounts, StoreError>> {
  try {
    const counts = await client.db.transaction(async (writer: StoreWriter): Promise<AuthoredImportCounts> => {
      const totals = { bodies: 0, locations: 0 };
      for (const batch of authoredInsertBatches({ files })) {
        await flush({ batch, totals, writer });
      }
      return totals;
    });
    return ok(counts);
  } catch (cause) {
    return err(StoreErrors.queryFailed({ cause, what: "import authored working state" }));
  }
}

/** Send one batch: its bodies, then its locations. */
async function flush({
  batch,
  totals,
  writer,
}: {
  batch: AuthoredInsertBatch;
  totals: { bodies: number; locations: number };
  writer: StoreWriter;
}): Promise<void> {
  if (batch.bodies.length > 0) {
    const inserted = await writer
      .insert(authoredBodyTable)
      .values(batch.bodies)
      .onConflictDoNothing({ target: authoredBodyTable.bodySha256 })
      .returning({ sha: authoredBodyTable.bodySha256 });
    totals.bodies += inserted.length;
  }
  if (batch.locations.length > 0) {
    const inserted = await writer
      .insert(authoredFileTable)
      .values(batch.locations)
      .onConflictDoNothing({ target: [authoredFileTable.relativePath, authoredFileTable.bodySha256] })
      .returning({ path: authoredFileTable.relativePath });
    totals.locations += inserted.length;
  }
}

/**
 * Every stored version, bodies left out — the list `show`, `list` and `restore` choose from.
 *
 * @param client an open store connection
 * @param directory only this top-level directory, when given
 * @returns each stored version, or the typed database failure
 */
export async function readAuthoredVersions({
  client,
  directory,
  relativePath,
}: {
  client: StoreClient;
  directory?: string;
  relativePath?: string;
}): Promise<Result<readonly StoredAuthoredVersion[], StoreError>> {
  const filters: SQL[] = [];
  if (directory !== undefined) {
    filters.push(eq(authoredFileTable.directory, directory));
  }
  if (relativePath !== undefined) {
    filters.push(eq(authoredFileTable.relativePath, relativePath));
  }
  try {
    const rows = await client.db
      .select({
        bodySha256: authoredFileTable.bodySha256,
        byteLength: authoredBodyTable.byteLength,
        fileModifiedAt: authoredFileTable.fileModifiedAt,
        relativePath: authoredFileTable.relativePath,
      })
      .from(authoredFileTable)
      .innerJoin(authoredBodyTable, eq(authoredBodyTable.bodySha256, authoredFileTable.bodySha256))
      .where(and(...filters))
      .orderBy(asc(authoredFileTable.relativePath));
    return ok(rows);
  } catch (cause) {
    return err(StoreErrors.queryFailed({ cause, what: "read authored file versions" }));
  }
}

/**
 * One body's bytes.
 *
 * @param client an open store connection
 * @param bodySha256 the body's key
 * @returns the bytes, `undefined` when no body carries that key, or the typed database failure
 */
export async function readAuthoredBody({
  client,
  bodySha256,
}: {
  client: StoreClient;
  bodySha256: string;
}): Promise<Result<Buffer | undefined, StoreError>> {
  try {
    const rows = await client.db
      .select({ body: authoredBodyTable.body })
      .from(authoredBodyTable)
      .where(eq(authoredBodyTable.bodySha256, bodySha256));
    return ok(rows[0]?.body);
  } catch (cause) {
    return err(StoreErrors.queryFailed({ cause, what: `read authored body ${bodySha256}` }));
  }
}

/** Paths per `IN (...)` or insert statement when the absent set is rewritten. */
const ABSENT_ROWS = 1000;

/** What one rewrite of the absent set did. */
export interface AuthoredAbsentCounts {
  /** Paths absent after the rewrite. */
  readonly absent: number;
  /** Paths newly found absent by this import. */
  readonly noticed: number;
  /** Paths absent before and present again, so cleared. */
  readonly cleared: number;
}

/**
 * Every distinct path the store holds a version of.
 *
 * @param client an open store connection
 * @returns the paths, or the typed database failure
 */
export async function readStoredAuthoredPaths({
  client,
}: {
  client: StoreClient;
}): Promise<Result<readonly string[], StoreError>> {
  try {
    const rows = await client.db.selectDistinct({ path: authoredFileTable.relativePath }).from(authoredFileTable);
    return ok(rows.map((row) => row.path));
  } catch (cause) {
    return err(StoreErrors.queryFailed({ cause, what: "read stored authored paths" }));
  }
}

/**
 * The paths the last whole-home import did not find — the ones `store authored-restore` leaves out.
 *
 * @param client an open store connection
 * @returns the absent paths, or the typed database failure
 */
export async function readAuthoredAbsent({
  client,
}: {
  client: StoreClient;
}): Promise<Result<ReadonlySet<string>, StoreError>> {
  try {
    const rows = await client.db.select({ path: authoredAbsentTable.relativePath }).from(authoredAbsentTable);
    return ok(new Set(rows.map((row) => row.path)));
  } catch (cause) {
    return err(StoreErrors.queryFailed({ cause, what: "read absent authored paths" }));
  }
}

/**
 * Make `authored_absent` exactly `absent`, in one transaction: a path present again is deleted, a newly absent
 * one inserted, and one still absent keeps the instant it was first noticed.
 *
 * @param client an open store connection
 * @param absent every stored path this import did not find on disk
 * @returns what changed, or the typed database failure
 */
export async function replaceAuthoredAbsent({
  client,
  absent,
}: {
  client: StoreClient;
  absent: readonly string[];
}): Promise<Result<AuthoredAbsentCounts, StoreError>> {
  const wanted = new Set(absent);
  try {
    const counts = await client.db.transaction(async (writer: StoreWriter): Promise<AuthoredAbsentCounts> => {
      const before = await writer.select({ path: authoredAbsentTable.relativePath }).from(authoredAbsentTable);
      const held = new Set(before.map((row) => row.path));
      const present = [...held].filter((path) => !wanted.has(path));
      const fresh = absent.filter((path) => !held.has(path));
      for (let start = 0; start < present.length; start += ABSENT_ROWS) {
        await writer
          .delete(authoredAbsentTable)
          .where(inArray(authoredAbsentTable.relativePath, present.slice(start, start + ABSENT_ROWS)));
      }
      for (let start = 0; start < fresh.length; start += ABSENT_ROWS) {
        await writer
          .insert(authoredAbsentTable)
          .values(fresh.slice(start, start + ABSENT_ROWS).map((relativePath) => ({ relativePath })))
          .onConflictDoNothing({ target: authoredAbsentTable.relativePath });
      }
      return { absent: wanted.size, cleared: present.length, noticed: fresh.length };
    });
    return ok(counts);
  } catch (cause) {
    return err(StoreErrors.queryFailed({ cause, what: "record absent authored paths" }));
  }
}
