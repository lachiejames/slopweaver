/**
 * The pure half of `store pages-import`: turn what `scan.ts` read into the exact rows and bodies the store will
 * hold, or refuse the whole import before anything is uploaded or written.
 *
 * ## A page and its history join on the slug
 *
 * A local page's freeze key IS its slug (`artifactKey`, `../../outbound/briefing/freezeStore.ts`), so
 * `pages/<slug>/` and `published-pages/<slug>/` are one page. A page folder with no history is still a page — a
 * folder can hold a page its freeze never reached — and a history with no page is a `history-only`. A publish today
 * writes neither folder (`./writePlan.ts`); this projection reads the folders a home already has.
 *
 * ## The pointer's `path` is never read
 *
 * `latest.json` carries an absolute `path` the freeze store once wrote. It is untrusted and may name another home,
 * so the frozen version is found by key and hash alone, `<key>/<sha256 hex>.html`, and every version's bytes are
 * hashed against the name they were frozen under.
 *
 * ## When a page was published
 *
 * The pointer's `frozenIso` when the page on disk IS the latest freeze, since that is the instant those bytes were
 * published; otherwise the file's own modification time, because a page written and not yet frozen has no other
 * record of when. The report counts how many took each.
 */
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { z } from "zod";

import { parseJson } from "#lib/jsonParse.js";
import { err, ok, type Result } from "#lib/result.js";

import { pagePath } from "../../pages/publish.js";
import { stateHomePaths } from "../../stateHome.js";
import { type BodyClaim, foldBodies, storedMediaType } from "./bodies.js";
import { type PublishedPagesImportError, PublishedPagesImportErrors } from "./errors.js";
import { UNSERVED_MEDIA_TYPE } from "./mediaType.js";
import type { PublishedPagesScan, ScannedDirectory, ScannedFile } from "./scan.js";

/** The page document's file name. */
const INDEX_FILE = "index.html";

/** The freeze store's pointer file. */
const LATEST_FILE = "latest.json";

/** A frozen version's file name: its own digest. */
const VERSION_FILE = /^([0-9a-f]{64})\.html$/u;

/** What a frozen version is stored as. */
const FROZEN_MEDIA_TYPE = "text/html";

/** The pointer the freeze store writes; `path` is required to be there and is never used. */
const latestPointerSchema = z.object({
  frozenIso: z.iso.datetime({ offset: true }),
  key: z.string(),
  path: z.string(),
  sha256: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
});

/** One distinct body the store will hold. */
export interface PlannedBlob {
  readonly sha256: string;
  readonly byteLength: number;
  readonly mediaType: string;
  readonly bytes: Buffer;
}

/** One `published_page` row and everything that hangs off it. */
export interface PlannedPage {
  readonly pageKey: string;
  readonly kind: "history-only" | "local";
  readonly canonicalAddress: string | null;
  readonly currentBodySha256: string | null;
  readonly latestFrozenBodySha256: string | null;
  readonly latestFrozenAt: Date | null;
  readonly publishedAt: Date | null;
  /** Every file the page serves, `index.html` included; empty for a history with no page. */
  readonly files: readonly { relativePath: string; bodySha256: string }[];
  /** Every frozen version's digest. */
  readonly versionSha256s: readonly string[];
}

/** What the folders hold, counted for the report. */
export interface PublishedPagesCounts {
  readonly localPages: number;
  readonly historiesWithoutPage: number;
  readonly files: number;
  readonly versions: number;
  readonly distinctBodies: number;
  readonly bytes: number;
  readonly publishedAtFromFreeze: number;
  readonly publishedAtFromModified: number;
  /** Files no reader serves, carried as opaque bytes. */
  readonly unservedFiles: number;
  readonly finderMetadataSkipped: number;
}

/** Everything an import will write. */
export interface PublishedPagesPlan {
  readonly blobs: readonly PlannedBlob[];
  readonly pages: readonly PlannedPage[];
  readonly counts: PublishedPagesCounts;
}

type ProjectResult<T> = Result<T, PublishedPagesImportError>;

/** One history directory, checked. */
interface ProjectedHistory {
  readonly key: string;
  readonly latest: { readonly sha256: string; readonly frozenAt: Date };
  readonly versions: readonly ScannedFile[];
}

/**
 * Project both folders into the rows and bodies an import writes, naming every defect rather than the first.
 *
 * @param home the home both folders sit under, which every canonical address and refusal path is spelled from
 * @param scan what `scanPublishedPageSources` read
 * @returns the plan, or every refusal
 */
