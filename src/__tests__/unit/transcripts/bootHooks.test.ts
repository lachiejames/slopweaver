/**
 * `src/transcripts/bootHooks.ts` — which SessionStart hooks a seat's boot never ran, read off the records
 * Claude Code writes. The fixture lines are the exact shape a real seat wrote (paths shortened).
 */
import { describe, expect, it } from "vitest";

import { bootHookReading, hookLabel, inWindow, readBootHookFailure } from "../../../transcripts/bootHooks.js";

const MIRROR_HOOK = '"${PLUGIN_DATA}/mirror/by-root${PLUGIN_ROOT}/current/scripts/hook.sh"';

/** One attachment line, as a seat's transcript carries it. */
function line({ attachment, sessionId = "s-1" }: { attachment: Record<string, unknown>; sessionId?: string }): string {
  return JSON.stringify({
    attachment,
    cwd: "/repo/wt",
    sessionId,
    timestamp: "2026-10-03T13:51:30.851Z",
    type: "attachment",
  });
}

const EXIT_127_ATTACHMENT = {
  command: `${MIRROR_HOOK} 10 handover-run "…/hooks/handover-run.sh"`,
  durationMs: 554,
  exitCode: 127,
  hookEvent: "SessionStart",
  hookName: "SessionStart:startup",
  stderr:
    "Failed with non-blocking status code: /bin/sh: /d/mirror/by-root/repo/wt/current/scripts/hook.sh: No such file or directory",
  type: "hook_non_blocking_error",
};

const EXIT_127 = line({ attachment: EXIT_127_ATTACHMENT });

