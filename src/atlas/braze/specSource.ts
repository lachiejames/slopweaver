/**
 * Getting Braze's two published documents onto disk, and reading the reference without re-downloading it
 * every run.
 *
 * ## The cache holds the EXTRACTED rows, not the pages
 *
 * MEASURED: the 146 operation pages are about 390 KB of HTML each — roughly 57 MB for one pass.
 * Caching those bytes would put a Microsoft-Graph-sized document on disk to describe an API a hundredth its
 * size, and nothing would ever read the markup again. So a page is parsed once and only its row is kept,
 * keyed by the URL and the `lastmod` the sitemap gave it. A page Braze republishes gets a new `lastmod` and
 * is re-fetched; one it has not touched is never fetched again. A declared page Braze redirects off the
 * operation tree is the one exception: it has no row to keep, so it is never cached and every run asks
 * again until Braze publishes it (`docsCatalogue.ts` carries that measurement).
 *
 * That makes the cache a FRESHNESS cache, which is exactly what `microsoft365/specSource.ts` says its own
 * cache deliberately is not — and the difference is the sources, not a change of mind. That pin is immutable,
 * so a digest settles everything and an expiry could add nothing. These documents move, so there is no digest
 * to settle anything with and the vendor's own modification instant is the only honest key available.
 *
 * ## Why this is not routed through the admit door
 *
 * The door governs the doored providers (`AGENTS.md` rule 3) and writes to a person's account. This reads two
 * public documents and writes only under `$SLOPWEAVER_HOME`, so it is `local-state` rather than
 * `external-write` — the same posture every other atlas sync takes.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

import { err, ok, type Result } from "../../lib/result.js";
import { safeJsonParse, safeJsonStringify } from "../../lib/safeJson.js";
import { writeFileAtomic } from "../../lib/writeAtomic.js";

import {
  type BrazeDocsOperationRow,
  type BrazeSitemapEntry,
  brazeDocsOperationRowSchema,
  brazeFamilyOf,
  brazeOperationPages,
  isBrazeOperationPage,
  readBrazeOperationPage,
  readBrazeSitemap,
} from "./docsCatalogue.js";
import { BrazeAtlasErrors, brazeAtlasErrorLines } from "./errors.js";
import { BRAZE_KINDS, type BrazeKind } from "./model.js";
import { BRAZE_COLLECTION_URL, BRAZE_SITEMAP_URL } from "./specLock.js";

/** How long any one document may take. Generous: the collection is a little over half a megabyte. */
const FETCH_TIMEOUT_MS = 120_000;

/** The cache layout version. Bumping it discards every cached row rather than migrating one. */
const CACHE_VERSION = 1;

/**
 * The HTTP seam. Injected so every branch below is reachable without a network call.
 *
 * @internal
 */
// named-object-params-exempt: must match the real global fetch's positional shape to be substitutable for it
export type BrazeFetchLike = (
  url: string,
  init: { redirect: "follow"; signal: AbortSignal },
) => Promise<{ ok: boolean; status: number; url: string; text: () => Promise<string> }>;

/** One operation page the sitemap declares and Braze redirects off the operation tree. */
export interface BrazeUnservedPage {
  /** The address the sitemap declared. */
  readonly url: string;
  /** Where Braze sent it — today, the family's own index page. */
  readonly servedAs: string;
}

/** One successful GET: the body, and where the request settled after any redirect. */
interface BrazeFetchedText {
  readonly text: string;
  readonly url: string;
}

/**
 * What one read of the reference produced.
 *
 * @internal
 */
export interface BrazeDocsSurface {
  readonly rows: readonly BrazeDocsOperationRow[];
  /** Pages whose row came from the cache because Braze has not republished them. */
  readonly fromCache: number;
  /** Pages fetched this run, unserved ones included. */
  readonly fetched: number;
  /** Operation pages the sitemap declared. */
  readonly declaredPages: number;
  /** Declared pages Braze actually serves at an operation address — what every row is owed against. */
  readonly servedPages: number;
  /** Declared pages Braze redirects off the operation tree, in sitemap order. */
  readonly unservedPages: readonly BrazeUnservedPage[];
  /** Families the sitemap declared that this build has no kind for. */
  readonly unknownFamilies: readonly string[];
}

/**
 * Where the extracted rows are cached.
 *
 * @param root the atlas's own directory under `$SLOPWEAVER_HOME`
 * @returns the absolute path
 *
 * @internal
 */
export function brazeDocsCachePath({ root }: { root: string }): string {
  return join(root, "_cache", "docs-operations.json");
}

