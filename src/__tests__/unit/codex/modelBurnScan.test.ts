/**
 * `scanModelBurn` over REAL temp homes: a registered Codex home with one rollout, read through the shipped
 * register and the shipped scan. Filesystem round-trips only, under `mkdtempSync` directories removed in
 * `afterEach`; nothing reads the operator's own `~/.codex`.
 */
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { buildModelBurnReport } from "../../../codex/modelBurn.js";
import { scanModelBurn } from "../../../codex/modelBurnScan.js";
import { epochSecondsToIso } from "../../../lib/date.js";
import { unwrap } from "../../../lib/result.js";
import type { RegisteredPlan } from "../../../plans/types.js";
import { stateHomePaths } from "../../../stateHome.js";
import { memoryPlanRegisterPort } from "../../planRegisterFixture.js";

const dirs: string[] = [];

/** A throwaway directory this file removes after every test. */
function temp({ prefix }: { prefix: string }): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

/** One `token_count` line reporting a weekly percentage, in the shape Codex writes. */
function weeklyLine({
  percent,
  resetsAt = 1790687001,
  timestamp,
}: {
  percent: number;
  resetsAt?: number;
  timestamp: string;
}): string {
  return JSON.stringify({
    payload: {
      rate_limits: {
        limit_id: "codex",
        plan_type: "pro",
        primary: { resets_at: resetsAt, used_percent: percent, window_minutes: 10080 },
        rate_limit_reached_type: null,
        secondary: null,
      },
      type: "token_count",
    },
    timestamp,
    type: "event_msg",
  });
}

/** A Codex home holding one pass whose weekly reading rose from 40% to 60%. */
function codexHome(): string {
  const home = temp({ prefix: "burn-home-" });
  const dayDir = join(home, "sessions", "2026", "09", "22");
  mkdirSync(dayDir, { recursive: true });
  const lines = [
    JSON.stringify({ payload: { id: "sess-1", thread_source: "slopweaver" }, type: "session_meta" }),
    JSON.stringify({ payload: { effort: "medium", model: "gpt-5.6-sol" }, type: "turn_context" }),
    weeklyLine({ percent: 40, timestamp: "2026-09-22T14:00:00.000Z" }),
    weeklyLine({ percent: 60, timestamp: "2026-09-22T15:00:00.000Z" }),
  ];
  writeFileSync(join(dayDir, "rollout-2026-09-22T14-00-00-aaaa.jsonl"), `${lines.join("\n")}\n`, "utf8");
  return home;
}

/** A state home whose register carries exactly `rows`. */
function stateWith({ rows }: { rows: readonly Omit<RegisteredPlan, "allowance" | "usageLimitPercent">[] }): string {
  const home = temp({ prefix: "burn-state-" });
  const path = stateHomePaths({ home }).plansJson;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ rows, version: 1 }), "utf8");
  return home;
}

afterEach(() => {
  dirs.splice(0).forEach((dir) => {
    rmSync(dir, { force: true, recursive: true });
  });
});

