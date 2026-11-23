/**
 * The pure half of run-due's verb child: what it is launched as, how its ending maps back to an exit code, and what
 * a signal retirement says happened to it.
 */
import { describe, expect, it } from "vitest";

import {
  childLeadsGroup,
  closedChildExit,
  killVerbGroup,
  runDueVerbChildMark,
  signalledExitCode,
  terminationClause,
  verbChildArgv,
} from "../../../../../cli/commands/automation/runDueVerbProcessPure.js";

/** An error carrying a `code`, as `process.kill` throws one. */
function codedError({ code, message }: { code: string; message: string }): Error {
  return Object.assign(new Error(message), { code });
}

describe("verbChildArgv", () => {
  it("runs the row's verb words after this tier's exec arguments and entry script, never the synthetic runtime prefix", () => {
    expect(
      verbChildArgv({
        argv: ["node", "slopweaver", "atlas", "freshness", "--behind-only"],
        launch: {
          entrypoint: "/repo/src/cli/index.ts",
          execArgv: ["--require", "/tsx/preflight.cjs", "--import", "file:///tsx/loader.mjs"],
          leadsGroup: true,
        },
      }),
    ).toEqual([
      "--require",
      "/tsx/preflight.cjs",
      "--import",
      "file:///tsx/loader.mjs",
      "/repo/src/cli/index.ts",
      "atlas",
      "freshness",
      "--behind-only",
    ]);
  });

  it("keeps a word holding spaces, quotes or a shell metacharacter as ONE argument", () => {
    expect(
      verbChildArgv({
        argv: ["node", "slopweaver", "slack", "post", "--text", "it's $(rm -rf /) & more"],
        launch: { entrypoint: "/repo/dist-cli/cli/index.js", execArgv: [], leadsGroup: true },
      }),
    ).toEqual(["/repo/dist-cli/cli/index.js", "slack", "post", "--text", "it's $(rm -rf /) & more"]);
  });
});

describe("signalledExitCode", () => {
  it("answers 128 plus the signal's number", () => {
    expect(signalledExitCode({ signal: "SIGINT" })).toBe(130);
    expect(signalledExitCode({ signal: "SIGKILL" })).toBe(137);
    expect(signalledExitCode({ signal: "SIGTERM" })).toBe(143);
  });
});

describe("closedChildExit", () => {
  it("passes every exit code through unchanged, so 3 still stamps and 4 still does not", () => {
    expect([0, 1, 2, 3, 4].map((code) => closedChildExit({ code, signal: null }))).toEqual([
      { exitCode: 0, line: null },
      { exitCode: 1, line: null },
      { exitCode: 2, line: null },
      { exitCode: 3, line: null },
      { exitCode: 4, line: null },
    ]);
  });

  it("maps a signal death to 128 + n and names the signal, since the child wrote no reason of its own", () => {
    expect(closedChildExit({ code: null, signal: "SIGKILL" })).toEqual({
      exitCode: 137,
      line: "automation run-due: the verb child was ended by SIGKILL",
    });
  });

  it("fails a close that reports neither, rather than reading it as success", () => {
    expect(closedChildExit({ code: null, signal: null })).toEqual({
      exitCode: 1,
      line: "automation run-due: the verb child closed reporting neither an exit code nor a signal",
    });
  });
});

describe("childLeadsGroup", () => {
  it("keeps the child in this group only when the mark names this process's own parent", () => {
    expect(childLeadsGroup({ inherited: runDueVerbChildMark({ pid: 4242 }), parentPid: 4242 })).toBe(false);
  });

  it("leads a group when no run-due marked this process", () => {
    expect(childLeadsGroup({ inherited: undefined, parentPid: 4242 })).toBe(true);
  });

  it("leads a group when the mark was inherited from further up, naming a process that is not this one's parent", () => {
    expect(childLeadsGroup({ inherited: runDueVerbChildMark({ pid: 1111 }), parentPid: 4242 })).toBe(true);
  });

  it("leads a group when the mark is a bare flag rather than a pid", () => {
    expect(childLeadsGroup({ inherited: "1", parentPid: 4242 })).toBe(true);
  });
});

