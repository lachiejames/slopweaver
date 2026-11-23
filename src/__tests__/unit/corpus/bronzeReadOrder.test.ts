/**
 * READ ORDER IS WRITE ORDER — proven through the real reader and the real collapse, over a real temp-dir
 * corpus laid out the way a compacted source actually is.
 *
 * This is the seam a unit test on the comparator alone would not have caught, because the defect was not in
 * any one function: `readdirSync().toSorted()` put `compact.jsonl` after every `2026-…jsonl`, while
 * compaction folds the OLD rows into it and every window written afterwards is NEWER. Measured on the
 * a real corpus, when the meeting lane stopped storing Gemini's summary: 41 freshly
 * re-projected transcript rows were written, and all 60 meetings still resolved to their superseded
 * versions inside `compact.jsonl`.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OwnerProtectionResolver } from "../../../corpus/bronzeProtection.js";
import { readCorpusDir } from "../../../corpus/corpusDirRead.js";
import { BRONZE_COMPACT_BASENAME } from "../../../corpus/corpusPaths.js";
import { latestRecords } from "../../../corpus/latestRecords.js";
import type { CorpusRecord } from "../../../corpus/types.js";
import { ok, unwrap } from "../../../lib/result.js";

/** An owner protect list with no entries, so no test reads the owner's own registry. */
const NO_ENTRIES: OwnerProtectionResolver = () => ok([]);

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "slop-read-order-"));
});
afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

/** One meeting, projected two ways at the same instant — the shape a re-projection produces. */
function meeting({ text }: { text: string }): CorpusRecord {
  return {
    container: "mail/meetings",
    kind: "transcript",
    refs: [],
    source: "gmail",
    sourceId: "m1:meeting",
    text,
    tsIso: "2026-08-25T02:08:54.000Z",
    url: "https://docs.google.com/document/d/abc123/edit",
  };
}

const SUPERSEDED = "Summary\nThe team met.\n\n## Transcript\nAna: hello\nBo: hi";
const CURRENT = "Ana: hello\nBo: hi";

function seed({ name, records }: { name: string; records: readonly CorpusRecord[] }): void {
  mkdirSync(join(dir, "gmail"), { recursive: true });
  writeFileSync(join(dir, "gmail", name), `${records.map((r) => JSON.stringify(r)).join("\n")}\n`, "utf8");
}

describe("bronze read order across a compacted source", () => {
  it("reads the canonical compacted file BEFORE a window written after it", () => {
    seed({ name: BRONZE_COMPACT_BASENAME, records: [meeting({ text: SUPERSEDED })] });
    seed({ name: "2026-04-01_2026-08-31.jsonl", records: [meeting({ text: CURRENT })] });

    const read = readCorpusDir({ dir, home: dir, protection: NO_ENTRIES });
    expect(read.isOk()).toBe(true);
    expect(unwrap(read).records.map((record) => record.text)).toEqual([SUPERSEDED, CURRENT]);
  });

  it("so the SHORTER re-projection wins, even though the tie-break prefers the longer row", () => {
    seed({ name: BRONZE_COMPACT_BASENAME, records: [meeting({ text: SUPERSEDED })] });
    seed({ name: "2026-04-01_2026-08-31.jsonl", records: [meeting({ text: CURRENT })] });

    const collapsed = latestRecords({
      records: unwrap(readCorpusDir({ dir, home: dir, protection: NO_ENTRIES })).records,
    });

    expect(collapsed.length).toBe(1);
    expect(collapsed[0]!.text).toBe(CURRENT);
  });

  it("still orders window files among themselves by name", () => {
    seed({ name: "2026-04-01_2026-08-31.jsonl", records: [meeting({ text: "first" })] });
    seed({ name: "2026-08-24_2026-08-26.jsonl", records: [meeting({ text: "second" })] });

    expect(
      readCorpusDir({ dir, home: dir, protection: NO_ENTRIES })
        ._unsafeUnwrap()
        .records.map((record) => record.text),
    ).toEqual(["first", "second"]);
  });
});