/**
 * Read Braze's reference: the sitemap, then every operation page it declares.
 *
 * @param root the atlas's own directory, under which the row cache lives
 * @param fetchImpl the HTTP seam; omitted takes the platform `fetch`
 * @returns every operation the reference declares, or why it could not be read
 */
export async function loadBrazeDocsSurface({
  root,
  fetchImpl: http = globalThis.fetch,
}: {
  root: string;
  fetchImpl?: BrazeFetchLike;
}): Promise<Result<BrazeDocsSurface>> {
  const sitemap = await fetchText({ fetchImpl: http, label: "Braze documentation sitemap", url: BRAZE_SITEMAP_URL });
  if (sitemap.isErr()) {
    return err(sitemap.error);
  }
  const pages = brazeOperationPages({ entries: readBrazeSitemap({ xml: sitemap.value.text }) });
  if (pages.length === 0) {
    return err(
      brazeAtlasErrorLines({ error: BrazeAtlasErrors.sitemapEmpty({ characters: sitemap.value.text.length }) }),
    );
  }
  const cache = readCache({ path: brazeDocsCachePath({ root }) });
  const unknownFamilies = new Set<string>();
  const reads: PageRead[] = [];
  for (const page of pages) {
    const read = await readOperationPage({ cache, fetchImpl: http, page, unknownFamilies });
    if (read.isErr()) {
      return err(read.error);
    }
    reads.push(read.value);
  }
  const { next, surface } = summariseReads({ declaredPages: pages.length, reads, unknownFamilies });
  writeCache({ entries: next, path: brazeDocsCachePath({ root }) });
  return ok(surface);
}

/** What reading one declared operation page settled as. */
type PageRead =
  | { readonly kind: "row"; readonly url: string; readonly entry: CachedPage; readonly fetched: boolean }
  | { readonly kind: "unserved"; readonly page: BrazeUnservedPage }
  | { readonly kind: "skipped"; readonly fetched: boolean };

/** Read one declared page: its cached row while Braze has not republished it, else a fetch judged in full. */
async function readOperationPage({
  cache,
  fetchImpl,
  page,
  unknownFamilies,
}: {
  cache: ReadonlyMap<string, CachedPage>;
  fetchImpl: BrazeFetchLike;
  page: BrazeSitemapEntry;
  unknownFamilies: Set<string>;
}): Promise<Result<PageRead>> {
  const held = cache.get(page.url);
  if (held !== undefined && held.lastModified === page.lastModified) {
    if (kindOf({ page, unknownFamilies }) === null) {
      return ok({ fetched: false, kind: "skipped" });
    }
    return ok({ entry: held, fetched: false, kind: "row", url: page.url });
  }
  const html = await fetchText({ fetchImpl, label: `Braze endpoint page ${page.url}`, url: page.url });
  if (html.isErr()) {
    return err(html.error);
  }
  // The family is the SITEMAP's declaration, so it is judged whether or not Braze serves the page: an
  // unknown family still refuses the sync even when its only page redirects.
  const kind = kindOf({ page, unknownFamilies });
  // Asked BEFORE the markup, and before an unknown kind is skipped, so every fetched page that settled off
  // the tree is reported: a page redirected off the operation tree is a declaration Braze does not serve
  // yet, and reading its family index as the operation would be refused as a template change that never
  // happened. Never cached, so the next run asks again.
  const settledOffTree = html.value.url !== page.url && !isBrazeOperationPage({ url: html.value.url });
  if (settledOffTree) {
    return ok({ kind: "unserved", page: { servedAs: html.value.url, url: page.url } });
  }
  if (kind === null) {
    return ok({ fetched: true, kind: "skipped" });
  }
  const row = readBrazeOperationPage({ html: html.value.text, kind, lastModified: page.lastModified, url: page.url });
  if (row.isErr()) {
    return err(row.error);
  }
  return ok({ entry: { lastModified: page.lastModified, row: row.value }, fetched: true, kind: "row", url: page.url });
}

/** Fold every page's read into the surface and the next cache, in sitemap order. Pure. */
function summariseReads({
  declaredPages,
  reads,
  unknownFamilies,
}: {
  declaredPages: number;
  reads: readonly PageRead[];
  unknownFamilies: ReadonlySet<string>;
}): { next: Map<string, CachedPage>; surface: BrazeDocsSurface } {
  const rows: BrazeDocsOperationRow[] = [];
  const next = new Map<string, CachedPage>();
  const unservedPages: BrazeUnservedPage[] = [];
  let fromCache = 0;
  let fetched = 0;
  for (const read of reads) {
    if (read.kind === "unserved") {
      unservedPages.push(read.page);
      fetched += 1;
      continue;
    }
    fetched += read.fetched ? 1 : 0;
    if (read.kind === "row") {
      rows.push(read.entry.row);
      next.set(read.url, read.entry);
      fromCache += read.fetched ? 0 : 1;
    }
  }
  // A sitemap may declare one address twice; once any fetch of it came back unserved, no occurrence is kept.
  for (const { url } of unservedPages) {
    next.delete(url);
  }
  const surface: BrazeDocsSurface = {
    declaredPages,
    fetched,
    fromCache,
    rows,
    servedPages: declaredPages - unservedPages.length,
    unknownFamilies: [...unknownFamilies].toSorted(),
    unservedPages,
  };
  return { next, surface };
}

