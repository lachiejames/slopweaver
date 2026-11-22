/**
 * The retrieval projection, the chunked line reader, and the heap guard at the bronze door — every case a
 * real temp-dir round trip, which `testing.md` allows for a genuine fixture.
 */
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { protectedSkipLine } from "../../../corpus/bronzeProtection.js";
import { readCorpusTally } from "../../../corpus/corpusDirRead.js";
import { resolveCorpusScan } from "../../../corpus/corpusResolve.js";
import { HEAP_BYTES_PER_DISK_BYTE, parseRow } from "../../../corpus/corpusRowCore.js";
import type { CorpusHeapCeilingError, CorpusStoreError } from "../../../corpus/corpusStore.errors.js";
import { protectedSkipWarnings, READ_CHUNK_BYTES, scanJsonlProtected } from "../../../corpus/corpusStore.js";
import type { CorpusRecord } from "../../../corpus/types.js";
import type { HeapGuard } from "../../../lib/heapBudget.js";
import { err, ok, unwrap, unwrapErr } from "../../../lib/result.js";
import { OwnerProtectionErrors } from "../../../protectedPaths/ownerEntries.js";
import type { ProtectedPath } from "../../../protectedPaths/registry.js";

/** What every walk in the `scanJsonlProtected` cases says it was doing. */
const OPERATION = { target: "the corpus", verb: "read" } as const;

/** The record a row decoded to — throws on a rejection, so no assertion needs a conditional. */
function recordOf(parsed: ReturnType<typeof parseRow>): CorpusRecord {
  if (!("record" in parsed)) {
    throw new Error(`row rejected: ${parsed.error}`);
  }
  return parsed.record;
}

/** Narrow to the heap-ceiling variant, or throw — the which-failure check is an explicit `code` assertion. */
function asHeapCeiling(error: CorpusStoreError): CorpusHeapCeilingError {
  if (error.code !== "CORPUS_HEAP_CEILING") {
    throw new Error(`expected CORPUS_HEAP_CEILING, got ${error.code}`);
  }
  return error;
}

let root = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "slopweaver-projection-"));
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

const line = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({
    container: "C1",
    kind: "message",
    raw: { channel: "C1", deep: { payload: "x".repeat(50) } },
    refs: [],
    source: "slack",
    sourceId: "m1",
    text: "hello — ünïcode",
    tsIso: "2026-01-01T00:00:00Z",
    url: "https://example.invalid/1",
    ...over,
  });

/** Write one bronze file under `slack/` and return its path. */
function writeSlack({ content, name = "w.jsonl" }: { content: string; name?: string }): string {
  const dir = join(root, "slack");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, content, "utf8");
  return path;
}

/** A guard that refuses once the projected bytes cross `refuseAbove`, recording every projection it saw. */
function thresholdGuard({ refuseAbove }: { refuseAbove: number }): { guard: HeapGuard; seen: number[] } {
  const seen: number[] = [];
  const guard: HeapGuard = ({ projectedBytes }) => {
    seen.push(projectedBytes);
    return projectedBytes > refuseAbove
      ? {
          collected: true,
          fits: false,
          limitBytes: 1000,
          projectedBytes,
          shortfallBytes: projectedBytes - refuseAbove,
          suggestedLimitMib: 2048,
          usedBytes: 100,
        }
      : { fits: true, headroomBytes: refuseAbove - projectedBytes };
  };
  return { guard, seen };
}

describe("the retrieval projection", () => {
  it("drops `raw` and nothing else", () => {
    const bronze = recordOf(parseRow({ line: line(), projection: "bronze" }));
    const retrieval = recordOf(parseRow({ line: line(), projection: "retrieval" }));
    expect(bronze.raw).toEqual({ channel: "C1", deep: { payload: "x".repeat(50) } });
    expect(retrieval.raw).toBe(undefined);
    expect(retrieval.text).toBe("hello — ünïcode");
    expect(retrieval.attrs).toBe(undefined);
  });

  it("defaults to bronze, so every existing reader still gets `raw`", () => {
    expect(recordOf(parseRow({ line: line() })).raw).toEqual({ channel: "C1", deep: { payload: "x".repeat(50) } });
  });

  it("applies through readCorpusTally", () => {
    writeSlack({ content: `${line()}\n${line({ sourceId: "m2" })}\n` });
    const tally = unwrap(readCorpusTally({ dir: root, home: root, protection: () => ok([]), projection: "retrieval" }));
    expect(tally.tallies[0]!.records.map((record) => record.raw)).toEqual([undefined, undefined]);
    expect(tally.tallies[0]!.records.map((record) => record.sourceId)).toEqual(["m1", "m2"]);
  });
});

