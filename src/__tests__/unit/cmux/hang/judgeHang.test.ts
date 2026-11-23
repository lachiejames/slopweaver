/*
 * The cmux hang judge's `judgeHang`: whether cmux is hung, judged from outside it over the revive journal — a
 * hang (pid 5088, socket refused for five hours) is the shape — and where an unanswered run starts,
 * breaks and passes the bound.
 */
import { describe, expect, it } from "vitest";

import { DEFAULT_HANG_BOUND_MS, judgeHang, MAX_READING_GAP_MS } from "../../../../cmux/hang.js";
import type { CmuxReviveEvent } from "../../../../cmux/reviveJournal.js";
import { instant, reading } from "./harness.js";

/** Judge with the shipped bound and gap. */
function judge({ events, now }: { events: readonly CmuxReviveEvent[]; now: string }): ReturnType<typeof judgeHang> {
  return judgeHang({
    boundMs: DEFAULT_HANG_BOUND_MS,
    events,
    maxGapMs: MAX_READING_GAP_MS,
    nowIso: instant({ clock: now }),
  });
}

describe("judgeHang", () => {
  const hang = [
    reading({ at: "18:50", state: "answering" }),
    reading({ at: "18:58", state: "refused" }),
    reading({ at: "19:01", state: "silent" }),
    reading({ at: "19:05", state: "refused" }),
    reading({ at: "19:09", state: "refused" }),
  ];

  it("knows nothing from an empty journal", () => {
    expect(judge({ events: [], now: "19:00" })).toEqual({ kind: "unknown" });
  });

  it("knows nothing from a reading older than the gap", () => {
    expect(judge({ events: hang, now: "19:15" })).toEqual({ kind: "unknown" });
  });

  it("dates an unbroken unanswered run from its first reading, and says it passed the bound", () => {
    expect(judge({ events: hang, now: "19:10" })).toEqual({
      appPid: 5088,
      kind: "unresponsive",
      overBound: true,
      sinceIso: instant({ clock: "18:58" }),
    });
  });

  it("calls a run shorter than the bound unresponsive but not over it", () => {
    expect(judge({ events: hang.slice(0, 3), now: "19:02" })).toEqual({
      appPid: 5088,
      kind: "unresponsive",
      overBound: false,
      sinceIso: instant({ clock: "18:58" }),
    });
  });

  it("breaks the run at a gap wider than the bound's watch — a machine asleep is not a hang", () => {
    const slept = [reading({ at: "18:00", state: "refused" }), reading({ at: "18:58", state: "refused" })];
    expect(judge({ events: slept, now: "18:59" })).toEqual({
      appPid: 5088,
      kind: "unresponsive",
      overBound: false,
      sinceIso: instant({ clock: "18:58" }),
    });
  });

  it("breaks the run at a relaunched app on the same pid", () => {
    const relaunched = [
      reading({ at: "19:00", state: "refused" }),
      reading({ appStart: "Sat Oct 10 19:02:00 2026", at: "19:03", state: "refused" }),
    ];
    expect(judge({ events: relaunched, now: "19:04" })).toEqual({
      appPid: 5088,
      kind: "unresponsive",
      overBound: false,
      sinceIso: instant({ clock: "19:03" }),
    });
  });

  it("dates a run of stalled readings like any other hang, and keeps it open but under the bound on an unprobed one", () => {
    const stalled = [
      reading({ at: "18:58", state: "stalled" }),
      reading({ at: "19:03", state: "stalled" }),
      reading({ at: "19:08", state: "stalled" }),
    ];
    expect([
      judge({ events: stalled, now: "19:09" }),
      judge({ events: [...stalled, reading({ at: "19:09", state: "unprobed" })], now: "19:10" }),
    ]).toEqual([
      { appPid: 5088, kind: "unresponsive", overBound: true, sinceIso: instant({ clock: "18:58" }) },
      { appPid: 5088, kind: "unresponsive", overBound: false, sinceIso: instant({ clock: "18:58" }) },
    ]);
  });

  it("steps over an unprobed reading inside a stalled run — that reading no longer restarts the run", () => {
    const run = [
      reading({ at: "06:56", state: "stalled" }),
      reading({ at: "07:00", state: "stalled" }),
      reading({ at: "07:02", state: "stalled" }),
      reading({ at: "07:03", state: "unprobed" }),
      reading({ at: "07:04", state: "stalled" }),
    ];
    expect(judge({ events: run, now: "07:06" })).toEqual({
      appPid: 5088,
      kind: "unresponsive",
      overBound: true,
      sinceIso: instant({ clock: "06:56" }),
    });
  });

  it("forgets an unprobed tail once the last unanswered reading is older than the gap", () => {
    const tail = [reading({ at: "19:00", state: "stalled" }), reading({ at: "19:02", state: "unprobed" })];
    expect([judge({ events: tail, now: "19:05" }), judge({ events: tail, now: "19:06" })]).toEqual([
      { appPid: 5088, kind: "unresponsive", overBound: false, sinceIso: instant({ clock: "19:00" }) },
      { kind: "unknown" },
    ]);
  });

  it("never bridges two unanswered readings further apart than the gap through unprobed ones", () => {
    const apart = [
      reading({ at: "19:00", state: "stalled" }),
      reading({ at: "19:03", state: "unprobed" }),
      reading({ at: "19:06", state: "stalled" }),
    ];
    expect(judge({ events: apart, now: "19:07" })).toEqual({
      appPid: 5088,
      kind: "unresponsive",
      overBound: false,
      sinceIso: instant({ clock: "19:06" }),
    });
  });

  it("knows nothing from an unprobed reading with no unanswered one before it", () => {
    const quiet = [reading({ at: "19:00", state: "answering" }), reading({ at: "19:01", state: "unprobed" })];
    expect(judge({ events: quiet, now: "19:02" })).toEqual({ kind: "unknown" });
  });

  it("starts a new run after a declined dialog, whose cause is gone", () => {
    const declined: CmuxReviveEvent = {
      atIso: instant({ clock: "19:04" }),
      button: "Cancel",
      kind: "dialog-dismissed",
      schemaVersion: 1,
      title: "Run Project Action?",
    };
    const run = [
      reading({ at: "18:58", state: "stalled" }),
      reading({ at: "19:03", state: "stalled" }),
      declined,
      reading({ at: "19:05", state: "stalled" }),
    ];
    expect(judge({ events: run, now: "19:09" })).toEqual({
      appPid: 5088,
      kind: "unresponsive",
      overBound: false,
      sinceIso: instant({ clock: "19:05" }),
    });
  });

  it("calls an answering newest reading responsive", () => {
    expect(judge({ events: [...hang, reading({ at: "19:10", state: "answering" })], now: "19:11" })).toEqual({
      kind: "responsive",
    });
  });

  it("calls a missing app absent", () => {
    expect(
      judge({ events: [reading({ appPid: null, appStart: null, at: "19:10", state: "absent" })], now: "19:11" }),
    ).toEqual({ kind: "absent" });
  });

  it("refuses to judge an unanswered reading that names no app", () => {
    expect(judge({ events: [reading({ appPid: null, at: "19:10", state: "refused" })], now: "19:11" })).toEqual({
      kind: "unknown",
    });
  });
});
