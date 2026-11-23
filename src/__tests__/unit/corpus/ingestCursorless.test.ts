/**
 * A `cursorless` lane writes its records and NO watermark — and, unlike a coverage gap, that is not a failure.
 *
 * The distinction is the whole reason `cursorless` is its own field rather than a reused `gaps` entry: a gap
 * means the lane could not see its window, so the run must report failure; `cursorless` means there is no
 * window and no cursor to begin with, so the run is a clean success that simply leaves no resume state behind.
 * Faking it with a gap would have made every `refresh --self` exit non-zero forever.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { OwnerProtectionResolver } from "../../../corpus/bronzeProtection.js";
import { readCorpusDir } from "../../../corpus/corpusDirRead.js";
import { bronzeSourceDir } from "../../../corpus/corpusPaths.js";
import type { SourceIngestJob } from "../../../corpus/ingestJob.js";
import { ingestSources } from "../../../corpus/ingestSource.js";
import type { CorpusRecord } from "../../../corpus/types.js";
import { advanceWatermark, isCursorlessSource, readWatermark } from "../../../corpus/watermark.js";
import { ok, type Result, unwrap } from "../../../lib/result.js";

/** An owner protect list with no entries, so no test reads the owner's own registry. */
const NO_ENTRIES: OwnerProtectionResolver = () => ok([]);

const window = { since: "1970-01-01", until: "2026-08-06" };
type RunResult = Result<{ records: readonly CorpusRecord[]; warnings: readonly string[] }>;

const selfRecord: CorpusRecord = {
  author: "me",
  container: "state/junkyard",
  kind: "document",
  refs: [],
  source: "self",
  sourceId: "state/junkyard/an-old-idea.md#0.0:owned-paths",
  text: "the idea, restated",
  tsIso: "2026-07-19T10:00:00+10:00",
  url: "/dev/state/junkyard/an-old-idea.md",
  visibility: "private",
};

/** A cursorless job yielding one record, or none. */
function cursorlessJob({ records }: { records: readonly CorpusRecord[] }): SourceIngestJob {
  return {
    cursorless: true,
    label: "self (1 root(s))",
    run: async (): Promise<RunResult> => ok({ records, warnings: [] }),
    source: "self",
    window,
  };
}

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function tempHome(): string {
  const root = mkdtempSync(join(tmpdir(), "slopweaver-cursorless-"));
  fixtureDirs.push(root);
  return join(root, "home");
}

/**
 * The hole a review pass found, and the reason the guard moved.
 *
 * The first version made cursorlessness a FLAG on the job, so the invariant held only as long as every call
 * site remembered to set it. Widening `CorpusSource` had also widened the generic watermark API, so
 * `advanceWatermark({ watermarks: [{ source: "self", … }] })` was type-valid and wrote `watermarks/self.json`.
 * Both routes are closed now, and both are pinned here — an optional flag whose absence breaks an invariant is
 * not an invariant.
 */