/**
 * Fetch the official Postman collection.
 *
 * @param fetchImpl the HTTP seam; omitted takes the platform `fetch`
 * @returns the collection document, as UTF-8, or why it could not be fetched
 */
export async function loadBrazeCollectionText({
  fetchImpl = globalThis.fetch,
}: {
  fetchImpl?: BrazeFetchLike;
} = {}): Promise<Result<string>> {
  const fetched = await fetchText({
    fetchImpl,
    label: "Braze Postman collection",
    url: BRAZE_COLLECTION_URL,
  });
  return fetched.map(({ text }) => text);
}

/** Which kind a page's family maps to, recording a family this build has no kind for. */
function kindOf({
  page,
  unknownFamilies,
}: {
  page: BrazeSitemapEntry;
  unknownFamilies: Set<string>;
}): BrazeKind | null {
  const family = brazeFamilyOf({ url: page.url });
  if (family === null) {
    return null;
  }
  const known = BRAZE_KINDS.find((kind) => kind === family);
  if (known === undefined) {
    unknownFamilies.add(family);
    return null;
  }
  return known;
}

/**
 * The cache document, validated rather than asserted.
 *
 * Disk is a parse boundary: a cache written by an older build, hand-edited, or truncated must not flow into a
 * published generation. A failure here is not an error — {@link readCache} treats an unreadable cache as an
 * empty one, which costs a re-fetch and nothing else.
 */
const cacheDocumentSchema = z
  .object({
    pages: z.record(
      z.string(),
      z.object({ lastModified: z.string().min(1), row: brazeDocsOperationRowSchema }).strict(),
    ),
    version: z.number().int(),
  })
  .strict();

/** One cached page: the instant Braze last changed it, and the row read from it. */
interface CachedPage {
  readonly lastModified: string;
  readonly row: BrazeDocsOperationRow;
}

/**
 * Read the row cache, treating anything unreadable as an empty cache.
 *
 * A cache is a convenience and never a source of truth: a corrupt one costs a re-fetch, and failing the whole
 * verb over it would make an optimisation into a liability.
 */
function readCache({ path }: { path: string }): Map<string, CachedPage> {
  const empty = new Map<string, CachedPage>();
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return empty;
  }
  let parsed: unknown;
  try {
    parsed = safeJsonParse({ label: "the Braze documentation row cache", text });
  } catch {
    return empty;
  }
  const document = cacheDocumentSchema.safeParse(parsed);
  if (!document.success || document.data.version !== CACHE_VERSION) {
    return empty;
  }
  for (const [url, page] of Object.entries(document.data.pages)) {
    empty.set(url, { lastModified: page.lastModified, row: page.row });
  }
  return empty;
}

/** Write the row cache atomically. A failure here is silent by design — see {@link readCache}. */
function writeCache({ entries, path }: { entries: ReadonlyMap<string, CachedPage>; path: string }): void {
  try {
    writeFileAtomic({
      contents: safeJsonStringify({
        label: "the Braze documentation row cache",
        value: { pages: Object.fromEntries(entries), version: CACHE_VERSION },
      }),
      fileMode: 0o600,
      path,
    });
  } catch {
    // A cache that cannot be written costs the next run a re-fetch and nothing else.
  }
}

/** One GET, bounded by a timeout, of an address no caller supplied — the body and where it settled. */
async function fetchText({
  fetchImpl,
  url,
  label,
}: {
  fetchImpl: BrazeFetchLike;
  url: string;
  label: string;
}): Promise<Result<BrazeFetchedText>> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, FETCH_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, { redirect: "follow", signal: controller.signal });
    if (!response.ok) {
      return err(
        brazeAtlasErrorLines({ error: BrazeAtlasErrors.fetchRefused({ label, status: response.status, url }) }),
      );
    }
    return ok({ text: await response.text(), url: response.url });
  } catch (cause: unknown) {
    return err(brazeAtlasErrorLines({ error: BrazeAtlasErrors.fetchFailed({ cause, label }) }));
  } finally {
    clearTimeout(timer);
  }
}
