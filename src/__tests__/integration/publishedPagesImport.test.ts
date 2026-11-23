/**
 * `store pages-import`'s write against the REAL stack: real folders scanned, projected and carried into a throwaway
 * database and bucket, then the same folders imported again, changed, removed and contradicted.
 *
 * OPT-IN, and never in CI: there is no real store in any lane. Point it at a THROWAWAY database in the running stack,
 * never `postgres`, the live fleet's. Objects go to a throwaway bucket named for this process, emptied and deleted
 * afterwards, so the real `published-pages` bucket is never touched:
 *
 *   createdb -h 127.0.0.1 -p 55322 -U postgres published_pages_proof
 *   SLOPWEAVER_STORE_URL=postgresql://postgres:postgres@127.0.0.1:55322/published_pages_proof slopweaver store push
 *   POLLY_MODE=passthrough PUBLISHED_PAGES_PROOF_URL=postgresql://postgres:postgres@127.0.0.1:55322/published_pages_proof \
 *     yarn vitest run --config config/vitest/integration.ts src/__tests__/integration/publishedPagesImport.test.ts
 */
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { StorageClient } from "@supabase/storage-js";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { type Result, unwrap, unwrapErr } from "../../lib/result.js";
import { openStore, type StoreClient } from "../../store/client.js";
import { type ObjectStore, openObjectStore } from "../../store/objects/client.js";
import type { ObjectStoreError } from "../../store/objects/errors.js";
import { storeObjectsSelection } from "../../store/objects/selection.js";
import { PublishedPagesImportErrors } from "../../store/publishedPages/errors.js";
import {
  importPublishedPages,
  type PublishedPagesWriteCounts,
  type PublishedPagesWriteError,
} from "../../store/publishedPages/importStore.js";
import { projectPublishedPages } from "../../store/publishedPages/project.js";
import { scanPublishedPageSources } from "../../store/publishedPages/scan.js";
import {
  publishedPageAliasTable,
  publishedPageBlobTable,
  publishedPageFileTable,
  publishedPageTable,
  publishedPageVersionTable,
} from "../../store/schema/publishedPages.js";

const PROOF_URL = process.env["PUBLISHED_PAGES_PROOF_URL"];
const PROOF_BUCKET = `published-pages-import-proof-${String(process.pid)}`;
const FIRST_IMPORT = new Date("2026-11-09T01:00:00.000Z");
const SECOND_IMPORT = new Date("2026-11-09T02:00:00.000Z");
const FROZEN_ISO = "2026-11-08T12:00:00.000Z";

/** The sha-256 a body is keyed by. */
function shaOf({ text }: { text: string }): string {
  return createHash("sha256").update(text).digest("hex");
}

/** What a run wrote when it wrote nothing at all. */
const NOTHING_WRITTEN: PublishedPagesWriteCounts = {
  blobs: 0,
  filesRemoved: 0,
  filesWritten: 0,
  objects: 0,
  pages: 0,
  storeOnlyPages: [],
  versions: 0,
};

