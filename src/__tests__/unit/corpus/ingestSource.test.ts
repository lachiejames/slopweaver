import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { OwnerProtectionResolver } from "../../../corpus/bronzeProtection.js";
import { readCorpusDir } from "../../../corpus/corpusDirRead.js";
import { bronzeSourceDir } from "../../../corpus/corpusPaths.js";
import type { WriteResult } from "../../../corpus/corpusWriter.js";
import { coverageGap, type SourceIngestJob } from "../../../corpus/ingestJob.js";
import {
  emptyFetchResult,
  fetchFailureResult,
  successfulIngestResult,
  writeFailureResult,
} from "../../../corpus/ingestResult.js";
import { type IngestDeps, type IngestProgress, ingestSources } from "../../../corpus/ingestSource.js";
import type { CorpusRecord } from "../../../corpus/types.js";
import { readWatermark } from "../../../corpus/watermark.js";
import { err, ok, type Result, unwrap } from "../../../lib/result.js";

/** An owner protect list with no entries, so no test reads the owner's own registry. */
const NO_ENTRIES: OwnerProtectionResolver = () => ok([]);

const window = { since: "2026-01-01", until: "2026-06-01" };
type RunResult = Result<{ records: readonly CorpusRecord[]; warnings: readonly string[] }>;

const slackRecord: CorpusRecord = {
  container: "slack/C_A",
  kind: "message",
  refs: [],
  source: "slack",
  sourceId: "C_A:1.1",
  text: "hello",
  tsIso: "2026-05-01T00:00:00.000Z",
  url: "u",
};

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function tempHome(): string {
  const root = mkdtempSync(join(tmpdir(), "slopweaver-ingest-"));
  fixtureDirs.push(root);
  return join(root, "home");
}

