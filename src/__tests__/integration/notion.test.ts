/**
 * INTEGRATION test: the Notion connector against the REAL Notion API, recorded + replayed through a Polly
 * cassette (`../setup-polly.ts` + `../cassetteRedactConfig.ts#NOTION`). This is the SEVENTH provider config.
 * As with Vanta, there is no throwaway Notion workspace to record against — the credentials in
 * `$SLOPWEAVER_HOME/secrets` reach our own real, live workspace — so every read here is real page/database
 * content, run through an allowlist that keeps only Notion's own structural vocabulary (`object`, `type`,
 * `color`, the two timestamps) and lets everything else (titles, rich-text runs, comments, people) fall
 * through to `[REDACTED]`.
 *
 * ## The write half IS against a dedicated fixture
 *
 * Unlike the read tests, `createPage`/`replaceMarkdown`/`movePage`/`archivePage` below act on pages THIS
 * SUITE CREATES, under {@link WRITE_PARENT_PAGE_ID} — never on existing organisation content. Every created
 * page is archived (Notion's only "delete", recoverable for 30 days) at the end of the same test. Recording
 * it again creates and archives more real, disposable pages; replaying it touches nothing.
 *
 * The move test creates TWO of them — a destination and a subject — because a move needs somewhere real to
 * go, and pointing it at existing organisation content would relocate a colleague's page to record a test.
 *
 * ## What this proves, and precisely what it cannot
 *
 * **Proved here.** `readNotionObject` (`src/live/notion/read.ts`) parses both a bare UUID and a
 * `notion.so`/`app.notion.com` URL into the same canonical target, then reads a real page (object + one
 * bounded page of top-level blocks, every container in it expanded through the children endpoint) and a
 * real database through the official SDK and the shared provider door; a synced DUPLICATE is read through
 * its original's id, since listing the duplicate's own id answers an empty list; `makeNotionWriteApi` (`src/corpus/notion/writeApi.ts`) creates a page from markdown, reads it back
 * as canonical markdown, replaces its content, confirms the replacement round-trips, and archives it — the
 * exact "create/update/read-back" cycle this connector's write lane exists for; `movePage` re-parents a page
 * under a second one and the page READS BACK under it with its body intact, which is the whole claim
 * `notion page move` makes; `botUserId` resolves the integration's own bot identity, which is what makes
 * `lastEditedBy` a trustworthy authorship signal.
 *
 * **NOT proved here — and why:**
 *
 * 1. Notion's own object model is NOT what `databases.retrieve` accepts as a **search hit**. A 2025+
 *    workspace's `search` only ever returns `page` and `data_source` objects — never a bare `database` — so
 *    the DATABASE id `retrieveDatabase` needs has to come from a data source's own `parent.database_id`,
 *    one extra hop `search` alone does not give you. Confirmed live: calling `databases.retrieve` with a
 *    `data_source` id returns a real `object_not_found`, and with the data source's `parent.database_id` it
 *    succeeds. Not a defect in this connector — `client.ts`'s `retrieveDatabase` was never wrong, a caller
 *    just has to already know a database id rather than discovering one from `search`. The bounded id below
 *    is the real database id, found this way, once.
 * 2. The bulk crawl machinery (`liveApi.ts`'s `notionSearch`, `renderBlocks`, `pageComments`, recursive block
 *    descent, the multi-item concurrency pool `fetch.ts` drives for `slopweaver refresh`) is absent. That is
 *    a different, much larger seam — an unbounded walk over however much of the real workspace the search
 *    cutoff admits — and belongs to its own suite rather than being folded into this one's fixed, bounded
 *    reads.
 * 3. A forced real rate-limit response is not attempted, for the same reason as `vanta.test.ts`: Notion's
 *    3 req/s allowance is shared with whatever else is legitimately using this same integration, and
 *    `callDeadline.ts`'s pacing is already unit-tested.
 *
 * **No assertion below may depend on a string this org authored** (a page/database title, a block's text, a
 * comment, a person's name or email). Only counts, booleans, ids-as-opaque-synthetic-values, and the closed
 * `object`/`type` fields the allowlist actually keeps are asserted — except inside the write cycle, where the
 * markdown body is content THIS TEST ITSELF wrote, not organisation content, so asserting on it is safe and
 * is the whole point of a round-trip proof.
 *
 * Run:
 *   yarn test:integration                                            # replay (default, offline)
 *   POLLY_MODE=record NOTION_TOKEN=… yarn test:integration            # (re)record — reads/writes real Notion data
 */
import { rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

import { makeNotionNamedReadApi } from "../../corpus/notion/liveApi.js";
import { makeNotionWriteApi, makeNotionWriteSeam, type NotionWriteApi } from "../../corpus/notion/writeApi.js";
import { unwrap } from "../../lib/result.js";
import { readNotionObject } from "../../live/notion/read.js";
import { homeDeclaringNoPrivateTerms } from "../privateTermsFixture.js";
import { activePolly } from "../setup-polly.js";

/**
 * Every Notion object id is a UUID, and every meaningful REST path embeds one
 * (`/v1/pages/{id}`, `/v1/databases/{id}`, `/v1/blocks/{id}/children`, …) — so
 * `cassetteRedactConfig.ts`'s `IDENTIFIER_SEGMENTS` (correctly) treats it as opaque and the WHOLE path
 * collapses to the literal `/[REDACTED]`. Two DIFFERENT real Notion calls in the same method (both GET, say)
 * therefore share an identical match key, and the default lenient matcher (`order: false`, this repo's
 * default — see `setup-polly.ts`'s own header) replays the SAME recorded entry for both, exactly the class of
 * bug `setup-polly.ts` warns `activePolly()`'s own doc comment about. Confirmed live: recording this
 * suite's own two-call page read without ordered matching produced ONE persisted HAR entry for two real
 * network calls, and replaying it fed a page object where a block list was expected — a real, reproduced
 * `TypeError`, not a hypothetical. Every test below that makes more than one id-bearing call opts into
 * `order: true`, the same fix `datadog.test.ts`'s rate-limit test already established for a same-endpoint
 * sequence — the calls happen in the same fixed order on every run, so record order IS replay order.
 */
function useOrderedMatching(): void {
  activePolly()
    ?.server.any()
    .on("request", (req) => {
      req.configure({ matchRequestsBy: { order: true } });
    });
}

const RECORD = process.env["POLLY_MODE"] === "record";

function requireRecordEnv({ name }: { name: string }): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`set ${name} to record the Notion cassette`);
  }
  return value;
}

/** @returns the real token on record, a shape-valid placeholder on replay */
function token(): string {
  return RECORD ? requireRecordEnv({ name: "NOTION_TOKEN" }) : "secret_".padEnd(50, "a");
}

/** The throwaway homes the write lane's privacy check reads its declared-empty terms file from. */
const writeHomes: string[] = [];

