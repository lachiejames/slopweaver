import { describe, expect, it } from "vitest";

import {
  HOOK_BUDGET_MS,
  type HookCall,
  hookBudgetMs,
  hookOverrunReading,
  readHookCall,
  readRefusedOverrun,
} from "../../../transcripts/hookDuration.js";

/**
 * A hook attachment line in the exact shape Claude Code 2.1.278 writes — the one measured on this machine,
 * `grep -rh -m1 'killed after 15s' ~/.claude/projects/`.
 */
const hookLine = ({
  durationMs,
  stderr = "",
  type = "hook_success",
  cwd = "/w/alpha",
  sessionId = "s-alpha",
  timedOut,
  command = "",
}: {
  durationMs: number;
  stderr?: string;
  type?: string;
  cwd?: string;
  sessionId?: string;
  timedOut?: boolean;
  command?: string;
}): string =>
  JSON.stringify({
    attachment: {
      command,
      durationMs,
      exitCode: 0,
      hookEvent: "PreToolUse",
      hookName: "PreToolUse:Bash",
      stderr,
      timedOut,
      type,
    },
    cwd,
    sessionId,
    timestamp: "2026-09-19T22:11:38.669Z",
    type: "attachment",
    uuid: "5eb49ad9-3a65-4476-8330-1c98edad1b9b",
  });

const KILLED =
  "pretooluse: killed after 15s without a verdict, so the tool call is no longer held — this hook reached no decision";

const call = (over: Partial<HookCall> = {}): HookCall => ({
  command: "",
  cwd: "/w/alpha",
  durationMs: 400,
  endedByOurBound: false,
  event: "PreToolUse",
  harnessTimedOut: false,
  hookName: "PreToolUse:Bash",
  interrupted: false,
  lineNumber: 1,
  sessionId: "s-alpha",
  timestamp: "2026-09-19T22:11:38.669Z",
  ...over,
});

/** The `hooks.json` command a `hook_cancelled` record carries verbatim, as the transcripts write it. */
const MIRROR_SYNC_COMMAND = '"${PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}/scripts/plugin-mirror-sync.sh"';

describe("readHookCall", () => {
  it("decodes the duration, the event and the seat off a real hook attachment line", () => {
    expect(readHookCall({ line: hookLine({ durationMs: 410 }), lineNumber: 946 })).toEqual({
      command: "",
      cwd: "/w/alpha",
      durationMs: 410,
      endedByOurBound: false,
      event: "PreToolUse",
      harnessTimedOut: false,
      hookName: "PreToolUse:Bash",
      interrupted: false,
      lineNumber: 946,
      sessionId: "s-alpha",
      timestamp: "2026-09-19T22:11:38.669Z",
    });
  });

  it("reads our own bound off the stderr line bounded-run.sh prints before it returns", () => {
    expect(
      readHookCall({ line: hookLine({ durationMs: 17_529, stderr: KILLED }), lineNumber: 2 })!.endedByOurBound,
    ).toBe(true);
  });

  it("reads the harness's own ending off `timedOut`, and names the entry it killed", () => {
    const decoded = readHookCall({
      line: hookLine({
        command: MIRROR_SYNC_COMMAND,
        durationMs: 60_158,
        timedOut: true,
        type: "hook_cancelled",
      }),
      lineNumber: 3,
    })!;

    expect(decoded.harnessTimedOut).toBe(true);
    expect(decoded.endedByOurBound).toBe(false);
    expect(decoded.interrupted).toBe(false);
    expect(decoded.command).toBe(MIRROR_SYNC_COMMAND);
    expect(decoded.durationMs).toBe(60_158);
  });

  // A person pressed escape. It cancels without `timedOut`, and reading it as the harness's timeout is what
  // made "zero unbounded" unfalsifiable: no change to any hook could ever drive an interrupt count down.
  it("separates a cancelled call that did NOT time out, because that is a person and not a defect", () => {
    const decoded = readHookCall({
      line: hookLine({ durationMs: 31_000, type: "hook_cancelled" }),
      lineNumber: 7,
    })!;

    expect(decoded.interrupted).toBe(true);
    expect(decoded.harnessTimedOut).toBe(false);
    expect(decoded.endedByOurBound).toBe(false);
  });

  it("answers undefined for an assistant line, which carries neither field", () => {
    const line = JSON.stringify({
      message: { content: "hello", role: "assistant" },
      timestamp: "2026-09-19T22:11:38.669Z",
      type: "assistant",
    });

    expect(readHookCall({ line, lineNumber: 4 })).toBeUndefined();
  });

  it("answers undefined for a hook record that names no duration, rather than calling it instant", () => {
    const line = JSON.stringify({
      attachment: { durationMs: null, hookEvent: "PreToolUse", hookName: "PreToolUse:Bash" },
      type: "attachment",
    });

    expect(readHookCall({ line, lineNumber: 5 })).toBeUndefined();
  });

  it("answers undefined for a line that passes the substring gate but is not JSON", () => {
    expect(readHookCall({ line: '{"durationMs":"hookEvent" broken', lineNumber: 6 })).toBeUndefined();
  });
});