describe("readBootHookFailure", () => {
  it("reads a SessionStart 127 as exit-127, carrying the seat, the entry and the line", () => {
    const failure = readBootHookFailure({ line: EXIT_127, lineNumber: 5 })!;
    expect(failure.kind).toBe("exit-127");
    expect(failure.hookName).toBe("SessionStart:startup");
    expect(failure.sessionId).toBe("s-1");
    expect(failure.cwd).toBe("/repo/wt");
    expect(failure.lineNumber).toBe(5);
    expect(failure.command).toContain("handover-run");
  });

  it("reads hook.sh's fail-open missing-target line as no-target, although it exited 0", () => {
    const failure = readBootHookFailure({
      line: line({
        attachment: {
          command: `${MIRROR_HOOK} 10 profile-context "…/hooks/profile-context.sh"`,
          durationMs: 40,
          exitCode: 0,
          hookEvent: "SessionStart",
          hookName: "SessionStart:startup",
          stderr:
            "hook.sh: profile-context has no executable at /x/hooks/profile-context.sh — this hook ran no check at all",
          type: "hook_success",
        },
      }),
      lineNumber: 7,
    })!;
    expect(failure.kind).toBe("no-target");
  });

  it("judges nothing off a record missing its exit code or its command, which names no registered entry", () => {
    const commandless = Object.fromEntries(Object.entries(EXIT_127_ATTACHMENT).filter(([key]) => key !== "command"));
    const codeless = Object.fromEntries(Object.entries(EXIT_127_ATTACHMENT).filter(([key]) => key !== "exitCode"));
    const targetless = line({
      attachment: {
        exitCode: 0,
        hookEvent: "SessionStart",
        hookName: "SessionStart:startup",
        stderr:
          "hook.sh: profile-context has no executable at /x/hooks/profile-context.sh — this hook ran no check at all",
        type: "hook_success",
      },
    });
    expect(readBootHookFailure({ line: line({ attachment: commandless }), lineNumber: 1 })).toBeUndefined();
    expect(readBootHookFailure({ line: line({ attachment: codeless }), lineNumber: 2 })).toBeUndefined();
    expect(readBootHookFailure({ line: targetless, lineNumber: 3 })).toBeUndefined();
  });

  it("reads a 127 written with spaced JSON, which a literal key-value gate would miss", () => {
    const spaced = JSON.stringify({ attachment: EXIT_127_ATTACHMENT, sessionId: "s-1", type: "attachment" }, null, 1)
      .split("\n")
      .join("");
    const failure = readBootHookFailure({ line: spaced, lineNumber: 2 })!;
    expect(failure.kind).toBe("exit-127");
  });

  it("ignores a hook that ran and exited non-zero over an inner helper's missing file", () => {
    const inner = line({
      attachment: {
        exitCode: 1,
        hookEvent: "SessionStart",
        hookName: "SessionStart:startup",
        stderr: "/bin/sh: inner-helper: No such file or directory",
        type: "hook_non_blocking_error",
      },
    });
    expect(readBootHookFailure({ line: inner, lineNumber: 1 })).toBeUndefined();
  });

  it("reads a missing wrapper under a plugin root with a space in it, which the quotes keep one word", () => {
    const spaced = line({
      attachment: {
        ...EXIT_127_ATTACHMENT,
        command: '"${PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}/scripts/hook.sh" 10 profile-context "x"',
        stderr:
          "Failed with non-blocking status code: /bin/sh: /tmp/root with space/scripts/hook.sh: No such file or directory",
      },
    });
    expect(readBootHookFailure({ line: spaced, lineNumber: 1 })!.kind).toBe("exit-127");
  });

  it("reads another plugin's single-quoted first word, spaces included, literally", () => {
    const quoted = {
      ...EXIT_127_ATTACHMENT,
      command: "'/tmp/plugin root/scripts/hook.sh' 10 profile-context '/tmp/target'",
    };
    const missing = line({
      attachment: { ...quoted, stderr: "/bin/sh: /tmp/plugin root/scripts/hook.sh: No such file or directory" },
    });
    const elsewhere = line({
      attachment: { ...quoted, stderr: "/bin/sh: /other/plugin root/scripts/hook.sh: No such file or directory" },
    });
    expect(readBootHookFailure({ line: missing, lineNumber: 1 })!.kind).toBe("exit-127");
    expect(readBootHookFailure({ line: elsewhere, lineNumber: 2 })).toBeUndefined();
  });

  it("removes the shell's quoting from the first word — an escaped quote, a concatenation, a bare backslash", () => {
    const shapes = [
      { command: String.raw`"/tmp/a\"b/hook.sh" 10 label /t`, path: '/tmp/a"b/hook.sh' },
      { command: `'/tmp/x'"/y"/hook.sh 10 label /t`, path: "/tmp/x/y/hook.sh" },
      { command: String.raw`/tmp/with\ space/hook.sh 10 label /t`, path: "/tmp/with space/hook.sh" },
      { command: `'/tmp/$HOME/hook.sh' 10 label /t`, path: "/tmp/$HOME/hook.sh" },
      { command: "~/missing-hook 10 label /t", path: "/Users/someone/missing-hook" },
      { command: `"$(printf ')')suffix" 10 label /t`, path: ")suffix" },
      { command: "\\\n~/missing-hook", path: "line 1: /Users/someone/missing-hook" },
      { command: "\"`printf '\\`'`/hook.sh\" 10 label /t", path: "`/hook.sh" },
    ];
    const kinds = shapes.map(
      ({ command, path }) =>
        readBootHookFailure({
          line: line({
            attachment: { ...EXIT_127_ATTACHMENT, command, stderr: `/bin/sh: ${path}: No such file or directory` },
          }),
          lineNumber: 1,
        })!.kind,
    );
    expect(kinds).toEqual(Array.from({ length: shapes.length }, () => "exit-127"));
    expect(shapes.length).toBe(8);
  });

  it("expands a tilde only as the word's first unquoted character, so a quoted one names a literal path", () => {
    const failureOf = ({ command, path }: { command: string; path: string }) =>
      readBootHookFailure({
        line: line({
          attachment: { ...EXIT_127_ATTACHMENT, command, stderr: `/bin/sh: ${path}: No such file or directory` },
        }),
        lineNumber: 1,
      });
    expect(failureOf({ command: '"~/run" 10 label /t', path: "/missing/run" })).toBeUndefined();
    expect(failureOf({ command: '""~/run 10 label /t', path: "/missing/run" })).toBeUndefined();
    expect(failureOf({ command: String.raw`\~/run 10 label /t`, path: "/missing/run" })).toBeUndefined();
    expect(failureOf({ command: '~"me"/run 10 label /t', path: "/missing/run" })).toBeUndefined();
    expect(failureOf({ command: '"~/run" 10 label /t', path: "~/run" })!.kind).toBe("exit-127");
    expect(failureOf({ command: "~me/run 10 label /t", path: "/home/me/run" })!.kind).toBe("exit-127");
  });

  it("matches every literal piece between expansions, not only the tail", () => {
    const real = line({
      attachment: {
        ...EXIT_127_ATTACHMENT,
        command:
          '"${PLUGIN_DATA:-${CLAUDE_PLUGIN_DATA:-$HOME/.claude/plugins/data/slopweaver}}/mirror/by-root${PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-/_unkeyed}}/current/scripts/hook.sh" 10 handover-run "x"',
        stderr:
          "/bin/sh: /h/.claude/plugins/data/slopweaver-inline/mirror/by-root/r/wt/current/scripts/hook.sh: not found",
      },
    });
    const noMirror = line({
      attachment: { ...EXIT_127_ATTACHMENT, stderr: "/bin/sh: /d/elsewhere/current/scripts/hook.sh: not found" },
    });
    expect(readBootHookFailure({ line: real, lineNumber: 1 })!.kind).toBe("exit-127");
    expect(readBootHookFailure({ line: noMirror, lineNumber: 2 })).toBeUndefined();
  });

  it("reads dash's spelling of a missing wrapper as exit-127 too", () => {
    const dash = line({
      attachment: {
        ...EXIT_127_ATTACHMENT,
        stderr: "/bin/sh: 1: /d/mirror/by-root/r/current/scripts/hook.sh: not found",
      },
    });
    const failure = readBootHookFailure({ line: dash, lineNumber: 1 })!;
    expect(failure.kind).toBe("exit-127");
  });

  it("reads another plugin's missing literal command as exit-127, and its target's own miss as nothing", () => {
    const other = {
      command: "/opt/plugin/bin/missing-hook",
      exitCode: 127,
      hookEvent: "SessionStart",
      hookName: "SessionStart:startup",
      type: "hook_non_blocking_error",
    };
    const missing = line({
      attachment: { ...other, stderr: "/bin/sh: /opt/plugin/bin/missing-hook: No such file or directory" },
    });
    const inner = line({
      attachment: { ...other, stderr: "/bin/sh: /opt/plugin/bin/helper: No such file or directory" },
    });
    expect(readBootHookFailure({ line: missing, lineNumber: 1 })!.kind).toBe("exit-127");
    expect(readBootHookFailure({ line: inner, lineNumber: 2 })).toBeUndefined();
  });

  it("ignores a 127 the TARGET propagated, since the wrapper and the target both ran", () => {
    const propagated = line({
      attachment: {
        ...EXIT_127_ATTACHMENT,
        stderr: "Failed with non-blocking status code: /bin/sh: /missing/helper: No such file or directory",
      },
    });
    expect(readBootHookFailure({ line: propagated, lineNumber: 1 })).toBeUndefined();
  });

  it("ignores a target's own miss of a path ending in the wrapper's tail, under its own name or among other output", () => {
    const ownName = line({
      attachment: {
        ...EXIT_127_ATTACHMENT,
        stderr: "/x/hooks/handover-run.sh: line 4: /tmp/other/scripts/hook.sh: No such file or directory",
      },
    });
    const amongOther = line({
      attachment: {
        ...EXIT_127_ATTACHMENT,
        stderr: "loading brief\n/bin/sh: /tmp/other/scripts/hook.sh: No such file or directory",
      },
    });
    const trailingBlank = line({
      attachment: {
        ...EXIT_127_ATTACHMENT,
        stderr: "/bin/sh: 1: /tmp/other/scripts/hook.sh: not found\n\n",
      },
    });
    expect(readBootHookFailure({ line: ownName, lineNumber: 1 })).toBeUndefined();
    expect(readBootHookFailure({ line: amongOther, lineNumber: 2 })).toBeUndefined();
    expect(readBootHookFailure({ line: trailingBlank, lineNumber: 3 })).toBeUndefined();
  });

  it("reads a missing-target line or a missing wrapper under a root whose path holds a newline", () => {
    const target = line({
      attachment: {
        command: '"${PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}/scripts/hook.sh" 10 profile-context "x"',
        exitCode: 0,
        hookEvent: "SessionStart",
        hookName: "SessionStart:startup",
        stderr:
          "hook.sh: profile-context has no executable at /tmp/plugin\nroot/hooks/profile-context.sh — this hook ran no check at all",
        type: "hook_success",
      },
    });
    const wrapper = line({
      attachment: {
        ...EXIT_127_ATTACHMENT,
        command: '"${PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}/scripts/hook.sh" 10 profile-context "x"',
        stderr: "/bin/sh: /tmp/plugin\nroot/scripts/hook.sh: No such file or directory",
      },
    });
    expect(readBootHookFailure({ line: target, lineNumber: 1 })!.kind).toBe("no-target");
    expect(readBootHookFailure({ line: wrapper, lineNumber: 2 })!.kind).toBe("exit-127");
  });

  it("ignores the registered label's missing-target phrase when it is not the whole stderr", () => {
    const embedded = {
      command: `${MIRROR_HOOK} 10 profile-context "…/hooks/profile-context.sh"`,
      exitCode: 0,
      hookEvent: "SessionStart",
      hookName: "SessionStart:startup",
      type: "hook_success",
    };
    const midLine = line({
      attachment: {
        ...embedded,
        stderr: "target output: hook.sh: profile-context has no executable at /fake — this hook ran no check at all",
      },
    });
    const amongOther = line({
      attachment: {
        ...embedded,
        stderr: "hook.sh: profile-context has no executable at /fake — this hook ran no check at all\nloaded brief",
      },
    });
    expect(readBootHookFailure({ line: midLine, lineNumber: 1 })).toBeUndefined();
    expect(readBootHookFailure({ line: amongOther, lineNumber: 2 })).toBeUndefined();
  });

  it("ignores a hook that ran and merely printed the marker phrase, not hook.sh's line", () => {
    const echoed = line({
      attachment: {
        exitCode: 0,
        hookEvent: "SessionStart",
        hookName: "SessionStart:startup",
        stderr: "worker has no executable at /tmp/helper",
        type: "hook_success",
      },
    });
    expect(readBootHookFailure({ line: echoed, lineNumber: 1 })).toBeUndefined();
  });

  it("ignores a missing-target line a target printed for its OWN nested hook.sh call", () => {
    const nested = line({
      attachment: {
        command: `${MIRROR_HOOK} 10 profile-context "…/hooks/profile-context.sh"`,
        exitCode: 0,
        hookEvent: "SessionStart",
        hookName: "SessionStart:startup",
        stderr: "hook.sh: inner has no executable at /missing/target — this hook ran no check at all",
        type: "hook_success",
      },
    });
    expect(readBootHookFailure({ line: nested, lineNumber: 1 })).toBeUndefined();
  });

  it("reads the registered entry's OWN missing-target line as no-target", () => {
    const own = line({
      attachment: {
        command: `${MIRROR_HOOK} 10 profile-context "…/hooks/profile-context.sh"`,
        exitCode: 0,
        hookEvent: "SessionStart",
        hookName: "SessionStart:startup",
        stderr:
          "hook.sh: profile-context has no executable at /x/hooks/profile-context.sh — this hook ran no check at all",
        type: "hook_success",
      },
    });
    expect(readBootHookFailure({ line: own, lineNumber: 1 })!.kind).toBe("no-target");
  });

  it("reads no missing target off a failure-prefixed copy of the line, or one under a nonzero exit", () => {
    const missing =
      "hook.sh: profile-context has no executable at /x/hooks/profile-context.sh — this hook ran no check at all";
    const ownEntry = {
      command: `${MIRROR_HOOK} 10 profile-context "…/hooks/profile-context.sh"`,
      hookEvent: "SessionStart",
      hookName: "SessionStart:startup",
    };
    const prefixed = line({
      attachment: {
        ...ownEntry,
        exitCode: 0,
        stderr: `Failed with non-blocking status code: ${missing}`,
        type: "hook_success",
      },
    });
    const nonzero = line({
      attachment: { ...ownEntry, exitCode: 1, stderr: missing, type: "hook_non_blocking_error" },
    });
    expect(readBootHookFailure({ line: prefixed, lineNumber: 1 })).toBeUndefined();
    expect(readBootHookFailure({ line: nonzero, lineNumber: 2 })).toBeUndefined();
  });

  it("ignores a SessionStart hook that ran", () => {
    const ran = line({
      attachment: {
        exitCode: 0,
        hookEvent: "SessionStart",
        hookName: "SessionStart:startup",
        stderr: "",
        type: "hook_success",
      },
    });
    expect(readBootHookFailure({ line: ran, lineNumber: 1 })).toBeUndefined();
  });

  it("ignores a 127 on any OTHER event — this probe is about the boot", () => {
    const preTool = line({
      attachment: {
        exitCode: 127,
        hookEvent: "PreToolUse",
        hookName: "PreToolUse:Bash",
        stderr: "/bin/sh: /x: No such file or directory",
        type: "hook_non_blocking_error",
      },
    });
    expect(readBootHookFailure({ line: preTool, lineNumber: 1 })).toBeUndefined();
  });

  it("ignores a line that is not JSON, and one that is not an attachment", () => {
    expect(readBootHookFailure({ line: '{"hookEvent":"SessionStart" broken', lineNumber: 1 })).toBeUndefined();
    expect(
      readBootHookFailure({ line: JSON.stringify({ hookEvent: "SessionStart", type: "user" }), lineNumber: 1 }),
    ).toBeUndefined();
  });
});

