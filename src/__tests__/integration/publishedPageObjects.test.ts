/**
 * Published pages against the REAL stack: what no fake can prove about the private bucket and the five tables. Exact
 * bytes back, a private object refused without a signature, a whole image-heavy page signed in one request with every
 * address fetched, a stopped Storage told apart from a missing page, and the CHECKs refusing a row that could not be
 * a page.
 *
 * OPT-IN, and never in CI: there is no real store in any lane. Point it at a THROWAWAY database in the running stack,
 * never `postgres`, the live fleet's. Objects go to a throwaway bucket named for this process, emptied and deleted
 * afterwards, so the real `published-pages` bucket is never touched:
 *
 *   createdb -h 127.0.0.1 -p 55322 -U postgres published_pages_proof
 *   SLOPWEAVER_STORE_URL=postgresql://postgres:postgres@127.0.0.1:55322/published_pages_proof slopweaver store push
 *   POLLY_MODE=passthrough PUBLISHED_PAGES_PROOF_URL=postgresql://postgres:postgres@127.0.0.1:55322/published_pages_proof \
 *     yarn vitest run --config config/vitest/integration.ts src/__tests__/integration/publishedPageObjects.test.ts
 *
 * `POLLY_MODE=passthrough` because the lane replays HTTP from cassettes by default, and this proof is about the real API.
 */
import { createHash } from "node:crypto";

import { StorageClient } from "@supabase/storage-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../lib/result.js";
import { openStore, type StoreClient } from "../../store/client.js";
import { type ObjectStore, openObjectStore } from "../../store/objects/client.js";
import { storeObjectsSelection } from "../../store/objects/selection.js";
import {
  publishedPageAliasTable,
  publishedPageBlobTable,
  publishedPageFileTable,
  publishedPageTable,
  publishedPageVersionTable,
} from "../../store/schema/publishedPages.js";

const PROOF_URL = process.env["PUBLISHED_PAGES_PROOF_URL"];
const PROOF_BUCKET = `published-pages-proof-${String(process.pid)}`;
const IMAGE_COUNT = 300;
const UPLOAD_CONCURRENCY = 20;
const SIGNATURE_LIFETIME_SECONDS = 60;
const ADDRESS = "file:///fixture/pages/acme-page/index.html";

/** The sha-256 an object is keyed by. */
function keyOf({ bytes }: { bytes: Uint8Array }): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Every message down a thrown failure's `cause` chain, so a case can name the database's own refusal. */
function causeChain({ error }: { error: unknown }): string {
  const parts: string[] = [];
  let current: unknown = error;
  while (current instanceof Error) {
    parts.push(current.message);
    current = current.cause;
  }
  return parts.join(" <- ");
}

/** What a write was refused with, thrown as a failure when it was not refused. */
async function refusalOf({ write }: { write: () => PromiseLike<unknown> }): Promise<string> {
  try {
    await write();
  } catch (error) {
    return causeChain({ error });
  }
  throw new Error("the write was accepted");
}