describe("hookOverrunReading", () => {
  it("counts only calls at or past the budget, and reports the coverage beside them", () => {
    const reading = hookOverrunReading({
      budgetMs: HOOK_BUDGET_MS,
      calls: [
        call({ durationMs: 410 }),
        call({ durationMs: 14_999 }),
        call({ durationMs: 15_000, endedByOurBound: true }),
        call({ durationMs: 17_529, endedByOurBound: true }),
      ],
    });

    expect(reading.recorded).toBe(4);
    expect(reading.overruns).toBe(2);
    expect(reading.unbounded).toBe(0);
    expect(reading.budgetMs).toBe(15_000);
  });

  it("counts an overrun the harness timed out separately, and carries the command it names", () => {
    const reading = hookOverrunReading({
      budgetMs: HOOK_BUDGET_MS,
      calls: [
        call({ durationMs: 17_529, endedByOurBound: true }),
        call({ command: MIRROR_SYNC_COMMAND, durationMs: 20_049, harnessTimedOut: true }),
      ],
    });

    expect(reading.overruns).toBe(2);
    expect(reading.unbounded).toBe(1);
    expect(reading.seats[0]!.unbounded).toBe(1);
    expect(reading.seats[0]!.unboundedCommands).toEqual([MIRROR_SYNC_COMMAND]);
  });

  // The `slopweaver init` entry ends `>/dev/null 2>&1` on purpose, so its bound line is discarded with
  // everything else it writes. Inferred from stderr it read as unbounded; read off `timedOut` it does not.
  it("does not call a bounded call unbounded just because its stderr was discarded", () => {
    const reading = hookOverrunReading({
      budgetMs: HOOK_BUDGET_MS,
      calls: [call({ durationMs: 28_000, endedByOurBound: false, harnessTimedOut: false })],
    });

    expect(reading.overruns).toBe(1);
    expect(reading.unbounded).toBe(0);
    expect(reading.seats[0]!.unboundedCommands).toEqual([]);
  });

  it("leaves an interrupted call out of the census entirely, and counts it on its own", () => {
    const reading = hookOverrunReading({
      budgetMs: HOOK_BUDGET_MS,
      calls: [call({ durationMs: 31_000, interrupted: true }), call({ durationMs: 17_529, endedByOurBound: true })],
    });

    expect(reading.interrupted).toBe(1);
    expect(reading.overruns).toBe(1);
    expect(reading.unbounded).toBe(0);
    expect(reading.seats.length).toBe(1);
  });

  it("groups by session and ranks the worst seat first", () => {
    const reading = hookOverrunReading({
      budgetMs: HOOK_BUDGET_MS,
      calls: [
        call({ cwd: "/w/beta", durationMs: 17_100, endedByOurBound: true, sessionId: "s-beta" }),
        call({ cwd: "/w/alpha", durationMs: 17_300, endedByOurBound: true, sessionId: "s-alpha" }),
        call({ cwd: "/w/alpha", durationMs: 17_515, endedByOurBound: true, sessionId: "s-alpha" }),
      ],
    });

    expect(reading.seats).toEqual([
      {
        cwd: "/w/alpha",
        maxMs: 17_515,
        overruns: 2,
        sessionId: "s-alpha",
        unbounded: 0,
        unboundedCommands: [],
        unboundedUnrecorded: 0,
      },
      {
        cwd: "/w/beta",
        maxMs: 17_100,
        overruns: 1,
        sessionId: "s-beta",
        unbounded: 0,
        unboundedCommands: [],
        unboundedUnrecorded: 0,
      },
    ]);
  });

  it("keeps two seats apart by cwd when no line named a session", () => {
    const reading = hookOverrunReading({
      budgetMs: HOOK_BUDGET_MS,
      calls: [
        call({ cwd: "/w/alpha", durationMs: 17_300, endedByOurBound: true, sessionId: "" }),
        call({ cwd: "/w/beta", durationMs: 17_400, endedByOurBound: true, sessionId: "" }),
      ],
    });

    expect(reading.seats.length).toBe(2);
    expect(reading.seats.map((seat) => seat.cwd).toSorted()).toEqual(["/w/alpha", "/w/beta"]);
  });

  it("reports no seat and no overrun for a window where every recorded call passed", () => {
    const reading = hookOverrunReading({
      budgetMs: HOOK_BUDGET_MS,
      calls: [call({ durationMs: 410 }), call({ durationMs: 1_650 })],
    });

    expect(reading.overruns).toBe(0);
    expect(reading.seats).toEqual([]);
    expect(reading.recorded).toBe(2);
  });

  it("reports an empty window as zero recorded rather than as a clean one", () => {
    const reading = hookOverrunReading({ budgetMs: HOOK_BUDGET_MS, calls: [] });

    expect(reading.recorded).toBe(0);
    expect(reading.overruns).toBe(0);
    expect(reading.seats).toEqual([]);
  });
});

