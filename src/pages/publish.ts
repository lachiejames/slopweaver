/**
 * PUBLISH ONE PAGE — build the document a reader opens, freeze its exact bytes, write both into the store, and answer
 * with the page's address.
 *
 * The rule: every session ends in ONE page the owner reacts to. This is the verb that makes that possible, and the
 * three things it does are the three
 * things the artifact publish used to do for free — supply the document shell, keep the bytes, hand back a
 * reachable address.
 *
 * ## The store is the only copy
 *
 * The owner's ruling (`docs/store/published-pages.md`, stage 6): a page lives in the store's Storage and
 * nowhere else. A publish writes NOTHING under `pages/` or `published-pages/`: the document, its new frozen version
 * and every file it loads go to the store in one write, through the injected `write`, and a failure there answers no
 * address. The address it answers, `file:///…/pages/<slug>/index.html`, is the page's IDENTITY — what a card, a board
 * row and a correction key it by — and no file exists there; the console and every verb read the store.
 *
 * ## The freeze is not optional, and it is why this is one function rather than two
 *
 * `../outbound/briefing/freezeStore.ts`'s header carries the finding: a page with no source bytes kept cost a
 * stamping run ~30 KB of hand-reconstructed HTML. So every publish's document IS its new frozen version, written in
 * the same act; a retry writes the same version and moves nothing backwards.
 *
 * ## Its files are read from where its publisher says
 *
 * Every file the document loads is read before the store is opened (`./pageAssets.ts`), from `--assets-from` or a
 * generated publisher's own list, and a page loading a file that is not there is refused, never stored broken.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { z } from "zod";

import { hatchFor } from "../hatch/lookup.js";
import { hatchRefusalLines } from "../hatch/render.js";
import { errorMessage } from "../lib/errorMessage.js";
import { sha256Text } from "../lib/hash.js";
import { err, ok, type Result } from "../lib/result.js";
import { stateHomePaths } from "../stateHome.js";
import { unsafePageAssets } from "./assets.js";
import { documentEscapes } from "./loadedFiles.js";
import { type PageAssetSource, type PreparedPageAsset, preparePageAssets } from "./pageAssets.js";
import { PagePublishErrors } from "./publishErrors.js";
import { wrapPageFragment } from "./shell.js";
import { isValidPageSlug, PAGE_FILENAME } from "./url.js";

/** The version one publish froze: its key, its digest and when. */
interface PublishedFreeze {
  /** The page's freeze key, its slug. */
  readonly key: string;
  /** `sha256:<hex>` of the document. */
  readonly sha256: string;
  /** When the freeze was taken. */
  readonly frozenIso: string;
}

/** What one publish produced: the page's identity, how to open it, and the version that was kept. */
export interface PublishedPage {
  /** The page's identity as a path. No file is there: the store holds the page. */
  readonly path: string;
  /** That identity as an address — what a card, a board row or a Slack reply links. */
  readonly url: string;
  /** The frozen version, so a later `briefing corrections` has bytes to diff against. */
  readonly frozen: PublishedFreeze;
  /** How many bytes the whole document came to, shell included. */
  readonly bytes: number;
}

/**
 * One slug's page identity as a path: `<home>/pages/<slug>/index.html`. It names the page; it is not a file anyone
 * writes or reads (stage 6 of `docs/store/published-pages.md`).
 *
 * @param home the state home the page belongs to
 * @param slug the page's own slug
 * @returns the identity path
 */
export function pagePath({ home, slug }: { home: string; slug: string }): string {
  return join(stateHomePaths({ home }).pages, slug, PAGE_FILENAME);
}

/** The ambient variable that opens the `page-external-local-asset` hatch for a whole process. */
const PAGE_EXTERNAL_LOCAL_ASSET_ENV = "SLOPWEAVER_ALLOW_PAGE_EXTERNAL_LOCAL_ASSET";

/** What one caller asks a publisher for — everything but where the store write goes. */
interface PublishPageRequest {
  /** The state home to publish under, which also selects the store. */
  readonly home: string;
  /** The page's slug, its identity and its freeze key. */
  readonly slug: string;
  /** The page as its author wrote it, with no document shell of its own. */
  readonly fragment: string;
  /** Generated HTML added AFTER the fragment — `page publish`'s review fold. */
  readonly appendix?: string;
  /** The instant the freeze is stamped with, supplied rather than read. */
  readonly nowIso: string;
  /** Opens the `page-external-local-asset` hatch for this call. */
  readonly allowExternalLocalAssets?: boolean;
  /** Where the files the page loads are read from; a page loading none needs none. */
  readonly assetSource?: PageAssetSource;
}

/** Writes one page's document, its frozen version and its files into the store, in one write. */
export type PageStoreWriter = (request: {
  readonly home: string;
  readonly slug: string;
  readonly document: string;
  readonly assets: readonly PreparedPageAsset[];
  readonly frozenAt: Date;
  readonly importedAt: Date;
}) => Promise<Result<void>>;

/** Publishes one page: the shape every caller injects, so a test passes a fake and production the store-bound one. */
export type PagePublisher = (request: PublishPageRequest) => Promise<Result<PublishedPage>>;

