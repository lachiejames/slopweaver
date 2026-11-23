/**
 * The heap guard's ADVICE: whether the `--max-old-space-size` a refusal prints is one a caller reaches in
 * one attempt, or the first rung of a ladder that never converges.
 *
 * Measured on a 7,814 MiB corpus, five attempts: 4,288 → 8,384 → 11,456 MiB, each
 * refusing with "needs ~16 MiB more" and each having read further, before 16,384 finally carried it. The
 * convergence case below is that failure written as a test — a real temp-dir corpus read twice, once at a
 * ceiling that refuses and once at the ceiling the refusal named — and it fails against the shape that
 * printed one chunk's shortfall as though it were the corpus's.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OwnerProtectionResolver } from "../../../corpus/bronzeProtection.js";
import { readCorpusTally } from "../../../corpus/corpusDirRead.js";
import { HEAP_BYTES_PER_DISK_BYTE } from "../../../corpus/corpusRowCore.js";
import type { CorpusHeapCeilingError, CorpusStoreError } from "../../../corpus/corpusStore.errors.js";
import { projectWholeCorpusHeap } from "../../../corpus/heapGuard.js";
import { assessHeapBudget, type HeapGuard } from "../../../lib/heapBudget.js";
import { ok, unwrap, unwrapErr } from "../../../lib/result.js";

/** An owner protect list with no entries, so no test reads the owner's own registry. */
const NO_ENTRIES: OwnerProtectionResolver = () => ok([]);

const MIB = 1024 * 1024;

/** The shipped `retrieval` band, so the pure cases are stated against a real coefficient pair. */
const BAND = HEAP_BYTES_PER_DISK_BYTE.retrieval;

/** Narrow to the heap-ceiling variant, or throw — the which-failure check is an explicit `code` assertion. */
function asHeapCeiling(error: CorpusStoreError): CorpusHeapCeilingError {
  if (error.code !== "CORPUS_HEAP_CEILING") {
    throw new Error(`expected CORPUS_HEAP_CEILING, got ${error.code}`);
  }
  return error;
}

let root = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "slopweaver-heapguard-"));
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

const line = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({
    container: "C1",
    kind: "message",
    refs: [],
    source: "slack",
    sourceId: "m1",
    text: "hello",
    tsIso: "2026-01-01T00:00:00Z",
    url: "https://example.invalid/1",
    ...over,
  });

/**
 * Write `count` equal-sized bronze files and report their total size on disk. Equal sizes are what make the
 * fake isolate below a faithful model: every file costs the same number of chunk checks AND the same number
 * of disk bytes, so heap-per-disk-byte is constant across the read, exactly as the extrapolation assumes.
 */
function writeCorpus({ count }: { count: number }): number {
  const dir = join(root, "slack");
  mkdirSync(dir, { recursive: true });
  let bytes = 0;
  for (let i = 0; i < count; i += 1) {
    const content = `${line({ sourceId: `m${String(i)}` })}\n`;
    writeFileSync(join(dir, `w${String(i)}.jsonl`), content, "utf8");
    bytes += Buffer.byteLength(content);
  }
  return bytes;
}

/**
 * A fake isolate whose heap grows by a fixed amount per guard call and whose verdicts come from the REAL
 * {@link assessHeapBudget} — so the reserve arithmetic under test is the shipped one, and only the reading
 * is synthetic. Nothing here is a mock: it is a plain function passed in through the reader's own seam.
 */
function fakeIsolate({ limitMib, growthBytes }: { limitMib: number; growthBytes: number }): {
  guard: HeapGuard;
  calls: () => number;
} {
  let usedBytes = 0;
  let calls = 0;
  return {
    calls: () => calls,
    guard: ({ projectedBytes }) => {
      calls += 1;
      usedBytes += growthBytes;
      return assessHeapBudget({ projectedBytes, reading: { externalBytes: 0, limitBytes: limitMib * MIB, usedBytes } });
    },
  };
}

describe("projectWholeCorpusHeap", () => {
  it("extrapolates the rest of the corpus from the ratio the read has already measured", () => {
    const projection = projectWholeCorpusHeap({
      band: BAND,
      diskBytes: 1000 * MIB,
      liveBytes: 200 * MIB,
      readBytes: 100 * MIB,
    });
    expect(projection.measured).toBe(true);
    expect(projection.ratio).toBe(2);
    // 200 MiB held + 900 MiB of disk left at 2 bytes each = 2,000 MiB, and 2,000/0.85 = 2,353 → 2,560.
    expect(projection.wholeCorpusBytes).toBe(2000 * MIB);
    expect(projection.ceilingMib).toBe(2560);
  });

  it("stands the band's CEILING in when nothing has been read at all", () => {
    // The preflight REFUSES at the floor so it can never turn away a corpus that would have fitted; a
    // suggestion built from that same floor is by construction the smallest ceiling that might work, which
    // is how a preflight refusal came to advise 6,656 MiB for a read that needed 16,384.
    const projection = projectWholeCorpusHeap({
      band: BAND,
      diskBytes: 1000 * MIB,
      liveBytes: 50 * MIB,
      readBytes: 0,
    });
    expect(projection.measured).toBe(false);
    expect(projection.ratio).toBe(1.8);
    expect(projection.wholeCorpusBytes).toBe(1850 * MIB);
    expect(projection.ceilingMib).toBe(2560);
  });

  it("never falls below the band's floor, so a cheap first file cannot under-project the rest", () => {
    // A first file retaining a tenth of its bytes says nothing about a corpus whose band floor is 0.35.
    const projection = projectWholeCorpusHeap({
      band: BAND,
      diskBytes: 1000 * MIB,
      liveBytes: 10 * MIB,
      readBytes: 100 * MIB,
    });
    expect(projection.measured).toBe(false);
    expect(projection.ratio).toBe(0.35);
    expect(projection.wholeCorpusBytes).toBe(325 * MIB);
  });

  it("projects only what is held once the whole corpus has been read", () => {
    const projection = projectWholeCorpusHeap({
      band: BAND,
      diskBytes: 100 * MIB,
      liveBytes: 400 * MIB,
      readBytes: 100 * MIB,
    });
    expect(projection.wholeCorpusBytes).toBe(400 * MIB);
    expect(projection.ceilingMib).toBe(512);
  });
});