describe.skipIf(PROOF_URL === undefined)("store pages-import against the real stack", () => {
  let client: StoreClient;
  let bucket: ObjectStore;
  let storage: StorageClient;
  let home = "";
  let bucketOpens = 0;

  /** Remove every row, children first, so a case starts from an empty set of tables. */
  async function emptyTables(): Promise<void> {
    await client.db.delete(publishedPageAliasTable);
    await client.db.delete(publishedPageFileTable);
    await client.db.delete(publishedPageVersionTable);
    await client.db.delete(publishedPageTable);
    await client.db.delete(publishedPageBlobTable);
  }

  /** Write one file of a local page. */
  function writePageFile({ slug, relativePath, text }: { slug: string; relativePath: string; text: string }): void {
    const path = join(home, "pages", slug, relativePath);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, text);
  }

  /** Freeze bodies under a key, the last one the latest. */
  function freeze({ key, bodies }: { key: string; bodies: readonly string[] }): void {
    const directory = join(home, "published-pages", key);
    mkdirSync(directory, { recursive: true });
    bodies.forEach((text) => writeFileSync(join(directory, `${shaOf({ text })}.html`), text));
    const latest = shaOf({ text: bodies.at(-1)! });
    writeFileSync(
      join(directory, "latest.json"),
      JSON.stringify({ frozenIso: FROZEN_ISO, key, path: "/elsewhere/ignored.html", sha256: `sha256:${latest}` }),
    );
  }

  /** Scan, project and import the home, opening the proof bucket through `objects`. */
  async function runImport({
    importedAt,
    objects,
  }: {
    importedAt: Date;
    objects?: () => Result<ObjectStore, ObjectStoreError>;
  }): Promise<Result<PublishedPagesWriteCounts, readonly PublishedPagesWriteError[]>> {
    const scan = unwrap(await scanPublishedPageSources({ home }));
    const plan = unwrap(projectPublishedPages({ home, scan }));
    const context = { importedAt, kind: "import" } as const;
    if (objects !== undefined) {
      return importPublishedPages({ client, context, objects, plan });
    }
    const counted = (): Result<ObjectStore, ObjectStoreError> => {
      bucketOpens += 1;
      return storeObjectsSelection().map(() => bucket);
    };
    return importPublishedPages({ client, context, objects: counted, plan });
  }

  beforeAll(async () => {
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
    home = mkdtempSync(join(tmpdir(), "pages-import-proof-"));
    bucketOpens = 0;
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

  it("carries a page, its image and its history in byte-exact, and a re-run writes nothing", async () => {
    writePageFile({ relativePath: "index.html", slug: "acme-page", text: "<p>v2</p>" });
    writePageFile({ relativePath: "images/a.png", slug: "acme-page", text: "PNGFIXTURE" });
    freeze({ bodies: ["<p>v1</p>", "<p>v2</p>"], key: "acme-page" });

    const first = unwrap(await runImport({ importedAt: FIRST_IMPORT }));
    const second = unwrap(await runImport({ importedAt: SECOND_IMPORT }));

    expect(first).toEqual({ ...NOTHING_WRITTEN, blobs: 3, filesWritten: 2, objects: 3, pages: 1, versions: 2 });
    expect(second).toEqual(NOTHING_WRITTEN);
    expect(bucketOpens).toBe(1);
    expect(new TextDecoder().decode(unwrap(await bucket.get({ key: shaOf({ text: "PNGFIXTURE" }) })))).toBe(
      "PNGFIXTURE",
    );
    const [page] = await client.db.select().from(publishedPageTable);
    expect(page).toMatchObject({
      currentBodySha256: shaOf({ text: "<p>v2</p>" }),
      kind: "local",
      latestFrozenBodySha256: shaOf({ text: "<p>v2</p>" }),
      publishedAt: new Date(FROZEN_ISO),
    });
    const versions = await client.db.select().from(publishedPageVersionTable);
    expect(versions.map((version) => [version.origin, version.firstFrozenAt])).toEqual([
      ["imported", FIRST_IMPORT],
      ["imported", FIRST_IMPORT],
    ]);
  });

  it("follows a republish: the new body and file land, the old version stays, a removed file goes", async () => {
    writePageFile({ relativePath: "index.html", slug: "acme-page", text: "<p>v1</p>" });
    writePageFile({ relativePath: "old.css", slug: "acme-page", text: "p{}" });
    freeze({ bodies: ["<p>v1</p>"], key: "acme-page" });
    unwrap(await runImport({ importedAt: FIRST_IMPORT }));

    rmSync(join(home, "pages", "acme-page", "old.css"));
    writePageFile({ relativePath: "index.html", slug: "acme-page", text: "<p>v2</p>" });
    freeze({ bodies: ["<p>v1</p>", "<p>v2</p>"], key: "acme-page" });
    const republished = unwrap(await runImport({ importedAt: SECOND_IMPORT }));

    expect(republished).toEqual({
      ...NOTHING_WRITTEN,
      blobs: 1,
      filesRemoved: 1,
      filesWritten: 1,
      objects: 1,
      pages: 1,
      versions: 1,
    });
    const files = await client.db.select().from(publishedPageFileTable);
    expect(files.map((file) => [file.relativePath, file.bodySha256])).toEqual([
      ["index.html", shaOf({ text: "<p>v2</p>" })],
    ]);
    const versions = await client.db.select().from(publishedPageVersionTable);
    expect(versions.map((version) => version.firstFrozenAt).toSorted((a, b) => a.getTime() - b.getTime())).toEqual([
      FIRST_IMPORT,
      SECOND_IMPORT,
    ]);
  });

  it("never rewrites a version a publish already recorded", async () => {
    writePageFile({ relativePath: "index.html", slug: "acme-page", text: "<p>v1</p>" });
    freeze({ bodies: ["<p>v1</p>"], key: "acme-page" });
    const sha = shaOf({ text: "<p>v1</p>" });
    const publishedAt = new Date("2026-11-01T00:00:00.000Z");
    await client.db.insert(publishedPageBlobTable).values({ bodySha256: sha, byteLength: 9, mediaType: "text/html" });
    await client.db.insert(publishedPageTable).values({
      canonicalAddress: "file:///fixture/pages/acme-page/index.html",
      currentBodySha256: sha,
      kind: "local",
      pageKey: "acme-page",
      publishedAt,
    });
    await client.db
      .insert(publishedPageVersionTable)
      .values({ bodySha256: sha, firstFrozenAt: publishedAt, origin: "published", pageKey: "acme-page" });

    unwrap(await runImport({ importedAt: FIRST_IMPORT }));

    const versions = await client.db.select().from(publishedPageVersionTable);
    expect(versions.map((version) => [version.origin, version.firstFrozenAt])).toEqual([["published", publishedAt]]);
  });

  it("turns a history with no page into a local page once its page appears", async () => {
    freeze({ bodies: ["<p>v1</p>"], key: "acme-page" });
    unwrap(await runImport({ importedAt: FIRST_IMPORT }));
    writePageFile({ relativePath: "index.html", slug: "acme-page", text: "<p>v1</p>" });

    const promoted = unwrap(await runImport({ importedAt: SECOND_IMPORT }));

    expect(promoted).toEqual({ ...NOTHING_WRITTEN, filesWritten: 1, pages: 1 });
    const [page] = await client.db.select().from(publishedPageTable);
    expect(page).toMatchObject({ currentBodySha256: shaOf({ text: "<p>v1</p>" }), kind: "local" });
  });

  it("leaves a stored page the folders no longer hold exactly as it is, and names it", async () => {
    writePageFile({ relativePath: "index.html", slug: "acme-gone", text: "<p>gone</p>" });
    writePageFile({ relativePath: "index.html", slug: "acme-kept", text: "<p>kept</p>" });
    unwrap(await runImport({ importedAt: FIRST_IMPORT }));
    rmSync(join(home, "pages", "acme-gone"), { force: true, recursive: true });

    const after = unwrap(await runImport({ importedAt: SECOND_IMPORT }));

    expect(after).toEqual({ ...NOTHING_WRITTEN, storeOnlyPages: ["acme-gone"] });
    const files = await client.db.select().from(publishedPageFileTable);
    expect(files.map((file) => file.pageKey).toSorted()).toEqual(["acme-gone", "acme-kept"]);
  });

  it("never lets a history move a stored page whose folder is gone, and names that page", async () => {
    writePageFile({ relativePath: "index.html", slug: "acme-page", text: "<p>v1</p>" });
    freeze({ bodies: ["<p>v1</p>"], key: "acme-page" });
    unwrap(await runImport({ importedAt: FIRST_IMPORT }));
    const [before] = await client.db.select().from(publishedPageTable);
    rmSync(join(home, "pages", "acme-page"), { force: true, recursive: true });
    freeze({ bodies: ["<p>v1</p>", "<p>v2</p>"], key: "acme-page" });

    const after = unwrap(await runImport({ importedAt: SECOND_IMPORT }));

    expect(after).toEqual({ ...NOTHING_WRITTEN, blobs: 1, objects: 1, storeOnlyPages: ["acme-page"], versions: 1 });
    expect(await client.db.select().from(publishedPageTable)).toEqual([before]);
  });

  it("refuses a body the store holds as something else, writing nothing", async () => {
    writePageFile({ relativePath: "index.html", slug: "acme-page", text: "<p>v1</p>" });
    const sha = shaOf({ text: "<p>v1</p>" });
    await client.db.insert(publishedPageBlobTable).values({ bodySha256: sha, byteLength: 9, mediaType: "text/plain" });

    const refused = unwrapErr(await runImport({ importedAt: FIRST_IMPORT }));

    expect(refused).toEqual([
      PublishedPagesImportErrors.heldBlobConflict({
        derived: "text/html, 9 bytes",
        held: "text/plain, 9 bytes",
        sha256: sha,
      }),
    ]);
    expect(bucketOpens).toBe(0);
    expect(await client.db.select().from(publishedPageTable)).toEqual([]);
  });

  it("writes no row when an upload fails", async () => {
    writePageFile({ relativePath: "index.html", slug: "acme-page", text: "<p>v1</p>" });
    const stopped = openObjectStore({ apiUrl: "http://127.0.0.1:9", bucket: PROOF_BUCKET, serviceKey: "FIXTURE" });

    const refused = unwrapErr(
      await runImport({ importedAt: FIRST_IMPORT, objects: () => storeObjectsSelection().map(() => stopped) }),
    );

    expect(refused[0]).toMatchObject({ code: "OBJECT_REQUEST_FAILED" });
    expect(await client.db.select().from(publishedPageBlobTable)).toEqual([]);
    expect(await client.db.select().from(publishedPageTable)).toEqual([]);
  });
});
