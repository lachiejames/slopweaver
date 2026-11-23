/*
 * `scanCodexGauge`'s stopping rule over Codex homes whose day-directories and file times each case builds by
 * hand: several days, a resumed session, a file past the eight-day horizon, a windowless exhaustion event, and
 * two-window readings. The cases built through one day-directory of rollout files reopen this describe in
 * `scanStoppingRollouts.test.ts`.
 */
import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scanCodexGauge } from "../../../../codex/gaugeScan.js";
import { epochSecondsToIso } from "../../../../lib/date.js";
import {
  REAL_POST_CAP_PREMIUM_EMPTY_LINE,
  REAL_USAGE_LIMIT_REACHED_LINE,
  REAL_WEEKLY_EXHAUSTED_LINE,
} from "../../../codexRolloutLines.js";
import {
  emptyCodexHome,
  FIVE_HOUR_OPEN_RESET,
  FIVE_HOUR_PASSED_RESET,
  OPEN_WEEKLY_EXHAUSTED_LINE,
  twoWindowLine,
  useGaugeRunHomes,
} from "./harness.js";

useGaugeRunHomes();

describe("scanCodexGauge stops only when no unread file could hold a later informative reading", () => {
  it("finds a still-current weekly cap in the SIXTH day-directory behind five newer days of empty readings", () => {
    const weekly = OPEN_WEEKLY_EXHAUSTED_LINE.replace("2026-07-19T16:28:08.923Z", "2026-09-17T19:49:00.000Z");
    const codexHome = emptyCodexHome();
    const days = ["23", "22", "21", "20", "19", "17"];
    const newestSeconds = 1_790_000_000;
    days.forEach((day, index) => {
      const dayDir = join(codexHome, "sessions", "2026", "09", day);
      mkdirSync(dayDir, { recursive: true });
      const path = join(dayDir, "rollout-000.jsonl");
      writeFileSync(path, `${index === days.length - 1 ? weekly : REAL_POST_CAP_PREMIUM_EMPTY_LINE}\n`, "utf8");
      utimesSync(path, newestSeconds - index * 86_400, newestSeconds - index * 86_400);
    });

    const scan = scanCodexGauge({ codexHome });

    expect(scan.gauge!.windows[0]!.usedPercent).toBe(100);
    expect(scan.filesRead).toBe(6);
  });

  it("finds a resumed session's current cap in a day-directory weeks older than eight newer empty days", () => {
    const newestSeconds = 1_790_000_000;
    const codexHome = emptyCodexHome();
    ["23", "22", "21", "20", "19", "18", "17", "16"].forEach((day, index) => {
      const dayDir = join(codexHome, "sessions", "2026", "09", day);
      mkdirSync(dayDir, { recursive: true });
      const path = join(dayDir, "rollout-000.jsonl");
      writeFileSync(path, `${REAL_POST_CAP_PREMIUM_EMPTY_LINE}\n`, "utf8");
      utimesSync(path, newestSeconds - 60 - index * 86_400, newestSeconds - 60 - index * 86_400);
    });
    const resumedDir = join(codexHome, "sessions", "2026", "09", "01");
    mkdirSync(resumedDir, { recursive: true });
    const resumed = join(resumedDir, "rollout-000.jsonl");
    const capped = OPEN_WEEKLY_EXHAUSTED_LINE.replace("2026-07-19T16:28:08.923Z", "2026-09-21T14:13:10.000Z");
    writeFileSync(resumed, `${capped}\n`, "utf8");
    utimesSync(resumed, newestSeconds, newestSeconds);

    const scan = scanCodexGauge({ codexHome });

    expect(scan.gauge!.windows[0]!.usedPercent).toBe(100);
    expect(scan.filesRead).toBe(1);
  });

  it("leaves out a file modified more than eight days before the newest one", () => {
    const newestSeconds = 1_790_000_000;
    const codexHome = emptyCodexHome();
    const recentDir = join(codexHome, "sessions", "2026", "09", "21");
    const staleDir = join(codexHome, "sessions", "2026", "09", "12");
    mkdirSync(recentDir, { recursive: true });
    mkdirSync(staleDir, { recursive: true });
    const recent = join(recentDir, "rollout-000.jsonl");
    const stale = join(staleDir, "rollout-000.jsonl");
    writeFileSync(recent, `${REAL_POST_CAP_PREMIUM_EMPTY_LINE}\n`, "utf8");
    writeFileSync(stale, `${REAL_WEEKLY_EXHAUSTED_LINE}\n`, "utf8");
    utimesSync(recent, newestSeconds, newestSeconds);
    utimesSync(stale, newestSeconds - 9 * 86_400, newestSeconds - 9 * 86_400);

    const scan = scanCodexGauge({ codexHome });

    expect(scan.gauge!.windows).toEqual([]);
    expect(scan.filesRead).toBe(1);
  });

  it("keeps a file's own capped window when its last line is Codex's windowless exhaustion event", () => {
    const codexHome = emptyCodexHome();
    const dayDir = join(codexHome, "sessions", "2026", "09", "11");
    mkdirSync(dayDir, { recursive: true });
    const capped = join(dayDir, "rollout-001.jsonl");
    const dipped = join(dayDir, "rollout-000.jsonl");
    const weeklyAt = ({ iso, percent }: { iso: string; percent: string }): string =>
      OPEN_WEEKLY_EXHAUSTED_LINE.replace("2026-07-19T16:28:08.923Z", iso).replace(
        '"used_percent":100.0',
        `"used_percent":${percent}`,
      );
    writeFileSync(
      capped,
      [
        weeklyAt({ iso: "2026-09-11T07:31:13.000Z", percent: "100.0" }),
        weeklyAt({ iso: "2026-09-11T07:31:17.000Z", percent: "100.0" }),
        REAL_USAGE_LIMIT_REACHED_LINE,
        "",
      ].join("\n"),
      "utf8",
    );
    writeFileSync(dipped, `${weeklyAt({ iso: "2026-09-11T07:19:00.000Z", percent: "97.0" })}\n`, "utf8");
    utimesSync(capped, new Date("2026-09-11T07:31:25.000Z"), new Date("2026-09-11T07:31:25.000Z"));
    utimesSync(dipped, new Date("2026-09-11T07:19:01.000Z"), new Date("2026-09-11T07:19:01.000Z"));

    const scan = scanCodexGauge({ codexHome, nowMs: Date.parse("2026-09-11T07:40:00.000Z") });

    expect(scan.gauge!.observedAtIso).toBe("2026-09-11T07:31:24.319Z");
    expect(scan.gauge!.windows.map((window) => [window.label, window.usedPercent])).toEqual([["weekly", 100]]);
  });

  it("reads on past a newer capped weekly-only reading to an older file holding a current five-hour cap", () => {
    const codexHome = emptyCodexHome();
    const dayDir = join(codexHome, "sessions", "2026", "09", "23");
    mkdirSync(dayDir, { recursive: true });
    const older = join(dayDir, "rollout-000.jsonl");
    const newer = join(dayDir, "rollout-001.jsonl");
    const olderLine = twoWindowLine({
      fiveHour: 100,
      fiveHourResetSeconds: FIVE_HOUR_OPEN_RESET,
      observedIso: "2026-09-23T09:59:00.000Z",
      weekly: 20,
    });
    writeFileSync(older, `${olderLine}\n`, "utf8");
    writeFileSync(
      newer,
      `${OPEN_WEEKLY_EXHAUSTED_LINE.replace("2026-07-19T16:28:08.923Z", "2026-09-23T11:00:00.000Z")}\n`,
      "utf8",
    );
    utimesSync(older, new Date("2026-09-23T10:00:00.000Z"), new Date("2026-09-23T10:00:00.000Z"));
    utimesSync(newer, new Date("2026-09-23T11:01:00.000Z"), new Date("2026-09-23T11:01:00.000Z"));

    const scan = scanCodexGauge({ codexHome, nowMs: Date.parse("2026-09-23T11:30:00.000Z") });

    expect(scan.filesRead).toBe(2);
    expect(scan.gauge!.windows.map((window) => [window.label, window.usedPercent])).toEqual([
      ["weekly", 100],
      ["five-hour", 100],
    ]);
  });

  it("stops before a file too old to hold a current window of a label no reading has named", () => {
    const codexHome = emptyCodexHome();
    const dayDir = join(codexHome, "sessions", "2026", "09", "23");
    mkdirSync(dayDir, { recursive: true });
    const older = join(dayDir, "rollout-000.jsonl");
    const newer = join(dayDir, "rollout-001.jsonl");
    writeFileSync(
      older,
      `${OPEN_WEEKLY_EXHAUSTED_LINE.replace("2026-07-19T16:28:08.923Z", "2026-09-23T05:00:00.000Z")}\n`,
      "utf8",
    );
    writeFileSync(
      newer,
      `${OPEN_WEEKLY_EXHAUSTED_LINE.replace("2026-07-19T16:28:08.923Z", "2026-09-23T11:00:00.000Z")}\n`,
      "utf8",
    );
    utimesSync(older, new Date("2026-09-23T05:00:00.000Z"), new Date("2026-09-23T05:00:00.000Z"));
    utimesSync(newer, new Date("2026-09-23T11:01:00.000Z"), new Date("2026-09-23T11:01:00.000Z"));

    const scan = scanCodexGauge({ codexHome, nowMs: Date.parse("2026-09-23T11:30:00.000Z") });

    expect(scan.filesRead).toBe(1);
    expect(scan.filesSkipped).toBe(1);
  });

  it("reads on past a window seen only AFTER its reset to the older reading still holding it open", () => {
    const codexHome = emptyCodexHome();
    const dayDir = join(codexHome, "sessions", "2026", "09", "23");
    mkdirSync(dayDir, { recursive: true });
    const older = join(dayDir, "rollout-000.jsonl");
    const newer = join(dayDir, "rollout-001.jsonl");
    const olderLine = twoWindowLine({
      fiveHour: 100,
      fiveHourResetSeconds: FIVE_HOUR_OPEN_RESET,
      observedIso: "2026-09-23T10:30:00.000Z",
      weekly: 100,
    });
    const newerLine = twoWindowLine({
      fiveHour: 5,
      fiveHourResetSeconds: FIVE_HOUR_PASSED_RESET,
      observedIso: "2026-09-23T11:00:00.000Z",
      weekly: 100,
    });
    writeFileSync(older, `${olderLine}\n`, "utf8");
    writeFileSync(newer, `${newerLine}\n`, "utf8");
    utimesSync(older, new Date("2026-09-23T10:30:01.000Z"), new Date("2026-09-23T10:30:01.000Z"));
    utimesSync(newer, new Date("2026-09-23T11:00:01.000Z"), new Date("2026-09-23T11:00:01.000Z"));

    const scan = scanCodexGauge({ codexHome, nowMs: Date.parse("2026-09-23T11:30:00.000Z") });

    expect(scan.filesRead).toBe(2);
    expect(scan.gauge!.windows.map((window) => [window.label, window.usedPercent])).toEqual([
      ["weekly", 100],
      ["five-hour", 100],
    ]);
  });

  it("reads on past a newer WINDOWLESS reached reading to the older capped window it cannot name", () => {
    const codexHome = emptyCodexHome();
    const dayDir = join(codexHome, "sessions", "2026", "09", "21");
    mkdirSync(dayDir, { recursive: true });
    const capped = join(dayDir, "rollout-000.jsonl");
    const reached = join(dayDir, "rollout-001.jsonl");
    writeFileSync(
      capped,
      `${OPEN_WEEKLY_EXHAUSTED_LINE.replace("2026-07-19T16:28:08.923Z", "2026-09-21T10:00:00.000Z")}\n`,
      "utf8",
    );
    writeFileSync(
      reached,
      `${REAL_USAGE_LIMIT_REACHED_LINE.replace("2026-09-11T07:31:24.319Z", "2026-09-21T13:00:00.000Z")}\n`,
      "utf8",
    );
    utimesSync(capped, new Date("2026-09-21T10:00:01.000Z"), new Date("2026-09-21T10:00:01.000Z"));
    utimesSync(reached, new Date("2026-09-21T13:00:01.000Z"), new Date("2026-09-21T13:00:01.000Z"));

    const scan = scanCodexGauge({ codexHome, nowMs: 1_790_000_000_000 });

    expect(scan.filesRead).toBe(2);
    expect(scan.gauge!.observedAtIso).toBe("2026-09-21T13:00:00.000Z");
    expect(scan.gauge!.windows.map((window) => [window.label, window.usedPercent])).toEqual([["weekly", 100]]);
  });

  it("reads on to an older 100% whose reset is up to the tolerance EARLIER than the dipped reading's", () => {
    const opened = 1_789_999_000;
    const reading = ({ percent, observed, reset }: { percent: number; observed: number; reset: number }): string =>
      REAL_WEEKLY_EXHAUSTED_LINE.replace("2026-07-19T16:28:08.923Z", epochSecondsToIso({ seconds: observed })!)
        .replace("1784998696", String(reset))
        .replace('"used_percent":100.0', `"used_percent":${String(percent)}.0`);
    const codexHome = emptyCodexHome();
    const dayDir = join(codexHome, "sessions", "2026", "09", "21");
    mkdirSync(dayDir, { recursive: true });
    const capped = join(dayDir, "rollout-000.jsonl");
    const dipped = join(dayDir, "rollout-001.jsonl");
    writeFileSync(capped, `${reading({ observed: opened + 5, percent: 100, reset: opened + 604_800 })}\n`, "utf8");
    writeFileSync(dipped, `${reading({ observed: opened + 60, percent: 97, reset: opened + 604_829 })}\n`, "utf8");
    utimesSync(capped, opened + 10, opened + 10);
    utimesSync(dipped, opened + 61, opened + 61);

    const scan = scanCodexGauge({ codexHome, nowMs: (opened + 3_600) * 1000 });

    expect(scan.gauge!.windows[0]!.usedPercent).toBe(100);
    expect(scan.filesRead).toBe(2);
  });
});
