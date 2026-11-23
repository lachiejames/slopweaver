/**
 * A publish and a freeze writing ONLY the store, against the REAL stack — stage 6 of `docs/store/published-pages.md`.
 * The real `publishPage` writes through the real plan and write (`../publishedPagesProofWriter.ts`), over a throwaway
 * database and a bucket named for this process, so the live store and the real bucket are never touched, and nothing
 * is ever written under the home's `pages/` or `published-pages/`.
 *
 * OPT-IN, and never in CI, set up exactly as `publishedPagesImport.test.ts` says, then:
 *
 *   POLLY_MODE=passthrough PUBLISHED_PAGES_PROOF_URL=postgresql://postgres:postgres@127.0.0.1:55322/published_pages_proof \
 *     yarn vitest run --config config/vitest/integration.ts src/__tests__/integration/publishedPagesPublish.test.ts
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
import { writeRows } from "../../store/publishedPages/importRows.js";
import { importPublishedPages, type PublishedPagesWriteCounts } from "../../store/publishedPages/importStore.js";
import { writePublishedPage } from "../../store/publishedPages/write.js";
import { freezeWrite, pageWrite } from "../../store/publishedPages/writePlan.js";
import {
  publishedPageAliasTable,
  publishedPageBlobTable,
  publishedPageFileTable,
  publishedPageTable,
  publishedPageVersionTable,
} from "../../store/schema/publishedPages.js";
import { pausedPageWriter, proofPageWriter } from "../publishedPagesProofWriter.js";

const PROOF_URL = process.env["PUBLISHED_PAGES_PROOF_URL"];
const PROOF_BUCKET = `published-pages-publish-proof-${String(process.pid)}`;
/** Nothing listens here, so a connection to it is refused — the store being down. */
const STOPPED_URL = "postgresql://postgres:postgres@127.0.0.1:1/published_pages_proof";
const V1_AT = "2026-11-09T01:00:00.000Z";
const V2_AT = "2026-11-09T02:00:00.000Z";
const AGAIN_AT = "2026-11-09T03:00:00.000Z";
const IMPORT_AT = new Date("2026-11-09T04:00:00.000Z");

/** The hex digest of the document a fragment publishes as. */
function documentSha256({ fragment }: { fragment: string }): string {
  return createHash("sha256").update(wrapPageFragment({ fragment })).digest("hex");
}

