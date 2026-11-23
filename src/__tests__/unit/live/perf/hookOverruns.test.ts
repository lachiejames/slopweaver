/**
 * The false green this half exists to end: `perf` graded hooks from a live `ps` sample only, so it printed
 * `no hook over the line` while 34 `PreToolUse` calls blew the 15 s budget in the same window (measured
 * over a three-hour window). Every case below feeds a census that CARRIES an overrun and asserts both
 * halves, so a regression that drops the reading reddens rather than reading as a quiet fleet.
 */
import { describe, expect, it } from "vitest";

import { perfFoldLines, perfSummaryLine } from "../../../../live/perf/render.js";
import { perfReport } from "../../../../live/perf/report.js";
import { HOOK_BUDGET_MS, type HookCall, hookOverrunReading } from "../../../../transcripts/hookDuration.js";
import { fleetReading, LOAD, seatStream, sessionLoad, streamReading } from "./perfFixtures.js";

const QUIET = sessionLoad({ cpuPct: 4, pid: 200, sessionId: "quiet" });

const call = (over: Partial<HookCall> = {}): HookCall => ({
  command: "",
  cwd: "/w/quiet",
  durationMs: 17_350,
  endedByOurBound: true,
  event: "PreToolUse",
  harnessTimedOut: false,
  hookName: "PreToolUse:Bash",
  interrupted: false,
  lineNumber: 1,
  sessionId: "quiet",
  timestamp: "2026-09-19T22:11:38.669Z",
  ...over,
});

/** A call that decided inside the budget — our bound never fired, which is what makes it a pass. */
const passed = ({ durationMs }: { durationMs: number }): HookCall => call({ durationMs, endedByOurBound: false });

/** A call the HARNESS's own declared timeout ended, exactly as a `hook_cancelled` record carries it. */
const harnessKilled = (over: Partial<HookCall> = {}): HookCall =>
  call({
    command: '"${PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}/scripts/plugin-mirror-sync.sh"',
    durationMs: 20_049,
    endedByOurBound: false,
    harnessTimedOut: true,
    ...over,
  });

const reportWith = ({ calls }: { calls: readonly HookCall[] }) =>
  perfReport({
    fleet: fleetReading({ sessions: [QUIET] }),
    hookOverruns: hookOverrunReading({ budgetMs: HOOK_BUDGET_MS, calls }),
    load: LOAD,
    strayDevServers: undefined,
    stream: streamReading({ seats: [seatStream({ cwd: "/w/quiet", firings: 12, sessionId: "quiet" })] }),
  });

