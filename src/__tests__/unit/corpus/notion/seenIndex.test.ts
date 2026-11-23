import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { OwnerProtectionResolver } from "../../../../corpus/bronzeProtection.js";
import { recordNotionCaptureCoverage } from "../../../../corpus/notion/captureCoverage.js";
import {
  buildNotionSeenIndex,
  EMPTY_NOTION_SEEN_INDEX,
  notionSeenIndexFrom,
} from "../../../../corpus/notion/seenIndex.js";
import { CAPTURE_PARTIAL } from "../../../../corpus/types.js";
import { ok, unwrap, unwrapErr } from "../../../../lib/result.js";

/** An owner protect list with no entries, so no test reads the owner's own registry. */
const NO_ENTRIES: OwnerProtectionResolver = () => ok([]);

const PAGE = "0e2f4a1b-1111-4222-8333-444455556666";
const OTHER = "0e2f4a1b-9999-4222-8333-444455556666";
/** A completed `--all` crawl's recorded coverage: every capture in bronze is marker-aware. */
const COVERED = "1970-01-01";

describe("notionSeenIndexFrom", () => {
  it("answers unchanged for a page bronze holds at the exact same last_edited_time", () => {
    const index = notionSeenIndexFrom({
      coveredSinceIso: COVERED,
      rows: [{ sourceId: `page:${PAGE}`, tsIso: "2026-05-01T00:00:00.000Z" }],
    });
    expect(index.isUnchanged({ id: PAGE, lastEdited: "2026-05-01T00:00:00.000Z" })).toBe(true);
    expect(index.size).toBe(1);
  });

  it("answers CHANGED when the page was edited after the capture bronze holds", () => {
    const index = notionSeenIndexFrom({
      coveredSinceIso: COVERED,
      rows: [{ sourceId: `page:${PAGE}`, tsIso: "2026-05-01T00:00:00.000Z" }],
    });
    expect(index.isUnchanged({ id: PAGE, lastEdited: "2026-05-02T00:00:00.000Z" })).toBe(false);
  });

  it("answers changed for a page bronze has never seen", () => {
    const index = notionSeenIndexFrom({
      coveredSinceIso: COVERED,
      rows: [{ sourceId: `page:${PAGE}`, tsIso: "2026-05-01T00:00:00.000Z" }],
    });
    expect(index.isUnchanged({ id: OTHER, lastEdited: "2026-05-01T00:00:00.000Z" })).toBe(false);
  });

  it("keys chunked page records back to the one page id", () => {
    const index = notionSeenIndexFrom({
      coveredSinceIso: COVERED,
      rows: [
        { sourceId: `page:${PAGE}:chunk:0`, tsIso: "2026-05-01T00:00:00.000Z" },
        { sourceId: `page:${PAGE}:chunk:1`, tsIso: "2026-05-01T00:00:00.000Z" },
      ],
    });
    expect(index.size).toBe(1);
    expect(index.isUnchanged({ id: PAGE, lastEdited: "2026-05-01T00:00:00.000Z" })).toBe(true);
  });

  it("REFUSES to skip a capture the connector recorded as truncated", () => {
    const index = notionSeenIndexFrom({
      coveredSinceIso: COVERED,
      rows: [{ capture: CAPTURE_PARTIAL, sourceId: `page:${PAGE}`, tsIso: "2026-05-01T00:00:00.000Z" }],
    });
    expect(index.isUnchanged({ id: PAGE, lastEdited: "2026-05-01T00:00:00.000Z" })).toBe(false);
  });

  it("refuses the skip when only ONE chunk of the page carries the partial marker", () => {
    const index = notionSeenIndexFrom({
      coveredSinceIso: COVERED,
      rows: [
        { sourceId: `page:${PAGE}:chunk:0`, tsIso: "2026-05-01T00:00:00.000Z" },
        { capture: CAPTURE_PARTIAL, sourceId: `page:${PAGE}:chunk:1`, tsIso: "2026-05-01T00:00:00.000Z" },
      ],
    });
    expect(index.isUnchanged({ id: PAGE, lastEdited: "2026-05-01T00:00:00.000Z" })).toBe(false);
  });

  it("lets a later COMPLETE capture supersede an earlier partial one", () => {
    const index = notionSeenIndexFrom({
      coveredSinceIso: COVERED,
      rows: [
        { capture: CAPTURE_PARTIAL, sourceId: `page:${PAGE}`, tsIso: "2026-05-01T00:00:00.000Z" },
        { sourceId: `page:${PAGE}`, tsIso: "2026-05-09T00:00:00.000Z" },
      ],
    });
    expect(index.isUnchanged({ id: PAGE, lastEdited: "2026-05-09T00:00:00.000Z" })).toBe(true);
    expect(index.isUnchanged({ id: PAGE, lastEdited: "2026-05-01T00:00:00.000Z" })).toBe(false);
  });

  it("keeps the NEWEST capture regardless of the order rows arrive in", () => {
    const index = notionSeenIndexFrom({
      coveredSinceIso: COVERED,
      rows: [
        { sourceId: `page:${PAGE}`, tsIso: "2026-05-09T00:00:00.000Z" },
        { sourceId: `page:${PAGE}`, tsIso: "2026-05-01T00:00:00.000Z" },
      ],
    });
    expect(index.isUnchanged({ id: PAGE, lastEdited: "2026-05-09T00:00:00.000Z" })).toBe(true);
  });

  it("ignores rows that are not page records — a database is never skippable", () => {
    const index = notionSeenIndexFrom({
      coveredSinceIso: COVERED,
      rows: [
        { sourceId: `database:${PAGE}`, tsIso: "2026-05-01T00:00:00.000Z" },
        { sourceId: `comment:${PAGE}`, tsIso: "2026-05-01T00:00:00.000Z" },
      ],
    });
    expect(index.size).toBe(0);
    expect(index.isUnchanged({ id: PAGE, lastEdited: "2026-05-01T00:00:00.000Z" })).toBe(false);
  });

  it("is empty for no rows at all", () => {
    const index = notionSeenIndexFrom({ coveredSinceIso: COVERED, rows: [] });
    expect(index.size).toBe(0);
    expect(index.isUnchanged({ id: PAGE, lastEdited: "2026-05-01T00:00:00.000Z" })).toBe(false);
  });
});