describe.skipIf(PROOF_URL === undefined)("a publish written only into the store, against the real stack", () => {
  let client: StoreClient;
  let bucket: ObjectStore;
  let storage: StorageClient;
  let home = "";
  let assets = "";
  const objects = (): Result<ObjectStore, ObjectStoreError> => storeObjectsSelection().map(() => bucket);

  /** Remove every row, children first. */
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
    storage = new StorageClient(`${selection.apiUrl}/storage/v1`, {
      Authorization: `Bearer ${selection.serviceKey}`,
      apikey: selection.serviceKey,
    });
    bucket = openObjectStore({ apiUrl: selection.apiUrl, bucket: PROOF_BUCKET, serviceKey: selection.serviceKey });
  });

  beforeEach(async () => {
    await emptyTables();
    home = mkdtempSync(join(tmpdir(), "pages-publish-proof-"));
    assets = mkdtempSync(join(tmpdir(), "pages-publish-assets-"));
    mkdirSync(join(assets, "images"));
    writeFileSync(join(assets, "images", "a.png"), "PNGFIXTURE");
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
    rmSync(assets, { force: true, recursive: true });
  });

  afterAll(async () => {
    await emptyTables();
    await storage.emptyBucket(PROOF_BUCKET);
    await storage.deleteBucket(PROOF_BUCKET);
    await client.close();
  });

  it("writes each publish's own version as published at its freeze, an identical re-publish adds nothing, and no folder is written", async () => {
    const counts: PublishedPagesWriteCounts[] = [];
    const write = proofPageWriter({ counts, objects, url: PROOF_URL! });
    const assetSource = { kind: "directory", root: assets } as const;
    const v1 = '<p>v1</p><img src="images/a.png">';
    const v2 = '<p>v2</p><img src="images/a.png">';

    unwrap(await publishPage({ assetSource, fragment: v1, home, nowIso: V1_AT, slug: "acme-page", write }));
    unwrap(await publishPage({ assetSource, fragment: v2, home, nowIso: V2_AT, slug: "acme-page", write }));
    unwrap(await publishPage({ assetSource, fragment: v2, home, nowIso: AGAIN_AT, slug: "acme-page", write }));

    expect(counts.map((count) => [count.objects, count.versions, count.filesWritten])).toEqual([
      [2, 1, 2],
      [1, 1, 1],
      [0, 0, 0],
    ]);
    const versions = await client.db.select().from(publishedPageVersionTable);
    expect(
      versions
        .map((version) => [version.bodySha256, version.origin, version.firstFrozenAt.toISOString()])
        .toSorted((a, b) => String(a[2]).localeCompare(String(b[2]))),
    ).toEqual([
      [documentSha256({ fragment: v1 }), "published", V1_AT],
      [documentSha256({ fragment: v2 }), "published", V2_AT],
    ]);
    const [page] = await client.db.select().from(publishedPageTable);
    expect(page).toMatchObject({ currentBodySha256: documentSha256({ fragment: v2 }), kind: "local" });
    expect(page!.latestFrozenAt!.toISOString()).toBe(AGAIN_AT);
    const files = await client.db.select().from(publishedPageFileTable);
    expect(files.map((file) => file.relativePath).toSorted()).toEqual(["images/a.png", "index.html"]);
    expect(new TextDecoder().decode(unwrap(await bucket.get({ key: documentSha256({ fragment: v2 }) })))).toBe(
      wrapPageFragment({ fragment: v2 }),
    );
    expect([existsSync(join(home, "pages")), existsSync(join(home, "published-pages"))]).toEqual([false, false]);
  });

  it("drops the file row of an image a re-publish no longer loads, keeping its body", async () => {
    const write = proofPageWriter({ counts: [], objects, url: PROOF_URL! });
    const assetSource = { kind: "directory", root: assets } as const;

    unwrap(
      await publishPage({
        assetSource,
        fragment: '<img src="images/a.png">',
        home,
        nowIso: V1_AT,
        slug: "acme-drop",
        write,
      }),
    );
    unwrap(await publishPage({ fragment: "<p>no image now</p>", home, nowIso: V2_AT, slug: "acme-drop", write }));

    const files = await client.db.select().from(publishedPageFileTable);
    expect(files.map((file) => file.relativePath)).toEqual(["index.html"]);
    const image = createHash("sha256").update("PNGFIXTURE").digest("hex");
    expect((await client.db.select().from(publishedPageBlobTable)).map((blob) => blob.bodySha256)).toContain(image);
  });

  it("fails a publish the store cannot take, leaving no row and no folder, and a re-run completes it", async () => {
    const fragment = "<p>while the store was down</p>";
    const counts: PublishedPagesWriteCounts[] = [];

    const refused = await publishPage({
      fragment,
      home,
      nowIso: V1_AT,
      slug: "acme-down",
      write: proofPageWriter({ counts, objects, url: STOPPED_URL }),
    });

    expect(unwrapErr(refused)[0]).toBe(
      "writing acme-down into the store failed or could not be confirmed, so the publish did not complete and the " +
        "page has no address yet. Re-run the same publish to complete it.",
    );
    expect(existsSync(join(home, "pages"))).toBe(false);
    expect(await client.db.select().from(publishedPageTable)).toEqual([]);

    unwrap(
      await publishPage({
        fragment,
        home,
        nowIso: V2_AT,
        slug: "acme-down",
        write: proofPageWriter({ counts, objects, url: PROOF_URL! }),
      }),
    );

    const versions = await client.db.select().from(publishedPageVersionTable);
    expect(versions.map((version) => [version.pageKey, version.origin, version.firstFrozenAt.toISOString()])).toEqual([
      ["acme-down", "published", V2_AT],
    ]);
  });

  it("keeps a version an import already held as it was, and moves only the page's latest freeze, on an identical publish", async () => {
    const fragment = "<p>imported first</p>";
    const held = unwrap(
      pageWrite({
        assets: [],
        document: wrapPageFragment({ fragment }),
        frozenAt: new Date(V1_AT),
        home,
        slug: "acme-held",
      }),
    );
    unwrap(
      await importPublishedPages({
        client,
        context: { importedAt: IMPORT_AT, kind: "import" },
        objects,
        plan: held.plan,
      }),
    );

    const counts: PublishedPagesWriteCounts[] = [];
    const write = proofPageWriter({ counts, objects, url: PROOF_URL! });
    unwrap(await publishPage({ fragment, home, nowIso: V2_AT, slug: "acme-held", write }));

    expect(counts.map((count) => [count.objects, count.versions, count.pages])).toEqual([[0, 0, 1]]);
    const versions = await client.db.select().from(publishedPageVersionTable);
    expect(versions.map((version) => [version.origin, version.firstFrozenAt.toISOString()])).toEqual([
      ["imported", IMPORT_AT.toISOString()],
    ]);
    const [page] = await client.db.select().from(publishedPageTable);
    expect(page!.latestFrozenAt!.toISOString()).toBe(V2_AT);
  });

  it("refuses an earlier publish whose checks passed before a later one landed, leaving the later one current", async () => {
    const v1 = "<p>checked first, written last</p>";
    const v2 = "<p>published in the gap</p>";
    const { paused, writer } = pausedPageWriter();

    unwrap(await publishPage({ fragment: v1, home, nowIso: V1_AT, slug: "acme-race", write: writer }));
    const write = proofPageWriter({ counts: [], objects, url: PROOF_URL! });
    unwrap(await publishPage({ fragment: v2, home, nowIso: V2_AT, slug: "acme-race", write }));
    const late = await writePublishedPage({ client, importedAt: IMPORT_AT, objects, write: paused[0]! });

    expect(unwrapErr(late).map((error) => error.code)).toEqual(["PAGES_PUBLISH_SUPERSEDED"]);
    const [page] = await client.db.select().from(publishedPageTable);
    expect([page!.currentBodySha256, page!.latestFrozenAt!.toISOString()]).toEqual([
      documentSha256({ fragment: v2 }),
      V2_AT,
    ]);
    expect((await client.db.select().from(publishedPageVersionTable)).map((version) => version.bodySha256)).toEqual([
      documentSha256({ fragment: v2 }),
    ]);
  });

  it("lets a same-bytes same-instant write through when a concurrent one inserted its body after both read it missing", async () => {
    const { paused, writer } = pausedPageWriter();
    unwrap(await publishPage({ fragment: "<p>acme twice</p>", home, nowIso: V1_AT, slug: "acme-twin", write: writer }));
    const planned = paused[0]!;
    const context = { importedAt: IMPORT_AT, kind: "publish", published: planned.published } as const;

    // Both writers read the body as missing before either transaction opened, so both write it as fresh.
    const first = unwrap(await writeRows({ blobs: planned.plan.blobs, client, context, plan: planned.plan }));
    const second = unwrap(await writeRows({ blobs: planned.plan.blobs, client, context, plan: planned.plan }));

    expect([first.blobs, first.versions, second.blobs, second.versions]).toEqual([1, 1, 0, 0]);
    expect((await client.db.select().from(publishedPageBlobTable)).map((blob) => blob.bodySha256)).toEqual([
      documentSha256({ fragment: "<p>acme twice</p>" }),
    ]);
  });

  it("refuses an earlier publish frozen at the SAME instant as a later one with other bytes", async () => {
    const v1 = "<p>checked first at one instant</p>";
    const v2 = "<p>published in the gap at that instant</p>";
    const { paused, writer } = pausedPageWriter();

    unwrap(await publishPage({ fragment: v1, home, nowIso: V1_AT, slug: "acme-tie", write: writer }));
    const write = proofPageWriter({ counts: [], objects, url: PROOF_URL! });
    unwrap(await publishPage({ fragment: v2, home, nowIso: V1_AT, slug: "acme-tie", write }));
    const late = await writePublishedPage({ client, importedAt: IMPORT_AT, objects, write: paused[0]! });

    expect(unwrapErr(late).map((error) => error.message)).toEqual([
      `the store already holds acme-tie as frozen at ${V1_AT}, the same instant as, with other bytes than, this ` +
        `publish's ${V1_AT}, and the store never moves a page backwards. Publish it again at the current time, ` +
        "without a --now at or before that freeze",
    ]);
    const [page] = await client.db.select().from(publishedPageTable);
    expect([page!.currentBodySha256, page!.latestFrozenBodySha256]).toEqual([
      documentSha256({ fragment: v2 }),
      documentSha256({ fragment: v2 }),
    ]);
  });

  // The freeze rides the same opt-in suite, store, bucket and per-test home as the publish above.
  describe("a freeze written only into the store", () => {
    /** Freeze `html` under `key` at `nowIso`, through the real write. */
    function freeze({
      key,
      html,
      nowIso,
      opensHistory,
    }: {
      key: string;
      html: string;
      nowIso: string;
      opensHistory: boolean;
    }) {
      const at = new Date(nowIso);
      const write = freezeWrite({ document: html, frozenAt: at, key, opensHistory });
      return writePublishedPage({ client, importedAt: at, objects, write });
    }

    it("moves a local page's latest freeze and never its document or files", async () => {
      const write = proofPageWriter({ counts: [], objects, url: PROOF_URL! });
      unwrap(await publishPage({ fragment: "<p>the page</p>", home, nowIso: V1_AT, slug: "acme-local", write }));

      unwrap(await freeze({ html: "<p>stamped copy</p>", key: "acme-local", nowIso: V2_AT, opensHistory: false }));

      const [page] = await client.db.select().from(publishedPageTable);
      const stamped = createHash("sha256").update("<p>stamped copy</p>").digest("hex");
      expect([
        page!.kind,
        page!.currentBodySha256,
        page!.latestFrozenBodySha256,
        page!.latestFrozenAt!.toISOString(),
      ]).toEqual(["local", documentSha256({ fragment: "<p>the page</p>" }), stamped, V2_AT]);
      const files = await client.db.select().from(publishedPageFileTable);
      expect(files.map((file) => [file.relativePath, file.bodySha256])).toEqual([
        ["index.html", documentSha256({ fragment: "<p>the page</p>" })],
      ]);
      expect((await client.db.select().from(publishedPageVersionTable)).length).toBe(2);
    });

    it("refuses a freeze opening a history without --new, naming the held keys a hair away, and writes nothing", async () => {
      unwrap(await freeze({ html: "<p>one</p>", key: "acme-brief", nowIso: V1_AT, opensHistory: true }));

      const refused = unwrapErr(
        await freeze({ html: "<p>two</p>", key: "acme-brie", nowIso: V2_AT, opensHistory: false }),
      );

      expect(refused.map((error) => error.code)).toEqual(["PAGES_FREEZE_OPENS_HISTORY"]);
      expect(refused[0]).toMatchObject({
        key: "acme-brie",
        neighbours: [{ distance: 1, key: "acme-brief", versions: 1 }],
      });
      const versions = await client.db.select().from(publishedPageVersionTable);
      expect(versions.map((version) => version.pageKey)).toEqual(["acme-brief"]);
    });

    it("opens a new history under --new, as a history with no page", async () => {
      unwrap(await freeze({ html: "<p>first</p>", key: "acme-history", nowIso: V1_AT, opensHistory: true }));
      unwrap(await freeze({ html: "<p>second</p>", key: "acme-history", nowIso: V2_AT, opensHistory: false }));

      const [page] = await client.db.select().from(publishedPageTable);
      expect([page!.pageKey, page!.kind, page!.currentBodySha256, page!.latestFrozenAt!.toISOString()]).toEqual([
        "acme-history",
        "history-only",
        null,
        V2_AT,
      ]);
      const versions = await client.db.select().from(publishedPageVersionTable);
      expect(versions.map((version) => version.origin)).toEqual(["published", "published"]);
    });
  });
});