export function projectPublishedPages({
  home,
  scan,
}: {
  home: string;
  scan: PublishedPagesScan;
}): Result<PublishedPagesPlan, readonly PublishedPagesImportError[]> {
  const roots = stateHomePaths({ home });
  const refusals: PublishedPagesImportError[] = [];
  const histories = new Map<string, ProjectedHistory>();
  for (const directory of scan.histories) {
    projectHistory({ directory, root: roots.publishedPages }).match(
      (history) => histories.set(history.key, history),
      (refusal) => refusals.push(refusal),
    );
  }
  const pages: PlannedPage[] = [];
  const claims: BodyClaim[] = [];
  for (const directory of scan.pages) {
    projectLocalPage({ directory, history: histories.get(directory.name), home }).match(
      (page) => {
        pages.push(page.page);
        claims.push(...page.claims);
      },
      (refusal) => refusals.push(refusal),
    );
  }
  const local = new Set(scan.pages.map((directory) => directory.name));
  for (const history of histories.values()) {
    claims.push(...versionClaims({ history, root: roots.publishedPages }));
    if (!local.has(history.key)) {
      pages.push(historyOnlyPage({ history }));
    }
  }
  const blobs = foldBodies({ claims, refusals });
  if (refusals.length > 0) {
    return err(refusals);
  }
  return ok({
    blobs,
    counts: countPlan({ blobs, claims, finderMetadataSkipped: scan.finderMetadataSkipped, pages }),
    pages: pages.toSorted((a, b) => a.pageKey.localeCompare(b.pageKey)),
  });
}

/**
 * One `published-pages/<key>/` directory: a pointer and the flat set of versions it points among.
 *
 * @param directory the scanned directory
 * @param root the absolute `published-pages` folder, for refusal paths
 * @returns the checked history, or a refusal
 */
function projectHistory({
  directory,
  root,
}: {
  directory: ScannedDirectory;
  root: string;
}): ProjectResult<ProjectedHistory> {
  const at = `${root}/${directory.name}`;
  if (directory.files.length === 0) {
    return err(PublishedPagesImportErrors.historyEmpty({ path: at }));
  }
  const versions: ScannedFile[] = [];
  let pointer: ScannedFile | undefined;
  for (const file of directory.files) {
    const path = `${at}/${file.relativePath}`;
    if (file.relativePath === LATEST_FILE) {
      pointer = file;
      continue;
    }
    const digest = VERSION_FILE.exec(file.relativePath)?.[1];
    if (digest === undefined) {
      return err(PublishedPagesImportErrors.versionNameInvalid({ path }));
    }
    if (digest !== file.sha256) {
      return err(PublishedPagesImportErrors.versionDigestMismatch({ actual: file.sha256, path }));
    }
    versions.push(file);
  }
  if (pointer === undefined) {
    return err(PublishedPagesImportErrors.latestMissing({ path: at }));
  }
  const latest = parseLatestPointer({ bytes: pointer.bytes, key: directory.name, path: `${at}/${LATEST_FILE}` });
  if (latest.isErr()) {
    return err(latest.error);
  }
  if (!versions.some((version) => version.sha256 === latest.value.sha256)) {
    return err(PublishedPagesImportErrors.latestVersionMissing({ path: at, sha256: latest.value.sha256 }));
  }
  return ok({ key: directory.name, latest: latest.value, versions });
}

/**
 * Read a `latest.json`, keeping its digest and instant and refusing one that names another key.
 *
 * @param bytes the pointer's bytes
 * @param key the directory it sits in, which it must name
 * @param path where it is, for the refusal
 * @returns the digest it points at and when that freeze was taken, or a refusal
 */
function parseLatestPointer({
  bytes,
  key,
  path,
}: {
  bytes: Buffer;
  key: string;
  path: string;
}): ProjectResult<{ sha256: string; frozenAt: Date }> {
  const json = parseJson({ text: bytes.toString("utf8") });
  if (json.isErr()) {
    return err(PublishedPagesImportErrors.latestInvalid({ path, reason: json.error.message }));
  }
  const parsed = latestPointerSchema.safeParse(json.value);
  if (!parsed.success) {
    return err(PublishedPagesImportErrors.latestInvalid({ path, reason: parsed.error.issues[0]!.message }));
  }
  if (parsed.data.key !== key) {
    return err(PublishedPagesImportErrors.latestInvalid({ path, reason: `it names key ${parsed.data.key}` }));
  }
  return ok({ frozenAt: new Date(parsed.data.frozenIso), sha256: parsed.data.sha256.slice("sha256:".length) });
}