describe("notionSeenIndexFrom trusts an UNMARKED capture only inside recorded coverage", () => {
  const rows = [{ sourceId: `page:${PAGE}`, tsIso: "2026-05-01T00:00:00.000Z" }];

  it("skips NOTHING when no marker-aware crawl has ever completed", () => {
    const index = notionSeenIndexFrom({ rows });
    expect(index.size).toBe(1);
    expect(index.isUnchanged({ id: PAGE, lastEdited: "2026-05-01T00:00:00.000Z" })).toBe(false);
  });

  it("refuses a capture OLDER than the covered window — it may be a legacy truncation", () => {
    const index = notionSeenIndexFrom({ coveredSinceIso: "2026-06-01", rows });
    expect(index.isUnchanged({ id: PAGE, lastEdited: "2026-05-01T00:00:00.000Z" })).toBe(false);
  });

  it("trusts a capture at or after the covered window", () => {
    const index = notionSeenIndexFrom({ coveredSinceIso: "2026-05-01", rows });
    expect(index.isUnchanged({ id: PAGE, lastEdited: "2026-05-01T00:00:00.000Z" })).toBe(true);
  });
});

describe("EMPTY_NOTION_SEEN_INDEX", () => {
  it("skips nothing, so --refetch-unchanged restores the re-fetch-everything behaviour", () => {
    expect(EMPTY_NOTION_SEEN_INDEX.size).toBe(0);
    expect(EMPTY_NOTION_SEEN_INDEX.isUnchanged({ id: PAGE, lastEdited: "2026-05-01T00:00:00.000Z" })).toBe(false);
  });

  it("holds no ids at all — the grant-delta reach report's empty starting point", () => {
    expect(EMPTY_NOTION_SEEN_INDEX.heldPageIds).toEqual(new Set());
    expect(EMPTY_NOTION_SEEN_INDEX.heldDatabaseIds).toEqual(new Set());
  });
});

