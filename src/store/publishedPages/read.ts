/**
 * Reading a published page out of the store: its latest frozen version with the bytes, every current page with its
 * title, and whether a page serves a named file. Stage 4 of [the published pages doc](../../../docs/store/published-pages.md).
 *
 * ## Bytes come by authenticated download, never a signed address
 *
 * A verb is the trusted local process already holding the Storage credential, so a body comes through
 * `ObjectStore.get`, which verifies the bytes against the digest they are keyed by. A signed address is a capability
 * for the console's viewer (stage 5); a verb would only mint one to fetch it straight back.
 *
 * ## No answer is partial, and nothing falls back to the folders
 *
 * One failed query or download fails the whole read. A store that cannot be read is an error the verb prints, never a
 * cue to look in `pages/` or `published-pages/` instead: a reader answering from the folders is a reader that still
 * works the day they are gone, and stage 7 deletes them.
 */
import { and, eq } from "drizzle-orm";

import { err, ok, type Result } from "#lib/result.js";
import { pageTitleOf } from "../../pages/find.js";
import { connectStore, type StoreClient } from "../client.js";
import { StoreErrors } from "../errors.js";
import type { ObjectStore } from "../objects/client.js";
import type { ObjectStoreError } from "../objects/errors.js";
import {
  publishedPageBlobTable,
  publishedPageFileTable,
  publishedPageTable,
  publishedPageVersionTable,
} from "../schema/publishedPages.js";
import { withStoreConnection } from "../withConnection.js";

import { publishedPageObjects } from "./importStore.js";
import { type HeldPageFile, type PagePresentation, pageDocument, pageFiles, pagePresentation } from "./presentation.js";
import { type PublishedPagesReadError, PublishedPagesReadErrors } from "./readErrors.js";

/**
 * How much of a document's head the title is parsed from — the same bound `page find` read off disk, so a title
 * deep in a large page is missed exactly as it always was.
 */
export const TITLE_HEAD_BYTES = 8192;

/**
 * The newest frozen version of one page, with its bytes.
 *
 * @internal reached as what {@link PublishedPagesReader.latestFrozen} answers, never named outside this file
 */
export interface LatestFrozenPublishedPage {
  readonly pageKey: string;
  /** Lower-case hex, the body's key in the bucket. */
  readonly bodySha256: string;
  readonly bytes: Uint8Array;
  readonly frozenAt: Date;
  /** How many distinct versions the store holds of this page. */
  readonly versionCount: number;
}

/**
 * One page a reader opens, as `page find` ranks it.
 *
 * @internal reached as what {@link PublishedPagesReader.listCurrent} answers, never named outside this file
 */
export interface CurrentPublishedPage {
  readonly pageKey: string;
  /** The document's `<title>`, absent when its head carries none. */
  readonly title: string | undefined;
  readonly publishedAt: Date;
  /** The current document's size in bytes. */
  readonly byteLength: number;
}

/** One local page's current document, as the store's rows hold it. */
export interface CurrentRow {
  readonly pageKey: string;
  readonly sha256: string;
  readonly byteLength: number;
  readonly publishedAt: Date;
}

/** The reads a verb makes, over one open connection. */
export interface PublishedPagesReader {
  /** The latest frozen version of a page or a history, refused when the store holds none. */
  readonly latestFrozen: (args: {
    pageKey: string;
  }) => Promise<Result<LatestFrozenPublishedPage, PublishedPagesReadError>>;
  /** Every local page, newest first. */
  readonly listCurrent: () => Promise<Result<readonly CurrentPublishedPage[], PublishedPagesReadError>>;
  /** Whether a local page currently serves the file at this path under it; `index.html` is the document. */
  readonly fileExists: (args: {
    pageKey: string;
    relativePath: string;
  }) => Promise<Result<boolean, PublishedPagesReadError>>;
  /** A local page's current document, its bytes verified against their digest. */
  readonly document: (args: { pageKey: string }) => Promise<Result<Uint8Array, PublishedPagesReadError>>;
  /** Every file a local page serves with its bytes, each verified against its digest, the document first. */
  readonly files: (args: { pageKey: string }) => Promise<Result<readonly HeldPageFile[], PublishedPagesReadError>>;
  /** Every file a local page serves, each with a signed read address for the console's server. */
  readonly presentation: (args: {
    pageKey: string;
    expiresInSeconds: number;
  }) => Promise<Result<PagePresentation, PublishedPagesReadError>>;
}

