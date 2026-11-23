/**
 * The ONE transaction an import or a publish writes its rows in — the row half of `./importStore.ts`, which checks
 * and uploads before calling it. Bodies first so every foreign key resolves, then pages, versions and each local
 * page's file set. A publish first takes its page's lock and refuses a regression (`laterFreezeHeld`).
 */
import { and, eq, inArray, sql } from "drizzle-orm";

import { err, ok, type Result } from "#lib/result.js";

import type { StoreClient, StoreWriter } from "../client.js";
import { type StoreError, StoreErrors } from "../errors.js";
import {
  type NewPublishedPageFileRecord,
  type NewPublishedPageRecord,
  type NewPublishedPageVersionRecord,
  publishedPageBlobTable,
  publishedPageFileTable,
  publishedPageTable,
  publishedPageVersionTable,
} from "../schema/publishedPages.js";

import {
  type PagesFreezeOpensHistoryError,
  type PagesPublishSupersededError,
  PublishedPagesImportErrors,
} from "./errors.js";
import { freezeOpensHistory } from "./freezeHistory.js";
import {
  blobRecord,
  type FileChanges,
  fileChanges,
  type HeldFile,
  type PublishedPagesWriteContext,
  pageRecord,
  versionRecords,
} from "./importPlan.js";
import type { PlannedBlob, PublishedPagesPlan } from "./project.js";

/** Rows per statement: `published_page` is the widest at seven columns, so 500 rows is 3,500 bind parameters. */
const INSERT_BATCH = 500;

/** Keys per `IN (…)` when reading what the store holds. */
export const HELD_BATCH = 1_000;

/** How many rows of each kind one transaction changed. */
export interface PublishedPagesRowCounts {
  readonly blobs: number;
  readonly pages: number;
  readonly versions: number;
  readonly filesWritten: number;
  readonly filesRemoved: number;
}

/**
 * The rows of one list, in batches this store can actually send.
 *
 * @param rows the whole list
 * @param size the most one batch holds
 * @returns each batch in order
 */
export function* batched<T>({ rows, size }: { rows: readonly T[]; size: number }): Generator<readonly T[]> {
  for (let start = 0; start < rows.length; start += size) {
    yield rows.slice(start, start + size);
  }
}

/**
 * Every row in one transaction: bodies, then pages, then versions, then each local page's file set.
 *
 * @param client an open store connection
 * @param blobs the bodies not yet held, whose objects are already uploaded
 * @param plan the projected plan
 * @param context the import or publish that decides how a new version is dated and marked
 * @returns how many rows of each kind changed, a publish's supersession refusal, or the typed database failure
 */
export async function writeRows({
  client,
  blobs,
  plan,
  context,
}: {
  client: StoreClient;
  blobs: readonly PlannedBlob[];
  plan: PublishedPagesPlan;
  context: PublishedPagesWriteContext;
}): Promise<Result<PublishedPagesRowCounts, PagesFreezeOpensHistoryError | PagesPublishSupersededError | StoreError>> {
  try {
    const outcome = await client.db.transaction(async (writer: StoreWriter) => {
      const refused = await ownVersionRefused({ context, writer });
      if (refused !== undefined) {
        return refused;
      }
      const blobsWritten = await insertBlobs({ blobs, writer });
      const pages = await upsertPages({
        movesLocalPointer: context.kind === "freeze",
        pages: plan.pages.map((page) => pageRecord({ page })),
        writer,
      });
      const versions = await insertVersions({ versions: versionRecords({ context, pages: plan.pages }), writer });
      const localKeys = plan.pages.filter((page) => page.kind === "local").map((page) => page.pageKey);
      const changes = fileChanges({ held: await heldFiles({ keys: localKeys, writer }), pages: plan.pages });
      await applyFileChanges({ changes, writer });
      return {
        blobs: blobsWritten,
        filesRemoved: changes.removals.length,
        filesWritten: changes.writes.length,
        pages,
        versions,
      };
    });
    if ("code" in outcome) {
      return err(outcome);
    }
    return ok(outcome);
  } catch (cause) {
    return err(
      StoreErrors.queryFailed({
        cause,
        what: `import ${String(plan.pages.length)} published page(s) and ${String(plan.blobs.length)} body(ies)`,
      }),
    );
  }
}

/**
 * A publish's or freeze's refusal, asked first in its transaction so a refusal writes nothing: a later freeze already
 * held, or a freeze opening a history it was not told to open. An import is never refused here.
 *
 * @param writer the open transaction
 * @param context the write
 * @returns the refusal, or nothing
 */