describe("no watermark can be written for a cursorless source, whatever the caller does", () => {
  it("names self as cursorless, and the fetched sources as not", () => {
    expect(isCursorlessSource({ source: "self" })).toBe(true);
    expect(isCursorlessSource({ source: "github" })).toBe(false);
    expect(isCursorlessSource({ source: "slack" })).toBe(false);
    expect(isCursorlessSource({ source: "linear" })).toBe(false);
    expect(isCursorlessSource({ source: "notion" })).toBe(false);
  });

  it("refuses a DIRECT advanceWatermark call for self, rather than trusting the caller", () => {
    const home = tempHome();

    const advanced = advanceWatermark({ home, watermarks: [{ cursor: "2026-08-06T00:00:00.000Z", source: "self" }] });

    expect(advanced.isOk()).toBe(true);
    expect(unwrap(advanced).paths).toEqual([]);
    expect(readWatermark({ home, source: "self" })).toBeUndefined();
  });

  it("still writes the cursor for a fetched source named in the same call", () => {
    const home = tempHome();

    const advanced = advanceWatermark({
      home,
      watermarks: [
        { cursor: "2026-08-06T00:00:00.000Z", source: "self" },
        { cursor: "2026-05-01T00:00:00.000Z", source: "slack" },
      ],
    });

    expect(unwrap(advanced).paths.length).toBe(1);
    expect(readWatermark({ home, source: "slack" })).toBe("2026-05-01T00:00:00.000Z");
    expect(readWatermark({ home, source: "self" })).toBeUndefined();
  });

  it("writes no watermark for a self job that FORGOT to declare itself cursorless", async () => {
    const home = tempHome();
    const undeclared: SourceIngestJob = {
      label: "self (careless)",
      run: async (): Promise<RunResult> => ok({ records: [selfRecord], warnings: [] }),
      source: "self",
      window,
    };

    const result = unwrap(await ingestSources({ home, jobs: [undeclared] }))[0]!;

    expect(result.written).toBe(1);
    expect(readWatermark({ home, source: "self" })).toBeUndefined();
  });

  it("writes no watermark for an EMPTY undeclared self job either — the exact reported counterexample", async () => {
    const home = tempHome();
    const undeclaredEmpty: SourceIngestJob = {
      label: "self (careless, empty)",
      run: async (): Promise<RunResult> => ok({ records: [], warnings: [] }),
      source: "self",
      window,
    };

    const result = unwrap(await ingestSources({ home, jobs: [undeclaredEmpty] }))[0]!;

    expect(result.ok).toBe(true);
    expect(readWatermark({ home, source: "self" })).toBeUndefined();
  });
});

describe("a cursorless lane", () => {
  it("writes its records", async () => {
    const home = tempHome();

    const result = unwrap(await ingestSources({ home, jobs: [cursorlessJob({ records: [selfRecord] })] }))[0]!;

    expect(result.written).toBe(1);
    expect(
      unwrap(
        readCorpusDir({ dir: bronzeSourceDir({ home, source: "self" }), home, protection: NO_ENTRIES }),
      ).records.map((r) => r.sourceId),
    ).toEqual(["state/junkyard/an-old-idea.md#0.0:owned-paths"]);
  });

  it("writes NO watermark, so nothing can later resume past a file", async () => {
    const home = tempHome();

    await ingestSources({ home, jobs: [cursorlessJob({ records: [selfRecord] })] });

    expect(readWatermark({ home, source: "self" })).toBeUndefined();
  });

  it("is still reported as a SUCCESS, unlike a coverage gap", async () => {
    const home = tempHome();

    const result = unwrap(await ingestSources({ home, jobs: [cursorlessJob({ records: [selfRecord] })] }))[0]!;

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.gaps).toEqual([]);
  });

  it("writes no watermark over an empty run either", async () => {
    const home = tempHome();

    const result = unwrap(await ingestSources({ home, jobs: [cursorlessJob({ records: [] })] }))[0]!;

    expect(result.ok).toBe(true);
    expect(result.written).toBe(0);
    expect(readWatermark({ home, source: "self" })).toBeUndefined();
  });

  it("re-running writes nothing new, which is what makes a full re-scan free", async () => {
    const home = tempHome();

    await ingestSources({ home, jobs: [cursorlessJob({ records: [selfRecord] })] });
    const second = unwrap(await ingestSources({ home, jobs: [cursorlessJob({ records: [selfRecord] })] }))[0]!;

    expect(second.written).toBe(0);
    expect(second.deduped).toBe(1);
    expect(readWatermark({ home, source: "self" })).toBeUndefined();
  });

  it("does not suppress a NORMAL lane's watermark in the same run", async () => {
    const home = tempHome();
    const slack: SourceIngestJob = {
      label: "slack",
      run: async (): Promise<RunResult> =>
        ok({
          records: [
            {
              container: "slack/C_A",
              kind: "message",
              refs: [],
              source: "slack",
              sourceId: "C_A:1.1",
              text: "hello",
              tsIso: "2026-05-01T00:00:00.000Z",
              url: "u",
            },
          ],
          warnings: [],
        }),
      source: "slack",
      window: { since: "2026-01-01", until: "2026-06-01" },
    };

    await ingestSources({ home, jobs: [cursorlessJob({ records: [selfRecord] }), slack] });

    expect(readWatermark({ home, source: "slack" })).toBe("2026-05-01T00:00:00.000Z");
    expect(readWatermark({ home, source: "self" })).toBeUndefined();
  });
});