/**
 * Decide a page's frozen pointer from its row and its versions, refusing the two contradictions: a pointer naming
 * no version the store holds of it (review r2: counting versions passed a pointer at A beside one version B), and
 * versions with no pointer — the second once read as "never frozen" and let a composed card stand over a freeze
 * marking another lean.
 *
 * @param pageKey the page the row is for, named in a refusal
 * @param row the page's frozen pointer, absent when the store holds no row for the key
 * @param versionDigests the digest of every version the store holds of the key
 * @returns the digest and instant to read, or why there is none to read
 */
export function frozenPointerOf({
  pageKey,
  row,
  versionDigests,
}: {
  pageKey: string;
  row: { readonly sha256: string | null; readonly frozenAt: Date | null } | undefined;
  versionDigests: readonly string[];
}): Result<{ readonly sha256: string; readonly frozenAt: Date }, PublishedPagesReadError> {
  const sha256 = row?.sha256;
  const frozenAt = row?.frozenAt;
  if (sha256 == null || frozenAt == null) {
    if (versionDigests.length > 0) {
      return err(
        PublishedPagesReadErrors.inconsistent({
          detail: `it holds ${String(versionDigests.length)} frozen version(s) and no latest freeze`,
          pageKey,
        }),
      );
    }
    return err(PublishedPagesReadErrors.neverFrozen({ pageKey }));
  }
  if (!versionDigests.includes(sha256)) {
    return err(
      PublishedPagesReadErrors.inconsistent({
        detail: `its latest freeze ${sha256} is none of its ${String(versionDigests.length)} frozen version(s)`,
        pageKey,
      }),
    );
  }
  return ok({ frozenAt, sha256 });
}

/**
 * The title of a document, parsed from its head only.
 *
 * @param bytes the whole document as the bucket returned it
 * @returns its title, or nothing when the first {@link TITLE_HEAD_BYTES} bytes carry none
 */
export function titleOfBody({ bytes }: { bytes: Uint8Array }): string | undefined {
  return pageTitleOf({ html: new TextDecoder().decode(bytes.subarray(0, TITLE_HEAD_BYTES)) });
}

/**
 * The digests to download for a list of pages, each once however many pages share it.
 *
 * @param digests every page's current document digest, in page order
 * @returns the distinct digests, in first-seen order
 */
export function distinctDigests({ digests }: { digests: readonly string[] }): readonly string[] {
  return [...new Set(digests)];
}

/**
 * A reader over one open connection.
 *
 * @param client the open store connection every query runs on
 * @param objects opens the bucket; called at most once, and only when a body is read
 * @returns the reads, none of which closes the connection
 */
export function publishedPagesReader({
  client,
  objects,
}: {
  client: StoreClient;
  objects: () => Result<ObjectStore, ObjectStoreError>;
}): PublishedPagesReader {
  const bucket = openedOnce({ open: objects });
  return {
    document: (args) => pageDocument({ ...args, bucket, client }),
    fileExists: (args) => fileExists({ ...args, client }),
    files: (args) => pageFiles({ ...args, bucket, client }),
    latestFrozen: (args) => latestFrozen({ ...args, bucket, client }),
    listCurrent: () => listCurrent({ bucket, client }),
    presentation: (args) => pagePresentation({ ...args, bucket, client }),
  };
}

/**
 * Open the store this home selects, run `read` over one reader, and close the connection whatever it answered.
 *
 * @param home the home whose selected store is read
 * @param read the operation, over the reader
 * @returns what `read` answered, or the refusal for the step that did not finish
 */
