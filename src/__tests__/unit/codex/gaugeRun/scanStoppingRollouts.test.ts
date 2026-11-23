/*
 * `scanCodexGauge`'s stopping rule over a Codex home of one day-directory, its rollout files newest first, one
 * line each — the cases built through `homeWithRollouts`. The cases that hand-build their day-directories and
 * file times reopen this describe in `scanStoppingDayDirs.test.ts`.
 */
import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scanCodexGauge } from "../../../../codex/gaugeScan.js";
import {
  REAL_HEALTHY_WEEKLY_LINE,
  REAL_POST_CAP_PREMIUM_EMPTY_LINE,
  REAL_WEEKLY_EXHAUSTED_LINE,
} from "../../../codexRolloutLines.js";
import { emptyCodexHome, OPEN_WEEKLY_EXHAUSTED_LINE, useGaugeRunHomes } from "./harness.js";

useGaugeRunHomes();

describe("scanCodexGauge stops only when no unread file could hold a later informative reading", () => {
  /** A Codex home with one day-directory of rollout files, newest first, one line each. */
  function homeWithRollouts({ lines }: { lines: readonly string[] }): string {
    const home = emptyCodexHome();
    const dayDir = join(home, "sessions", "2026", "09", "23");
    mkdirSync(dayDir, { recursive: true });
    const newestSeconds = 1_790_000_000;
    lines.forEach((line, index) => {
      const path = join(dayDir, `rollout-${String(index).padStart(3, "0")}.jsonl`);
      writeFileSync(path, `${line}\n`, "utf8");
      utimesSync(path, newestSeconds - index, newestSeconds - index);
    });
    return home;
  }

  it("finds the weekly reading in the THIRTEENTH file behind twelve empty post-cap files", () => {
    const weekly = OPEN_WEEKLY_EXHAUSTED_LINE.replace("2026-07-19T16:28:08.923Z", "2026-09-22T19:49:00.000Z");
    const codexHome = homeWithRollouts({
      lines: [...Array<string>(12).fill(REAL_POST_CAP_PREMIUM_EMPTY_LINE), weekly],
    });

    const scan = scanCodexGauge({ codexHome });

    expect(scan.gauge!.windows[0]!.usedPercent).toBe(100);
    expect(scan.gauge!.windows[0]!.label).toBe("weekly");
    expect(scan.filesRead).toBe(13);
    expect(scan.filesSkipped).toBe(0);
  });

  it("finds it behind MORE than two hundred empty files, since only the day-directories bound the walk", () => {
    const weekly = OPEN_WEEKLY_EXHAUSTED_LINE.replace("2026-07-19T16:28:08.923Z", "2026-09-22T19:49:00.000Z");
    const codexHome = homeWithRollouts({
      lines: [...Array<string>(205).fill(REAL_POST_CAP_PREMIUM_EMPTY_LINE), weekly],
    });

    const scan = scanCodexGauge({ codexHome });

    expect(scan.gauge!.windows[0]!.usedPercent).toBe(100);
    expect(scan.filesRead).toBe(206);
  });

  it("reads back past a line longer than the two-megabyte tail to the weekly cap written before it", () => {
    const weekly = OPEN_WEEKLY_EXHAUSTED_LINE.replace("2026-07-19T16:28:08.923Z", "2026-09-22T19:49:00.000Z");
    const oversized = JSON.stringify({ payload: { output: "x".repeat(2_600_000) }, type: "response_item" });
    const codexHome = homeWithRollouts({
      lines: [[weekly, oversized, REAL_POST_CAP_PREMIUM_EMPTY_LINE].join("\n")],
    });

    const scan = scanCodexGauge({ codexHome });

    expect(scan.gauge!.windows[0]!.usedPercent).toBe(100);
    expect(scan.filesRead).toBe(1);
  });

  it("skips empty day-directories rather than letting them use up the bound", () => {
    const weekly = OPEN_WEEKLY_EXHAUSTED_LINE.replace("2026-07-19T16:28:08.923Z", "2026-09-22T19:49:00.000Z");
    const codexHome = homeWithRollouts({ lines: [weekly] });
    ["01", "02", "03", "04", "05", "06", "07", "08"].forEach((day) => {
      mkdirSync(join(codexHome, "sessions", "2027", "01", day), { recursive: true });
    });

    const scan = scanCodexGauge({ codexHome });

    expect(scan.gauge!.windows[0]!.usedPercent).toBe(100);
    expect(scan.filesRead).toBe(1);
  });

  it("stops as soon as every unread file was modified before a best reading whose window is already full", () => {
    const capped = OPEN_WEEKLY_EXHAUSTED_LINE.replace("2026-07-19T16:28:08.923Z", "2026-09-21T14:13:20.000Z");
    const codexHome = homeWithRollouts({ lines: Array<string>(14).fill(capped) });

    const scan = scanCodexGauge({ codexHome });

    expect(scan.filesRead).toBe(1);
    expect(scan.filesSkipped).toBe(13);
  });

  it("never stops on a full window that had already reset when it was read", () => {
    const expired = REAL_WEEKLY_EXHAUSTED_LINE.replace("2026-07-19T16:28:08.923Z", "2026-09-21T14:13:20.000Z");
    const codexHome = homeWithRollouts({ lines: Array<string>(14).fill(expired) });

    const scan = scanCodexGauge({ codexHome });

    expect(scan.filesRead).toBe(14);
  });

  it("reports an older still-open 100% over a newer reading of a window that had already reset", () => {
    const current = OPEN_WEEKLY_EXHAUSTED_LINE.replace("2026-07-19T16:28:08.923Z", "2026-09-21T14:13:00.000Z");
    const expired = REAL_HEALTHY_WEEKLY_LINE.replace("2026-09-13T05:51:14.803Z", "2026-09-21T14:13:20.000Z");
    const codexHome = homeWithRollouts({ lines: [expired, current] });

    const scan = scanCodexGauge({ codexHome });

    expect(scan.gauge!.windows[0]!.usedPercent).toBe(100);
    expect(scan.gauge!.observedAtIso).toBe("2026-09-21T14:13:00.000Z");
  });

  it("never lets a newer reached type on an already-reset window mask an older open cap", () => {
    const capped = OPEN_WEEKLY_EXHAUSTED_LINE.replace("2026-07-19T16:28:08.923Z", "2026-09-21T10:00:00.000Z");
    const stale = REAL_WEEKLY_EXHAUSTED_LINE.replace("2026-07-19T16:28:08.923Z", "2026-09-21T12:00:00.000Z")
      .replace('"used_percent":100.0', '"used_percent":20.0')
      .replace('"rate_limit_reached_type":null', '"rate_limit_reached_type":"workspace_member_usage_limit_reached"');
    const codexHome = homeWithRollouts({ lines: [stale, capped] });

    const scan = scanCodexGauge({ codexHome, nowMs: 1_790_000_000_000 });

    expect(scan.gauge!.observedAtIso).toBe("2026-09-21T10:00:00.000Z");
    expect(scan.gauge!.windows[0]!.usedPercent).toBe(100);
    expect(scan.gauge!.reachedType).toBeUndefined();
  });

  it("drops a reading claiming to be from after the scan instant, so a true cap behind it stands", () => {
    const capped = OPEN_WEEKLY_EXHAUSTED_LINE.replace("2026-07-19T16:28:08.923Z", "2026-09-21T14:13:00.000Z");
    const skewed = OPEN_WEEKLY_EXHAUSTED_LINE.replace("2026-07-19T16:28:08.923Z", "2026-09-22T00:00:00.000Z").replace(
      '"used_percent":100.0',
      '"used_percent":97.0',
    );
    const codexHome = homeWithRollouts({ lines: [skewed, capped] });

    const scan = scanCodexGauge({ codexHome, nowMs: 1_790_000_000_000 });

    expect(scan.gauge!.observedAtIso).toBe("2026-09-21T14:13:00.000Z");
    expect(scan.gauge!.windows[0]!.usedPercent).toBe(100);
  });

  it("keeps reading an open window under 100%, since an older file may hold its higher mark", () => {
    const current = REAL_HEALTHY_WEEKLY_LINE.replace("2026-09-13T05:51:14.803Z", "2026-09-21T14:13:20.000Z").replace(
      "1789877221",
      "1790400000",
    );
    const codexHome = homeWithRollouts({ lines: Array<string>(14).fill(current) });

    const scan = scanCodexGauge({ codexHome });

    expect(scan.filesRead).toBe(14);
    expect(scan.filesSkipped).toBe(0);
  });

  it("reads on to an older file's 100% when the newest reading of the same window is a concurrent 97% dip", () => {
    const capped = OPEN_WEEKLY_EXHAUSTED_LINE.replace("2026-07-19T16:28:08.923Z", "2026-09-21T14:13:00.000Z");
    const dipped = OPEN_WEEKLY_EXHAUSTED_LINE.replace("2026-07-19T16:28:08.923Z", "2026-09-21T14:13:20.000Z").replace(
      '"used_percent":100.0',
      '"used_percent":97.0',
    );
    const codexHome = homeWithRollouts({ lines: [dipped, capped] });

    const scan = scanCodexGauge({ codexHome });

    expect(scan.gauge!.windows[0]!.usedPercent).toBe(100);
    expect(scan.filesRead).toBe(2);
  });

  it("reads past a stale reading in a newer-modified file to a later-observed cap in an older-modified one", () => {
    const capped = OPEN_WEEKLY_EXHAUSTED_LINE.replace("2026-07-19T16:28:08.923Z", "2026-09-21T14:00:00.000Z");
    const codexHome = homeWithRollouts({
      lines: [REAL_HEALTHY_WEEKLY_LINE, ...Array<string>(11).fill(REAL_POST_CAP_PREMIUM_EMPTY_LINE), capped],
    });

    const scan = scanCodexGauge({ codexHome });

    expect(scan.gauge!.windows[0]!.usedPercent).toBe(100);
    expect(scan.filesRead).toBe(13);
  });
});