describe("killVerbGroup", () => {
  it("sends SIGKILL to the NEGATIVE pid, the child's whole process group, when the child leads one", () => {
    const sent: { readonly pid: number; readonly signal: NodeJS.Signals }[] = [];
    const termination = killVerbGroup({
      kill: (target) => {
        sent.push(target);
      },
      leadsGroup: true,
      pid: 4242,
    });
    expect(sent).toEqual([{ pid: -4242, signal: "SIGKILL" }]);
    expect(termination).toEqual({ kind: "killed", pid: 4242, scope: "group" });
  });

  it("sends SIGKILL to the child alone when it shares this nested run-due's group, never the group itself", () => {
    const sent: { readonly pid: number; readonly signal: NodeJS.Signals }[] = [];
    const termination = killVerbGroup({
      kill: (target) => {
        sent.push(target);
      },
      leadsGroup: false,
      pid: 4242,
    });
    expect(sent).toEqual([{ pid: 4242, signal: "SIGKILL" }]);
    expect(termination).toEqual({ kind: "killed", pid: 4242, scope: "process" });
  });

  it("reads ESRCH as a group already gone", () => {
    const termination = killVerbGroup({
      kill: () => {
        throw codedError({ code: "ESRCH", message: "kill ESRCH" });
      },
      leadsGroup: true,
      pid: 4242,
    });
    expect(termination).toEqual({ kind: "already-finished", pid: 4242, scope: "group" });
  });

  it("falls back to the child alone when the group kill fails, and says the group may outlive it", () => {
    const sent: number[] = [];
    const termination = killVerbGroup({
      kill: ({ pid }) => {
        sent.push(pid);
        if (pid < 0) {
          throw codedError({ code: "EPERM", message: "kill EPERM" });
        }
      },
      leadsGroup: true,
      pid: 4242,
    });
    expect(sent).toEqual([-4242, 4242]);
    expect(termination).toEqual({ child: "sent", groupMessage: "kill EPERM", kind: "killed-alone", pid: 4242 });
    expect(terminationClause({ termination })).toBe(
      "sending SIGKILL to its verb child's process group (pid 4242) failed (kill EPERM), so the child alone was sent " +
        "SIGKILL, and anything else in that group may outlive it",
    );
  });

  it("says the child had already exited when it is gone by the fallback kill, never that it was sent SIGKILL", () => {
    const termination = killVerbGroup({
      kill: ({ pid }) => {
        if (pid < 0) {
          throw codedError({ code: "EPERM", message: "kill EPERM" });
        }
        throw codedError({ code: "ESRCH", message: "kill ESRCH" });
      },
      leadsGroup: true,
      pid: 4242,
    });
    expect(termination).toEqual({ child: "gone", groupMessage: "kill EPERM", kind: "killed-alone", pid: 4242 });
    expect(terminationClause({ termination })).toBe(
      "sending SIGKILL to its verb child's process group (pid 4242) failed (kill EPERM), so the child alone was " +
        "targeted and had already exited, and anything else in that group may outlive it",
    );
  });

  it("reports both failures when the group kill and the child kill each fail, never swallowing them as a kill", () => {
    const sent: number[] = [];
    const termination = killVerbGroup({
      kill: ({ pid }) => {
        sent.push(pid);
        throw codedError({ code: "EPERM", message: `kill EPERM ${String(pid)}` });
      },
      leadsGroup: true,
      pid: 4242,
    });
    expect(sent).toEqual([-4242, 4242]);
    expect(termination).toEqual({
      kind: "kill-failed",
      message: "kill EPERM -4242; then kill EPERM 4242",
      pid: 4242,
      scope: "group",
    });
  });

  it("reports a nested child's failed kill without a second attempt, since it never targeted a group", () => {
    const sent: number[] = [];
    const termination = killVerbGroup({
      kill: ({ pid }) => {
        sent.push(pid);
        throw codedError({ code: "EPERM", message: "kill EPERM" });
      },
      leadsGroup: false,
      pid: 4242,
    });
    expect(sent).toEqual([4242]);
    expect(termination).toEqual({ kind: "kill-failed", message: "kill EPERM", pid: 4242, scope: "process" });
  });
});

describe("terminationClause", () => {
  it("names a run with no child as one that ran in this process", () => {
    expect(terminationClause({ termination: { kind: "none-running" } })).toBe(
      "no verb child was running, so the effect ran in this process",
    );
  });
});
