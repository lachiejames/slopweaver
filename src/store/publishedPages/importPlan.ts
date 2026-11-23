/**
 * The pure decisions of a page import's store half: what each planned page becomes as rows, which held bodies
 * disagree with the folders, which file rows to remove and which to write, and which stored pages the folders no
 * longer hold. `importStore.ts` reads the store, asks these, and writes what they answer.
 *
 * ## A re-run over unchanged folders writes nothing
 *
 * Every write is the DIFFERENCE between what the store holds and what the folders hold: a body or version already
 * held is never re-inserted, a file row whose body is unchanged is never rewritten, and a page row is updated only
 * when a field differs. So the counts a run reports are what changed, and a second run's are all zero.
 *
 * ## Versions are append-only; files are the folders' exact set
 *
 * A version row is never rewritten, so a later stage's `origin = 'published'` row keeps its real
 * `first_frozen_at` through any re-import. A local page's file rows, by contrast, are made to match its folder
 * exactly: a file gone from disk loses its row (never its body or object), which is what makes a re-import after a
 * republish correct.
 */
import type {
  NewPublishedPageBlobRecord,
  NewPublishedPageFileRecord,
  NewPublishedPageRecord,
  NewPublishedPageVersionRecord,
} from "../schema/publishedPages.js";

import { type PublishedPagesImportError, PublishedPagesImportErrors } from "./errors.js";
import type { PlannedBlob, PlannedPage } from "./project.js";

/** What the store already holds of one body. */
export interface HeldBlob {
  readonly byteLength: number;
  readonly mediaType: string;
}

/** One file row as the store holds it. */
export interface HeldFile {
  readonly pageKey: string;
  readonly relativePath: string;
  readonly bodySha256: string;
}

/** The file rows to remove and to write so a page's set matches its folder. */
export interface FileChanges {
  readonly removals: readonly { pageKey: string; relativePath: string }[];
  readonly writes: readonly NewPublishedPageFileRecord[];
}

/**
 * Every held body whose type or length disagrees with what the folders derive for it — a refusal before anything is
 * uploaded or written, since a body row is never rewritten.
 *
 * @param blobs the distinct bodies the folders hold
 * @param held what the store holds, by digest
 * @returns one refusal per disagreeing body
 */
export function heldBlobConflicts({
  blobs,
  held,
}: {
  blobs: readonly PlannedBlob[];
  held: ReadonlyMap<string, HeldBlob>;
}): readonly PublishedPagesImportError[] {
  return blobs.flatMap((blob) => {
    const stored = held.get(blob.sha256);
    if (stored === undefined || (stored.mediaType === blob.mediaType && stored.byteLength === blob.byteLength)) {
      return [];
    }
    return [
      PublishedPagesImportErrors.heldBlobConflict({
        derived: `${blob.mediaType}, ${String(blob.byteLength)} bytes`,
        held: `${stored.mediaType}, ${String(stored.byteLength)} bytes`,
        sha256: blob.sha256,
      }),
    ];
  });
}

/**
 * The body rows the store does not hold yet.
 *
 * @param blobs the distinct bodies the folders hold
 * @param held what the store holds, by digest
 * @returns the rows to insert, which are also the objects to upload
 */
export function blobsToWrite({
  blobs,
  held,
}: {
  blobs: readonly PlannedBlob[];
  held: ReadonlyMap<string, HeldBlob>;
}): readonly PlannedBlob[] {
  return blobs.filter((blob) => !held.has(blob.sha256));
}

/**
 * A planned body as its row.
 *
 * @param blob the planned body
 * @returns its `published_page_blob` row
 */
export function blobRecord({ blob }: { blob: PlannedBlob }): NewPublishedPageBlobRecord {
  return { bodySha256: blob.sha256, byteLength: blob.byteLength, mediaType: blob.mediaType };
}

/**
 * A planned page as its row.
 *
 * @param page the planned page
 * @returns its `published_page` row
 */
export function pageRecord({ page }: { page: PlannedPage }): NewPublishedPageRecord {
  return {
    canonicalAddress: page.canonicalAddress,
    currentBodySha256: page.currentBodySha256,
    kind: page.kind,
    latestFrozenAt: page.latestFrozenAt,
    latestFrozenBodySha256: page.latestFrozenBodySha256,
    pageKey: page.pageKey,
    publishedAt: page.publishedAt,
  };
}

