/**
 * The walk's fixture page taken back out of the store, against the REAL stack: the remover's SQL over a throwaway
 * database, after the real `publishPage` wrote the fixture in (`src/store/publishedPages/removeFixture.ts`). The
 * unit test proves the verdict; this proves the rows it deletes are exactly the page's, and that a slug holding
 * anything else is left whole.
 *
 * OPT-IN, and never in CI, set up exactly as `publishedPagesImport.test.ts` says, then:
 *
 *   POLLY_MODE=passthrough PUBLISHED_PAGES_PROOF_URL=postgresql://postgres:postgres@127.0.0.1:55322/published_pages_proof \
 *     yarn vitest run --config config/vitest/integration.ts src/__tests__/integration/publishedPageFixtureRemove.test.ts
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { StorageClient } from "@supabase/storage-js";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { e2ePageFixture } from "../../desktop/e2eFixture.js";
import { ok, unwrap, unwrapErr } from "../../lib/result.js";
import { pagePath, publishPage } from "../../pages/publish.js";
import { openStore, type StoreClient } from "../../store/client.js";
import { STORE_URL_ENV } from "../../store/config.js";
import { type ObjectStore, openObjectStore } from "../../store/objects/client.js";
import { storeObjectsSelection } from "../../store/objects/selection.js";
import { removePublishedPageFixture } from "../../store/publishedPages/removeFixture.js";
import {
  publishedPageAliasTable,
  publishedPageBlobTable,
  publishedPageFileTable,
  publishedPageTable,
  publishedPageVersionTable,
} from "../../store/schema/publishedPages.js";
import { proofPageWriter } from "../publishedPagesProofWriter.js";

const PROOF_URL = process.env["PUBLISHED_PAGES_PROOF_URL"];
const PROOF_BUCKET = `published-pages-fixture-proof-${String(process.pid)}`;
const FIRST_AT = "2026-11-10T01:00:00.000Z";
const LATER_AT = "2026-11-10T02:00:00.000Z";

describe.skipIf(PROOF_URL === undefined)("the walk's fixture removed from the store, against the real stack", () => {
  let client: StoreClient;
  let bucket: ObjectStore;
  let storage: StorageClient;
  let home = "";

  /** Remove every row, children first. */
  async function emptyTables(): Promise<void> {
    await client.db.delete(publishedPageAliasTable);
    await client.db.delete(publishedPageFileTable);
    await client.db.delete(publishedPageVersionTable);
    await client.db.delete(publishedPageTable);
    await client.db.delete(publishedPageBlobTable);
  }

  /** The production plan and write, over the proof database and the proof bucket. */
  const write = proofPageWriter({ counts: [], objects: () => ok(bucket), url: PROOF_URL! });

  /** The remover, resolving the proof database the way the walk resolves its own store. */
  async function remove({
    slug,
    expectedBodySha256,
    expectedFrozenAtIso,
  }: {
    slug: string;
    expectedBodySha256: string;
    expectedFrozenAtIso: string;
  }) {
    const previous = process.env[STORE_URL_ENV];
    process.env[STORE_URL_ENV] = PROOF_URL!;
    try {
      return await removePublishedPageFixture({ expectedBodySha256, expectedFrozenAtIso, home, slug });
    } finally {
      if (previous === undefined) {
        delete process.env[STORE_URL_ENV];
      } else {
        process.env[STORE_URL_ENV] = previous;
      }
    }
  }

  beforeAll(() => {
    client = openStore({ url: PROOF_URL! });
    const selection = unwrap(storeObjectsSelection());
    storage = new StorageClient(`${selection.apiUrl}/storage/v1`, {
      Authorization: `Bearer ${selection.serviceKey}`,
      apikey: selection.serviceKey,
    });
    bucket = openObjectStore({ apiUrl: selection.apiUrl, bucket: PROOF_BUCKET, serviceKey: selection.serviceKey });
  });

  beforeEach(async () => {
    await emptyTables();
    home = mkdtempSync(join(tmpdir(), "pages-fixture-proof-"));
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  afterAll(async () => {
    await emptyTables();
    await storage.emptyBucket(PROOF_BUCKET);
    await storage.deleteBucket(PROOF_BUCKET);
    await client.close();
  });

  it("removes exactly the fixture's page, file and version rows, keeping its content-addressed body", async () => {
    const fixture = unwrap(e2ePageFixture({ home, nonce: "proof" }));
    const neighbour = "<p>an acme page beside it</p>";
    unwrap(await publishPage({ write, fragment: fixture.fragment, home, nowIso: FIRST_AT, slug: fixture.slug }));
    unwrap(await publishPage({ write, fragment: neighbour, home, nowIso: FIRST_AT, slug: "acme-neighbour" }));

    unwrap(await remove({ expectedBodySha256: fixture.bodySha256, expectedFrozenAtIso: FIRST_AT, slug: fixture.slug }));

    const pages = await client.db.select().from(publishedPageTable);
    expect(pages.map((page) => page.pageKey)).toEqual(["acme-neighbour"]);
    const files = await client.db.select().from(publishedPageFileTable);
    expect(files.map((file) => file.pageKey)).toEqual(["acme-neighbour"]);
    const versions = await client.db.select().from(publishedPageVersionTable);
    expect(versions.map((version) => version.pageKey)).toEqual(["acme-neighbour"]);
    const blobs = await client.db.select().from(publishedPageBlobTable);
    expect(blobs.map((blob) => blob.bodySha256).includes(fixture.bodySha256)).toBe(true);
  });

  it("leaves a fixture slug whole once it holds a second version or an alias, and refuses an absent one", async () => {
    const fixture = unwrap(e2ePageFixture({ home, nonce: "proof" }));
    unwrap(await publishPage({ write, fragment: fixture.fragment, home, nowIso: FIRST_AT, slug: fixture.slug }));
    unwrap(await publishPage({ write, fragment: "<p>other</p>", home, nowIso: LATER_AT, slug: fixture.slug }));

    expect(
      unwrapErr(
        await remove({ expectedBodySha256: fixture.bodySha256, expectedFrozenAtIso: FIRST_AT, slug: fixture.slug }),
      ).code,
    ).toBe("PAGES_FIXTURE_MISMATCH");
    expect((await client.db.select().from(publishedPageVersionTable)).length).toBe(2);
    expect((await client.db.select().from(publishedPageTable)).length).toBe(1);

    const aliased = unwrap(e2ePageFixture({ home, nonce: "aliased" }));
    unwrap(await publishPage({ write, fragment: aliased.fragment, home, nowIso: FIRST_AT, slug: aliased.slug }));
    const address = `file:///acme/pages/${aliased.slug}/index.html`;
    await client.db.insert(publishedPageAliasTable).values({ address, pageKey: aliased.slug, source: "home-register" });
    expect(
      unwrapErr(
        await remove({ expectedBodySha256: aliased.bodySha256, expectedFrozenAtIso: FIRST_AT, slug: aliased.slug }),
      ).code,
    ).toBe("PAGES_FIXTURE_MISMATCH");
    const aliases = await client.db.select().from(publishedPageAliasTable);
    expect(aliases.map((alias) => alias.address)).toEqual([address]);

    const absent = unwrap(e2ePageFixture({ home, nonce: "never-published" }));
    expect(
      unwrapErr(
        await remove({ expectedBodySha256: absent.bodySha256, expectedFrozenAtIso: FIRST_AT, slug: absent.slug }),
      ).code,
    ).toBe("PAGES_FIXTURE_ABSENT");
  });

  it("leaves a fixture slug whole once a later publish of the same bytes froze it again", async () => {
    const fixture = unwrap(e2ePageFixture({ home, nonce: "proof" }));
    unwrap(await publishPage({ write, fragment: fixture.fragment, home, nowIso: FIRST_AT, slug: fixture.slug }));
    unwrap(await publishPage({ write, fragment: fixture.fragment, home, nowIso: LATER_AT, slug: fixture.slug }));

    const refused = unwrapErr(
      await remove({ expectedBodySha256: fixture.bodySha256, expectedFrozenAtIso: FIRST_AT, slug: fixture.slug }),
    );
    expect(refused.message).toContain("it was frozen at another instant than this walk's publish");
    const pages = await client.db.select().from(publishedPageTable);
    expect(pages.map((page) => page.latestFrozenAt!.toISOString())).toEqual([LATER_AT]);
    expect((await client.db.select().from(publishedPageVersionTable)).length).toBe(1);
    expect((await client.db.select().from(publishedPageFileTable)).length).toBe(1);
  });

  it("leaves a fixture slug whole when another write re-dated its page", async () => {
    const fixture = unwrap(e2ePageFixture({ home, nonce: "proof" }));
    unwrap(await publishPage({ write, fragment: fixture.fragment, home, nowIso: FIRST_AT, slug: fixture.slug }));
    await client.db
      .update(publishedPageTable)
      .set({ publishedAt: new Date(LATER_AT) })
      .where(eq(publishedPageTable.pageKey, fixture.slug));

    const refused = unwrapErr(
      await remove({ expectedBodySha256: fixture.bodySha256, expectedFrozenAtIso: FIRST_AT, slug: fixture.slug }),
    );
    expect(refused.message).toContain("it was published at another instant than this walk's publish");
    const pages = await client.db.select().from(publishedPageTable);
    expect(pages.map((page) => page.publishedAt!.toISOString())).toEqual([LATER_AT]);
    expect((await client.db.select().from(publishedPageVersionTable)).length).toBe(1);
  });

  it("leaves a fixture slug whole when its one version is stamped as an import's", async () => {
    const fixture = unwrap(e2ePageFixture({ home, nonce: "proof" }));
    unwrap(await publishPage({ write, fragment: fixture.fragment, home, nowIso: FIRST_AT, slug: fixture.slug }));
    await client.db
      .update(publishedPageVersionTable)
      .set({ origin: "imported" })
      .where(eq(publishedPageVersionTable.pageKey, fixture.slug));

    const refused = unwrapErr(
      await remove({ expectedBodySha256: fixture.bodySha256, expectedFrozenAtIso: FIRST_AT, slug: fixture.slug }),
    );
    expect(refused.message).toContain("its history holds a version an import carried in, which no walk writes");
    const versions = await client.db.select().from(publishedPageVersionTable);
    expect(versions.map((version) => version.origin)).toEqual(["imported"]);
    expect((await client.db.select().from(publishedPageTable)).length).toBe(1);
  });

  it("leaves a fixture slug whole once another home published the same bytes at the same instant over it", async () => {
    const fixture = unwrap(e2ePageFixture({ home, nonce: "proof" }));
    const otherHome = mkdtempSync(join(tmpdir(), "pages-fixture-other-"));
    try {
      unwrap(await publishPage({ write, fragment: fixture.fragment, home, nowIso: FIRST_AT, slug: fixture.slug }));
      unwrap(
        await publishPage({ write, fragment: fixture.fragment, home: otherHome, nowIso: FIRST_AT, slug: fixture.slug }),
      );

      const refused = unwrapErr(
        await remove({ expectedBodySha256: fixture.bodySha256, expectedFrozenAtIso: FIRST_AT, slug: fixture.slug }),
      );
      expect(refused.message).toContain("it is addressed under another home than this walk's");
      const pages = await client.db.select().from(publishedPageTable);
      expect(pages.map((page) => page.canonicalAddress)).toEqual([
        pathToFileURL(pagePath({ home: otherHome, slug: fixture.slug })).href,
      ]);
      expect((await client.db.select().from(publishedPageVersionTable)).length).toBe(1);
    } finally {
      rmSync(otherHome, { force: true, recursive: true });
    }
  });
});
