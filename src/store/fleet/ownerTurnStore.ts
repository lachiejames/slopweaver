/**
 * Writing and reading the owner-turn record in the store — the effectful half of `./ownerTurn.ts`.
 *
 * ## Every write is `DO NOTHING`, and that is the whole append-only story
 *
 * A body is keyed by the hash of its bytes, so a conflict on `owner_turn` means the store already holds that
 * exact text. A location is keyed by `(path, body hash)`, so a conflict there means that very file was
 * already recorded with that very content — and an EDITED file is a different key, so both versions stay. No
 * write here can overwrite anything, which is what a record of what somebody said has to promise.
 *
 * The counts a caller reports come from `.returning()`, so a re-import over an unchanged home says `0`
 * written — the convergence proof — rather than echoing how many rows it offered.
 *
 * ## {@link recordOwnerTurnFile} re-reads the file, for the reason `./boardMirror.ts` gives
 *
 * A seat's belief about what it wrote is not a witness to what is on disk; the bytes are. So the verb takes
 * a path, never a text, and hashes what it reads back.
 */
import { readFileSync, realpathSync, statSync } from "node:fs";

import { desc, eq } from "drizzle-orm";

import { err, ok, type Result } from "#lib/result.js";

import { connectStore, type StoreClient, type StoreWriter } from "../client.js";
import { type StoreError, StoreErrors } from "../errors.js";
import {
  type NewOwnerTurnLocationRecord,
  type NewOwnerTurnRecord,
  ownerTurnLocationTable,
  ownerTurnTable,
} from "../schema/ownerTurn.js";

import { type FleetImportError, FleetImportErrors } from "./errors.js";
import { homeRelativePath } from "./homeWalk.js";
import { type OwnerTurnFamily, ownerTurnFamily, type ProjectedOwnerTurn, projectOwnerTurnFile } from "./ownerTurn.js";
import type { OwnerTurnRef } from "./ownerTurnAnchor.js";

/**
 * Rows per statement. `owner_turn_location` is the wider table at six columns, so 500 rows is 3,000 bind
 * parameters — far inside postgres's 65,535 limit, and the same chunk `./store.ts` uses.
 */
const INSERT_BATCH = 500;

/** How many rows an import actually wrote to each table. */
export interface OwnerTurnImportCounts {
  readonly bodies: number;
  readonly locations: number;
}

/** One stored copy of a turn, as a reader sees it. */
export interface StoredOwnerTurn {
  readonly relativePath: string;
  readonly turn: string;
  readonly family: string;
  readonly fileModifiedAt: Date;
  readonly bodySha256: string;
  readonly byteLength: number;
  readonly body: string;
}

/** What recording one file did, when nothing failed. */
export type OwnerTurnRecordOutcome =
  /** The store now holds this file's body and location; the counts say whether either was new. */
  | {
      readonly kind: "recorded";
      readonly relativePath: string;
      readonly turn: string;
      readonly bodySha256: string;
      readonly counts: OwnerTurnImportCounts;
    }
  /** The file is not an owner-turn file under either root of this home. */
  | { readonly kind: "outside-family" }
  /** This home has selected no store. */
  | { readonly kind: "no-store" };

/** Every way recording one file can fail. */
export type OwnerTurnRecordError = StoreError | FleetImportError;

/** The rows of one list, in batches this store can actually send. */
function* batched<T>({ rows }: { rows: readonly T[] }): Generator<readonly T[]> {
  for (let start = 0; start < rows.length; start += INSERT_BATCH) {
    yield rows.slice(start, start + INSERT_BATCH);
  }
}

/**
 * Write bodies and locations in one transaction, bodies first so every location's foreign key resolves.
 *
 * @param client an open store connection
 * @param bodies the distinct bodies, as `foldOwnerTurns` produced them
 * @param locations every location, each naming a body in `bodies` or one the store already holds
 * @returns how many rows of each were NEW, or the typed database failure
 */
