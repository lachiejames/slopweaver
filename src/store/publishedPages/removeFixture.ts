/**
 * Take ONE desktop end-to-end fixture page back out of the store, rows only. A walk publishes its fixture through the
 * real publisher (`../../desktop/e2ePageFixtureStore.ts`), so the store holds a page, its file and its version that
 * would otherwise outlive the walk; this removes exactly those. What makes a row the walk's own, and the residue, is
 * `./removeFixtureVerdict.ts`.
 *
 * Deliberately not a verb, and deliberately narrow, because deleting a published page and its history is otherwise
 * something nothing in this repository does. It refuses before opening anything unless the slug is a fixture's, and
 * inside the page's own publish lock it refuses unless every row under the slug is exactly the walk's own page, so a
 * real page can never be taken by a slug that merely looks like one.
 *
 * The body row and its object are KEPT. The fixture's bytes are the same on every walk, so that is one bounded body,
 * and deleting it could race another walk's publish, which uploads the object before its rows commit.
 */
import { pathToFileURL } from "node:url";

import { and, eq, sql } from "drizzle-orm";

import { err, type Result } from "#lib/result.js";

import { isE2ePageFixtureSlug } from "../../desktop/e2eFixture.js";
import { pagePath } from "../../pages/publish.js";
import { PAGE_FILENAME } from "../../pages/url.js";
import { connectStore, type StoreClient } from "../client.js";
import { StoreErrors } from "../errors.js";
import {
  publishedPageAliasTable,
  publishedPageFileTable,
  publishedPageTable,
  publishedPageVersionTable,
} from "../schema/publishedPages.js";
import { withStoreConnection } from "../withConnection.js";

import { type PublishedPageFixtureRemovalError, PublishedPageFixtureRemovalErrors } from "./removeFixtureErrors.js";
import { type FixturePin, type FixtureRows, fixtureRemovalVerdict, PUBLISHED_ORIGIN } from "./removeFixtureVerdict.js";

/** A lower-case hex sha-256. */
const SHA256_HEX = /^[0-9a-f]{64}$/u;

/** One open transaction on the store. */
type StoreTransaction = Parameters<Parameters<StoreClient["db"]["transaction"]>[0]>[0];

/** Thrown inside the transaction to roll every delete back when the slug turned out to hold more than the fixture. */
class LeftWhole extends Error {
  /** The refusal the caller answers once the transaction has rolled back. */
  readonly failure: PublishedPageFixtureRemovalError;

  /**
   * @param failure the refusal the caller answers once the transaction has rolled back
   */
  constructor({ failure }: { failure: PublishedPageFixtureRemovalError }) {
    super(failure.message);
    this.failure = failure;
  }
}

/**
 * Read a fixture's rows inside its page lock, with the page row itself locked so an import's upsert of it waits.
 *
 * @param tx the open transaction
 * @param slug the fixture's slug
 * @returns what the slug holds
 */
async function readLockedRows({ tx, slug }: { tx: StoreTransaction; slug: string }): Promise<FixtureRows> {
  // The lock every publish of this slug takes (`./importRows.ts`), so a publish landing mid-check waits.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`slopweaver:published-page:${slug}`}))`);
  // An import takes no advisory lock, so the page row is locked too: its upsert of the page waits for this commit.
  const [page] = await tx
    .select({
      canonicalAddress: publishedPageTable.canonicalAddress,
      currentBodySha256: publishedPageTable.currentBodySha256,
      kind: publishedPageTable.kind,
      latestFrozenAt: publishedPageTable.latestFrozenAt,
      latestFrozenBodySha256: publishedPageTable.latestFrozenBodySha256,
      publishedAt: publishedPageTable.publishedAt,
    })
    .from(publishedPageTable)
    .where(eq(publishedPageTable.pageKey, slug))
    .for("update");
  const files = await tx
    .select({ bodySha256: publishedPageFileTable.bodySha256, relativePath: publishedPageFileTable.relativePath })
    .from(publishedPageFileTable)
    .where(eq(publishedPageFileTable.pageKey, slug));
  const versions = await tx
    .select({
      bodySha256: publishedPageVersionTable.bodySha256,
      firstFrozenAt: publishedPageVersionTable.firstFrozenAt,
      origin: publishedPageVersionTable.origin,
    })
    .from(publishedPageVersionTable)
    .where(eq(publishedPageVersionTable.pageKey, slug));
  const aliases = await tx
    .select({ address: publishedPageAliasTable.address })
    .from(publishedPageAliasTable)
    .where(eq(publishedPageAliasTable.pageKey, slug));
  return { aliases, files, page, versions };
}

/**
 * Delete only rows carrying the fixture's digest, and the page only while it still carries every pinned field, then
 * refuse — rolling all of it back — when anything else is still under the slug. An import commits between statements
 * of this transaction without the advisory lock, so a row it added after
 * the check is never deleted: it is found here instead.
 *
 * @param tx the open transaction
 * @param slug the fixture's slug
 * @param pin what the walk's own publish left
 */
