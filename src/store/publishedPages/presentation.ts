/**
 * One page as the console shows it: every file the page currently serves, each with a short-lived signed read
 * address, in one answer. Stage 5 of [the published pages doc](../../../docs/store/published-pages.md) § Serving.
 *
 * The console cannot import `src/`, so it asks `slopweaver page read <slug> --presentation --json` once per page open
 * and proxies each file's bytes itself. One child and one batch-signing request answer a page with any number of
 * images, where a child per image would pay the CLI's startup once per image. The addresses go to the console's
 * server and never to the viewer, so the page keeps its sandbox, its policy and its relative links.
 *
 * **Every file the page serves is signed, not only the ones the document links.** A relative link resolves in the
 * browser, through `srcset`, CSS `url()` or a script, so a list parsed out of the document would miss one. The file
 * rows are the page's own list of what it serves.
 */
import { and, eq } from "drizzle-orm";

import { err, ok, type Result } from "#lib/result.js";
import { PAGE_FILENAME } from "../../pages/url.js";
import type { StoreClient } from "../client.js";
import { StoreErrors } from "../errors.js";
import type { ObjectStore } from "../objects/client.js";
import type { ObjectStoreError } from "../objects/errors.js";
import { publishedPageBlobTable, publishedPageFileTable, publishedPageTable } from "../schema/publishedPages.js";

import { type PublishedPagesReadError, PublishedPagesReadErrors } from "./readErrors.js";

/** How long a signed address reads, in seconds: a page open and the image loads it starts, with room to spare. */
export const PRESENTATION_EXPIRY_SECONDS = 300;

/** One file a page serves, as its rows hold it. */
export interface PresentedFile {
  /** The path under the page, `/`-separated. */
  readonly relativePath: string;
  /** Lower-case hex, the body's key in the bucket. */
  readonly sha256: string;
  readonly byteLength: number;
}

/** One file a page serves, with the address its bytes are read from until it expires. */
export interface SignedPresentedFile extends PresentedFile {
  readonly signedUrl: string;
}

/** Every file one page serves, signed. */
export interface PagePresentation {
  readonly pageKey: string;
  readonly expiresInSeconds: number;
  /** The document first, then every other file by path. */
  readonly files: readonly SignedPresentedFile[];
}

/** One page's row and its file rows, read in one snapshot. */
interface PresentationRows {
  /** The page's row, absent when the store holds none under the key. */
  readonly page: { readonly kind: string; readonly currentSha256: string | null } | undefined;
  /** Each file joined to its body's row; `byteLength` is null when that row is missing. */
  readonly files: readonly {
    readonly relativePath: string;
    readonly sha256: string;
    readonly byteLength: number | null;
  }[];
}

/**
 * The files a page serves, refused when it is no local page or its rows contradict each other.
 *
 * A page is published when it is a `local` row whose `index.html` file row names its current body. A key with no row,
 * or only a history, is not published; a local row whose document is missing or names another body is inconsistent,
 * never "not published", because the store holds the page and cannot say which bytes it is.
 *
 * @param pageKey the slug asked for, named in a refusal
 * @param rows the page's row and its file rows
 * @returns the files, the document first, or why there are none to show
 */
export function presentedFiles({
  pageKey,
  rows,
}: {
  pageKey: string;
  rows: PresentationRows;
}): Result<readonly PresentedFile[], PublishedPagesReadError> {
  const { page, files } = rows;
  if (page?.kind !== "local") {
    return err(PublishedPagesReadErrors.notPublished({ pageKey }));
  }
  const document = files.find((file) => file.relativePath === PAGE_FILENAME);
  if (document === undefined || document.sha256 !== page.currentSha256) {
    return err(PublishedPagesReadErrors.inconsistent({ detail: "its document is not its current body", pageKey }));
  }
  const complete: PresentedFile[] = [];
  for (const { byteLength, relativePath, sha256 } of files) {
    if (byteLength === null) {
      return err(PublishedPagesReadErrors.inconsistent({ detail: `${relativePath} has no body row`, pageKey }));
    }
    complete.push({ byteLength, relativePath, sha256 });
  }
  return ok(
    complete.toSorted(
      (left, right) =>
        Number(right.relativePath === PAGE_FILENAME) - Number(left.relativePath === PAGE_FILENAME) ||
        left.relativePath.localeCompare(right.relativePath),
    ),
  );
}

/**
 * Pair each file with its body's signed address, refused when the signing answer left one out.
 *
 * @param pageKey the page, named in a refusal
 * @param files the files the page serves
 * @param signed each body's address, keyed by its digest
 * @returns the files with their addresses
 */
export function signedFiles({
  pageKey,
  files,
  signed,
}: {
  pageKey: string;
  files: readonly PresentedFile[];
  signed: ReadonlyMap<string, string>;
}): Result<readonly SignedPresentedFile[], PublishedPagesReadError> {
  const paired: SignedPresentedFile[] = [];
  for (const file of files) {
    const signedUrl = signed.get(file.sha256);
    if (signedUrl === undefined) {
      return err(PublishedPagesReadErrors.inconsistent({ detail: `${file.relativePath} was not signed`, pageKey }));
    }
    paired.push({ ...file, signedUrl });
  }
  return ok(paired);
}

/**
 * Read one page's rows in one snapshot, so a publish landing between the two reads cannot pair the old page with the
 * new files.
 *
 * @param client the open connection
 * @param pageKey the slug
 * @returns the rows, or the store's refusal
 */
