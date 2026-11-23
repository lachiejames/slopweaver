/**
 * Writing published pages into the store — the effectful half of `./importPlan.ts`, for a folder import and for a
 * publish or freeze written straight in (`./write.ts`) alike.
 *
 * ## Ordering across two systems: check, then objects, then rows
 *
 * Every held body is checked against the planned bytes first, so a disagreement refuses before anything moves. Each body
 * the store does not hold is then uploaded to its content-addressed key; only then does ONE transaction write the
 * bodies, the pages, the versions and the file rows (`./importRows.ts`), bodies first so every foreign key resolves.
 * A crash between the two leaves an object no row names, which the next run uploads again to the same key and
 * records — the order `../fleet/measurementStore.ts` takes for the same reason.
 *
 * ## The bucket is opened only when a body needs it
 *
 * `objects` is a thunk, so a re-run whose every body is already held never selects the Storage API at all.
 */
import { inArray } from "drizzle-orm";

import { err, ok, type Result } from "#lib/result.js";

import type { StoreClient } from "../client.js";
import { type StoreError, StoreErrors } from "../errors.js";
import { type ObjectStore, openObjectStore } from "../objects/client.js";
import type { ObjectStoreError } from "../objects/errors.js";
import { storeObjectsSelection } from "../objects/selection.js";
import { publishedPageBlobTable, publishedPageTable } from "../schema/publishedPages.js";

import type { PublishedPagesImportError } from "./errors.js";
import {
  blobsToWrite,
  type HeldBlob,
  heldBlobConflicts,
  type PublishedPagesWriteContext,
  storeOnlyKeys,
} from "./importPlan.js";
import { batched, HELD_BATCH, type PublishedPagesRowCounts, writeRows } from "./importRows.js";
import type { PlannedBlob, PublishedPagesPlan } from "./project.js";

/** The private bucket every page body is an object in, keyed by its sha-256. */
const PUBLISHED_PAGES_BUCKET = "published-pages";

/** What an import changed. A re-run over unchanged folders reports zero for every write. */
export interface PublishedPagesWriteCounts extends PublishedPagesRowCounts {
  readonly objects: number;
  /** Stored pages the folders no longer hold, left untouched. */
  readonly storeOnlyPages: readonly string[];
}

/** Every way the store half of an import can fail. */
export type PublishedPagesWriteError = ObjectStoreError | PublishedPagesImportError | StoreError;

type WriteResult<T> = Result<T, readonly PublishedPagesWriteError[]>;

/**
 * The published-pages bucket on the running local stack's Storage API, its URL and key read off the stack now and
 * stored nowhere.
 *
 * @returns the bucket, or the typed refusal naming what was wrong with the stack
 */
export function publishedPageObjects(): Result<ObjectStore, ObjectStoreError> {
  return storeObjectsSelection().map((selection) =>
    openObjectStore({ apiUrl: selection.apiUrl, bucket: PUBLISHED_PAGES_BUCKET, serviceKey: selection.serviceKey }),
  );
}

/**
 * Carry a projected plan into the store: refuse a held body that disagrees, upload every new body, then write every
 * row in one transaction.
 *
 * @param client an open store connection
 * @param objects opens the bucket — called only when a body is not yet held
 * @param plan what `projectPublishedPages` derived from the folders
 * @param context a batch import, or a publish naming its own version; a publish reads no other page, so it reports
 *   no store-only pages
 * @returns what changed, or every refusal — nothing is written when a check or an upload failed
 */
export async function importPublishedPages({
  client,
  objects,
  plan,
  context,
}: {
  client: StoreClient;
  objects: () => Result<ObjectStore, ObjectStoreError>;
  plan: PublishedPagesPlan;
  context: PublishedPagesWriteContext;
}): Promise<WriteResult<PublishedPagesWriteCounts>> {
  const held = await heldBlobs({ client, shas: plan.blobs.map((blob) => blob.sha256) });
  if (held.isErr()) {
    return err([held.error]);
  }
  const conflicts = heldBlobConflicts({ blobs: plan.blobs, held: held.value });
  if (conflicts.length > 0) {
    return err(conflicts);
  }
  const storedKeys = context.kind === "import" ? await storedPageKeys({ client }) : ok([]);
  if (storedKeys.isErr()) {
    return err([storedKeys.error]);
  }
  const fresh = blobsToWrite({ blobs: plan.blobs, held: held.value });
  const uploaded = await uploadBodies({ blobs: fresh, objects });
  if (uploaded.isErr()) {
    return err([uploaded.error]);
  }
  const written = await writeRows({ blobs: fresh, client, context, plan });
  if (written.isErr()) {
    return err([written.error]);
  }
  return ok({
    ...written.value,
    objects: fresh.length,
    storeOnlyPages: storeOnlyKeys({ pages: plan.pages, stored: storedKeys.value }),
  });
}

/**
 * What the store holds of each of these bodies.
 *
 * @param client an open store connection
 * @param shas the digests to ask about
 * @returns the held ones by digest, or the typed database failure
 */
async function heldBlobs({
  client,
  shas,
}: {
  client: StoreClient;
  shas: readonly string[];
}): Promise<Result<ReadonlyMap<string, HeldBlob>, StoreError>> {
  const held = new Map<string, HeldBlob>();
  try {
    for (const batch of batched({ rows: shas, size: HELD_BATCH })) {
      const rows = await client.db
        .select({
          byteLength: publishedPageBlobTable.byteLength,
          mediaType: publishedPageBlobTable.mediaType,
          sha: publishedPageBlobTable.bodySha256,
        })
        .from(publishedPageBlobTable)
        .where(inArray(publishedPageBlobTable.bodySha256, [...batch]));
      rows.forEach((row) => held.set(row.sha, { byteLength: row.byteLength, mediaType: row.mediaType }));
    }
    return ok(held);
  } catch (cause) {
    return err(StoreErrors.queryFailed({ cause, what: "read which published page bodies the store holds" }));
  }
}

/**
 * Every page the store holds, by key and kind.
 *
 * @param client an open store connection
 * @returns the pages, or the typed database failure
 */
async function storedPageKeys({
  client,
}: {
  client: StoreClient;
}): Promise<Result<readonly { key: string; kind: string }[], StoreError>> {
  try {
    return ok(
      await client.db
        .select({ key: publishedPageTable.pageKey, kind: publishedPageTable.kind })
        .from(publishedPageTable),
    );
  } catch (cause) {
    return err(StoreErrors.queryFailed({ cause, what: "read which published pages the store holds" }));
  }
}

/**
 * Upload every body the store does not hold, opening the bucket only when there is one.
 *
 * @param blobs the bodies not yet held
 * @param objects opens the bucket
 * @returns nothing, or the first Storage failure
 */
async function uploadBodies({
  blobs,
  objects,
}: {
  blobs: readonly PlannedBlob[];
  objects: () => Result<ObjectStore, ObjectStoreError>;
}): Promise<Result<void, ObjectStoreError>> {
  if (blobs.length === 0) {
    return ok(undefined);
  }
  const opened = objects();
  if (opened.isErr()) {
    return err(opened.error);
  }
  const bucket = await opened.value.ensureBucket();
  if (bucket.isErr()) {
    return err(bucket.error);
  }
  for (const blob of blobs) {
    const put = await opened.value.put({ bytes: blob.bytes, contentType: blob.mediaType, key: blob.sha256 });
    if (put.isErr()) {
      return err(put.error);
    }
  }
  return ok(undefined);
}