describe("the chunked line reader", () => {
  it("reads every line whole across chunk boundaries, multi-byte characters included", () => {
    // Rows long enough that the 8 MiB read window falls inside several of them, and wide characters at the
    // split points, so a reader that cut a line or a code point would produce a corrupt row here.
    const wide = "ü€𝄞".repeat(2000);
    const rows = Array.from({ length: 1500 }, (_unused, i) =>
      line({ sourceId: `m${String(i)}`, text: `${wide}${String(i)}` }),
    );
    writeSlack({ content: `${rows.join("\n")}\n` });
    const tally = unwrap(readCorpusTally({ dir: root, home: root, protection: () => ok([]), projection: "retrieval" }));
    const records = tally.tallies[0]!.records;
    expect(records).toHaveLength(1500);
    expect(tally.tallies[0]!.rows).toBe(1500);
    expect(tally.tallies[0]!.skipped).toEqual([]);
    expect(records[0]!.text).toBe(`${wide}0`);
    expect(records[1499]!.text).toBe(`${wide}1499`);
  });

  it("reads a file with no trailing newline, and a blank interior line counts as no row", () => {
    writeSlack({ content: `${line()}\n\n${line({ sourceId: "m2" })}` });
    const tally = unwrap(readCorpusTally({ dir: root, home: root, protection: () => ok([]) }));
    expect(tally.tallies[0]!.rows).toBe(2);
    expect(tally.tallies[0]!.records.map((record) => record.sourceId)).toEqual(["m1", "m2"]);
  });

  it("numbers a corrupt line by its position in the file", () => {
    writeSlack({ content: `${line()}\nnot json\n${line({ sourceId: "m3" })}\n` });
    const tally = unwrap(readCorpusTally({ dir: root, home: root, protection: () => ok([]) }));
    expect(tally.warnings).toHaveLength(1);
    expect(tally.warnings[0]).toContain("1 row(s) rejected: invalid JSON (line 2)");
    expect(tally.tallies[0]!.skipped).toEqual([{ count: 1, reason: "invalid-json" }]);
  });
});