export async function importOwnerTurns({
  client,
  bodies,
  locations,
}: {
  client: StoreClient;
  bodies: readonly NewOwnerTurnRecord[];
  locations: readonly NewOwnerTurnLocationRecord[];
}): Promise<Result<OwnerTurnImportCounts, StoreError>> {
  if (bodies.length === 0 && locations.length === 0) {
    return ok({ bodies: 0, locations: 0 });
  }
  try {
    const counts = await client.db.transaction(async (writer: StoreWriter): Promise<OwnerTurnImportCounts> => {
      let writtenBodies = 0;
      for (const batch of batched({ rows: bodies })) {
        const inserted = await writer
          .insert(ownerTurnTable)
          .values([...batch])
          .onConflictDoNothing({ target: ownerTurnTable.bodySha256 })
          .returning({ sha: ownerTurnTable.bodySha256 });
        writtenBodies += inserted.length;
      }
      let writtenLocations = 0;
      for (const batch of batched({ rows: locations })) {
        const inserted = await writer
          .insert(ownerTurnLocationTable)
          .values([...batch])
          .onConflictDoNothing({ target: [ownerTurnLocationTable.relativePath, ownerTurnLocationTable.bodySha256] })
          .returning({ path: ownerTurnLocationTable.relativePath });
        writtenLocations += inserted.length;
      }
      return { bodies: writtenBodies, locations: writtenLocations };
    });
    return ok(counts);
  } catch (cause) {
    return err(
      StoreErrors.queryFailed({
        cause,
        what: `import ${String(bodies.length)} owner-turn body(ies) at ${String(locations.length)} location(s)`,
      }),
    );
  }
}

/**
 * Every stored copy an anchor resolves to, newest file write first.
 *
 * @param client an open store connection
 * @param ref the resolved anchor — one path, or one turn label across every folder
 * @returns each location with its body, or the typed database failure
 * @internal read through {@link readOwnerTurnsFromStore}, which owns the connection; exported for the integration witness
 */
export async function readOwnerTurns({
  client,
  ref,
}: {
  client: StoreClient;
  ref: OwnerTurnRef;
}): Promise<Result<readonly StoredOwnerTurn[], StoreError>> {
  const where =
    ref.kind === "path"
      ? eq(ownerTurnLocationTable.relativePath, ref.relativePath)
      : eq(ownerTurnLocationTable.turn, ref.turn);
  try {
    const rows = await client.db
      .select({
        body: ownerTurnTable.body,
        bodySha256: ownerTurnLocationTable.bodySha256,
        byteLength: ownerTurnTable.byteLength,
        family: ownerTurnLocationTable.family,
        fileModifiedAt: ownerTurnLocationTable.fileModifiedAt,
        relativePath: ownerTurnLocationTable.relativePath,
        turn: ownerTurnLocationTable.turn,
      })
      .from(ownerTurnLocationTable)
      .innerJoin(ownerTurnTable, eq(ownerTurnTable.bodySha256, ownerTurnLocationTable.bodySha256))
      .where(where)
      .orderBy(desc(ownerTurnLocationTable.fileModifiedAt), ownerTurnLocationTable.relativePath);
    return ok(rows);
  } catch (cause) {
    return err(StoreErrors.queryFailed({ cause, what: "read owner turns" }));
  }
}

/**
 * Both sides of the home comparison, resolved through the filesystem so a symlinked temp directory does not
 * read as two places.
 *
 * @param path the file
 * @param home the state home
 * @returns the resolved pair, or `undefined` when either is absent
 */
function resolvedPair({ path, home }: { path: string; home: string }): { path: string; home: string } | undefined {
  try {
    return { home: realpathSync(home), path: realpathSync(path) };
  } catch {
    return undefined;
  }
}

/**
 * Re-read one owner-turn file a seat has just written and record its body and location.
 *
 * @param path the file the seat wrote
 * @param home the state home whose roots and store selection apply
 * @param env the environment the store selection is read from; defaults to the process's own
 * @returns what happened, or the typed failure — never thrown
 */