/** The `hooks.json` command of the 10 s `handover-run` entry the harness timed out in a recut seat. */
const HANDOVER_RUN_COMMAND = '"${PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}/scripts/hook.sh" 10 handover-run';

// MEASURED: every overrun `perf` reported was a 60 s `SessionStart` mirror sync that exited 0, and
// a fleet finding sent a seat hunting a slow PreToolUse step that does not exist.
describe("hookOverrunReading grades only PreToolUse against the verdict budget", () => {
  it("does not call a SessionStart hook that finished inside its own 60s an overrun", () => {
    const reading = hookOverrunReading({
      budgetMs: HOOK_BUDGET_MS,
      calls: [
        call({
          command: MIRROR_SYNC_COMMAND,
          durationMs: 26_325,
          event: "SessionStart",
          hookName: "SessionStart:compact",
        }),
        call({ durationMs: 410 }),
      ],
    });

    expect(reading.overruns).toBe(0);
    expect(reading.unbounded).toBe(0);
    expect(reading.seats).toEqual([]);
    expect(reading.recorded).toBe(1);
  });

  it("counts a harness timeout under the verdict budget, whatever its event, as unbounded and not an overrun", () => {
    const reading = hookOverrunReading({
      budgetMs: HOOK_BUDGET_MS,
      calls: [
        call({
          command: HANDOVER_RUN_COMMAND,
          durationMs: 10_087,
          event: "SessionStart",
          harnessTimedOut: true,
          hookName: "SessionStart:startup",
        }),
      ],
    });

    expect(reading.overruns).toBe(0);
    expect(reading.unbounded).toBe(1);
    expect(reading.seats).toEqual([
      {
        cwd: "/w/alpha",
        maxMs: 10_087,
        overruns: 0,
        sessionId: "s-alpha",
        unbounded: 1,
        unboundedCommands: [HANDOVER_RUN_COMMAND],
        unboundedUnrecorded: 0,
      },
    ]);
  });

  it("counts a PreToolUse call our bound ended as an overrun even when its duration is a floor under the line", () => {
    const reading = hookOverrunReading({
      budgetMs: HOOK_BUDGET_MS,
      calls: [call({ durationMs: 13_000, endedByOurBound: true })],
    });

    expect(reading.overruns).toBe(1);
  });

  it("ranks an overrun seat ahead of a seat that only timed out", () => {
    const reading = hookOverrunReading({
      budgetMs: HOOK_BUDGET_MS,
      calls: [
        call({ cwd: "/w/beta", durationMs: 59_000, event: "SessionStart", harnessTimedOut: true, sessionId: "s-beta" }),
        call({ cwd: "/w/alpha", durationMs: 17_300, endedByOurBound: true, sessionId: "s-alpha" }),
      ],
    });

    expect(reading.seats.map((seat) => [seat.cwd, seat.overruns, seat.unbounded])).toEqual([
      ["/w/alpha", 1, 0],
      ["/w/beta", 0, 1],
    ]);
  });
});

/**
 * A refused tool call's result line in the exact shape Claude Code 2.1.289 writes — no attachment, the hook's
 * stderr inside the tool call's own error result. Shape read off a real session transcript.
 */