describe("the heap guard at the bronze door", () => {
  it("projects the whole corpus at the band's floor once, then only ONE CHUNK per chunk read", () => {
    // The per-file projection is gone on purpose: it multiplied a FILE's size by the band ceiling, which is
    // `self`'s coefficient, and over-projected a 2 GiB Slack window 3.5×. What replaces it never scales with
    // the file at all — every in-file projection is the same bounded chunk figure, whatever the file holds.
    const contentA = `${line()}\n`;
    const contentB = `${line({ sourceId: "m2" })}\n${line({ sourceId: "m3" })}\n`;
    writeSlack({ content: contentA, name: "a.jsonl" });
    writeSlack({ content: contentB, name: "b.jsonl" });
    const bytes = { a: Buffer.byteLength(contentA), b: Buffer.byteLength(contentB) };
    const { guard, seen } = thresholdGuard({ refuseAbove: Number.MAX_SAFE_INTEGER });
    unwrap(
      readCorpusTally({ dir: root, home: root, protection: () => ok([]), heapGuard: guard, projection: "retrieval" }),
    );
    const band = HEAP_BYTES_PER_DISK_BYTE.retrieval;
    const chunk = READ_CHUNK_BYTES * band.ceiling;
    // Preflight, then two checks per file: one before the read that returns its content, one before the
    // read that returns 0 bytes and ends the file.
    expect(seen).toEqual([(bytes.a + bytes.b) * band.floor, chunk, chunk, chunk, chunk]);
    expect(seen.slice(1).every((projected) => projected === chunk)).toBe(true);
  });

  it("the in-file projection does not grow with the file", () => {
    // Falsifiable against the shape this replaced: under a whole-file projection the bigger file would be
    // projected at a larger number than the smaller one.
    const small = `${line()}\n`;
    const big = `${Array.from({ length: 500 }, (_unused, i) => line({ sourceId: `m${String(i)}` })).join("\n")}\n`;
    writeSlack({ content: small, name: "a.jsonl" });
    writeSlack({ content: big, name: "b.jsonl" });
    expect(Buffer.byteLength(big)).toBeGreaterThan(Buffer.byteLength(small) * 100);
    const { guard, seen } = thresholdGuard({ refuseAbove: Number.MAX_SAFE_INTEGER });
    unwrap(
      readCorpusTally({ dir: root, home: root, protection: () => ok([]), heapGuard: guard, projection: "retrieval" }),
    );
    expect(new Set(seen.slice(1)).size).toBe(1);
  });

  it("refuses a hopeless corpus before opening a single file", () => {
    writeSlack({ content: `${line()}\n` });
    const { guard, seen } = thresholdGuard({ refuseAbove: 0 });
    const error = asHeapCeiling(
      unwrapErr(readCorpusTally({ dir: root, home: root, protection: () => ok([]), heapGuard: guard })),
    );
    expect(error.code).toBe("CORPUS_HEAP_CEILING");
    expect(seen).toHaveLength(1);
    expect(error.readBytes).toBe(0);
    expect(error.message).toContain("too large for this process's heap ceiling");
    expect(error.message).toContain("NODE_OPTIONS=--max-old-space-size=2048");
    expect(error.message).toContain("a mask, not a fix");
    // `compact` streams, so it is a real fix for a corpus this size and the refusal names it. The
    // sentence must not claim otherwise.
    expect(error.message).toContain("`slopweaver compact` streams");
    expect(error.message).not.toContain("NOT `slopweaver compact`");
  });

  it("refuses mid-read when the live heap runs out, reporting how much was already read", () => {
    const small = `${line()}\n`;
    const big = `${Array.from({ length: 40 }, (_unused, i) => line({ sourceId: `m${String(i)}` })).join("\n")}\n`;
    writeSlack({ content: small, name: "a.jsonl" });
    writeSlack({ content: big, name: "b.jsonl" });
    const band = HEAP_BYTES_PER_DISK_BYTE.retrieval;
    const total = Buffer.byteLength(small) + Buffer.byteLength(big);
    // A guard that fits the preflight and the first file's chunk checks, then runs out. `budget` counts
    // down per call the way a filling heap does, which is what the per-chunk check exists to notice.
    const seen: number[] = [];
    let budget = 4;
    const guard: HeapGuard = ({ projectedBytes }) => {
      seen.push(projectedBytes);
      budget -= 1;
      return budget >= 0
        ? { fits: true, headroomBytes: 1 }
        : {
            collected: true,
            fits: false,
            limitBytes: 1000,
            projectedBytes,
            shortfallBytes: 1,
            suggestedLimitMib: 2048,
            usedBytes: 900,
          };
    };
    const error = asHeapCeiling(
      unwrapErr(
        readCorpusTally({ dir: root, home: root, protection: () => ok([]), heapGuard: guard, projection: "retrieval" }),
      ),
    );
    // Both files' bytes: the budget ran out on `b`'s SECOND chunk check, by which point `b` had been read.
    // The figure counts progress inside the file the read stopped in, not only files it finished — a
    // whole-file count would have thrown away everything read since the last boundary, and on the real
    // corpus one file is most of a source.
    expect(error.readBytes).toBe(total);
    expect(error.fileCount).toBe(2);
    expect(error.diskBytes).toBe(total);
    expect(error.message).toContain("already read");
    expect(seen[0]).toBe(total * band.floor);
  });

  it("the band brackets the ratios measured on every source of the real corpus", () => {
    // Measured on a real corpus — see the table beside HEAP_BYTES_PER_DISK_BYTE. A band that stops bracketing
    // these is a guard that either refuses a corpus that fits or lets one through to the fatal.
    const measured = {
      bronze: [1.51, 0.99, 1.72, 0.88, 1.61, 1.36],
      retrieval: [1.51, 0.5, 0.87, 0.41, 0.52, 0.6],
    };
    for (const projection of ["bronze", "retrieval"] as const) {
      const band = HEAP_BYTES_PER_DISK_BYTE[projection];
      expect(Math.min(...measured[projection])).toBeGreaterThanOrEqual(band.floor);
      expect(Math.max(...measured[projection])).toBeLessThanOrEqual(band.ceiling);
    }
  });
});

describe("resolveCorpusScan", () => {
  it("reports the bytes on disk beside the file count", () => {
    writeSlack({ content: `${line()}\n` });
    const scan = unwrap(resolveCorpusScan({ corpus: root, home: root, protection: () => ok([]) }));
    expect(scan.fileCount).toBe(1);
    expect(scan.diskBytes).toBe(Buffer.byteLength(`${line()}\n`));
  });

  it("refuses a tree the owner's protect list marks no-access, before listing anything under it", () => {
    writeSlack({ content: `${line()}\n` });
    const entry = { addedIso: "2026-01-01T00:00:00.000Z", mode: "no-access" as const, path: root, why: "fixture" };
    const refusal = unwrapErr(resolveCorpusScan({ corpus: root, home: root, protection: () => ok([entry]) }));
    expect(refusal.code).toBe("CORPUS_PROTECTED");
    expect(refusal.message).toContain(`it would list ${root}, which the owner's protect list marks no-access`);
  });

  it("names a source the protect list kept out of the walk, and counts only the rest", () => {
    writeSlack({ content: `${line()}\n` });
    const held = join(root, "gmail");
    mkdirSync(held);
    writeFileSync(join(held, "w.jsonl"), `${line()}\n`);
    const entry = { addedIso: "2026-01-01T00:00:00.000Z", mode: "no-access" as const, path: held, why: "fixture" };
    const scan = unwrap(resolveCorpusScan({ corpus: root, home: root, protection: () => ok([entry]) }));
    expect(scan.fileCount).toBe(1);
    expect(scan.warnings).toEqual([`NOT READ, protected by the owner's list: ${held} [no-access]`]);
  });
});