describe("ingestSources", () => {
  it("advances the watermark past an ADVISORY warning, which describes no lost data", async () => {
    const home = tempHome();
    const job: SourceIngestJob = {
      label: "slack",
      run: async (): Promise<RunResult> => ok({ records: [slackRecord], warnings: ["rate limit hit once, retried"] }),
      source: "slack",
      window,
    };
    const result = unwrap(await ingestSources({ home, jobs: [job] }))[0]!;
    expect(result.ok).toBe(true);
    expect(result.written).toBe(1);
    expect(result.warnings).toEqual(["rate limit hit once, retried"]);
    expect(readWatermark({ home, source: "slack" })).toBe("2026-05-01T00:00:00.000Z");
    expect(readWatermark({ home, source: "github" })).toBeUndefined();
    expect(
      unwrap(
        readCorpusDir({ dir: bronzeSourceDir({ home, source: "slack" }), home, protection: NO_ENTRIES }),
      ).records.map((r) => r.sourceId),
    ).toEqual(["C_A:1.1"]);
  });

  it("HOLDS the watermark when the lane reports a coverage gap, so the gap is re-scanned not skipped", async () => {
    const home = tempHome();
    const job: SourceIngestJob = {
      label: "slack",
      run: async (): Promise<RunResult> =>
        ok({ gaps: [coverageGap({ message: "1 thread could not be read" })], records: [slackRecord], warnings: [] }),
      source: "slack",
      window,
    };

    const result = unwrap(await ingestSources({ home, jobs: [job] }))[0]!;

    expect(result.written).toBe(1);
    expect(result.gaps).toEqual([{ heldPerContainer: false, message: "1 thread could not be read" }]);
    expect(result.ok).toBe(false);
    expect(readWatermark({ home, source: "slack" })).toBeUndefined();
  });

  it("still writes the records that DID arrive alongside a gap, so a partial capture is not discarded", async () => {
    const home = tempHome();
    const job: SourceIngestJob = {
      label: "slack",
      run: async (): Promise<RunResult> =>
        ok({ gaps: [coverageGap({ message: "page marker did not add up" })], records: [slackRecord], warnings: [] }),
      source: "slack",
      window,
    };

    unwrap(await ingestSources({ home, jobs: [job] }));

    expect(
      unwrap(
        readCorpusDir({ dir: bronzeSourceDir({ home, source: "slack" }), home, protection: NO_ENTRIES }),
      ).records.map((r) => r.sourceId),
    ).toEqual(["C_A:1.1"]);
  });

  it("holds the cursor on an EMPTY window that reported a gap", async () => {
    const home = tempHome();
    const job: SourceIngestJob = {
      label: "linear",
      run: async (): Promise<RunResult> =>
        ok({ gaps: [coverageGap({ message: "lane unavailable" })], records: [], warnings: [] }),
      source: "linear",
      window,
    };

    const result = unwrap(await ingestSources({ home, jobs: [job] }))[0]!;

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(["lane unavailable"]);
    expect(readWatermark({ home, source: "linear" })).toBeUndefined();
  });

  it("ADVANCES the cursor when every gap is held per container, and still fails the run", async () => {
    const home = tempHome();
    const job: SourceIngestJob = {
      label: "slack",
      run: async (): Promise<RunResult> =>
        ok({
          gaps: [coverageGap({ heldPerContainer: true, message: "slack channel C_HANG was abandoned as stalled" })],
          records: [slackRecord],
          warnings: [],
        }),
      source: "slack",
      window,
    };

    const result = unwrap(await ingestSources({ home, jobs: [job] }))[0]!;

    // The cursor moved — this is the assertion that goes red if a per-conversation stall is ever allowed to
    // freeze the workspace cursor again (MEASURED, `CoverageGap.heldPerContainer`).
    expect(readWatermark({ home, source: "slack" })).toBe("2026-05-01T00:00:00.000Z");
    // …and the run still FAILED, which is the property the stall fix bought.
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(["slack channel C_HANG was abandoned as stalled"]);
    expect(result.written).toBe(1);
  });

  it("HOLDS the cursor when a held-per-container gap arrives beside an ordinary one", async () => {
    const home = tempHome();
    const job: SourceIngestJob = {
      label: "slack",
      run: async (): Promise<RunResult> =>
        ok({
          gaps: [
            coverageGap({ heldPerContainer: true, message: "slack channel C_HANG was abandoned as stalled" }),
            coverageGap({ message: "the curated surfaces pass did not finish" }),
          ],
          records: [slackRecord],
          warnings: [],
        }),
      source: "slack",
      window,
    };

    const result = unwrap(await ingestSources({ home, jobs: [job] }))[0]!;

    expect(readWatermark({ home, source: "slack" })).toBeUndefined();
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual([
      "slack channel C_HANG was abandoned as stalled",
      "the curated surfaces pass did not finish",
    ]);
  });

  it("advances an EMPTY window whose only gap is held per container", async () => {
    const home = tempHome();
    const job: SourceIngestJob = {
      label: "slack",
      run: async (): Promise<RunResult> =>
        ok({ gaps: [coverageGap({ heldPerContainer: true, message: "C_HANG stalled" })], records: [], warnings: [] }),
      source: "slack",
      window,
    };

    const result = unwrap(await ingestSources({ home, jobs: [job] }))[0]!;

    expect(readWatermark({ home, source: "slack" })).toBe("2026-06-01");
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(["C_HANG stalled"]);
  });

  it("treats an explicitly empty gap list exactly as no gaps", async () => {
    const home = tempHome();
    const job: SourceIngestJob = {
      label: "linear",
      run: async (): Promise<RunResult> => ok({ gaps: [], records: [], warnings: [] }),
      source: "linear",
      window,
    };

    const result = unwrap(await ingestSources({ home, jobs: [job] }))[0]!;

    expect(result.ok).toBe(true);
    expect(readWatermark({ home, source: "linear" })).toBe("2026-06-01");
  });

  it("HOLDS the watermark for a bounded fetch, because the lane never saw the rest of its window", async () => {
    const home = tempHome();
    const job: SourceIngestJob = {
      label: "linear",
      run: async (): Promise<RunResult> => ok({ records: [slackRecord], warnings: [] }),
      source: "slack",
      window,
    };

    const result = unwrap(await ingestSources({ boundedFetch: true, home, jobs: [job] }))[0]!;

    expect(result.written).toBe(1);
    expect(readWatermark({ home, source: "slack" })).toBeUndefined();
  });

  it("advances the watermark to `until` on a successful empty window (no fake records written)", async () => {
    const home = tempHome();
    const job: SourceIngestJob = {
      label: "linear",
      run: async (): Promise<RunResult> => ok({ records: [], warnings: [] }),
      source: "linear",
      window,
    };
    const result = unwrap(await ingestSources({ home, jobs: [job] }))[0]!;
    expect(result.written).toBe(0);
    expect(readWatermark({ home, source: "linear" })).toBe("2026-06-01");
  });

  it("reports a failing source without aborting the run", async () => {
    const home = tempHome();
    const job: SourceIngestJob = {
      label: "notion",
      run: async (): Promise<RunResult> => err(["notion: 401"]),
      source: "notion",
      window,
    };
    const result = unwrap(await ingestSources({ home, jobs: [job] }))[0]!;
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(["notion: 401"]);
  });
});

