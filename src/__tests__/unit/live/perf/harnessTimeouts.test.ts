/**
 * A harness timeout owes the tick an act only when a LIVE seat is running a pre-envelope `hooks.json`, and the
 * act is that seat's reseat. Every other timeout is folded — the defect this file holds down is the REACT line
 * that named no seat and no command and so carried pass to pass, tick after tick.
 */
import { describe, expect, it } from "vitest";

import { harnessTimeoutFoldLines, harnessTimeoutReactLines } from "../../../../live/perf/harnessTimeouts.js";
import { perfFoldLines } from "../../../../live/perf/render.js";
import { perfReport } from "../../../../live/perf/report.js";
import { HOOK_BUDGET_MS, type HookCall, hookOverrunReading } from "../../../../transcripts/hookDuration.js";
import { fleetReading, LOAD, seatStream, sessionLoad, streamReading } from "./perfFixtures.js";

const ENVELOPED = '"${PLUGIN_ROOT}/scripts/hook.sh" 10 handover-run "${PLUGIN_ROOT}/hooks/handover-run.sh"';
const MIRROR = '"${PLUGIN_ROOT}/scripts/plugin-mirror-sync.sh"';
const INIT = '"${PLUGIN_ROOT}/scripts/init.sh"';

/** A call the harness's own declared timeout ended, as a `hook_cancelled` record carries it. */
const timedOut = (over: Partial<HookCall> = {}): HookCall => ({
  command: MIRROR,
  cwd: "/w/a",
  durationMs: 60_158,
  endedByOurBound: false,
  event: "SessionStart",
  harnessTimedOut: true,
  hookName: "SessionStart:startup",
  interrupted: false,
  lineNumber: 1,
  sessionId: "a",
  timestamp: "2026-10-18T12:00:00.000Z",
  ...over,
});

/** Seats `a` (workspace:7) and `b` (workspace:9) are live; `gone` is not. */
const reportWith = ({ calls, workspaces = true }: { calls: readonly HookCall[]; workspaces?: boolean }) =>
  perfReport({
    fleet: fleetReading({
      sessions: [
        sessionLoad({ cpuPct: 4, pid: 101, sessionId: "a" }),
        sessionLoad({ cpuPct: 3, pid: 102, sessionId: "b" }),
      ],
    }),
    hookOverruns: hookOverrunReading({ budgetMs: HOOK_BUDGET_MS, calls }),
    load: LOAD,
    strayDevServers: undefined,
    stream: streamReading({
      seats: [
        seatStream({ cwd: "/w/a", sessionId: "a", workspaceId: workspaces ? "workspace:7" : undefined }),
        seatStream({ cwd: "/w/b", sessionId: "b", workspaceId: workspaces ? "workspace:9" : undefined }),
      ],
    }),
  });

