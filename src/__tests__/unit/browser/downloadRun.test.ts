import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { DownloadDirectoryObservation, DownloadFile } from "../../../browser/download.js";
import { DOWNLOAD_WATCH_MS, listDownloadDir, resolveDownload, watchDownloadDir } from "../../../browser/downloadRun.js";
import { ok } from "../../../lib/result.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-download-run-"));
  dirs.push(dir);
  return dir;
}

/** A listing in name order, so an assertion does not depend on the directory's own order. */
function byName({ files }: { files: readonly DownloadFile[] }): readonly DownloadFile[] {
  return files.toSorted((left, right) => left.name.localeCompare(right.name));
}

function sortedObservations({
  observations,
}: {
  observations: readonly DownloadDirectoryObservation[];
}): readonly DownloadDirectoryObservation[] {
  return observations.map((one) => ({ atIso: one.atIso, files: byName({ files: one.files }) }));
}

/**
 * A clock that moves only when the watch sleeps, and a sleep that records each wait and then runs the next
 * scripted change to the directory.
 */
function drivenWatch({ changes }: { changes: readonly (() => void)[] }): {
  nowMs: Parameters<typeof watchDownloadDir>[0]["nowMs"];
  sleep: Parameters<typeof watchDownloadDir>[0]["sleep"];
  slept: number[];
} {
  let now = 0;
  const slept: number[] = [];
  const pending = [...changes];
  return {
    nowMs: () => now,
    sleep: (ms) => {
      slept.push(ms);
      now += ms;
      const change = pending.shift();
      if (change !== undefined) {
        change();
      }
    },
    slept,
  };
}

describe("listDownloadDir", () => {
  it("lists regular files with their sizes, a zero-byte one included and a child directory left out", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "a.pdf"), "abc");
    writeFileSync(join(dir, "empty.txt"), "");
    mkdirSync(join(dir, "nested"));

    expect(byName({ files: listDownloadDir({ directory: dir }) })).toEqual([
      { bytes: 3, name: "a.pdf" },
      { bytes: 0, name: "empty.txt" },
    ]);
  });

  it("answers an empty list for a directory that does not exist", () => {
    expect(listDownloadDir({ directory: join(tempDir(), "absent") })).toEqual([]);
  });
});

describe("watchDownloadDir", () => {
  it("sets the download watch constant to 20_000 ms", () => {
    expect(DOWNLOAD_WATCH_MS).toBe(20_000);
  });

  it("settles on the observation where a new file's size first repeats, not on a stable baseline file, observing every 750 ms", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "old.pdf"), "1234");
    const watch = drivenWatch({
      changes: [
        () => writeFileSync(join(dir, "report.pdf"), "ab"),
        () => writeFileSync(join(dir, "report.pdf"), "abcde"),
      ],
    });

    const observations = watchDownloadDir({
      baseline: [{ bytes: 4, name: "old.pdf" }],
      directory: dir,
      nowMs: watch.nowMs,
      sleep: watch.sleep,
    });

    expect(sortedObservations({ observations })).toEqual([
      {
        atIso: "1970-01-01T00:00:00.750Z",
        files: [
          { bytes: 4, name: "old.pdf" },
          { bytes: 2, name: "report.pdf" },
        ],
      },
      {
        atIso: "1970-01-01T00:00:01.500Z",
        files: [
          { bytes: 4, name: "old.pdf" },
          { bytes: 5, name: "report.pdf" },
        ],
      },
      {
        atIso: "1970-01-01T00:00:02.250Z",
        files: [
          { bytes: 4, name: "old.pdf" },
          { bytes: 5, name: "report.pdf" },
        ],
      },
    ]);
    expect(watch.slept).toEqual([750, 750, 750]);
  });

  it("times out after 27 waits of 750 ms, the last observation at 20.25 s showing only the baseline file, when only that file ever stands", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "old.pdf"), "1234");
    const watch = drivenWatch({ changes: [] });

    const observations = watchDownloadDir({
      baseline: [{ bytes: 4, name: "old.pdf" }],
      directory: dir,
      nowMs: watch.nowMs,
      sleep: watch.sleep,
    });

    expect(observations.length).toBe(27);
    expect(watch.slept).toEqual(Array.from({ length: 27 }, () => 750));
    expect(observations.at(-1)).toEqual({ atIso: "1970-01-01T00:00:20.250Z", files: [{ bytes: 4, name: "old.pdf" }] });
  });
});

describe("resolveDownload", () => {
  const landmine = (): void => {
    throw new Error("a request that is not a watched download must never wait");
  };

  it("answers null without waiting for a kind that is not a download", () => {
    expect(
      resolveDownload({
        baseline: [],
        request: { downloadDir: tempDir(), downloadOut: undefined, expectName: undefined, kind: "click" },
        sleep: landmine,
      }),
    ).toEqual(ok(null));
  });

  it("answers null without waiting for a download that names no directory", () => {
    expect(
      resolveDownload({
        baseline: [],
        request: { downloadDir: undefined, downloadOut: undefined, expectName: undefined, kind: "download" },
        sleep: landmine,
      }),
    ).toEqual(ok(null));
  });
});