export async function withPublishedPagesReader<T>({
  home,
  read,
}: {
  home: string;
  read: (reader: PublishedPagesReader) => Promise<Result<T, PublishedPagesReadError>>;
}): Promise<Result<T, PublishedPagesReadError>> {
  return withStoreConnection<StoreClient, T, PublishedPagesReadError>({
    body: (client) => read(publishedPagesReader({ client, objects: publishedPageObjects })),
    connect: () => connectStore({ home, max: 1 }),
    unavailable: PublishedPagesReadErrors.unavailable,
  });
}

/**
 * Wrap a bucket opener so a reader that downloads many bodies resolves the stack's selection once.
 *
 * @param open what opens the bucket
 * @returns an opener answering the first answer every time
 */
function openedOnce({
  open,
}: {
  open: () => Result<ObjectStore, ObjectStoreError>;
}): () => Result<ObjectStore, ObjectStoreError> {
  const held: Result<ObjectStore, ObjectStoreError>[] = [];
  return () => {
    if (held.length === 0) {
      held.push(open());
    }
    return held[0]!;
  };
}

/**
 * Download one body through the bucket, verified against its digest.
 *
 * @param bucket opens the bucket
 * @param sha256 the body's key
 * @returns the bytes, or the bucket's own refusal
 */
async function bodyOf({
  bucket,
  sha256,
}: {
  bucket: () => Result<ObjectStore, ObjectStoreError>;
  sha256: string;
}): Promise<Result<Uint8Array, PublishedPagesReadError>> {
  const opened = bucket();
  if (opened.isErr()) {
    return err(opened.error);
  }
  return opened.value.get({ key: sha256 });
}

/**
 * The latest frozen version of one key, with its bytes.
 *
 * @param client the open connection
 * @param bucket opens the bucket
 * @param pageKey a slug, or a history's freeze key
 * @returns the version, or why there is none to read
 */
async function latestFrozen({
  bucket,
  client,
  pageKey,
}: {
  bucket: () => Result<ObjectStore, ObjectStoreError>;
  client: StoreClient;
  pageKey: string;
}): Promise<Result<LatestFrozenPublishedPage, PublishedPagesReadError>> {
  let pointer: Result<{ readonly sha256: string; readonly frozenAt: Date }, PublishedPagesReadError>;
  let versionCount: number;
  try {
    // One snapshot for both reads: under the default READ COMMITTED a publish landing between them pairs the old
    // pointer with the new version list, an answer no instant ever held.
    const { row, versions } = await client.db.transaction(
      async (tx) => {
        const [pageRow] = await tx
          .select({ frozenAt: publishedPageTable.latestFrozenAt, sha256: publishedPageTable.latestFrozenBodySha256 })
          .from(publishedPageTable)
          .where(eq(publishedPageTable.pageKey, pageKey));
        const versionRows = await tx
          .select({ sha256: publishedPageVersionTable.bodySha256 })
          .from(publishedPageVersionTable)
          .where(eq(publishedPageVersionTable.pageKey, pageKey));
        return { row: pageRow, versions: versionRows };
      },
      { accessMode: "read only", isolationLevel: "repeatable read" },
    );
    const versionDigests = versions.map((version) => version.sha256);
    versionCount = versionDigests.length;
    pointer = frozenPointerOf({ pageKey, row, versionDigests });
  } catch (cause) {
    return err(StoreErrors.queryFailed({ cause, what: `read the latest freeze of ${pageKey}` }));
  }
  if (pointer.isErr()) {
    return err(pointer.error);
  }
  const { frozenAt, sha256 } = pointer.value;
  const bytes = await bodyOf({ bucket, sha256 });
  return bytes.map((value) => ({ bodySha256: sha256, bytes: value, frozenAt, pageKey, versionCount }));
}

/**
 * Every local page with its current document's size and title, newest first.
 *
 * @param client the open connection
 * @param bucket opens the bucket
 * @returns the pages, or the first refusal — never a list with a page missing
 */