const refusalLine = ({ text, isError = true }: { text: string; isError?: boolean }): string =>
  JSON.stringify({
    cwd: "/w/alpha",
    message: {
      content: [{ content: text, is_error: isError, tool_use_id: "toolu_01", type: "tool_result" }],
      role: "user",
    },
    sessionId: "s-alpha",
    timestamp: "2026-10-04T18:48:25.189Z",
    type: "user",
  });

const HOOK_PREFIX = 'PreToolUse:Bash hook error: ["…/scripts/hook.sh" 20 pretooluse "…/scripts/pretooluse.sh"]: ';

describe("readRefusedOverrun", () => {
  it("decodes a fail-closed spent budget off the refused call's error result", () => {
    const line = refusalLine({
      text: `${HOOK_PREFIX}pretooluse: killed after 15s without a verdict, so the tool call is refused rather than run past its gates — this hook reached no decision; run it again`,
    });

    expect(readRefusedOverrun({ line, lineNumber: 12 })).toEqual({
      command: "",
      cwd: "/w/alpha",
      durationMs: 15_000,
      endedByOurBound: true,
      event: "PreToolUse",
      harnessTimedOut: false,
      hookName: "PreToolUse:Bash",
      interrupted: false,
      lineNumber: 12,
      sessionId: "s-alpha",
      timestamp: "2026-10-04T18:48:25.189Z",
    });
  });

  it("decodes the give-up the shim prints when the budget went before the gate could run", () => {
    const line = refusalLine({
      text: `${HOOK_PREFIX}pretooluse: no gate reached a verdict on this Bash call (the 15s budget was spent before the gate could run) — refusing it rather than running it past the one-door, poll and script gates; run it again`,
    });

    expect(readRefusedOverrun({ line, lineNumber: 1 })!.durationMs).toBe(15_000);
  });

  it("decodes a spent budget rendered with no bracketed hook command, as a deny document renders it", () => {
    const line = refusalLine({
      text: "PreToolUse:Bash hook error: pretooluse: killed after 15s without a verdict, so the tool call is refused\n\n(refused by the slopweaver pretooluse-dispatch check)",
    });

    expect(readRefusedOverrun({ line, lineNumber: 1 })!.durationMs).toBe(15_000);
  });

  it("reads a gate's own refusal as the hook working, not as an overrun", () => {
    const line = refusalLine({
      text: `${HOOK_PREFIX}poll-gate: refused a log read of /w/alpha/x.jsonl — the same target was polled 8s ago.`,
    });

    expect(readRefusedOverrun({ line, lineNumber: 1 })).toBeUndefined();
  });

  it("does not read a tool output that merely QUOTES the give-up line as a refusal", () => {
    const quoted = "case 2) printf 'pretooluse: killed after 15s without a verdict, so the tool call is refused'";
    const asOutput = refusalLine({ isError: false, text: `PreToolUse:Bash hook error: ${quoted}` });
    const asError = refusalLine({ text: `Exit code 1\n${quoted}` });

    expect(readRefusedOverrun({ line: asOutput, lineNumber: 1 })).toBeUndefined();
    expect(readRefusedOverrun({ line: asError, lineNumber: 1 })).toBeUndefined();
  });

  it("decodes the array form of a tool result's content", () => {
    const line = JSON.stringify({
      message: {
        content: [
          {
            content: [
              {
                text: `${HOOK_PREFIX}pretooluse: killed after 12s without a verdict, so the tool call is refused`,
                type: "text",
              },
            ],
            is_error: true,
            type: "tool_result",
          },
        ],
      },
      type: "user",
    });

    expect(readRefusedOverrun({ line, lineNumber: 1 })!.durationMs).toBe(12_000);
  });

  it("decodes the browser-door guard's give-up line", () => {
    const line = refusalLine({
      text: `${HOOK_PREFIX}pretooluse: cannot run the browser-door guard (the 15s budget was spent first) — refusing the call`,
    });

    expect(readRefusedOverrun({ line, lineNumber: 1 })!.durationMs).toBe(15_000);
  });

  it("skips a block that is not a tool result and reads the refusal after it", () => {
    const line = JSON.stringify({
      message: {
        content: [
          "a bare string block",
          { text: "PreToolUse: is_error", type: "text" },
          { content: { not: "text" }, is_error: true, type: "tool_result" },
          {
            content: [
              { type: "image" },
              { text: `${HOOK_PREFIX}pretooluse: killed after 9s without a verdict`, type: "text" },
            ],
            is_error: true,
            type: "tool_result",
          },
        ],
      },
    });

    expect(readRefusedOverrun({ line, lineNumber: 1 })!.durationMs).toBe(9_000);
  });

  it("answers undefined for a line that passes the substring gate but is not JSON", () => {
    expect(readRefusedOverrun({ line: '"PreToolUse: "is_error":true {', lineNumber: 1 })).toBeUndefined();
  });

  it("answers undefined when the line carries no message object", () => {
    const line = JSON.stringify({ is_error: true, message: HOOK_PREFIX });

    expect(readRefusedOverrun({ line, lineNumber: 1 })).toBeUndefined();
  });

  it("answers undefined when the message content is a string rather than blocks", () => {
    const line = JSON.stringify({ is_error: true, message: { content: HOOK_PREFIX } });

    expect(readRefusedOverrun({ line, lineNumber: 1 })).toBeUndefined();
  });
});