/** A freeze instant the store accepts. */
const FREEZE_INSTANT = z.iso.datetime({ offset: true });

/**
 * Build one authored fragment into a complete page, read the files it loads, write it all into the store, and answer
 * with its address.
 *
 * The fragment reaches the store byte-for-byte inside the shell; nothing here trims, reformats or re-encodes it.
 * Republishing the same slug replaces the page's document and files and adds one frozen version — or, when the bytes
 * are identical to a version already held, keeps that version and moves the page's pointer to this freeze.
 *
 * @param home the state home to publish under, which also selects the store
 * @param slug the page's slug, its identity and its freeze key
 * @param fragment the page as its author wrote it, with no document shell of its own
 * @param appendix generated HTML the verb adds AFTER the fragment — `page publish`'s review fold — so the fragment
 *   stays a byte-for-byte prefix and the freeze still holds the whole document the owner opened; machine callers omit it
 * @param nowIso the instant the freeze is stamped with, supplied rather than read
 * @param allowExternalLocalAssets opens the `page-external-local-asset` hatch for this call, as
 *   `SLOPWEAVER_ALLOW_PAGE_EXTERNAL_LOCAL_ASSET=1` does for the process
 * @param assetSource where the files the page loads are read from
 * @param write writes the page into the store — called only once every file it loads is read
 * @returns the page's identity, address and frozen version, or why it was not published — nothing is written on disk
 *   either way, and a store write that fails answers no address
 */
export async function publishPage({
  home,
  slug,
  fragment,
  appendix,
  nowIso,
  allowExternalLocalAssets,
  assetSource,
  write,
}: PublishPageRequest & { write: PageStoreWriter }): Promise<Result<PublishedPage>> {
  if (!isValidPageSlug({ slug })) {
    return err([
      `"${slug}" cannot be a page slug: it names the page in its address, so it must start with a letter or digit ` +
        "and carry only letters, digits, dot, dash or underscore.",
    ]);
  }
  if (!FREEZE_INSTANT.safeParse(nowIso).success) {
    return err([PagePublishErrors.instantInvalid({ nowIso }).message]);
  }
  // A caller may only ever ADD to the hatch, never close one the operator opened (`hatch-release`).
  const hatchOpen = process.env[PAGE_EXTERNAL_LOCAL_ASSET_ENV] === "1" || allowExternalLocalAssets === true;
  const html = wrapPageFragment({ fragment: appendix === undefined ? fragment : `${fragment}${appendix}` });
  const unloadable = hatchOpen ? [] : unloadableReferences({ fragment, html, slug });
  if (unloadable.length > 0) {
    return err(
      hatchRefusalLines({
        detail: `${String(unloadable.length)} in this page: ${unloadable.join("; ")}; link each relatively and name its directory with --assets-from`,
        hatch: hatchFor({ id: "page-external-local-asset" }),
      }),
    );
  }
  const assets = await preparePageAssets({ document: html, slug, source: assetSource });
  if (assets.isErr()) {
    return err(assets.error.map((error) => error.message));
  }
  const frozenAt = new Date(nowIso);
  const written = await write({ assets: assets.value, document: html, frozenAt, home, importedAt: frozenAt, slug });
  if (written.isErr()) {
    return err([PagePublishErrors.storeUnconfirmed({ slug }).message, ...written.error]);
  }
  const path = pagePath({ home, slug });
  return ok({
    bytes: Buffer.byteLength(html),
    frozen: { frozenIso: nowIso, key: slug, sha256: sha256Text({ text: html }) },
    path,
    url: pathToFileURL(path).href,
  });
}

/**
 * Every reference the console could never load, named for the refusal: what the fragment wrote as a `file:`,
 * absolute or climbing path, then what the document's `<base href>` resolves outside the page.
 *
 * @param fragment the page as its author wrote it
 * @param html the complete document, whose base the second check resolves through
 * @param slug the page's slug
 * @returns each reference with why, empty when the page loads whole
 */
function unloadableReferences({ fragment, html, slug }: { fragment: string; html: string; slug: string }): string[] {
  const written = unsafePageAssets({ fragment });
  const named = new Set(written.map((asset) => asset.reference));
  return [
    ...written.map((asset) => `${asset.reference} (${asset.kind}, ${asset.source})`),
    ...documentEscapes({ document: html, slug })
      .filter((reference) => !named.has(reference))
      .map((reference) => `${reference} (resolves outside the page)`),
  ];
}

/**
 * Read one authored fragment off disk.
 *
 * Separated from {@link publishPage} so the publisher itself takes the bytes rather than a path — which is
 * what lets a test publish a fragment it holds in memory without inventing a file, and what keeps the
 * read's own failure named as a read rather than as a publish.
 *
 * @param path the fragment file to read
 * @returns its contents, or why they could not be read
 */
export function readPageFragment({ path }: { path: string }): Result<string> {
  try {
    return ok(readFileSync(path, "utf8"));
  } catch (error: unknown) {
    return err([`could not read the page at ${path}: ${errorMessage({ error })}`]);
  }
}