describe("hookLabel", () => {
  it("reads hook.sh's label off a quoted or bare wrapper path, and nothing off any other command", () => {
    expect(hookLabel({ command: `${MIRROR_HOOK} 10 handover-run "x"` })).toBe("handover-run");
    expect(hookLabel({ command: "/p/scripts/hook.sh 30 slopweaver-init /p/bin/slopweaver init" })).toBe(
      "slopweaver-init",
    );
    expect(hookLabel({ command: "'/tmp/plugin root/scripts/hook.sh' 10 'profile-context' '/missing'" })).toBe(
      "profile-context",
    );
    expect(hookLabel({ command: "/bin/echo hi" })).toBeUndefined();
  });

  it("reads past the door-gated row's SLOPWEAVER_HOOK_GIVE_UP prefix to the label", () => {
    expect(hookLabel({ command: `SLOPWEAVER_HOOK_GIVE_UP=2 ${MIRROR_HOOK} 30 pretooluse "x"` })).toBe("pretooluse");
  });
});

describe("inWindow", () => {
  const failure = readBootHookFailure({ line: EXIT_127, lineNumber: 5 })!;
  const at = Date.parse("2026-10-03T13:51:30.851Z");

  it("keeps a record inside the window and drops one provably before or after it", () => {
    expect(inWindow({ failure, sinceMs: at - 1, untilMs: at + 1 })).toBe(true);
    expect(inWindow({ failure, sinceMs: at + 1, untilMs: undefined })).toBe(false);
    expect(inWindow({ failure, sinceMs: undefined, untilMs: at - 1 })).toBe(false);
  });

  it("keeps a record with no readable timestamp, which cannot be placed outside any window", () => {
    expect(inWindow({ failure: { ...failure, timestamp: "" }, sinceMs: at + 1, untilMs: undefined })).toBe(true);
  });
});

describe("bootHookReading", () => {
  it("counts every walked transcript, a clean one included, and ranks the worst seat first", () => {
    const one = readBootHookFailure({ line: EXIT_127, lineNumber: 5 })!;
    const other = readBootHookFailure({
      line: line({ attachment: EXIT_127_ATTACHMENT, sessionId: "s-2" }),
      lineNumber: 9,
    })!;
    const reading = bootHookReading({ perSession: [[one], [], [other, other]] });
    expect(reading.sessionsWalked).toBe(3);
    expect(reading.failures).toBe(3);
    expect(reading.seats.map((seat) => [seat.sessionId, seat.failures.length])).toEqual([
      ["s-2", 2],
      ["s-1", 1],
    ]);
  });

  it("reports nothing walked as zero seats, never as a clean bill over something", () => {
    const reading = bootHookReading({ perSession: [] });
    expect(reading).toEqual({ failures: 0, seats: [], sessionsWalked: 0 });
  });
});