describe("hookBudgetMs", () => {
  it("is the shim's own default when nothing narrows it", () => {
    expect(hookBudgetMs({ env: {} })).toBe(15_000);
  });

  it("grades against the narrowed line when a seat is running with one", () => {
    expect(hookBudgetMs({ env: { SLOPWEAVER_HOOK_BUDGET_SECONDS: "2" } })).toBe(2000);
    expect(hookBudgetMs({ env: { SLOPWEAVER_HOOK_BUDGET_SECONDS: "15" } })).toBe(15_000);
  });

  it("never widens past the default, because bounded-run.sh clamps a larger value the same way", () => {
    expect(hookBudgetMs({ env: { SLOPWEAVER_HOOK_BUDGET_SECONDS: "16" } })).toBe(15_000);
    expect(hookBudgetMs({ env: { SLOPWEAVER_HOOK_BUDGET_SECONDS: "30" } })).toBe(15_000);
  });

  it("falls back to the default rather than trusting a value bounded-run.sh would also reject", () => {
    expect(hookBudgetMs({ env: { SLOPWEAVER_HOOK_BUDGET_SECONDS: "not-a-number" } })).toBe(15_000);
    expect(hookBudgetMs({ env: { SLOPWEAVER_HOOK_BUDGET_SECONDS: "-5" } })).toBe(15_000);
    expect(hookBudgetMs({ env: { SLOPWEAVER_HOOK_BUDGET_SECONDS: "0" } })).toBe(15_000);
  });
});

describe("readHookCall, on a line that passes the substring gate but is not a hook record", () => {
  it("answers undefined for a top-level JSON value that is not an object", () => {
    const line = '[{"durationMs": 17000, "hookEvent": "PreToolUse"}]';
    expect(line.includes('"durationMs"')).toBe(true);
    expect(line.includes('"hookEvent"')).toBe(true);
    expect(readHookCall({ line, lineNumber: 3 })).toBeUndefined();
  });

  it("answers undefined when `attachment` is not an object", () => {
    const line = '{"attachment": 17000, "durationMs": 17000, "hookEvent": "PreToolUse"}';
    expect(line.includes('"durationMs"')).toBe(true);
    expect(readHookCall({ line, lineNumber: 4 })).toBeUndefined();
  });
  it("answers undefined for a durationMs that is not a number, rather than reading it as zero time", () => {
    const line = JSON.stringify({
      attachment: { durationMs: "17000", hookEvent: "PreToolUse", hookName: "PreToolUse:Bash" },
      cwd: "/w/alpha",
      type: "attachment",
    });
    expect(readHookCall({ line, lineNumber: 5 })).toBeUndefined();
  });
});

describe("hookOverrunReading, when the first line of a seat named no cwd", () => {
  it("backfills the seat's cwd from a later line of the same session", () => {
    const reading = hookOverrunReading({
      budgetMs: HOOK_BUDGET_MS,
      calls: [
        call({ cwd: "", durationMs: 17_300, endedByOurBound: true, lineNumber: 1 }),
        call({ cwd: "/w/alpha", durationMs: 19_400, harnessTimedOut: true, lineNumber: 2 }),
      ],
    });
    expect(reading.seats).toEqual([
      {
        cwd: "/w/alpha",
        maxMs: 19_400,
        overruns: 2,
        sessionId: "s-alpha",
        unbounded: 1,
        unboundedCommands: [],
        unboundedUnrecorded: 1,
      },
    ]);
  });
});