/**
 * One `pages/<slug>/` directory as a local page, with the bodies its files claim.
 *
 * @param directory the scanned page directory
 * @param history the same slug's checked history, when it has one
 * @param home the home its canonical address is spelled under
 * @returns the page and its claims, or a refusal
 */
function projectLocalPage({
  directory,
  history,
  home,
}: {
  directory: ScannedDirectory;
  history: ProjectedHistory | undefined;
  home: string;
}): ProjectResult<{ page: PlannedPage; claims: readonly BodyClaim[] }> {
  const at = join(stateHomePaths({ home }).pages, directory.name);
  const index = directory.files.find((file) => file.relativePath === INDEX_FILE);
  if (index === undefined) {
    return err(PublishedPagesImportErrors.indexMissing({ path: at }));
  }
  const claims = directory.files.map((file) => ({
    bytes: file.bytes,
    mediaType: storedMediaType({ relativePath: file.relativePath }),
    path: `${at}/${file.relativePath}`,
    sha256: file.sha256,
  }));
  const fromFreeze = history !== undefined && history.latest.sha256 === index.sha256;
  return ok({
    claims,
    page: {
      canonicalAddress: pathToFileURL(pagePath({ home, slug: directory.name })).href,
      currentBodySha256: index.sha256,
      files: directory.files.map((file) => ({ bodySha256: file.sha256, relativePath: file.relativePath })),
      kind: "local",
      latestFrozenAt: history === undefined ? null : history.latest.frozenAt,
      latestFrozenBodySha256: history === undefined ? null : history.latest.sha256,
      pageKey: directory.name,
      publishedAt: fromFreeze ? history.latest.frozenAt : index.modifiedAt,
      versionSha256s: history === undefined ? [] : history.versions.map((version) => version.sha256),
    },
  });
}

/**
 * A history whose page is gone: versions and a latest pointer, nothing a reader opens.
 *
 * @param history the checked history
 * @returns its page row
 */
function historyOnlyPage({ history }: { history: ProjectedHistory }): PlannedPage {
  return {
    canonicalAddress: null,
    currentBodySha256: null,
    files: [],
    kind: "history-only",
    latestFrozenAt: history.latest.frozenAt,
    latestFrozenBodySha256: history.latest.sha256,
    pageKey: history.key,
    publishedAt: null,
    versionSha256s: history.versions.map((version) => version.sha256),
  };
}

/**
 * The bodies a history's versions claim, every one an HTML document.
 *
 * @param history the checked history
 * @param root the absolute `published-pages` folder, for conflict paths
 * @returns one claim per version
 */
function versionClaims({ history, root }: { history: ProjectedHistory; root: string }): readonly BodyClaim[] {
  return history.versions.map((file) => ({
    bytes: file.bytes,
    mediaType: FROZEN_MEDIA_TYPE,
    path: `${root}/${history.key}/${file.relativePath}`,
    sha256: file.sha256,
  }));
}

/**
 * The report's counts.
 *
 * @param blobs the distinct bodies
 * @param claims every file's claim
 * @param pages every planned page
 * @param finderMetadataSkipped the scan's skip count
 * @returns the counts
 */
function countPlan({
  blobs,
  claims,
  pages,
  finderMetadataSkipped,
}: {
  blobs: readonly PlannedBlob[];
  claims: readonly BodyClaim[];
  pages: readonly PlannedPage[];
  finderMetadataSkipped: number;
}): PublishedPagesCounts {
  const local = pages.filter((page) => page.kind === "local");
  const fromFreeze = local.filter(
    (page) => page.latestFrozenBodySha256 !== null && page.latestFrozenBodySha256 === page.currentBodySha256,
  ).length;
  return {
    bytes: blobs.reduce((sum, blob) => sum + blob.byteLength, 0),
    distinctBodies: blobs.length,
    files: local.reduce((sum, page) => sum + page.files.length, 0),
    finderMetadataSkipped,
    historiesWithoutPage: pages.length - local.length,
    localPages: local.length,
    publishedAtFromFreeze: fromFreeze,
    publishedAtFromModified: local.length - fromFreeze,
    unservedFiles: claims.filter((claim) => claim.mediaType === UNSERVED_MEDIA_TYPE).length,
    versions: pages.reduce((sum, page) => sum + page.versionSha256s.length, 0),
  };
}
