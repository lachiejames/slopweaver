/**
 * Listing the Notion page ledger's `pages` index for the publication audit: a home with no index is an empty
 * inventory, a file that is not a whole record is counted rather than dropped, and an index that cannot be listed is
 * an error, never an empty list. Real filesystem, in a temp dir. No mocks.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { adoptPage } from "../../../../outbound/notion/pageLedger.js";
import { listPageRecords } from "../../../../outbound/notion/pageLedgerListing.js";
import { stateHomePaths } from "../../../../stateHome.js";

const PAGE = "00000000-0000-0000-0000-00000000a001";
const CORRUPT = "00000000-0000-0000-0000-00000000a002";
const URL = "https://app.notion.com/p/x-00000000000000000000000000a001";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function home(): string {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-notion-ledger-list-"));
  fixtureDirs.push(dir);
  return dir;
}

function pagesDir({ root }: { root: string }): string {
  return join(stateHomePaths({ home: root }).ledgers, "notion-pages", "pages");
}

describe("listPageRecords", () => {
  it("answers an empty inventory for a home no write ever touched", () => {
    const listed = listPageRecords({ home: home() });
    expect(listed.isOk()).toBe(true);
    expect(unwrap(listed)).toEqual({ rows: [], unreadableRows: 0 });
  });

  it("lists a whole record and counts a corrupt file and a malformed name", () => {
    const root = home();
    adoptPage({ canonical: "digest", home: root, nowIso: "2026-11-01T00:00:00.000Z", pageId: PAGE, url: URL });
    writeFileSync(join(pagesDir({ root }), `${CORRUPT}.json`), "{not json");
    writeFileSync(join(pagesDir({ root }), "notes.txt"), "{}");
    const listed = unwrap(listPageRecords({ home: root }));
    expect(listed.unreadableRows).toBe(2);
    expect(listed.rows.map((record) => [record.pageId, record.intent, record.url, record.confirmedIso])).toEqual([
      [PAGE, `adopted:${PAGE}`, URL, "2026-11-01T00:00:00.000Z"],
    ]);
  });

  it("refuses an index it cannot list with a fixed message, rather than answering empty", () => {
    const root = home();
    mkdirSync(join(stateHomePaths({ home: root }).ledgers, "notion-pages"), { recursive: true });
    // A FILE where the directory should be: listing it fails with ENOTDIR, which is not absence.
    writeFileSync(pagesDir({ root }), "");
    const listed = listPageRecords({ home: root });
    expect(listed.isErr()).toBe(true);
    expect(unwrapErr(listed)).toEqual({
      code: "PAGE_INDEX_UNLISTABLE",
      message: "the notion page ledger's pages index could not be listed",
    });
  });
});