describe("the ceiling a refusal prints", () => {
  it("carries the WHOLE read in one attempt — the ladder that never converged", () => {
    const diskBytes = writeCorpus({ count: 200 });
    // Sized so the whole read needs multiples of the ceiling it starts at: 401 checks at 8 MiB each is
    // ~3.1 GiB of growth against a 128 MiB ceiling. That gap is the point — a suggestion built from the
    // refused CHUNK lands one 512 MiB step up and refuses again, which is what the assertions below catch.
    const growthBytes = 8 * MIB;
    const first = fakeIsolate({ growthBytes, limitMib: 128 });
    const refused = asHeapCeiling(
      unwrapErr(readCorpusTally({ dir: root, home: root, protection: NO_ENTRIES, heapGuard: first.guard })),
    );

    expect(refused.code).toBe("CORPUS_HEAP_CEILING");
    expect(refused.diskBytes).toBe(diskBytes);
    expect(refused.readBytes).toBeGreaterThan(0);
    expect(refused.readBytes).toBeLessThan(diskBytes);
    expect(refused.projection.measured).toBe(true);

    // The whole point: take the printed ceiling, run the same read again, and it finishes. Under the shape
    // this replaced the suggestion was the refused CHUNK's ceiling — 64 MiB plus one 512 MiB step — and the
    // second run refused with the same sentence at a slightly later file.
    const second = fakeIsolate({ growthBytes, limitMib: refused.suggestedLimitMib });
    const tally = unwrap(readCorpusTally({ dir: root, home: root, protection: NO_ENTRIES, heapGuard: second.guard }));
    expect(tally.tallies[0]!.records).toHaveLength(200);
    expect(second.calls()).toBe(401);
  });

  it("reports the disk bytes consumed inside the file it stopped in, not only whole files", () => {
    const diskBytes = writeCorpus({ count: 4 });
    // Refuse on the very first in-file check, before any line of the first file has been read.
    const isolate = fakeIsolate({ growthBytes: 32 * MIB, limitMib: 64 });
    const refused = asHeapCeiling(
      unwrapErr(readCorpusTally({ dir: root, home: root, protection: NO_ENTRIES, heapGuard: isolate.guard })),
    );
    expect(refused.readBytes).toBe(0);
    expect(refused.diskBytes).toBe(diskBytes);
    // Nothing read is the preflight's information state, wherever it happens, so the band's ceiling stands in.
    expect(refused.projection.measured).toBe(false);
    expect(refused.projection.ratio).toBe(HEAP_BYTES_PER_DISK_BYTE.bronze.ceiling);
  });

  it("says an uncollected reading is uncollected rather than calling it live", () => {
    writeCorpus({ count: 2 });
    const guard: HeapGuard = ({ projectedBytes }) => ({
      collected: false,
      fits: false,
      limitBytes: 1000 * MIB,
      projectedBytes,
      shortfallBytes: 1,
      suggestedLimitMib: 1024,
      usedBytes: 900 * MIB,
    });
    const refused = asHeapCeiling(
      unwrapErr(readCorpusTally({ dir: root, home: root, protection: NO_ENTRIES, heapGuard: guard })),
    );
    expect(refused.message).toContain("900 MiB in use (uncollected)");
    expect(refused.message).not.toContain("900 MiB live");
  });

  it("names a ceiling sized for the whole corpus, and says so in the line that prints it", () => {
    writeCorpus({ count: 200 });
    const isolate = fakeIsolate({ growthBytes: 8 * MIB, limitMib: 128 });
    const refused = asHeapCeiling(
      unwrapErr(readCorpusTally({ dir: root, home: root, protection: NO_ENTRIES, heapGuard: isolate.guard })),
    );
    expect(refused.message).toContain(
      `NODE_OPTIONS=--max-old-space-size=${String(refused.suggestedLimitMib)} — sized for the WHOLE corpus`,
    );
    expect(refused.message).toContain("heap bytes per disk byte this read has measured");
    // A ceiling built from the refused chunk alone lands one 512 MiB step above the 128 MiB it started at.
    expect(refused.suggestedLimitMib).toBeGreaterThan(512);
  });
});
