import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { scanCodexGaugeSeries } from "../../../codex/gaugeSeries.js";
import {
  REAL_FIVE_HOUR_PRIMARY_LINE,
  REAL_HEALTHY_WEEKLY_LINE,
  REAL_SPEND_CAP_TASK_COMPLETE_LINE,
  REAL_WEEKLY_EXHAUSTED_LINE,
} from "../../codexRolloutLines.js";

let codexHome: string;

beforeEach(() => {
  codexHome = mkdtempSync(join(tmpdir(), "gauge-series-"));
});

afterEach(() => {
  rmSync(codexHome, { force: true, recursive: true });
});

/** Write one rollout file under `sessions/<day>/` with an explicit mtime, in epoch seconds. */
function writeRollout({
  day,
  name,
  lines,
  mtimeSeconds,
}: {
  day: string;
  name: string;
  lines: readonly string[];
  mtimeSeconds: number;
}): void {
  const dayDir = join(codexHome, "sessions", day);
  mkdirSync(dayDir, { recursive: true });
  const path = join(dayDir, name);
  writeFileSync(path, `${lines.join("\n")}\n`, "utf8");
  utimesSync(path, mtimeSeconds, mtimeSeconds);
}

/**
 * Two rollout files whose mtime order is the REVERSE of their directory order: the file in the older
 * day-directory was written to most recently, as a resumed session's is.
 */
function writeReversedPair(): void {
  writeRollout({
    day: "2026/07/01",
    lines: [REAL_FIVE_HOUR_PRIMARY_LINE, REAL_WEEKLY_EXHAUSTED_LINE],
    mtimeSeconds: 1_790_000_200,
    name: "rollout-a.jsonl",
  });
  writeRollout({
    day: "2026/07/03",
    lines: [REAL_HEALTHY_WEEKLY_LINE],
    mtimeSeconds: 1_790_000_100,
    name: "rollout-b.jsonl",
  });
}

describe("scanCodexGaugeSeries", () => {
  it("returns every reading in a file, including both windows one event carries", () => {
    writeRollout({
      day: "2026/07/03",
      lines: [REAL_FIVE_HOUR_PRIMARY_LINE],
      mtimeSeconds: 1_790_000_000,
      name: "rollout-1.jsonl",
    });

    expect(scanCodexGaugeSeries({ codexHome })).toEqual({
      filesRead: 1,
      filesSkipped: 0,
      gauges: [
        {
          credits: undefined,
          limitId: "codex",
          observedAtIso: "2026-07-03T03:51:33.329Z",
          planType: "team",
          reached: undefined,
          reachedType: undefined,
          windows: [
            {
              label: "five-hour",
              resetAtIso: "2026-07-03T08:51:13.000Z",
              slot: "primary",
              usedPercent: 1,
              windowMinutes: 300,
            },
            {
              label: "weekly",
              resetAtIso: "2026-07-07T09:00:16.000Z",
              slot: "secondary",
              usedPercent: 13,
              windowMinutes: 10_080,
            },
          ],
        },
      ],
    });
  });

  it("orders files by mtime, newest first, rather than by directory name, and keeps file order within each", () => {
    writeReversedPair();

    const series = scanCodexGaugeSeries({ codexHome });

    expect(series.gauges.map((gauge) => gauge.observedAtIso)).toEqual([
      "2026-07-03T03:51:33.329Z",
      "2026-07-19T16:28:08.923Z",
      "2026-09-13T05:51:14.803Z",
    ]);
    expect([series.filesRead, series.filesSkipped]).toEqual([2, 0]);
  });

  it("opens only the newest file at maxFiles 1 and reports the other as skipped, and opens both at maxFiles 2", () => {
    writeReversedPair();

    const one = scanCodexGaugeSeries({ codexHome, maxFiles: 1 });
    const two = scanCodexGaugeSeries({ codexHome, maxFiles: 2 });

    expect(one.gauges.map((gauge) => gauge.observedAtIso)).toEqual([
      "2026-07-03T03:51:33.329Z",
      "2026-07-19T16:28:08.923Z",
    ]);
    expect([one.filesRead, one.filesSkipped]).toEqual([1, 1]);
    expect(two.gauges.map((gauge) => gauge.observedAtIso)).toEqual([
      "2026-07-03T03:51:33.329Z",
      "2026-07-19T16:28:08.923Z",
      "2026-09-13T05:51:14.803Z",
    ]);
    expect([two.filesRead, two.filesSkipped]).toEqual([2, 0]);
  });

  it("never counts a file in a day-directory past the dayDirs bound as skipped", () => {
    writeReversedPair();

    const series = scanCodexGaugeSeries({ codexHome, dayDirs: 1 });

    expect(series.gauges.map((gauge) => gauge.observedAtIso)).toEqual(["2026-09-13T05:51:14.803Z"]);
    expect([series.filesRead, series.filesSkipped]).toEqual([1, 0]);
  });

  it("counts an opened file whose lines carry no reading, while contributing no gauge", () => {
    writeRollout({
      day: "2026/07/03",
      lines: ["{not json", REAL_SPEND_CAP_TASK_COMPLETE_LINE, REAL_HEALTHY_WEEKLY_LINE.slice(120)],
      mtimeSeconds: 1_790_000_000,
      name: "rollout-noise.jsonl",
    });

    expect(scanCodexGaugeSeries({ codexHome })).toEqual({ filesRead: 1, filesSkipped: 0, gauges: [] });
  });

  it("returns the empty series for a home with no sessions directory", () => {
    expect(scanCodexGaugeSeries({ codexHome: join(codexHome, "absent") })).toEqual({
      filesRead: 0,
      filesSkipped: 0,
      gauges: [],
    });
  });
});
