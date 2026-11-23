/**
 * The bronze writer's dedup index must be buildable over a source too large to hold in memory, and a write
 * it cannot make safe must refuse in a way that names the RIGHT remedy.
 *
 * Both halves are one defect. The index used to be built by reading every stored record back and
 * keying on its full serialisation; on a 5.9 GiB Slack window the reader's heap guard refused, the writer saw
 * "this source could not be read", and every Slack refresh was a silent no-op for five days while the message
 * on screen described a permission bit.
 *
 * The heap guard is INJECTED here rather than simulated with a real 5.9 GiB file: what is under test is what
 * the writer does when a guard refuses, and a fake guard makes that falsifiable in milliseconds. The real
 * measurement — that the shipped index fits the real corpus — is `slopweaver dev dedup-index --source slack`,
 * which runs against the live home rather than a fixture.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildBronzeDedupIndex, emptyBronzeDedupIndex, recordDedupDigest } from "../../../corpus/bronzeDedupIndex.js";
import { commitRefusal } from "../../../corpus/commitRefusal.js";
import { createBronzeCommitter, freshRecordsForBucket } from "../../../corpus/corpusWriter.js";
import type { CorpusRecord } from "../../../corpus/types.js";
import type { HeapGuard } from "../../../lib/heapBudget.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "slopweaver-dedup-index-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** A record the writer will index or write. */
function record(over: Partial<CorpusRecord> = {}): CorpusRecord {
  return {
    container: "C1",
    kind: "message",
    refs: [],
    source: "slack",
    sourceId: "m1",
    text: "hello",
    tsIso: "2026-01-01T00:00:00Z",
    url: "https://example.invalid/m1",
    ...over,
  };
}

/** Write one bronze window file under the temp home. */
function writeWindow({ name, rows }: { name: string; rows: readonly CorpusRecord[] }): string {
  const dir = join(home, "corpus", "bronze", "slack");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
  return path;
}

/** A guard that refuses every projection, with the numbers a real shortfall carries. */
const refusingGuard: HeapGuard = ({ projectedBytes }) => ({
  collected: true,
  fits: false,
  limitBytes: 4_496_293_888,
  projectedBytes,
  shortfallBytes: 1_073_741_824,
  suggestedLimitMib: 6656,
  usedBytes: 4_000_000_000,
});

