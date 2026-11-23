/**
 * The Notion incremental flush over a throwaway home, and the durability notes it feeds — imported from
 * their own modules rather than through `tokenedJobs.ts`'s re-export.
 */
import { chmodSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { flushNotionBatch } from "../../../../../cli/commands/refresh/tokenedJobsNotion.js";
import { notionDurabilityNotes } from "../../../../../cli/commands/refresh/tokenedJobsNotionNotes.js";
import type { OwnerProtectionResolver } from "../../../../../corpus/bronzeProtection.js";
import { readCorpusDir } from "../../../../../corpus/corpusDirRead.js";
import { bronzeFile, bronzeSourceDir } from "../../../../../corpus/corpusPaths.js";
import type { CorpusRecord, ExportWindow } from "../../../../../corpus/types.js";
import { ok, unwrap } from "../../../../../lib/result.js";

/** An owner protect list with no entries, so no test reads the owner's own registry. */
const NO_ENTRIES: OwnerProtectionResolver = () => ok([]);

const window: ExportWindow = { since: "2026-01-01", until: "2026-02-01" };

/** One Notion page record, varied only by its id. */
function page({ sourceId }: { sourceId: string }): CorpusRecord {
  return {
    container: "notion",
    kind: "page",
    refs: [],
    source: "notion",
    sourceId,
    text: "hi",
    tsIso: "2026-01-15T00:00:00Z",
    url: "u",
  };
}

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "notion-flush-"));
});
afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** The Notion sourceIds bronze holds, read back through the production reader. */
function bronzeNotionIds(): readonly string[] {
  return unwrap(
    readCorpusDir({ dir: bronzeSourceDir({ home, source: "notion" }), home, protection: NO_ENTRIES }),
  ).records.map((record) => record.sourceId);
}

describe("flushNotionBatch", () => {
  it("writes a non-empty batch to bronze at once and counts it as written", () => {
    const spend = { failed: 0, written: 0 };

    flushNotionBatch({ home, spend, window })({ records: [page({ sourceId: "page:1" })] });

    expect(spend).toEqual({ failed: 0, written: 1 });
    expect(bronzeNotionIds()).toEqual(["page:1"]);
  });

  it("leaves the spend and the disk alone for an empty batch", () => {
    const spend = { failed: 0, written: 0 };

    flushNotionBatch({ home, spend, window })({ records: [] });

    expect(spend).toEqual({ failed: 0, written: 0 });
    expect(readdirSync(home, { recursive: true })).toEqual([]);
  });

  it("counts a batch the writer refuses as one failure, adding nothing to written", () => {
    // An earlier flush's window file made unreadable, so the dedup index cannot be built and the commit refuses.
    const spend = { failed: 0, written: 0 };
    flushNotionBatch({ home, spend, window })({ records: [page({ sourceId: "page:1" })] });
    chmodSync(bronzeFile({ home, source: "notion", window }), 0o000);

    flushNotionBatch({ home, spend, window })({ records: [page({ sourceId: "page:2" })] });

    expect(spend).toEqual({ failed: 1, written: 1 });
  });

  it("dedups a record a second batch repeats, writing two unique records across both", () => {
    const spend = { failed: 0, written: 0 };
    const flush = flushNotionBatch({ home, spend, window });

    flush({ records: [page({ sourceId: "page:1" })] });
    flush({ records: [page({ sourceId: "page:1" }), page({ sourceId: "page:2" })] });

    expect(spend).toEqual({ failed: 0, written: 2 });
    expect(bronzeNotionIds()).toEqual(["page:1", "page:2"]);
  });
});

describe("notionDurabilityNotes", () => {
  it("says nothing when nothing was flushed and nothing failed", () => {
    expect(notionDurabilityNotes({ spend: { failed: 0, written: 0 } })).toEqual([]);
  });

  it("reports a flush with no failure as one line", () => {
    expect(notionDurabilityNotes({ spend: { failed: 0, written: 5 } })).toEqual([
      "durability: flushed 5 record(s) to bronze incrementally during the crawl",
    ]);
  });

  it("reports a failure with nothing flushed as one line", () => {
    expect(notionDurabilityNotes({ spend: { failed: 2, written: 0 } })).toEqual([
      "durability: 2 incremental batch write(s) FAILED — that content only lands via the closing write, if the run completes",
    ]);
  });

  it("reports both, flush first, as two lines", () => {
    expect(notionDurabilityNotes({ spend: { failed: 1, written: 3 } })).toEqual([
      "durability: flushed 3 record(s) to bronze incrementally during the crawl",
      "durability: 1 incremental batch write(s) FAILED — that content only lands via the closing write, if the run completes",
    ]);
  });
});
