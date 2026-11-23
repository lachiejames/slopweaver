/**
 * `src/context/loadTranscript.ts` — what a seat's own transcript says about its profile loads: a hook that never ran,
 * a hook run judged by what it printed, and a by-hand `profile context` counted only as the result of its own call.
 */
import { describe, expect, it } from "vitest";

import {
  observationOfBootFailure,
  observationOfTranscriptLoad,
  profileContextCalls,
} from "../../../context/loadTranscript.js";
import type { BootHookFailure } from "../../../transcripts/bootHooks.js";

/** A boot record of a hook that never ran, as `readBootHookFailure` returns it. */
function bootFailure(over: Partial<BootHookFailure> = {}): BootHookFailure {
  return {
    command: '"${PLUGIN_DATA}/mirror/current/scripts/hook.sh" 10 profile-context "…/hooks/profile-context.sh"',
    cwd: "/repo/stale-wt",
    hookName: "SessionStart:startup",
    kind: "exit-127",
    lineNumber: 4,
    sessionId: "s-9",
    stderr: "No such file or directory",
    timestamp: "2026-10-05T10:23:58.000Z",
    ...over,
  };
}

/** The block a load that found the owner's profile prints, as the hook's `additionalContext` envelope. */
const DELIVERED = `${JSON.stringify({
  hookSpecificOutput: {
    additionalContext: "[slopweaver] always-loaded context — read at 2026-10-05T10:29:58.000Z\n## About the owner\n- x",
    hookEventName: "SessionStart",
  },
})}\n`;

/** One raw `hook_success` transcript line for the hook labelled `label`, printing `stdout`. */
function successLine({
  label = "profile-context",
  exitCode = 0,
  timestamp = "2026-10-05T10:30:00.000Z",
  stdout = DELIVERED,
  recordsStdout = true,
}: {
  label?: string;
  exitCode?: number;
  timestamp?: string;
  stdout?: string;
  recordsStdout?: boolean;
} = {}): string {
  return JSON.stringify({
    attachment: {
      command: `"\${PLUGIN_DATA}/mirror/current/scripts/hook.sh" 10 ${label} "…/hooks/${label}.sh"`,
      exitCode,
      hookEvent: "SessionStart",
      hookName: "SessionStart:compact",
      stderr: "",
      ...(recordsStdout ? { stdout } : {}),
      type: "hook_success",
    },
    cwd: "/repo/wt",
    sessionId: "s-9",
    timestamp,
    type: "attachment",
  });
}

/** One raw assistant record calling Bash with `command` as tool use `id`. */
function callLine({ id, command }: { id: string; command: string }): string {
  return JSON.stringify({
    message: { content: [{ id, input: { command }, name: "Bash", type: "tool_use" }], role: "assistant" },
    sessionId: "s-7",
    timestamp: "2026-10-05T10:59:59.000Z",
    type: "assistant",
  });
}

/** One raw user record carrying the result of tool use `answers`, which printed `body`. */
function resultLine({ body, answers = "t-1" }: { body: string; answers?: string }): string {
  return JSON.stringify({
    cwd: "/repo/old-wt",
    message: { content: [{ content: body, tool_use_id: answers, type: "tool_result" }], role: "user" },
    sessionId: "s-7",
    timestamp: "2026-10-05T11:00:00.000Z",
    type: "user",
  });
}

const NO_CALLS: ReadonlySet<string> = new Set();

describe("observationOfBootFailure", () => {
  it("reads a profile-context boot record as a failure under its event, and another hook's as nothing", () => {
    expect(observationOfBootFailure({ failure: bootFailure(), fileSessionId: "file" })).toEqual({
      atIso: "2026-10-05T10:23:58.000Z",
      cwd: "/repo/stale-wt",
      event: "SessionStart:startup",
      outcome: "failed",
      sessionId: "s-9",
      why: "the SessionStart:startup profile hook never ran (exit-127)",
    });
    const handover = bootFailure({ command: '"…/hook.sh" 10 handover-run "…/hooks/handover-run.sh"' });
    expect(observationOfBootFailure({ failure: handover, fileSessionId: "file" })).toBeUndefined();
  });

  it("takes the transcript's own id for a record naming none", () => {
    expect(
      observationOfBootFailure({ failure: bootFailure({ sessionId: "" }), fileSessionId: "file" })!.sessionId,
    ).toBe("file");
  });
});