async function deleteExactlyTheFixture({
  tx,
  slug,
  pin,
}: {
  tx: StoreTransaction;
  slug: string;
  pin: FixturePin;
}): Promise<void> {
  const file = publishedPageFileTable;
  const version = publishedPageVersionTable;
  await tx
    .delete(file)
    .where(and(eq(file.pageKey, slug), eq(file.relativePath, PAGE_FILENAME), eq(file.bodySha256, pin.bodySha256)));
  await tx
    .delete(version)
    .where(
      and(
        eq(version.pageKey, slug),
        eq(version.bodySha256, pin.bodySha256),
        eq(version.origin, PUBLISHED_ORIGIN),
        eq(version.firstFrozenAt, new Date(pin.frozenAtIso)),
      ),
    );
  const leftFiles = await tx.select({ path: file.relativePath }).from(file).where(eq(file.pageKey, slug));
  const leftVersions = await tx.select({ sha: version.bodySha256 }).from(version).where(eq(version.pageKey, slug));
  const page = publishedPageTable;
  const removed = await tx
    .delete(page)
    .where(
      and(
        eq(page.pageKey, slug),
        eq(page.canonicalAddress, pin.canonicalAddress),
        eq(page.currentBodySha256, pin.bodySha256),
        eq(page.latestFrozenBodySha256, pin.bodySha256),
        eq(page.latestFrozenAt, new Date(pin.frozenAtIso)),
        eq(page.publishedAt, new Date(pin.frozenAtIso)),
      ),
    )
    .returning({ pageKey: page.pageKey });
  if (leftFiles.length > 0 || leftVersions.length > 0 || removed.length !== 1) {
    throw new LeftWhole({
      failure: PublishedPageFixtureRemovalErrors.mismatch({
        detail: "another write reached it while it was removed",
        slug,
      }),
    });
  }
}

/**
 * Read a fixture's rows inside its page lock, check them, and delete its file, version and page — or nothing.
 *
 * @param client an open store connection
 * @param slug the fixture's slug, already checked to be one
 * @param pin what the walk's own publish left, already checked to be well formed
 * @returns nothing once removed, or the refusal
 */
async function removeFixtureRows({
  client,
  slug,
  pin,
}: {
  client: StoreClient;
  slug: string;
  pin: FixturePin;
}): Promise<Result<void, PublishedPageFixtureRemovalError>> {
  try {
    return await client.db.transaction(async (tx) => {
      const rows = await readLockedRows({ slug, tx });
      const checked = fixtureRemovalVerdict({ pin, rows, slug });
      if (checked.isErr()) {
        return checked;
      }
      await deleteExactlyTheFixture({ pin, slug, tx });
      return checked;
    });
  } catch (cause) {
    if (cause instanceof LeftWhole) {
      return err(cause.failure);
    }
    return err(StoreErrors.queryFailed({ cause, what: `remove the fixture page ${slug}` }));
  }
}

/**
 * Remove one end-to-end fixture page's rows from the store under a home, over one connection that is always closed.
 *
 * @param home the home whose store the walk published into, and whose address the page must carry
 * @param slug the fixture's slug — anything else is refused before a connection opens
 * @param expectedBodySha256 the fixture document's lower-case hex digest, which every row must carry
 * @param expectedFrozenAtIso the instant the walk's own publish froze it at, which the page and its version must carry
 * @returns nothing once removed, or the refusal — a refusal removes nothing
 */
export async function removePublishedPageFixture({
  home,
  slug,
  expectedBodySha256,
  expectedFrozenAtIso,
}: {
  home: string;
  slug: string;
  expectedBodySha256: string;
  expectedFrozenAtIso: string;
}): Promise<Result<void, PublishedPageFixtureRemovalError>> {
  if (!isE2ePageFixtureSlug({ slug })) {
    return err(PublishedPageFixtureRemovalErrors.slugRefused({ slug }));
  }
  if (!SHA256_HEX.test(expectedBodySha256)) {
    return err(PublishedPageFixtureRemovalErrors.digestMalformed({ slug }));
  }
  if (Number.isNaN(Date.parse(expectedFrozenAtIso))) {
    return err(PublishedPageFixtureRemovalErrors.instantMalformed({ slug }));
  }
  const pin: FixturePin = {
    bodySha256: expectedBodySha256,
    canonicalAddress: pathToFileURL(pagePath({ home, slug })).href,
    frozenAtIso: expectedFrozenAtIso,
  };
  return withStoreConnection<StoreClient, void, PublishedPageFixtureRemovalError>({
    body: (client) => removeFixtureRows({ client, pin, slug }),
    connect: () => connectStore({ home, max: 1 }),
    unavailable: PublishedPageFixtureRemovalErrors.unavailable,
  });
}
