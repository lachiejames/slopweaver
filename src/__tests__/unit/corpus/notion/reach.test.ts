import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { NotionDatabaseItem, NotionPageItem } from "../../../../corpus/notion/project.js";
import {
  backfillNotionGrantDelta,
  computeGrantDelta,
  type NotionReachApi,
  type NotionReachHit,
  structureNotionDataSourceIds,
  summariseGrantDelta,
} from "../../../../corpus/notion/reach.js";
import type { NotionSkip } from "../../../../corpus/notion/skips.js";
import { writeStructureRows } from "../../../../corpus/structures/store.js";
import type { StructureBronzeRow } from "../../../../corpus/structures/types.js";
import { unwrap } from "../../../../lib/result.js";
import { NO_PROTECTION } from "../../../noProtection.js";

const A = "0e2f4a1b-1111-4222-8333-444455556661";
const B = "0e2f4a1b-1111-4222-8333-444455556662";
const C = "0e2f4a1b-1111-4222-8333-444455556663";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function tempHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-reach-"));
  fixtureDirs.push(dir);
  return dir;
}

function reachHit({ id, title = "" }: { id: string; title?: string }): NotionReachHit {
  return {
    id,
    lastEdited: "2026-05-01T00:00:00.000Z",
    raw: title.length > 0 ? { id, title: [{ plain_text: title, type: "text" }] } : { id },
  };
}

function pageItem({ id, parent }: { id: string; parent?: string }): NotionPageItem {
  return {
    chunks: ["body"],
    comments: [],
    id,
    title: `page ${id}`,
    tsIso: "2026-05-01T00:00:00.000Z",
    url: `https://notion.so/${id}`,
    ...(parent !== undefined ? { parent } : {}),
  };
}

function databaseItem({ id }: { id: string }): NotionDatabaseItem {
  return {
    description: "",
    id,
    title: `db ${id}`,
    tsIso: "2026-05-01T00:00:00.000Z",
    url: `https://notion.so/${id}`,
  };
}

describe("computeGrantDelta", () => {
  it("keeps only the ids not already held", () => {
    const delta = computeGrantDelta({
      databases: [reachHit({ id: A }), reachHit({ id: B })],
      heldDatabaseIds: new Set([A]),
      heldPageIds: new Set([B]),
      pages: [reachHit({ id: B }), reachHit({ id: C })],
    });
    expect(delta.newPages.map((hit) => hit.id)).toEqual([C]);
    expect(delta.newDatabases.map((hit) => hit.id)).toEqual([B]);
  });

  it("is empty when everything reachable is already held", () => {
    const delta = computeGrantDelta({
      databases: [reachHit({ id: A })],
      heldDatabaseIds: new Set([A]),
      heldPageIds: new Set([B]),
      pages: [reachHit({ id: B })],
    });
    expect(delta.newPages).toEqual([]);
    expect(delta.newDatabases).toEqual([]);
  });
});

describe("summariseGrantDelta", () => {
  it("reports nothing-new plainly when the delta is empty", () => {
    const summary = summariseGrantDelta({
      delta: { newDatabases: [], newPages: [] },
      totalDatabases: 10,
      totalPages: 100,
    });
    expect(summary).toBe(
      "reach: 100 page(s) + 10 database(s) reachable, all already held — nothing newly reachable this run",
    );
  });

  it("reports the reachable/held/new split and lists roots by title", () => {
    const summary = summariseGrantDelta({
      delta: {
        newDatabases: [reachHit({ id: B, title: "Operations Protocols" })],
        newPages: [reachHit({ id: A, title: "Sales Guide" })],
      },
      totalDatabases: 10,
      totalPages: 100,
    });
    expect(summary).toBe(
      "reach: 100 page(s) + 10 database(s) reachable — 99 page(s) + 9 database(s) already held, " +
        "+1 page(s) + 1 database(s) newly reachable this run, backfilled regardless of edit date; " +
        "roots: Sales Guide, Operations Protocols",
    );
  });

  it("omits the roots clause when no newly-reachable hit rendered a title", () => {
    const summary = summariseGrantDelta({
      delta: { newDatabases: [], newPages: [reachHit({ id: A })] },
      totalDatabases: 0,
      totalPages: 1,
    });
    expect(summary).toBe(
      "reach: 1 page(s) + 0 database(s) reachable — 0 page(s) + 0 database(s) already held, " +
        "+1 page(s) + 0 database(s) newly reachable this run, backfilled regardless of edit date",
    );
  });
});