describe.skipIf(PROOF_URL === undefined)("published pages against the real stack", () => {
  let client: StoreClient;
  let objects: ObjectStore;
  let apiUrl: string;
  let storage: StorageClient;
  const documentBytes = new TextEncoder().encode("<!doctype html><h1>acme</h1>");
  const documentKey = keyOf({ bytes: documentBytes });

  /** Remove every row, children first, so a case starts from an empty set of tables. */
  async function emptyTables(): Promise<void> {
    await client.db.delete(publishedPageAliasTable);
    await client.db.delete(publishedPageFileTable);
    await client.db.delete(publishedPageVersionTable);
    await client.db.delete(publishedPageTable);
    await client.db.delete(publishedPageBlobTable);
  }

  beforeAll(async () => {
    client = openStore({ url: PROOF_URL! });
    const selection = unwrap(storeObjectsSelection());
    apiUrl = selection.apiUrl;
    storage = new StorageClient(`${selection.apiUrl}/storage/v1`, {
      Authorization: `Bearer ${selection.serviceKey}`,
      apikey: selection.serviceKey,
    });
    objects = openObjectStore({ apiUrl: selection.apiUrl, bucket: PROOF_BUCKET, serviceKey: selection.serviceKey });
    unwrap(await objects.ensureBucket());
  });

  beforeEach(async () => {
    await emptyTables();
  });

  afterAll(async () => {
    await emptyTables();
    await storage.emptyBucket(PROOF_BUCKET);
    await storage.deleteBucket(PROOF_BUCKET);
    await client.close();
  });

  it("gives back the exact bytes it was given", async () => {
    unwrap(await objects.put({ bytes: documentBytes, contentType: "text/html", key: documentKey }));

    expect(unwrap(await objects.get({ key: documentKey }))).toEqual(documentBytes);
  });

  it("refuses a private object to a reader with no signature", async () => {
    unwrap(await objects.put({ bytes: documentBytes, contentType: "text/html", key: documentKey }));

    const response = await fetch(`${apiUrl}/storage/v1/object/public/${PROOF_BUCKET}/${documentKey}`);

    // Measured: the public route answers a private bucket as one that does not exist, never its bytes.
    const body: unknown = await response.json();

    expect({ body, status: response.status }).toEqual({
      body: { error: "Bucket not found", message: "Bucket not found", statusCode: "404" },
      status: 400,
    });
  });

  it("signs an image-heavy page in one request and every address gives back its own bytes", async () => {
    const images = Array.from({ length: IMAGE_COUNT }, (_, index) =>
      new TextEncoder().encode(`image-${String(index)}`),
    );
    for (let start = 0; start < images.length; start += UPLOAD_CONCURRENCY) {
      const results = await Promise.all(
        images
          .slice(start, start + UPLOAD_CONCURRENCY)
          .map((bytes) => objects.put({ bytes, contentType: "image/png", key: keyOf({ bytes }) })),
      );
      results.forEach((result) => unwrap(result));
    }
    const keys = images.map((bytes) => keyOf({ bytes }));

    const startedAt = performance.now();
    const addresses = unwrap(await objects.sign({ expiresInSeconds: SIGNATURE_LIFETIME_SECONDS, keys }));
    process.stdout.write(`signed ${String(keys.length)} keys in ${(performance.now() - startedAt).toFixed(0)} ms\n`);

    // Bounded: 300 unbounded fetches had the local gateway close sockets ("other side closed"), so the console's proxy
    // must bound its own fetches too. A browser opening the page holds about six connections per origin.
    const fetched: string[] = [];
    for (let start = 0; start < keys.length; start += UPLOAD_CONCURRENCY) {
      const hashes = await Promise.all(
        keys.slice(start, start + UPLOAD_CONCURRENCY).map(async (key) => {
          const response = await fetch(addresses.get(key)!);
          return keyOf({ bytes: new Uint8Array(await response.arrayBuffer()) });
        }),
      );
      fetched.push(...hashes);
    }

    expect(addresses.size).toBe(IMAGE_COUNT);
    expect(fetched).toEqual(keys);
  });

  it("fails a whole batch on one key that was never stored", async () => {
    unwrap(await objects.put({ bytes: documentBytes, contentType: "text/html", key: documentKey }));
    const missing = "c".repeat(64);

    const failure = unwrapErr(
      await objects.sign({ expiresInSeconds: SIGNATURE_LIFETIME_SECONDS, keys: [documentKey, missing] }),
    );

    expect(failure).toMatchObject({ code: "OBJECT_REQUEST_FAILED", key: missing });
  });

  it("tells a missing page, which the API answered, from a stopped Storage, which nothing answered", async () => {
    const stopped = openObjectStore({ apiUrl: "http://127.0.0.1:9", bucket: PROOF_BUCKET, serviceKey: "FIXTURE" });

    const missing = unwrapErr(await objects.get({ key: "d".repeat(64) }));
    const unreachable = unwrapErr(await stopped.get({ key: "d".repeat(64) }));

    expect(missing).toMatchObject({ code: "OBJECT_REQUEST_FAILED", status: expect.any(Number) });
    expect(unreachable).toMatchObject({ code: "OBJECT_REQUEST_FAILED", status: undefined });
  });

  describe("the rows", () => {
    const sha = "e".repeat(64);
    const publishedAt = new Date("2026-11-08T00:00:00.000Z");

    beforeEach(async () => {
      await client.db.insert(publishedPageBlobTable).values({ bodySha256: sha, byteLength: 1, mediaType: "text/html" });
    });

    /** A well-formed local page, for a case to spoil one field of. */
    const localPage = {
      canonicalAddress: ADDRESS,
      currentBodySha256: sha,
      kind: "local",
      pageKey: "acme-page",
      publishedAt,
    };

    it("accepts a local page and a history with no page", async () => {
      await client.db.insert(publishedPageTable).values(localPage);
      await client.db.insert(publishedPageTable).values({ kind: "history-only", pageKey: "acme-history" });

      expect((await client.db.select().from(publishedPageTable)).length).toBe(2);
    });

    it("refuses a local page with no current body", async () => {
      const refusal = await refusalOf({
        write: () => client.db.insert(publishedPageTable).values({ ...localPage, currentBodySha256: null }),
      });

      expect(refusal).toContain("published_page_local_shape");
    });

    it("refuses a key that is not a safe slug", async () => {
      const refusal = await refusalOf({
        write: () => client.db.insert(publishedPageTable).values({ ...localPage, pageKey: "../escape" }),
      });

      expect(refusal).toContain("published_page_key_shape");
    });

    it("refuses a frozen pointer with no date", async () => {
      const refusal = await refusalOf({
        write: () => client.db.insert(publishedPageTable).values({ ...localPage, latestFrozenBodySha256: sha }),
      });

      expect(refusal).toContain("published_page_frozen_pair");
    });

    it.each(["../secret", "a/../b", "/absolute", "a//b", "a\\b", "./a"])(
      "refuses the file path %s",
      async (relativePath) => {
        await client.db.insert(publishedPageTable).values(localPage);

        const refusal = await refusalOf({
          write: () =>
            client.db.insert(publishedPageFileTable).values({ bodySha256: sha, pageKey: "acme-page", relativePath }),
        });

        expect(refusal).toContain("published_page_file_path_shape");
      },
    );

    it("accepts a nested image path under a page", async () => {
      await client.db.insert(publishedPageTable).values(localPage);
      await client.db
        .insert(publishedPageFileTable)
        .values({ bodySha256: sha, pageKey: "acme-page", relativePath: "images/a.b/c-1.png" });

      expect((await client.db.select().from(publishedPageFileTable)).length).toBe(1);
    });

    it("refuses a file naming a body the store does not hold", async () => {
      await client.db.insert(publishedPageTable).values(localPage);

      const refusal = await refusalOf({
        write: () =>
          client.db
            .insert(publishedPageFileTable)
            .values({ bodySha256: "f".repeat(64), pageKey: "acme-page", relativePath: "a.png" }),
      });

      expect(refusal).toContain("published_page_file_body_sha256");
    });

    it("refuses a file or an alias on a history with no page", async () => {
      await client.db.insert(publishedPageTable).values({ kind: "history-only", pageKey: "acme-history" });

      const fileRefusal = await refusalOf({
        write: () =>
          client.db
            .insert(publishedPageFileTable)
            .values({ bodySha256: sha, pageKey: "acme-history", relativePath: "index.html" }),
      });
      const aliasRefusal = await refusalOf({
        write: () =>
          client.db
            .insert(publishedPageAliasTable)
            .values({ address: "file:///old", pageKey: "acme-history", source: "store-row" }),
      });

      expect(fileRefusal).toContain("published_page_file_local_page_fk");
      expect(aliasRefusal).toContain("published_page_alias_local_page_fk");
    });

    it("refuses an alias from a source nothing writes", async () => {
      await client.db.insert(publishedPageTable).values(localPage);

      const refusal = await refusalOf({
        write: () =>
          client.db
            .insert(publishedPageAliasTable)
            .values({ address: "file:///other", pageKey: "acme-page", source: "guessed" }),
      });

      expect(refusal).toContain("published_page_alias_source");
    });
  });
});