export async function recordOwnerTurnFile({
  path,
  home,
  env = process.env,
}: {
  path: string;
  home: string;
  env?: Readonly<Record<string, string | undefined>>;
}): Promise<Result<OwnerTurnRecordOutcome, OwnerTurnRecordError>> {
  const pair = resolvedPair({ home, path });
  if (pair === undefined) {
    return err(FleetImportErrors.sourceAbsent({ path }));
  }
  const relativePath = homeRelativePath(pair);
  const family: OwnerTurnFamily | undefined = ownerTurnFamily({ relativePath });
  if (family === undefined) {
    return ok({ kind: "outside-family" });
  }
  let bytes: Buffer;
  let fileModifiedAt: Date;
  try {
    bytes = readFileSync(pair.path);
    fileModifiedAt = statSync(pair.path).mtime;
  } catch {
    return err(FleetImportErrors.sourceAbsent({ path }));
  }
  const projected = projectOwnerTurnFile({ bytes, fileModifiedAt, relativePath });
  if (projected.isErr()) {
    return err(projected.error);
  }
  try {
    return await writeRecorded({ env, home, projected: projected.value });
  } catch (cause) {
    return err(StoreErrors.queryFailed({ cause, what: `record ${path} into owner_turn` }));
  }
}

/**
 * Open the selected store, write one file's rows, and close it.
 *
 * @param projected the file's two rows
 * @param home the state home whose store selection applies
 * @param env the environment the selection is read from
 * @returns the outcome, or the typed store failure
 */
async function writeRecorded({
  projected,
  home,
  env,
}: {
  projected: ProjectedOwnerTurn;
  home: string;
  env: Readonly<Record<string, string | undefined>>;
}): Promise<Result<OwnerTurnRecordOutcome, OwnerTurnRecordError>> {
  const opened = await connectStore({ env, home });
  if (opened.isErr()) {
    if (opened.error.code === "STORE_URL_MISSING") {
      return ok({ kind: "no-store" });
    }
    return err(opened.error);
  }
  try {
    const written = await importOwnerTurns({
      bodies: [projected.body],
      client: opened.value,
      locations: [projected.location],
    });
    if (written.isErr()) {
      return err(written.error);
    }
    return ok({
      bodySha256: projected.body.bodySha256,
      counts: written.value,
      kind: "recorded",
      relativePath: projected.location.relativePath,
      turn: projected.location.turn,
    });
  } finally {
    await opened.value.close();
  }
}

/** What reading the store for one ref found, when nothing failed. */
export type OwnerTurnStoreRead =
  | { readonly kind: "read"; readonly rows: readonly StoredOwnerTurn[] }
  /** This home has selected no store, so there is nothing to read — never the disk copy instead. */
  | { readonly kind: "no-store" };

/**
 * Open the selected store, read every copy one ref resolves to, and close it.
 *
 * @param ref the resolved anchor
 * @param home the state home whose store selection applies
 * @param env the environment the selection is read from; defaults to the process's own
 * @returns the rows, `no-store`, or the typed store failure — never thrown
 */
export async function readOwnerTurnsFromStore({
  ref,
  home,
  env = process.env,
}: {
  ref: OwnerTurnRef;
  home: string;
  env?: Readonly<Record<string, string | undefined>>;
}): Promise<Result<OwnerTurnStoreRead, StoreError>> {
  try {
    const opened = await connectStore({ env, home });
    if (opened.isErr()) {
      if (opened.error.code === "STORE_URL_MISSING") {
        return ok({ kind: "no-store" });
      }
      return err(opened.error);
    }
    try {
      const rows = await readOwnerTurns({ client: opened.value, ref });
      if (rows.isErr()) {
        return err(rows.error);
      }
      return ok({ kind: "read", rows: rows.value });
    } finally {
      await opened.value.close();
    }
  } catch (cause) {
    return err(StoreErrors.queryFailed({ cause, what: "read owner turns" }));
  }
}