async function listCurrent({
  bucket,
  client,
}: {
  bucket: () => Result<ObjectStore, ObjectStoreError>;
  client: StoreClient;
}): Promise<Result<readonly CurrentPublishedPage[], PublishedPagesReadError>> {
  const rows = await currentRows({ client });
  if (rows.isErr()) {
    return err(rows.error);
  }
  const titles = new Map<string, string | undefined>();
  for (const sha256 of distinctDigests({ digests: rows.value.map((row) => row.sha256) })) {
    const bytes = await bodyOf({ bucket, sha256 });
    if (bytes.isErr()) {
      return err(bytes.error);
    }
    titles.set(sha256, titleOfBody({ bytes: bytes.value }));
  }
  return ok(
    rows.value
      .map((row) => ({
        byteLength: row.byteLength,
        pageKey: row.pageKey,
        publishedAt: row.publishedAt,
        title: titles.get(row.sha256),
      }))
      .toSorted((left, right) => right.publishedAt.getTime() - left.publishedAt.getTime()),
  );
}

/**
 * Every local page's current document digest, size and publication instant.
 *
 * @param client the open connection
 * @returns the rows, or why they could not be read or contradict the schema's own shape
 */
async function currentRows({
  client,
}: {
  client: StoreClient;
}): Promise<Result<readonly CurrentRow[], PublishedPagesReadError>> {
  let rows: readonly {
    readonly pageKey: string;
    readonly sha256: string | null;
    readonly byteLength: number | null;
    readonly publishedAt: Date | null;
  }[];
  try {
    // A LEFT join, so a page whose body row is missing reaches the check below and refuses, rather than an inner
    // join dropping it and the list answering without it (review r1).
    rows = await client.db
      .select({
        byteLength: publishedPageBlobTable.byteLength,
        pageKey: publishedPageTable.pageKey,
        publishedAt: publishedPageTable.publishedAt,
        sha256: publishedPageTable.currentBodySha256,
      })
      .from(publishedPageTable)
      .leftJoin(publishedPageBlobTable, eq(publishedPageTable.currentBodySha256, publishedPageBlobTable.bodySha256))
      .where(eq(publishedPageTable.kind, "local"));
  } catch (cause) {
    return err(StoreErrors.queryFailed({ cause, what: "list the published pages" }));
  }
  const complete: CurrentRow[] = [];
  for (const row of rows) {
    const checked = completeRow({ row });
    if (checked.isErr()) {
      return err(checked.error);
    }
    complete.push(checked.value);
  }
  return ok(complete);
}

/**
 * One listed row, refused when the store's rows leave out what a local page must carry.
 *
 * @param row the page joined to its current body's row, which is absent when that row is missing
 * @returns the complete row, or the inconsistency naming the page
 */
export function completeRow({
  row,
}: {
  row: {
    readonly pageKey: string;
    readonly sha256: string | null;
    readonly byteLength: number | null;
    readonly publishedAt: Date | null;
  };
}): Result<CurrentRow, PublishedPagesReadError> {
  const { byteLength, pageKey, publishedAt, sha256 } = row;
  if (sha256 === null || publishedAt === null) {
    return err(PublishedPagesReadErrors.inconsistent({ detail: "a local page with no current document", pageKey }));
  }
  if (byteLength === null) {
    return err(
      PublishedPagesReadErrors.inconsistent({ detail: `its current document ${sha256} has no body row`, pageKey }),
    );
  }
  return ok({ byteLength, pageKey, publishedAt, sha256 });
}

/**
 * Whether a local page currently serves a file at this path.
 *
 * @param client the open connection
 * @param pageKey the page's slug
 * @param relativePath the path under the page, `/`-separated
 * @returns whether it does — a failed query is an error, never `false`
 */
async function fileExists({
  client,
  pageKey,
  relativePath,
}: {
  client: StoreClient;
  pageKey: string;
  relativePath: string;
}): Promise<Result<boolean, PublishedPagesReadError>> {
  try {
    const rows = await client.db
      .select({ pageKey: publishedPageFileTable.pageKey })
      .from(publishedPageFileTable)
      .where(and(eq(publishedPageFileTable.pageKey, pageKey), eq(publishedPageFileTable.relativePath, relativePath)))
      .limit(1);
    return ok(rows.length > 0);
  } catch (cause) {
    return err(StoreErrors.queryFailed({ cause, what: `read whether ${pageKey} serves ${relativePath}` }));
  }
}