describe("observationOfTranscriptLoad — the profile hook's own run", () => {
  it("reads a run that printed the owner's profile as a load, naming the hook and its matcher", () => {
    expect(observationOfTranscriptLoad({ contextCalls: NO_CALLS, fileSessionId: "file", line: successLine() })).toEqual(
      {
        atIso: "2026-10-05T10:30:00.000Z",
        cwd: "/repo/wt",
        event: "SessionStart:compact",
        outcome: "loaded",
        sessionId: "s-9",
        why: "the SessionStart:compact profile hook delivered the owner's profile",
      },
    );
  });

  it("reads a run killed by its bound, one that printed nothing, and either form of found-nothing as a failure", () => {
    const stop = DELIVERED.replace(
      "## About",
      "# STOP — the owner's profile did NOT load into this session\\n## About",
    );
    // Older code's found-nothing block, carrying a cache error other than "never written".
    const oldNone = DELIVERED.replace(
      "- x",
      "unavailable: store down, and the cache was captured against another database",
    );
    expect(
      [
        successLine({ stdout: "profile-context: killed after 8s\n" }),
        successLine({ stdout: "" }),
        successLine({ stdout: stop }),
        successLine({ stdout: oldNone }),
      ].map((line) => observationOfTranscriptLoad({ contextCalls: NO_CALLS, fileSessionId: "file", line })!.outcome),
    ).toEqual(["failed", "failed", "failed", "failed"]);
  });

  it("is no evidence for another hook, a non-zero exit, no stdout field, an untimed record or a line that is not JSON", () => {
    expect(
      [
        successLine({ label: "handover-run" }),
        successLine({ exitCode: 1 }),
        successLine({ recordsStdout: false }),
        successLine({ timestamp: "later" }),
        '{"hook_success" profile-context',
      ].map((line) => observationOfTranscriptLoad({ contextCalls: NO_CALLS, fileSessionId: "file", line })),
    ).toEqual([undefined, undefined, undefined, undefined, undefined]);
  });
});

describe("profileContextCalls", () => {
  it("names a Bash call whose command is the reload, with or without flags, an env prefix or a pipe after it", () => {
    expect(
      [
        "slopweaver profile context",
        "slopweaver profile context --json | head -40",
        "SLOPWEAVER_HOME=/h slopweaver profile context",
      ].flatMap((command, index) => profileContextCalls({ line: callLine({ command, id: `t-${String(index)}` }) })),
    ).toEqual(["t-0", "t-1", "t-2"]);
  });

  it("names no call that merely mentions the reload — a screen read, an echo, a grep", () => {
    expect(
      [
        "slopweaver cmux read-screen seat-2 # shows slopweaver profile context",
        "echo slopweaver profile context",
        'grep -n "slopweaver profile context" skills/profile/SKILL.md',
      ].flatMap((command) => profileContextCalls({ line: callLine({ command, id: "t-9" }) })),
    ).toEqual([]);
  });
});

describe("observationOfTranscriptLoad — a by-hand `profile context` printed into the session", () => {
  const report = "[slopweaver] always-loaded context — read at 2026-10-05T10:59:59.000Z\n## About the owner\n- x\n";
  const calls: ReadonlySet<string> = new Set(["t-1"]);

  it("reads the reload call's report ending origin live, or its --json origin, as a load in that session", () => {
    const json = JSON.stringify({ lines: [report], origin: "cache" });
    expect([
      observationOfTranscriptLoad({
        contextCalls: calls,
        fileSessionId: "file",
        line: resultLine({ body: `${report}origin: live` }),
      }),
      observationOfTranscriptLoad({ contextCalls: calls, fileSessionId: "file", line: resultLine({ body: json }) })!
        .outcome,
    ]).toEqual([
      {
        atIso: "2026-10-05T11:00:00.000Z",
        cwd: "/repo/old-wt",
        event: "by-hand",
        outcome: "loaded",
        sessionId: "s-7",
        why: "a by-hand `profile context` printed the owner's profile",
      },
      "loaded",
    ]);
  });

  it("is no evidence for the same report answering another call, nor for a report that found nothing", () => {
    expect([
      observationOfTranscriptLoad({
        contextCalls: calls,
        fileSessionId: "file",
        line: resultLine({ answers: "t-2", body: `${report}origin: live` }),
      }),
      observationOfTranscriptLoad({
        contextCalls: NO_CALLS,
        fileSessionId: "file",
        line: resultLine({ body: `${report}origin: live` }),
      }),
      observationOfTranscriptLoad({
        contextCalls: calls,
        fileSessionId: "file",
        line: resultLine({ body: `${report}origin: none — down` }),
      }),
    ]).toEqual([undefined, undefined, undefined]);
  });
});