describe("perf carries the overrun census", () => {
  it("stops claiming no hook over the line when calls blew the budget and died", () => {
    const line = perfSummaryLine({ report: reportWith({ calls: [call(), passed({ durationMs: 400 })] }) });

    expect(line).toContain("no hook over the line NOW");
    expect(line).toContain("1 PreToolUse call(s) blew the 15s budget on 1 seat(s), of 2 with a recorded duration");
  });

  it("still says no hook over the line, unqualified, when the census saw none", () => {
    const line = perfSummaryLine({ report: reportWith({ calls: [passed({ durationMs: 400 })] }) });

    expect(line).toContain("no hook over the line");
    expect(line).not.toContain("NOW");
    expect(line).not.toContain("blew the");
  });

  it("says nothing about overruns at all when no transcript could be read", () => {
    const report = perfReport({
      fleet: fleetReading({ sessions: [QUIET] }),
      hookOverruns: undefined,
      load: LOAD,
      strayDevServers: undefined,
      stream: streamReading({ seats: [] }),
    });

    expect(report.hookOverruns).toBeUndefined();
    expect(perfSummaryLine({ report })).toContain("no hook over the line");
    expect(perfSummaryLine({ report })).not.toContain("NOW");
  });

  it("names a call our own watchdog never ended, because the harness had to", () => {
    const line = perfSummaryLine({
      report: reportWith({ calls: [call(), harnessKilled()] }),
    });

    expect(line).toContain("2 PreToolUse call(s) blew the 15s budget on 1 seat(s), of 2 with a recorded duration");
    expect(line).toContain("1 hook(s) past our own bound, ended by the harness's timeout");
  });

  it("gives the tick a react line naming what those tool calls lost", () => {
    const report = reportWith({ calls: [call(), call()] });

    expect(report.react[0]).toContain("2 PreToolUse call(s) spent the whole 15s budget");
    expect(report.react[0]).toContain("a door-gated call among them was refused");
    expect(report.react[0]).toContain("the budget itself never widens");
    expect(report.react[0]).toContain("/w/quiet");
  });

  it("gives a SECOND react line only for the calls our bound never ended", () => {
    const bounded = reportWith({ calls: [call()] });
    const unbounded = reportWith({ calls: [harnessKilled()] });

    expect(bounded.react.length).toBe(1);
    expect(unbounded.react.length).toBe(2);
    expect(unbounded.react[1]).toContain("scripts/hook.sh");
    // The whole point of reading `command` off the record: the line NAMES the entry rather than counting it.
    expect(unbounded.react[1]).toContain("plugin-mirror-sync.sh");
  });

  // Inferring "unbounded" from an absent stderr line counted a call a PERSON cancelled as the defect, so
  // no change to any hook could have driven the number down. Read off `timedOut`, it is not one.
  it("leaves a call the operator interrupted out of the census, and owes the tick nothing for it", () => {
    const report = reportWith({ calls: [call({ durationMs: 31_000, endedByOurBound: false, interrupted: true })] });

    expect(report.hookOverruns!.interrupted).toBe(1);
    expect(report.hookOverruns!.overruns).toBe(0);
    expect(report.hookOverruns!.unbounded).toBe(0);
    expect(report.react).toEqual([]);
  });

  it("owes the tick nothing when every recorded call stayed inside the budget", () => {
    expect(reportWith({ calls: [passed({ durationMs: 410 })] }).react).toEqual([]);
  });

  // The finding that started this: a 60 s mirror sync, exit 0 at 26 s, reported as a PreToolUse call that
  // "decided NOTHING" — and a seat sent to bound a hook step that never ran slow.
  it("owes the tick nothing for a SessionStart hook that finished inside its own declared timeout", () => {
    const report = reportWith({
      calls: [
        call({
          command: '"${PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}/scripts/plugin-mirror-sync.sh"',
          durationMs: 26_325,
          endedByOurBound: false,
          event: "SessionStart",
          hookName: "SessionStart:compact",
        }),
      ],
    });

    expect(report.react).toEqual([]);
    expect(perfSummaryLine({ report })).toContain("no hook over the line");
    expect(perfSummaryLine({ report })).not.toContain("NOW");
  });

  // Handoff 330 tick 35 on: an enveloped `handover-run` timeout was a REACT line with no seat and no command,
  // so the act-on-every-REACT-line step had nothing to do and the line carried pass to pass, exiting 3.
  it("folds an enveloped harness timeout under the verdict budget, owing the tick nothing", () => {
    const report = reportWith({
      calls: [
        harnessKilled({
          command: '"${PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}/scripts/hook.sh" 10 handover-run',
          durationMs: 10_087,
          event: "SessionStart",
          hookName: "SessionStart:startup",
        }),
      ],
    });

    expect(report.react).toEqual([]);
    expect(perfFoldLines({ report }).at(-1)).toBe(
      "  harness timeout, enveloped: hook.sh 10 handover-run — the envelope armed and lost the race to the " +
        "declared timeout: a starved machine or a regression to record, never a seat to stop",
    );
    expect(perfSummaryLine({ report })).toContain("no hook over the line NOW");
    expect(perfSummaryLine({ report })).toContain("1 hook(s) past our own bound, ended by the harness's timeout");
    expect(perfSummaryLine({ report })).not.toContain("blew the");
  });

  // Pass 189 of handoff 319: the record's own command said the envelope had armed and lost, and the line
  // sent a seat to check for a pre-envelope `hooks.json` anyway. Each command now lands where its mark says.
  it("reacts on the no-envelope command and folds the enveloped one, on the same seat", () => {
    const report = reportWith({
      calls: [
        harnessKilled({
          command:
            '"${PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}/scripts/hook.sh" 10 handover-run "${PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}/hooks/handover-run.sh"',
          event: "SessionStart",
          hookName: "SessionStart:startup",
        }),
        harnessKilled({ durationMs: 60_158, event: "SessionStart", hookName: "SessionStart:startup" }),
      ],
    });

    expect(report.react.length).toBe(1);
    expect(report.react[0]).toContain("timeout ended plugin-mirror-sync.sh (no envelope)");
    expect(report.react[0]).not.toContain("handover-run.sh");
    expect(perfFoldLines({ report }).at(-1)).toContain("harness timeout, enveloped: handover-run.sh — ");
  });
});