describe("harness timeouts: react on a live pre-envelope seat, fold everything else", () => {
  it("names the live seat and its exact reseat for a no-envelope command", () => {
    expect(reportWith({ calls: [timedOut()] }).react).toEqual([
      "REACT — seat a booted on a hooks.json older than the envelope (`scripts/hook.sh`), so the harness's own " +
        "declared timeout ended plugin-mirror-sync.sh (no envelope): reseat it so it re-reads hooks.json: " +
        "`slopweaver cmux reseat workspace:7`. A busy seat refuses until its turn ends, and your own seat is " +
        "reseated from another one",
    ]);
  });

  it("points at the worktree in cmux list, never a fake reseat, when the stream named no workspace", () => {
    const [line] = reportWith({ calls: [timedOut()], workspaces: false }).react;

    expect(line).toContain("find it by its worktree /w/a in `slopweaver cmux list`");
    expect(line).toContain("`slopweaver cmux reseat <workspace>`");
    expect(line).not.toContain("cmux reseat a");
  });

  // A review's counterexample: an empty id printed `cmux reseat ` with no target.
  it("treats an empty workspace id as unnamed and points at cmux list instead", () => {
    const report = perfReport({
      fleet: fleetReading({ sessions: [sessionLoad({ cpuPct: 4, pid: 101, sessionId: "a" })] }),
      hookOverruns: hookOverrunReading({ budgetMs: HOOK_BUDGET_MS, calls: [timedOut()] }),
      load: LOAD,
      strayDevServers: undefined,
      stream: streamReading({ seats: [seatStream({ cwd: "/w/a", sessionId: "a", workspaceId: "" })] }),
    });

    expect(report.react.length).toBe(1);
    expect(report.react[0]).toContain("find it by its worktree /w/a in `slopweaver cmux list`");
    expect(report.react[0]).not.toContain("`slopweaver cmux reseat `");
  });

  // A review's counterexample: the envelope named as an ARGUMENT is not the envelope running.
  it("reads the envelope off the command's target, never an argument that mentions it", () => {
    const report = reportWith({ calls: [timedOut({ command: "/bin/sh -c 'sleep 120' scripts/hook.sh" })] });

    expect(report.react.length).toBe(1);
    expect(report.react[0]).toContain("`slopweaver cmux reseat workspace:7`");
  });

  it("reads a target behind the give-up assignment as enveloped, as the live PreToolUse entry is written", () => {
    const report = reportWith({
      calls: [
        timedOut({
          command:
            'SLOPWEAVER_HOOK_GIVE_UP=2 "${PLUGIN_DATA}/current/scripts/hook.sh" 30 pretooluse "${PLUGIN_DATA}/current/scripts/pretooluse.sh"',
        }),
      ],
    });

    expect(report.react).toEqual([]);
    expect(perfFoldLines({ report }).at(-1)).toContain("harness timeout, enveloped: pretooluse.sh — ");
  });

  // A review's counterexample: a QUOTED assignment is the shell's command word, so it is the target.
  it("reads a quoted give-up assignment as the target, so the command is not enveloped", () => {
    const report = reportWith({
      calls: [timedOut({ command: '"SLOPWEAVER_HOOK_GIVE_UP=2" /tmp/scripts/hook.sh 30 pretooluse /tmp/p.sh' })],
    });

    expect(report.react.length).toBe(1);
    expect(report.react[0]).toContain("`slopweaver cmux reseat workspace:7`");
  });

  // The shell runs the first word that is not an assignment, so two give-up prefixes still run the envelope.
  it("reads the envelope behind two give-up assignments as enveloped, as the hook-bounded gate does", () => {
    const report = reportWith({
      calls: [
        timedOut({
          command: "SLOPWEAVER_HOOK_GIVE_UP=2 SLOPWEAVER_HOOK_GIVE_UP=0 /tmp/scripts/hook.sh 30 pretooluse /tmp/p.sh",
        }),
      ],
    });

    expect(report.react).toEqual([]);
    expect(perfFoldLines({ report }).at(-1)).toContain("harness timeout, enveloped: p.sh — ");
  });

  it("owes nothing for enveloped timeouts and folds them, on any number of seats", () => {
    const report = reportWith({
      calls: [timedOut({ command: ENVELOPED }), timedOut({ command: ENVELOPED, cwd: "/w/b", sessionId: "b" })],
    });

    expect(report.react).toEqual([]);
    expect(perfFoldLines({ report }).filter((line) => line.includes("harness timeout"))).toEqual([
      "  harness timeout, enveloped: handover-run.sh — the envelope armed and lost the race to the declared " +
        "timeout: a starved machine or a regression to record, never a seat to stop",
    ]);
  });

  it("folds a no-envelope timeout on a seat that is not running, and never reacts on it", () => {
    const report = reportWith({ calls: [timedOut({ cwd: "/w/gone", sessionId: "gone" })] });

    expect(report.react).toEqual([]);
    expect(perfFoldLines({ report }).at(-1)).toBe(
      "  harness timeout, nothing to reseat: gone plugin-mirror-sync.sh (no envelope, seat not running) — a seat " +
        "that is not running has no frozen hooks.json left to restart, and an unrecorded command proves no old one",
    );
  });

  // The r1 review's counterexample: an empty-list test read this seat as all-recorded and lost the second call.
  it("reacts on the recorded no-envelope call and still folds the unrecorded one on the same live seat", () => {
    const report = reportWith({ calls: [timedOut(), timedOut({ command: "" })] });

    expect(report.react.length).toBe(1);
    expect(report.react[0]).toContain("ended plugin-mirror-sync.sh (no envelope)");
    expect(perfFoldLines({ report }).at(-1)).toContain("nothing to reseat: a (command not recorded) — ");
  });

  it("folds both halves of a closed seat that ran a recorded and an unrecorded timeout", () => {
    const report = reportWith({
      calls: [
        timedOut({ cwd: "/w/gone", sessionId: "gone" }),
        timedOut({ command: "", cwd: "/w/gone", sessionId: "gone" }),
      ],
    });

    expect(report.react).toEqual([]);
    expect(perfFoldLines({ report }).at(-1)).toContain(
      "nothing to reseat: gone (command not recorded); gone plugin-mirror-sync.sh (no envelope, seat not running) — ",
    );
  });

  it("folds a timeout whose record named no command, even on a live seat", () => {
    const report = reportWith({ calls: [timedOut({ command: "" })] });

    expect(report.react).toEqual([]);
    expect(perfFoldLines({ report }).at(-1)).toContain("nothing to reseat: a (command not recorded)");
  });

  it("never joins a seat by its worktree when the records named no session", () => {
    const report = reportWith({ calls: [timedOut({ sessionId: "" })] });

    expect(report.react).toEqual([]);
    expect(perfFoldLines({ report }).at(-1)).toContain("nothing to reseat: /w/a plugin-mirror-sync.sh");
  });

  it("gives one line per seat, its distinct no-envelope tails sorted", () => {
    const report = reportWith({
      calls: [
        timedOut({ command: MIRROR }),
        timedOut({ command: INIT }),
        timedOut({ command: MIRROR }),
        timedOut({ command: MIRROR, cwd: "/w/b", sessionId: "b" }),
      ],
    });

    expect(report.react.length).toBe(2);
    expect(report.react[0]).toContain("seat a booted");
    expect(report.react[0]).toContain("ended init.sh, plugin-mirror-sync.sh (no envelope)");
    expect(report.react[0]).toContain("`slopweaver cmux reseat workspace:7`");
    expect(report.react[1]).toContain("seat b booted");
    expect(report.react[1]).toContain("`slopweaver cmux reseat workspace:9`");
  });

  it("keeps the folded timeouts when the seat cap drops every seat row", () => {
    const report = reportWith({ calls: [timedOut({ command: ENVELOPED })] });

    expect(perfFoldLines({ report, topN: 0 })).toEqual([
      "  harness timeout, enveloped: handover-run.sh — the envelope armed and lost the race to the declared " +
        "timeout: a starved machine or a regression to record, never a seat to stop",
    ]);
  });

  it("adds nothing to the fold when no harness timeout was recorded", () => {
    expect(perfFoldLines({ report: reportWith({ calls: [] }) }).length).toBe(2);
  });

  it("owes no line either way when no transcript census could be read", () => {
    const seats = reportWith({ calls: [timedOut()] }).seats;

    expect(seats.length).toBe(2);
    expect(harnessTimeoutReactLines({ hookOverruns: undefined, seats })).toEqual([]);
    expect(harnessTimeoutFoldLines({ hookOverruns: undefined, seats })).toEqual([]);
  });
});
