/**
 * Reading a published page out of the store, against the REAL stack — stage 4 of `docs/store/published-pages.md`.
 * Pages are published through the real `publishPage` and its real store write, which writes no folder, so every
 * answer below can only have come from the store: a throwaway database and a bucket named for this process, never the
 * live store or the real bucket.
 *
 * OPT-IN, and never in CI, set up exactly as `publishedPagesImport.test.ts` says, then:
 *
 *   POLLY_MODE=passthrough PUBLISHED_PAGES_PROOF_URL=postgresql://postgres:postgres@127.0.0.1:55322/published_pages_proof \
 *     yarn vitest run --config config/vitest/integration.ts src/__tests__/integration/publishedPagesRead.test.ts
 */
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { StorageClient } from "@supabase/storage-js";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { type Result, unwrap, unwrapErr } from "../../lib/result.js";
import { publishPage } from "../../pages/publish.js";
import { wrapPageFragment } from "../../pages/shell.js";
import { openStore, type StoreClient } from "../../store/client.js";
import { type ObjectStore, openObjectStore } from "../../store/objects/client.js";
import type { ObjectStoreError } from "../../store/objects/errors.js";
import { storeObjectsSelection } from "../../store/objects/selection.js";
import { publishedPagesReader } from "../../store/publishedPages/read.js";
import { PublishedPagesReadErrors } from "../../store/publishedPages/readErrors.js";
import { writePublishedPage } from "../../store/publishedPages/write.js";
import { freezeWrite } from "../../store/publishedPages/writePlan.js";
import {
  publishedPageAliasTable,
  publishedPageBlobTable,
  publishedPageFileTable,
  publishedPageTable,
  publishedPageVersionTable,
} from "../../store/schema/publishedPages.js";
import { proofPageWriter } from "../publishedPagesProofWriter.js";

const PROOF_URL = process.env["PUBLISHED_PAGES_PROOF_URL"];
const PROOF_BUCKET = `published-pages-read-proof-${String(process.pid)}`;
/** Nothing listens here, so a connection to it is refused — the store being down. */
const STOPPED_URL = "postgresql://postgres:postgres@127.0.0.1:1/published_pages_proof";
const V1_AT = "2026-11-09T01:00:00.000Z";
const V2_AT = "2026-11-09T02:00:00.000Z";
const V1 = '<title>Acme first</title><p>v1</p><img src="images/a.png">';
const V2 = '<title>Acme second</title><p>v2</p><img src="images/a.png">';

/** The hex digest of the document a fragment publishes as. */
function documentSha256({ fragment }: { fragment: string }): string {
  return createHash("sha256").update(wrapPageFragment({ fragment })).digest("hex");
}