describe("backfillNotionGrantDelta", () => {
  const fakeApi = ({
    pageHits,
    databaseHits,
    pageItems,
    rowItems,
    databaseItems,
    skip,
  }: {
    pageHits: readonly NotionReachHit[];
    databaseHits: readonly NotionReachHit[];
    pageItems: readonly NotionPageItem[];
    rowItems: readonly NotionPageItem[];
    databaseItems: readonly NotionDatabaseItem[];
    skip?: NotionSkip;
  }): NotionReachApi => ({
    backfillDatabases: async () => ({
      databases: databaseItems,
      notes: ["backfilled databases"],
      rows: rowItems,
      skips: [],
    }),
    backfillPages: async () => ({ notes: ["backfilled pages"], pages: pageItems, skips: [] }),
    enumerateDatabases: async () => ({ hits: databaseHits, skips: [] }),
    enumeratePages: async () => ({ hits: pageHits, skips: skip !== undefined ? [skip] : [] }),
  });

  it("backfills only the delta and reports the reach summary", async () => {
    const result = await backfillNotionGrantDelta({
      api: fakeApi({
        databaseHits: [],
        databaseItems: [],
        pageHits: [reachHit({ id: A }), reachHit({ id: B })],
        pageItems: [pageItem({ id: B })],
        rowItems: [],
      }),
      heldDatabaseIds: new Set(),
      heldPageIds: new Set([A]),
    });
    expect(result.pages.map((page) => page.id)).toEqual([B]);
    expect(result.summary).toContain("+1 page(s) + 0 database(s) newly reachable");
    expect(result.notes).toEqual(["backfilled pages", "backfilled databases"]);
  });

  it("reconciles a data-source row that the pages lane also found as a shadow", async () => {
    const shadow = pageItem({ id: B, parent: "db1" });
    const row = pageItem({ id: B, parent: "db1" });
    const result = await backfillNotionGrantDelta({
      api: fakeApi({
        databaseHits: [reachHit({ id: "db1" })],
        databaseItems: [databaseItem({ id: "db1" })],
        pageHits: [reachHit({ id: B })],
        pageItems: [shadow],
        rowItems: [row],
      }),
      heldDatabaseIds: new Set(),
      heldPageIds: new Set(),
    });
    // one merged item, not two competing ones under the same id
    expect(result.pages.map((page) => page.id)).toEqual([B]);
    expect(result.databases.map((database) => database.id)).toEqual(["db1"]);
  });

  it("carries every skip collected across enumeration and backfill", async () => {
    const skip: NotionSkip = { operation: "notion.search.reach.pages", reason: "network", subject: "search" };
    const result = await backfillNotionGrantDelta({
      api: fakeApi({
        databaseHits: [],
        databaseItems: [],
        pageHits: [],
        pageItems: [],
        rowItems: [],
        skip,
      }),
      heldDatabaseIds: new Set(),
      heldPageIds: new Set(),
    });
    expect(result.skips).toEqual([skip]);
  });
});

describe("structureNotionDataSourceIds", () => {
  function dataSourceRow({ sourceId }: { sourceId: string }): StructureBronzeRow {
    return {
      attrs: { propertyCount: 0, propertyNames: [] },
      fetchedAtIso: "2026-05-01T00:00:00.000Z",
      identity: { nativeId: sourceId },
      kind: "data_source",
      provenance: ["notion.dataSources.retrieve"],
      raw: { id: sourceId },
      relations: [],
      source: "notion",
      sourceId,
      version: 1,
      warnings: [],
    };
  }

  it("returns only data-source ids from the notion structures store", () => {
    const home = tempHome();
    unwrap(
      writeStructureRows({
        home,
        protection: NO_PROTECTION,
        rows: [dataSourceRow({ sourceId: A }), dataSourceRow({ sourceId: B })],
        source: "notion",
      }),
    );
    const ids = structureNotionDataSourceIds({ home });
    expect(ids).toEqual(new Set([A, B]));
  });

  it("is empty when the notion structures store has never been written", () => {
    const ids = structureNotionDataSourceIds({ home: tempHome() });
    expect(ids).toEqual(new Set());
  });
});