afterEach(() => {
  for (const home of writeHomes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

/** The write-lane API, every write judged under a throwaway home whose private-terms file declares none. */
function notionWriteApi(): NotionWriteApi {
  const home = homeDeclaringNoPrivateTerms({ prefix: "notion-integration-" });
  writeHomes.push(home);
  return makeNotionWriteApi({ seam: makeNotionWriteSeam({ home, token: token() }) });
}

/**
 * A real page in this workspace, addressed by its bare id, with over five real top-level blocks (proves the
 * bounded read's `hasMore`/residue reporting against a genuine multi-page body).
 */
const REAL_PAGE_ID = "00000000-0000-8000-8000-0000000000a1";

/** The same page, addressed as a `notion.so` URL instead — proves the OTHER half of address parsing. */
const REAL_PAGE_URL = `https://www.notion.so/${REAL_PAGE_ID.replaceAll("-", "")}`;

/**
 * A real DATABASE id (not a data-source id) — see this file's header, point 1, for how it was found.
 */
const REAL_DATABASE_ID = "00000000-0000-8000-8000-0000000000b2";

/** The parent this suite creates and archives its own disposable page under. */
const WRITE_PARENT_PAGE_ID = "00000000-0000-8000-8000-0000000000a1";

/**
 * A disposable page, created under {@link WRITE_PARENT_PAGE_ID} to record this suite and archived straight
 * after, whose one top-level block is a synced DUPLICATE of a block on a second disposable page. Archived
 * pages still answer reads by id for Notion's 30-day window; replay touches nothing.
 */
const SYNCED_DUPLICATE_PAGE_ID = "00000000-0000-8000-8000-0000000000c3";

/** The production default call ceiling, with a clock that never advances so the time ceiling never fires. */
const NESTED = { maxCalls: 400, nowMs: () => 0 } as const;

describe("notion (integration — real Notion API via Polly cassette)", () => {
  it("reads one page by bare id: the page object plus a bounded page of top-level blocks", async () => {
    useOrderedMatching();
    const api = makeNotionNamedReadApi({ token: token() });
    const result = await readNotionObject({
      address: REAL_PAGE_ID,
      after: undefined,
      api,
      kind: "page",
      limit: 5,
      nested: NESTED,
      nowIso: () => "2026-01-01T00:00:00.000Z",
    });
    expect(result.isOk()).toBe(true);
    const doc = unwrap(result);
    expect(doc.target.identity).toBe(REAL_PAGE_ID);
    const data = doc.data as { page: { object: string }; blocks: { results: readonly unknown[]; hasMore: boolean } };
    expect(data.page.object).toBe("page");
    expect(data.blocks.results.length).toBe(5);
    expect(data.blocks.hasMore).toBe(true);
    expect(doc.coverage.residue).toContain(
      "more top-level blocks remain: read the next slice with --after cursor_2131",
    );
    // The slice's one container (a table) is listed through the children endpoint, one call, nothing left over.
    const nested = (doc.data as { nested: { calls: number; complete: boolean; unexpanded: readonly unknown[] } })
      .nested;
    expect(nested.calls).toBe(1);
    expect(nested.complete).toBe(true);
    expect(nested.unexpanded).toEqual([]);
  });

  it("reads a synced duplicate through its original", async () => {
    useOrderedMatching();
    const api = makeNotionNamedReadApi({ token: token() });
    const result = await readNotionObject({
      address: SYNCED_DUPLICATE_PAGE_ID,
      after: undefined,
      api,
      kind: "page",
      limit: 100,
      nested: NESTED,
      nowIso: () => "2026-01-01T00:00:00.000Z",
    });
    expect(result.isOk()).toBe(true);
    const data = unwrap(result).data as {
      blockTree: readonly {
        block: { type: string };
        expansion: string;
        children: readonly { block: { type: string }; expansion: string }[];
      }[];
      nested: { calls: number; complete: boolean };
    };
    // Listing the duplicate's OWN id answers an empty list with no error; the original's id carries the content.
    const synced = data.blockTree.find((node) => node.block.type === "synced_block")!;
    expect(synced.expansion).toBe("complete");
    expect(synced.children.map((child) => child.block.type)).toEqual(["paragraph"]);
    expect(data.nested.calls).toBe(1);
    expect(data.nested.complete).toBe(true);
  });

  it("reads the same page addressed as a notion.so URL, resolving to the identical id", async () => {
    useOrderedMatching();
    const api = makeNotionNamedReadApi({ token: token() });
    const result = await readNotionObject({
      address: REAL_PAGE_URL,
      after: undefined,
      api,
      kind: "page",
      limit: 1,
      nested: NESTED,
      nowIso: () => "2026-01-01T00:00:00.000Z",
    });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result).target.identity).toBe(REAL_PAGE_ID);
  });

  it("reads one database object by its real database id", async () => {
    const api = makeNotionNamedReadApi({ token: token() });
    const result = await readNotionObject({
      address: REAL_DATABASE_ID,
      after: undefined,
      api,
      kind: "database",
      limit: 1,
      nested: NESTED,
      nowIso: () => "2026-01-01T00:00:00.000Z",
    });
    expect(result.isOk()).toBe(true);
    const doc = unwrap(result);
    // `doc.target.identity` is this repo's own PARSED address, resolved locally before any network call —
    // never touched by cassette redaction. `data.id` (the response body's own id) is a STRING id and IS
    // redacted to a synthetic value on replay, so it is deliberately not asserted here.
    expect(doc.target.identity).toBe(REAL_DATABASE_ID);
    const data = doc.data as { object: string };
    expect(data.object).toBe("database");
  });

  it("resolves the integration's own bot user id", async () => {
    const writeApi = notionWriteApi();
    const result = await writeApi.botUserId();
    expect(result.isOk()).toBe(true);
    expect(unwrap(result).length).toBeGreaterThan(0);
  });

  it("creates a page from markdown, reads it back, replaces its content, and archives it", async () => {
    useOrderedMatching();
    const writeApi = notionWriteApi();

    const created = await writeApi.createPage({
      icon: undefined,
      markdown: "original-body-marker",
      parentPageId: WRITE_PARENT_PAGE_ID,
      title: "slopweaver integration test fixture",
    });
    expect(created.isOk()).toBe(true);
    const page = unwrap(created);
    expect(page.archived).toBe(false);

    const firstRead = await writeApi.retrieveMarkdown({ pageId: page.id });
    expect(firstRead.isOk()).toBe(true);
    expect(unwrap(firstRead).markdown).toContain("original-body-marker");
    expect(unwrap(firstRead).truncated).toBe(false);

    const replaced = await writeApi.replaceMarkdown({ markdown: "replaced-body-marker", pageId: page.id });
    expect(replaced.isOk()).toBe(true);

    const secondRead = await writeApi.retrieveMarkdown({ pageId: page.id });
    expect(secondRead.isOk()).toBe(true);
    expect(unwrap(secondRead).markdown).toContain("replaced-body-marker");
    expect(unwrap(secondRead).markdown).not.toContain("original-body-marker");

    // The authorship signal `writeApi.ts`'s header describes: a page nobody but the bot has touched reports
    // its own bot id back as `lastEditedBy`, which is what makes a later update-safety check trustworthy.
    const botId = unwrap(await writeApi.botUserId());
    const readBack = await writeApi.retrievePage({ pageId: page.id });
    expect(readBack.isOk()).toBe(true);
    expect(unwrap(readBack)?.lastEditedBy).toBe(botId);

    const archived = await writeApi.archivePage({ pageId: page.id });
    expect(archived.isOk()).toBe(true);
    const afterArchive = await writeApi.retrievePage({ pageId: page.id });
    expect(afterArchive.isOk()).toBe(true);
    expect(unwrap(afterArchive)?.archived).toBe(true);
  });

  it("moves that page under a second parent, and the page reads back under it", async () => {
    useOrderedMatching();
    const writeApi = notionWriteApi();

    // Two disposable pages, both under the suite's own write parent: one to move, one to move it under.
    const destination = await writeApi.createPage({
      icon: undefined,
      markdown: "move-destination-marker",
      parentPageId: WRITE_PARENT_PAGE_ID,
      title: "slopweaver integration test move destination",
    });
    expect(destination.isOk()).toBe(true);
    const subject = await writeApi.createPage({
      icon: undefined,
      markdown: "move-subject-marker",
      parentPageId: WRITE_PARENT_PAGE_ID,
      title: "slopweaver integration test move subject",
    });
    expect(subject.isOk()).toBe(true);

    // The parent it STARTS under, kept so the move can be shown to have CHANGED it. Compared against
    // another RESPONSE-derived id rather than against `WRITE_PARENT_PAGE_ID`: a response body's id is
    // redacted to a synthetic on replay, so asserting the real constant here would pass only while
    // recording — exactly the trap the database test's own comment describes.
    expect(unwrap(subject).parent?.kind).toBe("page_id");
    const parentBefore = unwrap(subject).parent?.id;
    expect(parentBefore).not.toBe(unwrap(destination).id);

    const moved = await writeApi.movePage({ pageId: unwrap(subject).id, parentPageId: unwrap(destination).id });
    expect(moved.isOk()).toBe(true);

    // The read-back, not the move's own response, is what this test is for: `notion page move` reports
    // `moved` only when the page ITSELF says it hangs where it was sent.
    const afterMove = await writeApi.retrievePage({ pageId: unwrap(subject).id });
    expect(afterMove.isOk()).toBe(true);
    expect(unwrap(afterMove)?.parent?.kind).toBe("page_id");
    expect(unwrap(afterMove)?.parent?.id).toBe(unwrap(destination).id);
    expect(unwrap(afterMove)?.parent?.id).not.toBe(parentBefore);

    // The move changed no content: the body it was created with is still exactly there.
    const body = await writeApi.retrieveMarkdown({ pageId: unwrap(subject).id });
    expect(body.isOk()).toBe(true);
    expect(unwrap(body).markdown).toContain("move-subject-marker");

    // Archiving the destination trashes the subject with it, so both are read back to prove it.
    expect((await writeApi.archivePage({ pageId: unwrap(subject).id })).isOk()).toBe(true);
    expect((await writeApi.archivePage({ pageId: unwrap(destination).id })).isOk()).toBe(true);
    expect(unwrap(await writeApi.retrievePage({ pageId: unwrap(subject).id }))?.archived).toBe(true);
    expect(unwrap(await writeApi.retrievePage({ pageId: unwrap(destination).id }))?.archived).toBe(true);
  });
});
