/*
 * `compactSource` re-spelling an undashed Notion page id onto the dashed one the API writes, so the two spellings of
 * one page become one identity, and leaving every other id alone.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { OwnerProtectionResolver } from "../../../../corpus/bronzeProtection.js";
import { compactSource } from "../../../../corpus/compact.js";
import { readCorpusDir } from "../../../../corpus/corpusDirRead.js";
import { bronzeSourceDir } from "../../../../corpus/corpusPaths.js";
import { latestRecords } from "../../../../corpus/latestRecords.js";
import type { CorpusRecord } from "../../../../corpus/types.js";
import { ok, unwrap } from "../../../../lib/result.js";
import { canonical, home, jsonl, record, useCompactHome, writeWindow } from "./harness.js";

/** An owner protect list with no entries, so no test reads the owner's own registry. */
const NO_ENTRIES: OwnerProtectionResolver = () => ok([]);

useCompactHome();

describe("compactSource re-keys an undashed Notion page id onto the dashed one", () => {
  const DASHED = "0123abcd-4567-89ab-cdef-0123456789ab";
  const UNDASHED = "0123abcd456789abcdef0123456789ab";
  const page = (over: Partial<CorpusRecord> = {}): CorpusRecord =>
    record({ container: "notion/parent", kind: "page", source: "notion", sourceId: `page:${DASHED}`, ...over });
  const writeNotion = ({ records }: { records: readonly CorpusRecord[] }): void => {
    const dir = bronzeSourceDir({ home, source: "notion" });
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "a.jsonl"), jsonl({ records }), "utf8");
  };
  const notionIds = (): readonly string[] =>
    unwrap(
      readCorpusDir({ dir: bronzeSourceDir({ home, source: "notion" }), home, protection: NO_ENTRIES }),
    ).records.map((r) => r.sourceId);

  it("collapses an undashed row into its dashed twin of identical content", () => {
    writeNotion({ records: [page({ sourceId: `page:${UNDASHED}` }), page()] });

    const plan = unwrap(compactSource({ home, protection: NO_ENTRIES, source: "notion" }));

    expect(plan.rekeyed).toBe(1);
    expect(plan.duplicatesCollapsed).toBe(1);
    expect(notionIds()).toStrictEqual([`page:${DASHED}`]);
  });

  it("keeps two differing versions under ONE identity, so the latest view holds one page", () => {
    writeNotion({
      records: [
        page({ sourceId: `page:${UNDASHED}`, text: "old", tsIso: "2026-06-01T00:00:00.000Z" }),
        page({ text: "new", tsIso: "2026-06-02T00:00:00.000Z" }),
      ],
    });

    const plan = unwrap(compactSource({ home, protection: NO_ENTRIES, source: "notion" }));
    const read = unwrap(
      readCorpusDir({ dir: bronzeSourceDir({ home, source: "notion" }), home, protection: NO_ENTRIES }),
    ).records;

    expect(plan.after.records).toBe(2);
    expect(read.map((r) => r.sourceId)).toStrictEqual([`page:${DASHED}`, `page:${DASHED}`]);
    expect(latestRecords({ records: read }).map((r) => r.text)).toStrictEqual(["new"]);
  });

  it("re-keys a chunk and a comment id under the page, and leaves a database id alone", () => {
    const commentId = "fedcba98-7654-3210-fedc-ba9876543210";
    writeNotion({
      records: [
        page({ sourceId: `page:${UNDASHED}:chunk:1`, text: "chunk" }),
        page({ kind: "comment", sourceId: `page:${UNDASHED}:comment:${commentId}`, text: "comment" }),
        page({ kind: "database", sourceId: `database:${UNDASHED}`, text: "db" }),
      ],
    });

    const plan = unwrap(compactSource({ home, protection: NO_ENTRIES, source: "notion" }));

    expect(plan.rekeyed).toBe(2);
    expect(notionIds()).toStrictEqual([
      `page:${DASHED}:chunk:1`,
      `page:${DASHED}:comment:${commentId}`,
      `database:${UNDASHED}`,
    ]);
  });

  it("re-keys nothing on a second pass — the canonical file is already canonical", () => {
    writeNotion({ records: [page({ sourceId: `page:${UNDASHED}` })] });
    unwrap(compactSource({ home, protection: NO_ENTRIES, source: "notion" }));

    const second = unwrap(compactSource({ home, protection: NO_ENTRIES, source: "notion" }));

    expect(second.rekeyed).toBe(0);
    expect(notionIds()).toStrictEqual([`page:${DASHED}`]);
  });

  it("never re-keys another source's 32-hex sourceId", () => {
    writeWindow({ name: "a.jsonl", records: [record({ sourceId: `page:${UNDASHED}` })] });

    const plan = unwrap(compactSource({ home, protection: NO_ENTRIES, source: "github" }));

    expect(plan.rekeyed).toBe(0);
    expect(canonical()).toBe(jsonl({ records: [record({ sourceId: `page:${UNDASHED}` })] }));
  });
});