describe("buildBronzeDedupIndex", () => {
  it("indexes every stored row without retaining a record, across window files", () => {
    writeWindow({
      name: "2026-01-01_2026-01-02.jsonl",
      rows: [record({ sourceId: "m1" }), record({ sourceId: "m2" })],
    });
    writeWindow({ name: "2026-01-03_2026-01-04.jsonl", rows: [record({ sourceId: "m3" })] });

    const built = buildBronzeDedupIndex({ home, source: "slack" });

    expect(built.rows).toBe(3);
    expect(built.fileCount).toBe(2);
    expect(built.index.seen.size).toBe(3);
    expect([...built.index.newestTs.keys()].toSorted()).toEqual(["m1", "m2", "m3"]);
    expect(built.unreadable).toEqual([]);
    expect(built.shortfall).toBe(undefined);
  });

  it("keys on the digest the writer computes, so a stored row dedups against its own re-capture", () => {
    writeWindow({ name: "2026-01-01_2026-01-02.jsonl", rows: [record()] });

    const built = buildBronzeDedupIndex({ home, source: "slack" });

    expect(built.index.seen.has(recordDedupDigest({ record: record() }))).toBe(true);
  });

  it("keeps the NEWEST tsIso per sourceId, whichever file it was read from", () => {
    writeWindow({
      name: "2026-01-01_2026-01-02.jsonl",
      rows: [record({ text: "v2", tsIso: "2026-01-05T00:00:00Z" }), record({ text: "v1" })],
    });

    const built = buildBronzeDedupIndex({ home, source: "slack" });

    expect(built.index.newestTs.get("m1")).toBe("2026-01-05T00:00:00Z");
  });

  it("skips a corrupt line exactly as the reader does, and still counts the file as read", () => {
    const dir = join(home, "corpus", "bronze", "slack");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "w.jsonl"), `${JSON.stringify(record())}\nnot json at all\n`, "utf8");

    const built = buildBronzeDedupIndex({ home, source: "slack" });

    expect(built.rows).toBe(2);
    expect(built.index.seen.size).toBe(1);
    expect(built.unreadable).toEqual([]);
  });

  it("reads a source that was never ingested as empty, not as unreadable", () => {
    const built = buildBronzeDedupIndex({ home, source: "linear" });

    expect(built.rows).toBe(0);
    expect(built.fileCount).toBe(0);
    expect(built.unreadable).toEqual([]);
    expect(built.shortfall).toBe(undefined);
  });

  it("does not consult the guard inside one check interval, so a small source never pays for it", () => {
    writeWindow({ name: "2026-01-01_2026-01-02.jsonl", rows: [record()] });

    const built = buildBronzeDedupIndex({ heapGuard: refusingGuard, home, source: "slack" });

    expect(built.shortfall).toBe(undefined);
    expect(built.rows).toBe(1);
  });

  it("stops at the guard's shortfall rather than passing a partial index off as complete", () => {
    const rows = Array.from({ length: 100_001 }, (_unused, at) => record({ sourceId: `m${String(at)}` }));
    writeWindow({ name: "2026-01-01_2026-01-02.jsonl", rows });

    const built = buildBronzeDedupIndex({ heapGuard: refusingGuard, home, source: "slack" });

    expect(built.shortfall?.suggestedLimitMib).toBe(6656);
    // Stopped AT the check, so it holds one interval and no more — a partial index, honestly reported.
    expect(built.rows).toBe(100_000);
    expect(built.unreadable).toEqual([]);
  });
});

describe("commitRefusal", () => {
  it("names the heap ceiling and `compact` when the guard stopped the build", () => {
    const refusal = commitRefusal({
      source: "slack",
      stored: {
        diskBytes: 6_810_000_000,
        fileCount: 20,
        rows: 900_000,
        shortfall: {
          collected: true,
          fits: false,
          limitBytes: 4_496_293_888,
          projectedBytes: 40_000_000,
          shortfallBytes: 1_073_741_824,
          suggestedLimitMib: 6656,
          usedBytes: 4_000_000_000,
        },
        unreadable: [],
      },
    });

    expect(refusal).toContain("refusing to write slack");
    expect(refusal).toContain("needs more heap than this process has");
    // Named as something that DOES reduce what the source holds — compaction streams, so the shape that
    // gets here is the shape it rewrites. A message that claims it cannot is the defect.
    expect(refusal).toContain("`slopweaver compact --source slack` does");
    expect(refusal).not.toContain("cannot do");
    expect(refusal).toContain("--max-old-space-size=6656");
    // The half that made the outage unreadable: a heap refusal must NOT say a path could not be read.
    expect(refusal).not.toContain("could not be read");
  });

  it("names the paths and nothing about heap when a stored file could not be read", () => {
    const refusal = commitRefusal({
      source: "slack",
      stored: {
        diskBytes: 10,
        fileCount: 1,
        rows: 0,
        shortfall: undefined,
        unreadable: ["/tmp/blocked.jsonl"],
      },
    });

    expect(refusal).toContain("1 stored path(s) could not be read");
    expect(refusal).toContain("/tmp/blocked.jsonl");
    expect(refusal).not.toContain("compact");
  });

  it("says nothing at all when the index is complete", () => {
    const refusal = commitRefusal({
      source: "slack",
      stored: {
        diskBytes: 10,
        fileCount: 1,
        rows: 1,
        shortfall: undefined,
        unreadable: [],
      },
    });

    expect(refusal).toBe(undefined);
  });
});

