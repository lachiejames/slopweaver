/**
 * The pure half of writing ONE page, or ONE freeze, straight into the store — stage 6 of
 * `docs/store/published-pages.md`, where a publish writes nothing under `pages/` or `published-pages/`. The plan is
 * the same `PublishedPagesPlan` a folder import projects (`./project.ts`), built from the bytes the publisher holds
 * instead of from a scan, so `./importStore.ts` writes it under exactly the guarantees an import has: held bodies
 * checked, objects uploaded by digest, every row in one transaction behind the page's lock.
 *
 * - **A publish states the whole page.** Its files are `index.html` and the files its document loads, nothing else,
 *   so a file the previous publish stored and this one no longer loads loses its row (`./importPlan.ts` §
 *   `fileChanges`); its body and object stay, as every body does.
 * - **A freeze states one version.** `briefing freeze` names a key that may be a local page or a history with no page,
 *   so its plan is a history-only row carrying the new latest pointer, which moves a local page's pointer too
 *   (`./importRows.ts` § `upsertPages`) and never its document or files.
 */
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

import { err, ok, type Result } from "#lib/result.js";

import { pagePath } from "../../pages/publish.js";
import { PAGE_FILENAME } from "../../pages/url.js";
import { type BodyClaim, foldBodies, storedMediaType } from "./bodies.js";
import type { PublishedPagesImportError } from "./errors.js";
import type { OwnVersion } from "./importPlan.js";
import { UNSERVED_MEDIA_TYPE } from "./mediaType.js";
import type { PlannedBlob, PlannedPage, PublishedPagesPlan } from "./project.js";

/** What a frozen version is stored as. */
const FROZEN_MEDIA_TYPE = "text/html";

/** One page's publish, or one key's freeze, as the plan its write carries out. */
export type PublishedPageWrite =
  | { readonly kind: "publish"; readonly plan: PublishedPagesPlan; readonly published: OwnVersion }
  | {
      readonly kind: "freeze";
      readonly plan: PublishedPagesPlan;
      readonly published: OwnVersion;
      /** Whether opening a history the store holds no version of is what was meant: `briefing freeze --new`. */
      readonly opensHistory: boolean;
    };

/**
 * The lower-case hex sha-256 of some bytes.
 *
 * @param bytes the bytes
 * @returns the digest
 */
function sha256Hex({ bytes }: { bytes: Buffer }): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Plan one page's publish: its document as its current body and its new frozen version, and its files.
 *
 * @param home the home the page's address is spelled under
 * @param slug the page's slug, its key
 * @param document the complete document, shell included
 * @param assets every other file its document loads, read by the publisher
 * @param frozenAt the instant this publish froze the document at
 * @returns the write, or a body claimed under two media types
 */
export function pageWrite({
  home,
  slug,
  document,
  assets,
  frozenAt,
}: {
  home: string;
  slug: string;
  document: string;
  assets: readonly { relativePath: string; bytes: Buffer }[];
  frozenAt: Date;
}): Result<PublishedPageWrite, readonly PublishedPagesImportError[]> {
  const files = [{ bytes: Buffer.from(document, "utf8"), relativePath: PAGE_FILENAME }, ...assets];
  const claims: BodyClaim[] = files.map(({ bytes, relativePath }) => ({
    bytes,
    mediaType: storedMediaType({ relativePath }),
    path: `${slug}/${relativePath}`,
    sha256: sha256Hex({ bytes }),
  }));
  const refusals: PublishedPagesImportError[] = [];
  const blobs = foldBodies({ claims, refusals });
  if (refusals.length > 0) {
    return err(refusals);
  }
  const documentSha256 = claims[0]!.sha256;
  const page: PlannedPage = {
    canonicalAddress: pathToFileURL(pagePath({ home, slug })).href,
    currentBodySha256: documentSha256,
    files: files.map((file, index) => ({ bodySha256: claims[index]!.sha256, relativePath: file.relativePath })),
    kind: "local",
    latestFrozenAt: frozenAt,
    latestFrozenBodySha256: documentSha256,
    pageKey: slug,
    publishedAt: frozenAt,
    versionSha256s: [documentSha256],
  };
  return ok({
    kind: "publish",
    plan: { blobs, counts: planCounts({ blobs, page }), pages: [page] },
    published: { bodySha256: documentSha256, frozenAt, pageKey: slug },
  });
}

/**
 * Plan one key's freeze: one version, and the key's latest pointer moved to it.
 *
 * @param key the freeze key, a local page's slug or a history with no page
 * @param document the exact bytes frozen
 * @param frozenAt the instant the freeze was taken
 * @param opensHistory whether a key the store holds no version of may be opened
 * @returns the write
 */
export function freezeWrite({
  key,
  document,
  frozenAt,
  opensHistory,
}: {
  key: string;
  document: string;
  frozenAt: Date;
  opensHistory: boolean;
}): PublishedPageWrite {
  const bytes = Buffer.from(document, "utf8");
  const sha256 = sha256Hex({ bytes });
  const blobs: readonly PlannedBlob[] = [{ byteLength: bytes.length, bytes, mediaType: FROZEN_MEDIA_TYPE, sha256 }];
  const page: PlannedPage = {
    canonicalAddress: null,
    currentBodySha256: null,
    files: [],
    kind: "history-only",
    latestFrozenAt: frozenAt,
    latestFrozenBodySha256: sha256,
    pageKey: key,
    publishedAt: null,
    versionSha256s: [sha256],
  };
  return {
    kind: "freeze",
    opensHistory,
    plan: { blobs, counts: planCounts({ blobs, page }), pages: [page] },
    published: { bodySha256: sha256, frozenAt, pageKey: key },
  };
}

/**
 * The report counts of a one-page plan.
 *
 * @param blobs its distinct bodies
 * @param page its one page
 * @returns the counts
 */
function planCounts({
  blobs,
  page,
}: {
  blobs: readonly PlannedBlob[];
  page: PlannedPage;
}): PublishedPagesPlan["counts"] {
  const local = page.kind === "local" ? 1 : 0;
  return {
    bytes: blobs.reduce((sum, blob) => sum + blob.byteLength, 0),
    distinctBodies: blobs.length,
    files: page.files.length,
    finderMetadataSkipped: 0,
    historiesWithoutPage: 1 - local,
    localPages: local,
    publishedAtFromFreeze: local,
    publishedAtFromModified: 0,
    unservedFiles: blobs.filter((blob) => blob.mediaType === UNSERVED_MEDIA_TYPE).length,
    versions: page.versionSha256s.length,
  };
}