async function ownVersionRefused({
  writer,
  context,
}: {
  writer: StoreWriter;
  context: PublishedPagesWriteContext;
}): Promise<PagesFreezeOpensHistoryError | PagesPublishSupersededError | undefined> {
  if (context.kind === "import") {
    return undefined;
  }
  const superseded = await laterFreezeHeld({ published: context.published, writer });
  if (superseded !== undefined || context.kind === "publish" || context.opensHistory) {
    return superseded;
  }
  return freezeOpensHistory({ key: context.published.pageKey, writer });
}

/**
 * Serialise every publish of one page behind a transaction lock, then refuse when the store already holds a later
 * freeze of it, or other bytes frozen at the same instant. A publish's checks run on the folder before its connection
 * opens, so a second publish of the slug can land and carry in that gap; without this the first would write its older
 * plan over the second's and report success. Two publishes given the same `--now` freeze at one instant, so an equal
 * instant is ordered by its bytes: the same bytes are the same version, other bytes are the one already held winning.
 * Run first in the transaction, so a refusal writes nothing.
 *
 * @param writer the open transaction, which holds the lock until it ends
 * @param published the version this publish froze
 * @returns the refusal, or nothing when this publish is the page's latest the store has seen
 */
async function laterFreezeHeld({
  writer,
  published,
}: {
  writer: StoreWriter;
  published: { readonly pageKey: string; readonly bodySha256: string; readonly frozenAt: Date };
}): Promise<PagesPublishSupersededError | undefined> {
  await writer.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`slopweaver:published-page:${published.pageKey}`}))`,
  );
  const [held] = await writer
    .select({
      latestFrozenAt: publishedPageTable.latestFrozenAt,
      latestFrozenBodySha256: publishedPageTable.latestFrozenBodySha256,
    })
    .from(publishedPageTable)
    .where(eq(publishedPageTable.pageKey, published.pageKey));
  if (held?.latestFrozenAt == null) {
    return undefined;
  }
  const heldAt = held.latestFrozenAt.getTime();
  const ownAt = published.frozenAt.getTime();
  const sameInstantOtherBytes = heldAt === ownAt && held.latestFrozenBodySha256 !== published.bodySha256;
  const superseded = heldAt > ownAt || sameInstantOtherBytes;
  if (!superseded) {
    return undefined;
  }
  return PublishedPagesImportErrors.publishSuperseded({
    frozenAt: published.frozenAt,
    heldFrozenAt: held.latestFrozenAt,
    pageKey: published.pageKey,
  });
}

/**
 * Insert every body row not already held. The list was read before the transaction opened, so a concurrent write of
 * the same content-addressed body may have landed since; that row is the same body under the same key, and is kept.
 *
 * @param writer the open transaction
 * @param blobs the bodies the pre-transaction read found missing
 * @returns how many were new
 */
async function insertBlobs({ writer, blobs }: { writer: StoreWriter; blobs: readonly PlannedBlob[] }): Promise<number> {
  let inserted = 0;
  for (const batch of batched({ rows: blobs.map((blob) => blobRecord({ blob })), size: INSERT_BATCH })) {
    const written = await writer
      .insert(publishedPageBlobTable)
      .values([...batch])
      .onConflictDoNothing({ target: publishedPageBlobTable.bodySha256 })
      .returning({ sha: publishedPageBlobTable.bodySha256 });
    inserted += written.length;
  }
  return inserted;
}

/**
 * Insert or update every page row, changing a held row only when a field differs. A local row takes every field,
 * which is how a history-only row whose page has appeared becomes local. A history-only row moves only another one's
 * latest pointer on an import, so a stored local page whose folder is gone keeps every field, its pointer included. A
 * freeze is the one write that moves a local page's pointer from a history-only row: it took a version of that key.
 *
 * @param writer the open transaction
 * @param pages every page row
 * @param movesLocalPointer whether a history-only row also moves a held local page's latest pointer
 * @returns how many rows were inserted or changed
 */
async function upsertPages({
  writer,
  pages,
  movesLocalPointer,
}: {
  writer: StoreWriter;
  pages: readonly NewPublishedPageRecord[];
  movesLocalPointer: boolean;
}): Promise<number> {
  let changed = 0;
  const pointer = {
    latestFrozenAt: sql.raw("excluded.latest_frozen_at"),
    latestFrozenBodySha256: sql.raw("excluded.latest_frozen_body_sha256"),
  };
  const pointerDiffers = sql.raw(
    `${movesLocalPointer ? "" : "published_page.kind = 'history-only' and "}` +
      "(published_page.latest_frozen_body_sha256, published_page.latest_frozen_at) is distinct from " +
      "(excluded.latest_frozen_body_sha256, excluded.latest_frozen_at)",
  );
  const localSet = {
    ...pointer,
    canonicalAddress: sql.raw("excluded.canonical_address"),
    currentBodySha256: sql.raw("excluded.current_body_sha256"),
    kind: sql.raw("excluded.kind"),
    publishedAt: sql.raw("excluded.published_at"),
  };
  const localDiffers = sql.raw(
    "(published_page.kind, published_page.canonical_address, published_page.current_body_sha256, " +
      "published_page.latest_frozen_body_sha256, published_page.latest_frozen_at, published_page.published_at) " +
      "is distinct from (excluded.kind, excluded.canonical_address, excluded.current_body_sha256, " +
      "excluded.latest_frozen_body_sha256, excluded.latest_frozen_at, excluded.published_at)",
  );
  for (const kind of ["history-only", "local"] as const) {
    const rows = pages.filter((page) => page.kind === kind);
    for (const batch of batched({ rows, size: INSERT_BATCH })) {
      const written = await writer
        .insert(publishedPageTable)
        .values([...batch])
        .onConflictDoUpdate({
          set: kind === "local" ? localSet : pointer,
          setWhere: kind === "local" ? localDiffers : pointerDiffers,
          target: publishedPageTable.pageKey,
        })
        .returning({ key: publishedPageTable.pageKey });
      changed += written.length;
    }
  }
  return changed;
}

/**
 * Insert every version not already held; a held one is never rewritten.
 *
 * @param writer the open transaction
 * @param versions every version row
 * @returns how many were new
 */
async function insertVersions({
  writer,
  versions,
}: {
  writer: StoreWriter;
  versions: readonly NewPublishedPageVersionRecord[];
}): Promise<number> {
  let inserted = 0;
  for (const batch of batched({ rows: versions, size: INSERT_BATCH })) {
    const written = await writer
      .insert(publishedPageVersionTable)
      .values([...batch])
      .onConflictDoNothing({ target: [publishedPageVersionTable.pageKey, publishedPageVersionTable.bodySha256] })
      .returning({ key: publishedPageVersionTable.pageKey });
    inserted += written.length;
  }
  return inserted;
}

/**
 * The file rows the store holds for these pages, read inside the import's transaction.
 *
 * @param writer the open transaction
 * @param keys the local pages' keys
 * @returns their file rows
 */
async function heldFiles({ writer, keys }: { writer: StoreWriter; keys: readonly string[] }): Promise<HeldFile[]> {
  const held: HeldFile[] = [];
  for (const batch of batched({ rows: keys, size: HELD_BATCH })) {
    held.push(
      ...(await writer
        .select({
          bodySha256: publishedPageFileTable.bodySha256,
          pageKey: publishedPageFileTable.pageKey,
          relativePath: publishedPageFileTable.relativePath,
        })
        .from(publishedPageFileTable)
        .where(inArray(publishedPageFileTable.pageKey, [...batch]))),
    );
  }
  return held;
}

/**
 * Remove the file rows a folder no longer holds and write the new or changed ones.
 *
 * @param writer the open transaction
 * @param changes what `fileChanges` decided
 */
async function applyFileChanges({ writer, changes }: { writer: StoreWriter; changes: FileChanges }): Promise<void> {
  const removalsByPage = Map.groupBy(changes.removals, (removal) => removal.pageKey);
  for (const [pageKey, removals] of removalsByPage) {
    const paths = removals.map((removal) => removal.relativePath);
    await writer
      .delete(publishedPageFileTable)
      .where(and(eq(publishedPageFileTable.pageKey, pageKey), inArray(publishedPageFileTable.relativePath, paths)));
  }
  for (const batch of batched<NewPublishedPageFileRecord>({ rows: changes.writes, size: INSERT_BATCH })) {
    await writer
      .insert(publishedPageFileTable)
      .values([...batch])
      .onConflictDoUpdate({
        set: { bodySha256: sql.raw("excluded.body_sha256") },
        target: [publishedPageFileTable.pageKey, publishedPageFileTable.relativePath],
      });
  }
}