describe("pure result builders", () => {
  it("fetchFailureResult surfaces errors with zero counts", () => {
    expect(fetchFailureResult({ errors: ["boom"], source: "github" })).toEqual({
      deduped: 0,
      excluded: 0,
      errors: ["boom"],
      gaps: [],
      notes: [],
      ok: false,
      projected: 0,
      source: "github",
      warnings: [],
      written: 0,
    });
  });

  it("emptyFetchResult is ok when the watermark advanced", () => {
    expect(emptyFetchResult({ advanced: ok(undefined), source: "slack", warnings: ["w"] })).toEqual({
      deduped: 0,
      excluded: 0,
      errors: [],
      gaps: [],
      notes: [],
      ok: true,
      projected: 0,
      source: "slack",
      warnings: ["w"],
      written: 0,
    });
  });

  it("emptyFetchResult fails when the watermark advance failed", () => {
    const result = emptyFetchResult({ advanced: err(["wm"]), source: "slack", warnings: [] });
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(["wm"]);
  });

  it("emptyFetchResult names its gaps as the errors when the gaps alone failed it", () => {
    const result = emptyFetchResult({
      advanced: ok(undefined),
      gaps: [coverageGap({ message: "calendar a could not be read this pass" })],
      source: "calendar",
      warnings: [],
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(["calendar a could not be read this pass"]);
  });

  it("emptyFetchResult carries the advance failure first and the gaps after it", () => {
    const result = emptyFetchResult({
      advanced: err(["wm"]),
      gaps: [coverageGap({ message: "gap" })],
      source: "slack",
      warnings: [],
    });
    expect(result.errors).toEqual(["wm", "gap"]);
  });

  it("writeFailureResult keeps projected but zero written", () => {
    expect(writeFailureResult({ errors: ["io"], projected: 5, source: "notion", warnings: [] })).toEqual({
      deduped: 0,
      excluded: 0,
      errors: ["io"],
      gaps: [],
      notes: [],
      ok: false,
      projected: 5,
      source: "notion",
      warnings: [],
      written: 0,
    });
  });

  it("successfulIngestResult preserves write counts even when the watermark advance failed", () => {
    const result = successfulIngestResult({
      advanced: err(["wm"]),
      deduped: 2,
      projected: 5,
      source: "github",
      warnings: [],
      written: 3,
    });
    expect(result.ok).toBe(false);
    expect(result.written).toBe(3);
    expect(result.deduped).toBe(2);
    expect(result.errors).toEqual(["wm"]);
  });

  it("successfulIngestResult fails a source with a coverage gap, names the gap, and keeps what it wrote", () => {
    const result = successfulIngestResult({
      advanced: ok(undefined),
      deduped: 1,
      gaps: [coverageGap({ message: "slack channel C_HANG was abandoned as stalled" })],
      projected: 8,
      source: "slack",
      warnings: [],
      written: 7,
    });
    expect(result.ok).toBe(false);
    expect(result.written).toBe(7);
    expect(result.errors).toEqual(["slack channel C_HANG was abandoned as stalled"]);
  });
});

/** The fake clock every advance below is capped against — far enough ahead to cap nothing by accident. */
const FAKE_NOW = "2030-01-01T00:00:00Z";

/** A plain fake IngestDeps (no mocks): canned write/advance outcomes + call recorders. */
const fakeDeps = ({
  write,
  advance,
}: {
  write: Result<WriteResult>;
  advance: ReturnType<IngestDeps["advance"]>;
}): { deps: IngestDeps; writeCalls: unknown[]; advanceCalls: unknown[] } => {
  const writeCalls: unknown[] = [];
  const advanceCalls: unknown[] = [];
  return {
    advanceCalls,
    deps: {
      advance: (args) => {
        advanceCalls.push(args);
        return advance;
      },
      nowIso: () => FAKE_NOW,
      write: (args) => {
        writeCalls.push(args);
        return write;
      },
    },
    writeCalls,
  };
};

const ghJob = (over: Partial<SourceIngestJob> = {}): SourceIngestJob => ({
  label: "GitHub",
  run: () => Promise.resolve(ok({ records: [slackRecord], warnings: [] })),
  source: "github",
  window,
  ...over,
});

describe("ingestSources over injected seams", () => {
  it("does NOT advance the watermark when the write fails", async () => {
    const { deps, advanceCalls } = fakeDeps({ advance: ok({ paths: [] }), write: err(["disk full"]) });
    const result = unwrap(await ingestSources({ deps, home: "/h", jobs: [ghJob()] }))[0]!;
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(["disk full"]);
    expect(advanceCalls).toHaveLength(0);
  });

  it("surfaces a watermark failure after a successful write, keeping the write counts", async () => {
    const { deps } = fakeDeps({
      advance: err(["wm io"]),
      write: ok({ bySource: { github: 1 }, deduped: 0, excluded: 0, written: 1 }),
    });
    const result = unwrap(await ingestSources({ deps, home: "/h", jobs: [ghJob()] }))[0]!;
    expect(result.ok).toBe(false);
    expect(result.written).toBe(1);
    expect(result.errors).toEqual(["wm io"]);
  });

  it("emits start/done progress in order and one source failure does not skip the next", async () => {
    const { deps } = fakeDeps({
      advance: ok({ paths: [] }),
      write: ok({ bySource: { github: 1 }, deduped: 0, excluded: 0, written: 1 }),
    });
    const progress: IngestProgress[] = [];
    const results = unwrap(
      await ingestSources({
        deps,
        home: "/h",
        jobs: [ghJob({ label: "A", run: () => Promise.resolve(err(["a failed"])) }), ghJob({ label: "B" })],
        onProgress: (p) => progress.push(p),
      }),
    );
    expect(results.map((r) => r.ok)).toEqual([false, true]);
    expect(progress.map((p) => `${p.phase}:${String(p.done)}`)).toEqual(["start:0", "done:1", "start:1", "done:2"]);
  });
});