describe("scanJsonlProtected", () => {
  const noAccess = ({ path }: { path: string }): ProtectedPath => ({
    addedIso: "2026-01-01T00:00:00.000Z",
    mode: "no-access",
    path,
    why: "fixture",
  });

  it("skips and names a no-access source under the root, never listing it, and reads every other", () => {
    const slack = writeSlack({ content: `${line()}\n` });
    const gmail = join(root, "gmail");
    mkdirSync(gmail);
    writeFileSync(join(gmail, "w.jsonl"), `${line({ source: "gmail" })}\n`);
    // A directory this walk cannot list: had the walk tried, `unreadableDirs` would name it.
    chmodSync(gmail, 0o000);
    try {
      const entry = noAccess({ path: gmail });
      const scan = unwrap(
        scanJsonlProtected({ dir: root, home: root, operation: OPERATION, protection: () => ok([entry]) }),
      );
      expect(scan.files.map((file) => file.path)).toEqual([slack]);
      expect(scan.protectedSkipped).toEqual([{ entry, path: gmail }]);
      expect(scan.unreadableDirs).toEqual([]);
      expect(protectedSkipWarnings({ scan })).toEqual([
        `NOT READ, protected by the owner's list: ${gmail} [no-access]`,
      ]);
    } finally {
      chmodSync(gmail, 0o755);
    }
  });

  it("skips a directory symlink that resolves into a protected tree, never following it", () => {
    writeSlack({ content: `${line()}\n` });
    // The real path, since the entry the walk meets through the link is the one the link resolves to.
    const outside = realpathSync(mkdtempSync(join(tmpdir(), "slopweaver-outside-")));
    try {
      writeFileSync(join(outside, "held.jsonl"), `${line({ sourceId: "held" })}\n`);
      const link = join(root, "slack", "nested");
      symlinkSync(outside, link);
      const entry = noAccess({ path: outside });
      const scan = unwrap(
        scanJsonlProtected({ dir: root, home: root, operation: OPERATION, protection: () => ok([entry]) }),
      );
      expect(scan.files.map((file) => file.path)).toEqual([join(root, "slack", "w.jsonl")]);
      expect(scan.protectedSkipped).toEqual([{ entry, path: link }]);
      expect(protectedSkipLine({ skip: { entry, path: link } })).toBe(`${outside} [no-access] (met as ${link})`);
    } finally {
      rmSync(outside, { force: true, recursive: true });
    }
  });

  it("refuses a root a no-access entry covers, rather than skipping the whole of it", () => {
    writeSlack({ content: `${line()}\n` });
    const refusal = unwrapErr(
      scanJsonlProtected({
        dir: root,
        home: root,
        operation: OPERATION,
        protection: () => ok([noAccess({ path: root })]),
      }),
    );
    expect(refusal).toEqual([
      `refusing to read the corpus: it would list ${root}, which the owner's protect list marks no-access at ${root} (fixture)`,
    ]);
  });

  it("refuses every walk when the protect list cannot be read", () => {
    writeSlack({ content: `${line()}\n` });
    const refusal = unwrapErr(
      scanJsonlProtected({
        dir: root,
        home: root,
        operation: OPERATION,
        protection: () => err(OwnerProtectionErrors.unknown({ reason: "fixture" })),
      }),
    );
    expect(refusal).toEqual([
      "refusing to read the corpus: the owner's protect list could not be read, so nothing it might cover is " +
        "touched: fixture",
    ]);
  });

  it("names a skip in the tally's warnings, so the rest is never read as the whole", () => {
    writeSlack({ content: `${line()}\n` });
    const gmail = join(root, "gmail");
    mkdirSync(gmail);
    writeFileSync(join(gmail, "w.jsonl"), `${line({ source: "gmail" })}\n`);
    const tally = unwrap(readCorpusTally({ dir: root, home: root, protection: () => ok([noAccess({ path: gmail })]) }));
    expect(tally.warnings).toEqual([`NOT READ, protected by the owner's list: ${gmail} [no-access]`]);
    expect(tally.tallies.map((group) => group.group)).toEqual(["slack"]);
  });
});