describe("scanModelBurn over real homes", () => {
  it("reads the model, effort and origin off a rollout's head and the rise off its tail", async () => {
    const codex = codexHome();
    const scan = unwrap(
      await scanModelBurn({
        days: 3,
        home: stateWith({ rows: [{ alias: "codex-a", provider: "codex", storeDir: codex }] }),
        port: memoryPlanRegisterPort(),
      }),
    );
    const report = buildModelBurnReport({ sessions: scan.sessions });
    expect(scan.filesRead).toBe(1);
    expect(report.rows.map((row) => [row.model, row.effort, row.passes, row.weeklyDrawn])).toEqual([
      ["gpt-5.6-sol", "medium", 1, 20],
    ]);
  });

  it("reads a resumed session's file in an old day-directory by its mtime, and leaves out a stale one", async () => {
    const codex = temp({ prefix: "burn-home-" });
    const newestSeconds = 1_790_000_000;
    const head = [
      JSON.stringify({ payload: { id: "sess-1", thread_source: "slopweaver" }, type: "session_meta" }),
      JSON.stringify({ payload: { effort: "medium", model: "gpt-5.6-sol" }, type: "turn_context" }),
    ];
    const write = ({ day, percents, ageSeconds }: { day: string; percents: readonly number[]; ageSeconds: number }) => {
      const dayDir = join(codex, "sessions", "2026", "09", day);
      mkdirSync(dayDir, { recursive: true });
      const path = join(dayDir, `rollout-2026-09-${day}T00-00-00-aaaa.jsonl`);
      const readings = percents.map((percent, index) =>
        weeklyLine({
          percent,
          timestamp: epochSecondsToIso({ seconds: newestSeconds - ageSeconds - 600 + index * 60 })!,
        }),
      );
      writeFileSync(path, `${[...head, ...readings].join("\n")}\n`, "utf8");
      utimesSync(path, newestSeconds - ageSeconds, newestSeconds - ageSeconds);
    };
    write({ ageSeconds: 3_600, day: "22", percents: [10] });
    write({ ageSeconds: 0, day: "01", percents: [10, 80] });
    write({ ageSeconds: 5 * 86_400, day: "10", percents: [5, 9] });

    const scan = unwrap(
      await scanModelBurn({
        days: 1,
        home: stateWith({ rows: [{ alias: "codex-a", provider: "codex", storeDir: codex }] }),
        port: memoryPlanRegisterPort(),
      }),
    );

    expect(scan.filesRead).toBe(2);
    expect(buildModelBurnReport({ sessions: scan.sessions }).rows.map((row) => row.weeklyDrawn)).toEqual([70]);
  });

  it("widens past an oversized line hiding the last reading of the window before a new one opened", async () => {
    const codex = temp({ prefix: "burn-home-" });
    const dayDir = join(codex, "sessions", "2026", "09", "29");
    mkdirSync(dayDir, { recursive: true });
    const session = ({ id, start, body }: { id: string; start: string; body: readonly string[] }): string =>
      [
        JSON.stringify({
          payload: { id, thread_source: "slopweaver", timestamp: start },
          timestamp: start,
          type: "session_meta",
        }),
        JSON.stringify({ payload: { effort: "medium", model: "gpt-5.6-sol" }, type: "turn_context" }),
        ...body,
      ].join("\n") + "\n";
    writeFileSync(
      join(dayDir, "rollout-2026-09-29T09-00-00-aaaa.jsonl"),
      session({
        body: [weeklyLine({ percent: 50, timestamp: "2026-09-29T10:00:00.000Z" })],
        id: "sess-1",
        start: "2026-09-29T09:00:00.000Z",
      }),
      "utf8",
    );
    writeFileSync(
      join(dayDir, "rollout-2026-09-29T11-00-00-bbbb.jsonl"),
      session({
        body: [
          weeklyLine({ percent: 90, timestamp: "2026-09-29T12:00:00.000Z" }),
          JSON.stringify({ payload: { output: "x".repeat(400_000) }, type: "response_item" }),
          weeklyLine({ percent: 5, resetsAt: 1791291801, timestamp: "2026-09-29T14:00:00.000Z" }),
        ],
        id: "sess-2",
        start: "2026-09-29T11:00:00.000Z",
      }),
      "utf8",
    );

    const scan = unwrap(
      await scanModelBurn({
        days: 3,
        home: stateWith({ rows: [{ alias: "codex-a", provider: "codex", storeDir: codex }] }),
        nowMs: Date.parse("2026-10-01T00:00:00.000Z"),
        port: memoryPlanRegisterPort(),
      }),
    );

    expect(buildModelBurnReport({ sessions: scan.sessions }).rows.map((row) => row.weeklyDrawn)).toEqual([45]);
  });

  it("drops a reading taken after its own window reset, so no rise is credited to a closed window", async () => {
    const codex = temp({ prefix: "burn-home-" });
    const dayDir = join(codex, "sessions", "2026", "09", "22");
    mkdirSync(dayDir, { recursive: true });
    const lines = [
      JSON.stringify({ payload: { id: "sess-1", thread_source: "slopweaver" }, type: "session_meta" }),
      JSON.stringify({ payload: { effort: "medium", model: "gpt-5.6-sol" }, type: "turn_context" }),
      weeklyLine({ percent: 50, resetsAt: 1790074800, timestamp: "2026-09-22T10:00:00.000Z" }),
      weeklyLine({ percent: 80, resetsAt: 1790074800, timestamp: "2026-09-22T12:00:00.000Z" }),
    ];
    writeFileSync(join(dayDir, "rollout-2026-09-22T10-00-00-aaaa.jsonl"), `${lines.join("\n")}\n`, "utf8");

    const scan = unwrap(
      await scanModelBurn({
        days: 3,
        home: stateWith({ rows: [{ alias: "codex-a", provider: "codex", storeDir: codex }] }),
        port: memoryPlanRegisterPort(),
      }),
    );

    expect(buildModelBurnReport({ sessions: scan.sessions }).rows.map((row) => row.weeklyDrawn)).toEqual([0]);
  });

  it("drops a reading claiming a time after the scan, so no rise is invented from it", async () => {
    const codex = temp({ prefix: "burn-home-" });
    const dayDir = join(codex, "sessions", "2026", "09", "22");
    mkdirSync(dayDir, { recursive: true });
    const lines = [
      JSON.stringify({ payload: { id: "sess-1", thread_source: "slopweaver" }, type: "session_meta" }),
      JSON.stringify({ payload: { effort: "medium", model: "gpt-5.6-sol" }, type: "turn_context" }),
      weeklyLine({ percent: 10, timestamp: "2026-09-22T23:00:00.000Z" }),
      weeklyLine({ percent: 90, timestamp: "2026-09-24T00:00:00.000Z" }),
    ];
    writeFileSync(join(dayDir, "rollout-2026-09-22T23-00-00-aaaa.jsonl"), `${lines.join("\n")}\n`, "utf8");

    const scan = unwrap(
      await scanModelBurn({
        days: 7,
        home: stateWith({ rows: [{ alias: "codex-a", provider: "codex", storeDir: codex }] }),
        nowMs: Date.parse("2026-09-23T00:00:00.000Z"),
        port: memoryPlanRegisterPort(),
      }),
    );

    expect(scan.sessions[0]!.readings.map((reading) => reading.usedPercent)).toEqual([10]);
  });

  it("widens past an oversized line when all the tail shows is a reading taken after its window reset", async () => {
    const codex = temp({ prefix: "burn-home-" });
    const dayDir = join(codex, "sessions", "2026", "09", "29");
    mkdirSync(dayDir, { recursive: true });
    const head = ({ id, start }: { id: string; start: string }): readonly string[] => [
      JSON.stringify({
        payload: { id, thread_source: "slopweaver", timestamp: start },
        timestamp: start,
        type: "session_meta",
      }),
      JSON.stringify({ payload: { effort: "medium", model: "gpt-5.6-sol" }, type: "turn_context" }),
    ];
    const one = [
      ...head({ id: "sess-1", start: "2026-09-29T09:00:00.000Z" }),
      weeklyLine({ percent: 40, timestamp: "2026-09-29T10:00:00.000Z" }),
    ];
    const two = [
      ...head({ id: "sess-2", start: "2026-09-29T11:00:00.000Z" }),
      weeklyLine({ percent: 100, timestamp: "2026-09-29T12:00:00.000Z" }),
      JSON.stringify({ payload: { output: "x".repeat(400_000) }, type: "response_item" }),
      weeklyLine({ percent: 100, timestamp: "2026-09-29T14:00:00.000Z" }),
    ];
    writeFileSync(join(dayDir, "rollout-2026-09-29T09-00-00-aaaa.jsonl"), `${one.join("\n")}\n`, "utf8");
    writeFileSync(join(dayDir, "rollout-2026-09-29T11-00-00-bbbb.jsonl"), `${two.join("\n")}\n`, "utf8");

    const scan = unwrap(
      await scanModelBurn({
        days: 3,
        home: stateWith({ rows: [{ alias: "codex-a", provider: "codex", storeDir: codex }] }),
        nowMs: Date.parse("2026-10-01T00:00:00.000Z"),
        port: memoryPlanRegisterPort(),
      }),
    );

    expect(buildModelBurnReport({ sessions: scan.sessions }).rows.map((row) => row.weeklyDrawn)).toEqual([60]);
  });

  it("reads back past a line longer than the tail to the readings written before it", async () => {
    const codex = temp({ prefix: "burn-home-" });
    const dayDir = join(codex, "sessions", "2026", "09", "22");
    mkdirSync(dayDir, { recursive: true });
    const lines = [
      JSON.stringify({ payload: { id: "sess-1", thread_source: "slopweaver" }, type: "session_meta" }),
      JSON.stringify({ payload: { effort: "medium", model: "gpt-5.6-sol" }, type: "turn_context" }),
      weeklyLine({ percent: 40, timestamp: "2026-09-22T14:00:00.000Z" }),
      weeklyLine({ percent: 60, timestamp: "2026-09-22T15:00:00.000Z" }),
      JSON.stringify({ payload: { output: "x".repeat(400_000) }, type: "response_item" }),
    ];
    writeFileSync(join(dayDir, "rollout-2026-09-22T14-00-00-aaaa.jsonl"), `${lines.join("\n")}\n`, "utf8");
    const scan = unwrap(
      await scanModelBurn({
        days: 3,
        home: stateWith({ rows: [{ alias: "codex-a", provider: "codex", storeDir: codex }] }),
        port: memoryPlanRegisterPort(),
      }),
    );
    expect(buildModelBurnReport({ sessions: scan.sessions }).rows[0]!.weeklyDrawn).toBe(20);
  });

  it("reads the model past a session_meta line longer than the head bound", async () => {
    const codex = temp({ prefix: "burn-home-" });
    const dayDir = join(codex, "sessions", "2026", "09", "22");
    mkdirSync(dayDir, { recursive: true });
    const lines = [
      JSON.stringify({
        payload: { id: "sess-1", instructions: "x".repeat(210_000), thread_source: "slopweaver" },
        type: "session_meta",
      }),
      JSON.stringify({ payload: { effort: "medium", model: "gpt-6-astra" }, type: "turn_context" }),
      weeklyLine({ percent: 40, timestamp: "2026-09-22T14:00:00.000Z" }),
      weeklyLine({ percent: 60, timestamp: "2026-09-22T15:00:00.000Z" }),
    ];
    writeFileSync(join(dayDir, "rollout-2026-09-22T14-00-00-aaaa.jsonl"), `${lines.join("\n")}\n`, "utf8");
    const scan = unwrap(
      await scanModelBurn({
        days: 3,
        home: stateWith({ rows: [{ alias: "codex-a", provider: "codex", storeDir: codex }] }),
        port: memoryPlanRegisterPort(),
      }),
    );
    const report = buildModelBurnReport({ sessions: scan.sessions });
    expect(report.unattributedSessions).toBe(0);
    expect(report.rows.map((row) => [row.model, row.weeklyDrawn])).toEqual([["gpt-6-astra", 20]]);
  });

  it("reads a home two register rows spell differently ONCE, so its rise is never credited twice", async () => {
    const codex = codexHome();
    const scan = unwrap(
      await scanModelBurn({
        days: 3,
        home: stateWith({
          rows: [
            { alias: "codex-a", provider: "codex", storeDir: codex },
            { alias: "codex-b", provider: "codex", storeDir: `${codex}/.` },
          ],
        }),
        port: memoryPlanRegisterPort(),
      }),
    );
    expect(scan.destinations).toEqual(["codex-a"]);
    expect(buildModelBurnReport({ sessions: scan.sessions }).rows[0]!.weeklyDrawn).toBe(20);
  });
});