describe.skipIf(PROOF_URL === undefined)("a published page read out of the store, against the real stack", () => {
  let client: StoreClient;
  let bucket: ObjectStore;
  let storage: StorageClient;
  let home = "";
  const objects = (): Result<ObjectStore, ObjectStoreError> => storeObjectsSelection().map(() => bucket);

  /** Remove every row, children first. */
  async function emptyTables(): Promise<void> {
    await client.db.delete(publishedPageAliasTable);
    await client.db.delete(publishedPageFileTable);
    await client.db.delete(publishedPageVersionTable);
    await client.db.delete(publishedPageTable);
    await client.db.delete(publishedPageBlobTable);
  }

  /** Freeze `html` under `key` at `nowIso` as `briefing freeze --new` does, through the real write. */
  async function freezeHistory({ key, html, nowIso }: { key: string; html: string; nowIso: string }): Promise<void> {
    const at = new Date(nowIso);
    const write = freezeWrite({ document: html, frozenAt: at, key, opensHistory: true });
    unwrap(await writePublishedPage({ client, importedAt: at, objects, write }));
  }

  /** Publish V1 then V2 of `acme-read` with one image read from `--assets-from`; only the store holds either. */
  async function publishTwice(): Promise<void> {
    const assets = join(home, "drafts");
    mkdirSync(join(assets, "images"), { recursive: true });
    writeFileSync(join(assets, "images", "a.png"), "PNGFIXTURE");
    const assetSource = { kind: "directory", root: assets } as const;
    const write = proofPageWriter({ counts: [], objects, url: PROOF_URL! });
    unwrap(await publishPage({ assetSource, fragment: V1, home, nowIso: V1_AT, slug: "acme-read", write }));
    unwrap(await publishPage({ assetSource, fragment: V2, home, nowIso: V2_AT, slug: "acme-read", write }));
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
    home = mkdtempSync(join(tmpdir(), "pages-read-proof-"));
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

  it("reads the latest frozen version's exact bytes, digest, instant and count from the store alone", async () => {
    await publishTwice();

    const latest = unwrap(await publishedPagesReader({ client, objects }).latestFrozen({ pageKey: "acme-read" }));

    expect(new TextDecoder().decode(latest.bytes)).toBe(wrapPageFragment({ fragment: V2 }));
    expect(latest.bodySha256).toBe(documentSha256({ fragment: V2 }));
    expect(latest.frozenAt.toISOString()).toBe(V2_AT);
    expect(latest.versionCount).toBe(2);
  });

  it("lists the current page with its title, publication instant and exact size", async () => {
    await publishTwice();
    const started = performance.now();

    const pages = unwrap(await publishedPagesReader({ client, objects }).listCurrent());
    console.log(`listCurrent over 1 page: ${(performance.now() - started).toFixed(0)} ms`);

    expect(pages).toEqual([
      {
        byteLength: Buffer.byteLength(wrapPageFragment({ fragment: V2 })),
        pageKey: "acme-read",
        publishedAt: new Date(V2_AT),
        title: "Acme second",
      },
    ]);
  });

  it("answers which files a page serves, and false for a file or page it does not", async () => {
    await publishTwice();
    const reader = publishedPagesReader({ client, objects });

    const answers = await Promise.all([
      reader.fileExists({ pageKey: "acme-read", relativePath: "index.html" }),
      reader.fileExists({ pageKey: "acme-read", relativePath: "images/a.png" }),
      reader.fileExists({ pageKey: "acme-read", relativePath: "images/b.png" }),
      reader.fileExists({ pageKey: "acme-absent", relativePath: "index.html" }),
    ]);

    expect(answers.map((answer) => unwrap(answer))).toEqual([true, true, false, false]);
  });

  it("reads a page's current document from the store alone, and refuses a key holding no published page", async () => {
    await publishTwice();
    const reader = publishedPagesReader({ client, objects });

    const document = unwrap(await reader.document({ pageKey: "acme-read" }));
    const refused = unwrapErr(await reader.document({ pageKey: "acme-absent" }));

    expect(new TextDecoder().decode(document)).toBe(wrapPageFragment({ fragment: V2 }));
    expect(refused).toEqual(PublishedPagesReadErrors.notPublished({ pageKey: "acme-absent" }));
  });

  it("reads every file a page serves with its bytes, the document first, and refuses when one body is lost", async () => {
    await publishTwice();
    const reader = publishedPagesReader({ client, objects });

    const files = unwrap(await reader.files({ pageKey: "acme-read" }));
    expect(files.map(({ bytes, relativePath }) => [relativePath, new TextDecoder().decode(bytes)])).toEqual([
      ["index.html", wrapPageFragment({ fragment: V2 })],
      ["images/a.png", "PNGFIXTURE"],
    ]);
    expect(unwrapErr(await reader.files({ pageKey: "acme-absent" }))).toEqual(
      PublishedPagesReadErrors.notPublished({ pageKey: "acme-absent" }),
    );

    const image = createHash("sha256").update("PNGFIXTURE").digest("hex");
    await storage.from(PROOF_BUCKET).remove([image]);
    expect(unwrapErr(await reader.files({ pageKey: "acme-read" })).code).toBe("OBJECT_REQUEST_FAILED");
  });

  it("reads a history with no page as frozen, and never lists it as a current page", async () => {
    await freezeHistory({ html: "<p>old</p>", key: "acme-history", nowIso: V1_AT });
    const reader = publishedPagesReader({ client, objects });

    const latest = unwrap(await reader.latestFrozen({ pageKey: "acme-history" }));

    expect(new TextDecoder().decode(latest.bytes)).toBe("<p>old</p>");
    expect(unwrap(await reader.listCurrent())).toEqual([]);
  });

  it("reads the newest `briefing freeze` of a history with no page, each written as it was taken", async () => {
    await freezeHistory({ html: "<p>round one</p>", key: "acme-briefing", nowIso: V1_AT });
    await freezeHistory({ html: "<p>round two</p>", key: "acme-briefing", nowIso: V2_AT });
    const reader = publishedPagesReader({ client, objects });

    const latest = unwrap(await reader.latestFrozen({ pageKey: "acme-briefing" }));

    expect([new TextDecoder().decode(latest.bytes), latest.frozenAt.toISOString(), latest.versionCount]).toEqual([
      "<p>round two</p>",
      V2_AT,
      2,
    ]);
    expect(unwrap(await reader.listCurrent())).toEqual([]);
  });

  it("refuses a key the store never froze, naming it", async () => {
    const refused = unwrapErr(await publishedPagesReader({ client, objects }).latestFrozen({ pageKey: "acme-none" }));

    expect(refused.code).toBe("PAGES_NEVER_FROZEN");
  });

  it("refuses a body the bucket lost, rather than answering rows with no bytes", async () => {
    await publishTwice();
    await storage.from(PROOF_BUCKET).remove([documentSha256({ fragment: V2 })]);

    const refused = unwrapErr(await publishedPagesReader({ client, objects }).latestFrozen({ pageKey: "acme-read" }));

    expect(refused.code).toBe("OBJECT_REQUEST_FAILED");
  });

  it("refuses every read when the database is down, never answering false or empty", async () => {
    const stopped = openStore({ url: STOPPED_URL });
    const reader = publishedPagesReader({ client: stopped, objects });

    const refusals = [
      unwrapErr(await reader.fileExists({ pageKey: "acme-read", relativePath: "index.html" })),
      unwrapErr(await reader.listCurrent()),
      unwrapErr(await reader.latestFrozen({ pageKey: "acme-read" })),
      unwrapErr(await reader.document({ pageKey: "acme-read" })),
      unwrapErr(await reader.files({ pageKey: "acme-read" })),
    ];
    await stopped.close();

    expect(refusals.map((refusal) => refusal.code)).toEqual([
      "STORE_QUERY_FAILED",
      "STORE_QUERY_FAILED",
      "STORE_QUERY_FAILED",
      "STORE_QUERY_FAILED",
      "STORE_QUERY_FAILED",
    ]);
  });
});