async function presentationRows({
  client,
  pageKey,
}: {
  client: StoreClient;
  pageKey: string;
}): Promise<Result<PresentationRows, PublishedPagesReadError>> {
  try {
    const rows = await client.db.transaction(
      async (tx) => {
        const [page] = await tx
          .select({ currentSha256: publishedPageTable.currentBodySha256, kind: publishedPageTable.kind })
          .from(publishedPageTable)
          .where(eq(publishedPageTable.pageKey, pageKey));
        // A LEFT join, so a file whose body row is missing reaches `presentedFiles` and refuses, never drops.
        const files = await tx
          .select({
            byteLength: publishedPageBlobTable.byteLength,
            relativePath: publishedPageFileTable.relativePath,
            sha256: publishedPageFileTable.bodySha256,
          })
          .from(publishedPageFileTable)
          .leftJoin(publishedPageBlobTable, eq(publishedPageFileTable.bodySha256, publishedPageBlobTable.bodySha256))
          .where(and(eq(publishedPageFileTable.pageKey, pageKey), eq(publishedPageFileTable.pageKind, "local")));
        return { files, page };
      },
      { accessMode: "read only", isolationLevel: "repeatable read" },
    );
    return ok(rows);
  } catch (cause) {
    return err(StoreErrors.queryFailed({ cause, what: `read the files ${pageKey} serves` }));
  }
}

/**
 * One page's current document, downloaded and verified against its digest: what the console voice reads a page from.
 * Refused exactly as {@link pagePresentation} refuses, from the same snapshot, so the voice and the console agree on
 * whether a page is published and which bytes it is.
 *
 * @param client the open connection
 * @param bucket opens the bucket
 * @param pageKey the slug
 * @returns the document's bytes, or why the page cannot be read
 */
export async function pageDocument({
  client,
  bucket,
  pageKey,
}: {
  client: StoreClient;
  bucket: () => Result<ObjectStore, ObjectStoreError>;
  pageKey: string;
}): Promise<Result<Uint8Array, PublishedPagesReadError>> {
  const rows = await presentationRows({ client, pageKey });
  if (rows.isErr()) {
    return err(rows.error);
  }
  const files = presentedFiles({ pageKey, rows: rows.value });
  if (files.isErr()) {
    return err(files.error);
  }
  const opened = bucket();
  if (opened.isErr()) {
    return err(opened.error);
  }
  // `presentedFiles` puts the document first and refuses a page without one.
  return opened.value.get({ key: files.value[0]!.sha256 });
}

/** One file a page serves, with its bytes. */
export interface HeldPageFile {
  /** The path under the page, `/`-separated. */
  readonly relativePath: string;
  readonly bytes: Uint8Array;
}

/**
 * Every file one page currently serves, each downloaded and verified against its digest, the document first: what
 * `page export` builds its one copy from. Refused exactly as {@link pagePresentation} refuses, from the same
 * snapshot, and one failed download fails the whole read, so an export never silently drops an image.
 *
 * @param client the open connection
 * @param bucket opens the bucket
 * @param pageKey the slug
 * @returns the files and their bytes, or why the page cannot be read
 */
export async function pageFiles({
  client,
  bucket,
  pageKey,
}: {
  client: StoreClient;
  bucket: () => Result<ObjectStore, ObjectStoreError>;
  pageKey: string;
}): Promise<Result<readonly HeldPageFile[], PublishedPagesReadError>> {
  const rows = await presentationRows({ client, pageKey });
  if (rows.isErr()) {
    return err(rows.error);
  }
  const files = presentedFiles({ pageKey, rows: rows.value });
  if (files.isErr()) {
    return err(files.error);
  }
  const opened = bucket();
  if (opened.isErr()) {
    return err(opened.error);
  }
  const held: HeldPageFile[] = [];
  for (const { relativePath, sha256 } of files.value) {
    const bytes = await opened.value.get({ key: sha256 });
    if (bytes.isErr()) {
      return err(bytes.error);
    }
    held.push({ bytes: bytes.value, relativePath });
  }
  return ok(held);
}

/**
 * Every file one page serves, each with a signed address, from one snapshot and one signing request.
 *
 * @param client the open connection
 * @param bucket opens the bucket
 * @param pageKey the slug
 * @param expiresInSeconds how long each address reads
 * @returns the presentation, or why the page cannot be shown
 */
export async function pagePresentation({
  client,
  bucket,
  pageKey,
  expiresInSeconds,
}: {
  client: StoreClient;
  bucket: () => Result<ObjectStore, ObjectStoreError>;
  pageKey: string;
  expiresInSeconds: number;
}): Promise<Result<PagePresentation, PublishedPagesReadError>> {
  const rows = await presentationRows({ client, pageKey });
  if (rows.isErr()) {
    return err(rows.error);
  }
  const files = presentedFiles({ pageKey, rows: rows.value });
  if (files.isErr()) {
    return err(files.error);
  }
  const opened = bucket();
  if (opened.isErr()) {
    return err(opened.error);
  }
  const keys = [...new Set(files.value.map((file) => file.sha256))];
  const signed = await opened.value.sign({ expiresInSeconds, keys });
  if (signed.isErr()) {
    return err(signed.error);
  }
  return signedFiles({ files: files.value, pageKey, signed: signed.value }).map((paired) => ({
    expiresInSeconds,
    files: paired,
    pageKey,
  }));
}