/** The one version a publish or a freeze took: its page, its bytes and the instant it was frozen at. */
export interface OwnVersion {
  readonly pageKey: string;
  readonly bodySha256: string;
  readonly frozenAt: Date;
}

/**
 * Why a write is happening, which decides what a NEW version row says about itself. A batch import dates every
 * version it finds by the import. A publish or a `briefing freeze` knows exactly one version is its own, frozen at a
 * real instant; any other version it plans is still only imported. A freeze moves only its key's latest pointer, a
 * local page's included, and refuses to open a history unless `opensHistory` says that is what was meant.
 */
export type PublishedPagesWriteContext =
  | { readonly kind: "import"; readonly importedAt: Date }
  | { readonly kind: "publish"; readonly importedAt: Date; readonly published: OwnVersion }
  | {
      readonly kind: "freeze";
      readonly importedAt: Date;
      readonly published: OwnVersion;
      readonly opensHistory: boolean;
    };

/**
 * Every planned version as a row: a publish's or freeze's own version as `published` at its freeze, every other as
 * `imported` at the import.
 *
 * @param pages every planned page
 * @param context the import or the publish this write is
 * @returns the version rows, each to be inserted only when not already held
 */
export function versionRecords({
  pages,
  context,
}: {
  pages: readonly PlannedPage[];
  context: PublishedPagesWriteContext;
}): readonly NewPublishedPageVersionRecord[] {
  return pages.flatMap((page) =>
    page.versionSha256s.map((bodySha256): NewPublishedPageVersionRecord => {
      const own =
        context.kind !== "import" &&
        context.published.pageKey === page.pageKey &&
        context.published.bodySha256 === bodySha256;
      if (own) {
        return { bodySha256, firstFrozenAt: context.published.frozenAt, origin: "published", pageKey: page.pageKey };
      }
      return { bodySha256, firstFrozenAt: context.importedAt, origin: "imported", pageKey: page.pageKey };
    }),
  );
}

/**
 * The file rows to remove and write so every LOCAL page's set matches its folder; a page the folders hold no
 * directory for is not touched.
 *
 * @param pages every planned page
 * @param held the file rows the store holds for those pages
 * @returns the removals and the writes, both empty when nothing changed
 */
export function fileChanges({
  pages,
  held,
}: {
  pages: readonly PlannedPage[];
  held: readonly HeldFile[];
}): FileChanges {
  const local = pages.filter((page) => page.kind === "local");
  const planned = new Map(
    local.flatMap((page) => page.files.map((file) => [fileKey({ ...file, pageKey: page.pageKey }), file.bodySha256])),
  );
  const heldBodies = new Map(held.map((file) => [fileKey(file), file.bodySha256]));
  const localKeys = new Set(local.map((page) => page.pageKey));
  return {
    removals: held
      .filter((file) => localKeys.has(file.pageKey) && !planned.has(fileKey(file)))
      .map(({ pageKey, relativePath }) => ({ pageKey, relativePath })),
    writes: local.flatMap((page) =>
      page.files
        .filter((file) => heldBodies.get(fileKey({ ...file, pageKey: page.pageKey })) !== file.bodySha256)
        .map((file) => ({ bodySha256: file.bodySha256, pageKey: page.pageKey, relativePath: file.relativePath })),
    ),
  };
}

/**
 * The stored pages the folders no longer hold, left untouched and reported. A stored LOCAL page whose page folder is
 * gone is one even when its freeze folder remains, because a history never rewrites a page.
 *
 * @param pages every planned page
 * @param stored every page the store holds, by key and kind
 * @returns the stored keys no planned page of their own kind carries, sorted
 */
export function storeOnlyKeys({
  pages,
  stored,
}: {
  pages: readonly PlannedPage[];
  stored: readonly { readonly key: string; readonly kind: string }[];
}): readonly string[] {
  const planned = new Map(pages.map((page) => [page.pageKey, page.kind]));
  return stored
    .filter((page) => planned.get(page.key) !== page.kind && planned.get(page.key) !== "local")
    .map((page) => page.key)
    .toSorted();
}

/**
 * One file's identity as a map key.
 *
 * @param pageKey the page
 * @param relativePath the file under it
 * @returns a key no two files share
 */
function fileKey({ pageKey, relativePath }: { pageKey: string; relativePath: string }): string {
  return `${pageKey}\u0000${relativePath}`;
}