describe("createBronzeCommitter under a refusing heap guard", () => {
  it("REFUSES the write and says the corpus is too large, not that a path is unreadable", () => {
    // Long enough to cross ONE guard interval, which is what makes the injected guard reachable at all.
    const rows = Array.from({ length: 100_001 }, (_unused, at) => record({ sourceId: `m${String(at)}` }));
    writeWindow({ name: "2026-01-01_2026-01-02.jsonl", rows });

    const committer = createBronzeCommitter({
      heapGuard: refusingGuard,
      home,
      window: { since: "2026-01-05", until: "2026-01-06" },
    });
    const failed = unwrapErr(committer.commit({ records: [record({ sourceId: "new" })] }));

    expect(failed).toHaveLength(1);
    expect(failed[0]).toContain("needs more heap than this process has");
    expect(failed[0]).toContain("slopweaver compact --source slack");
  });

  it("writes normally under a guard that fits, over the same store", () => {
    const rows = Array.from({ length: 100_001 }, (_unused, at) => record({ sourceId: `m${String(at)}` }));
    writeWindow({ name: "2026-01-01_2026-01-02.jsonl", rows });

    const committer = createBronzeCommitter({ home, window: { since: "2026-01-05", until: "2026-01-06" } });
    const written = unwrap(committer.commit({ records: [record({ sourceId: "new" })] }));

    expect(written.written).toBe(1);
    // The premise: the index really did absorb the stored rows, so the refusal above was the guard's doing.
    const deduped = unwrap(committer.commit({ records: [record({ sourceId: "m7" })] }));
    expect(deduped.written).toBe(0);
    expect(deduped.deduped).toBe(1);
  });
});

describe("createBronzeCommitter over a write the disk refuses", () => {
  it("returns the refusal as its Err, and its next commit writes the batch the failed one never landed", () => {
    mkdirSync(join(home, "corpus", "bronze"), { recursive: true });
    const blocked = join(home, "corpus", "bronze", "slack");
    writeFileSync(blocked, "a file where the source's directory belongs", "utf8");
    const committer = createBronzeCommitter({ home, window: { since: "2026-01-05", until: "2026-01-06" } });

    const failed = unwrapErr(committer.commit({ records: [record()] }));
    expect(failed).toHaveLength(1);
    expect(failed[0]).toContain(`bronze append to ${blocked}/2026-01-05_2026-01-06.jsonl failed`);

    rmSync(blocked);
    expect(unwrap(committer.commit({ records: [record()] })).written).toBe(1);
  });
});

describe("freshRecordsForBucket over the digest index", () => {
  it("accepts a record once and rejects its exact re-capture", () => {
    const index = emptyBronzeDedupIndex();

    expect(freshRecordsForBucket({ bucket: [record()], index })).toHaveLength(1);
    expect(freshRecordsForBucket({ bucket: [record()], index })).toEqual([]);
  });

  it("rejects a record older than what the same sourceId already holds", () => {
    const index = emptyBronzeDedupIndex();
    freshRecordsForBucket({ bucket: [record({ text: "v2", tsIso: "2026-01-05T00:00:00Z" })], index });

    expect(freshRecordsForBucket({ bucket: [record({ text: "v0", tsIso: "2026-01-01T00:00:00Z" })], index })).toEqual(
      [],
    );
  });

  it("accepts a genuinely newer version of the same sourceId", () => {
    const index = emptyBronzeDedupIndex();
    freshRecordsForBucket({ bucket: [record({ text: "v1" })], index });

    expect(
      freshRecordsForBucket({ bucket: [record({ text: "v2", tsIso: "2026-01-05T00:00:00Z" })], index }),
    ).toHaveLength(1);
  });

  it("does not collide two different sourceIds carrying identical content", () => {
    const index = emptyBronzeDedupIndex();
    freshRecordsForBucket({ bucket: [record({ sourceId: "a" })], index });

    expect(freshRecordsForBucket({ bucket: [record({ sourceId: "b" })], index })).toHaveLength(1);
  });
});