describe("notionSeenIndexFrom held ids — the bronze half of grant-delta detection", () => {
  it("collects every page id captured, even one only ever seen as a partial capture", () => {
    const index = notionSeenIndexFrom({
      rows: [{ capture: CAPTURE_PARTIAL, sourceId: `page:${PAGE}`, tsIso: "2026-05-01T00:00:00.000Z" }],
    });
    expect(index.heldPageIds).toEqual(new Set([PAGE]));
  });

  it("keys chunked page records back to the one held page id", () => {
    const index = notionSeenIndexFrom({
      rows: [
        { sourceId: `page:${PAGE}:chunk:0`, tsIso: "2026-05-01T00:00:00.000Z" },
        { sourceId: `page:${PAGE}:chunk:1`, tsIso: "2026-05-01T00:00:00.000Z" },
      ],
    });
    expect(index.heldPageIds).toEqual(new Set([PAGE]));
  });

  it("collects database ids separately from page ids", () => {
    const index = notionSeenIndexFrom({
      rows: [
        { sourceId: `page:${PAGE}`, tsIso: "2026-05-01T00:00:00.000Z" },
        { sourceId: `database:${OTHER}`, tsIso: "2026-05-01T00:00:00.000Z" },
      ],
    });
    expect(index.heldPageIds).toEqual(new Set([PAGE]));
    expect(index.heldDatabaseIds).toEqual(new Set([OTHER]));
  });

  it("ignores a comment record for held-id purposes", () => {
    const index = notionSeenIndexFrom({
      rows: [{ sourceId: `page:${PAGE}:comment:abc`, tsIso: "2026-05-01T00:00:00.000Z" }],
    });
    expect(index.heldPageIds).toEqual(new Set());
    expect(index.heldDatabaseIds).toEqual(new Set());
  });
});

describe("buildNotionSeenIndex", () => {
  const fixtureDirs: string[] = [];

  afterEach(() => {
    for (const dir of fixtureDirs.splice(0)) {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it("reads every bronze window file, tolerating a truncated tail line from a killed run", async () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-seen-"));
    fixtureDirs.push(home);
    const dir = join(home, "corpus", "bronze", "notion");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "2026-01-01_2026-05-01.jsonl"),
      `${JSON.stringify({ sourceId: `page:${PAGE}`, tsIso: "2026-05-01T00:00:00.000Z" })}\n`,
    );
    writeFileSync(
      join(dir, "2026-05-01_2026-06-01.jsonl"),
      [
        JSON.stringify({
          attrs: { capture: CAPTURE_PARTIAL },
          sourceId: `page:${OTHER}`,
          tsIso: "2026-05-20T00:00:00.000Z",
        }),
        '{"sourceId":"page:0e2f4a1b-1111-4222-8333-4444555',
      ].join("\n"),
    );
    recordNotionCaptureCoverage({ home, sinceIso: COVERED });
    const index = unwrap(await buildNotionSeenIndex({ home, protection: NO_ENTRIES }));
    expect(index.size).toBe(2);
    expect(index.isUnchanged({ id: PAGE, lastEdited: "2026-05-01T00:00:00.000Z" })).toBe(true);
    expect(index.isUnchanged({ id: OTHER, lastEdited: "2026-05-20T00:00:00.000Z" })).toBe(false);
  });

  it("is empty when Notion has never been ingested", async () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-seen-empty-"));
    fixtureDirs.push(home);
    const index = unwrap(await buildNotionSeenIndex({ home, protection: NO_ENTRIES }));
    expect(index.size).toBe(0);
  });

  it("refuses, rather than answering with an empty index, when the protect list marks Notion bronze no-access", async () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-seen-protected-"));
    fixtureDirs.push(home);
    const dir = join(home, "corpus", "bronze", "notion");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "w.jsonl"), `${JSON.stringify({ sourceId: `page:${PAGE}`, tsIso: COVERED })}\n`);
    const entry = { addedIso: "2026-01-01T00:00:00.000Z", mode: "no-access" as const, path: dir, why: "fixture" };

    const refusal = unwrapErr(await buildNotionSeenIndex({ home, protection: () => ok([entry]) }));

    expect(refusal).toEqual([
      `refusing to read notion: it would search ${dir}, which the owner's protect list marks no-access at ${dir} (fixture)`,
    ]);
  });
});
