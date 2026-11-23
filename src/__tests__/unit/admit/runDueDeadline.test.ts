/**
 * The run-due deadline gate's classifier: which `Bash` calls run a firing a deadline can kill, and which only
 * mention one.
 */
import { describe, expect, it } from "vitest";

import { BASH_BACKGROUND_MAX_TIMEOUT_MS, classifyRunDueDeadline } from "../../../admit/runDueDeadline.js";

/** Classify a background call at the tool's maximum `timeout`, where only a wrapper can be the deadline. */
function background({ command }: { command: string }): ReturnType<typeof classifyRunDueDeadline> {
  return classifyRunDueDeadline({ command, runInBackground: true, timeoutMs: BASH_BACKGROUND_MAX_TIMEOUT_MS });
}

/** Classify a foreground call, which names no `timeout`. */
function foreground({ command }: { command: string }): ReturnType<typeof classifyRunDueDeadline> {
  return classifyRunDueDeadline({ command, runInBackground: false, timeoutMs: undefined });
}

describe("classifyRunDueDeadline", () => {
  it("refuses a run-due under timeout, naming the wrapper and the invocation", () => {
    expect(background({ command: "timeout 900 slopweaver automation run-due --recipe store-backup-daily" })).toEqual({
      invocation: "slopweaver automation run-due --recipe store-backup-daily",
      kind: "deadline-wrapper",
      wrapper: "timeout",
    });
  });

  it("reads gtimeout's own options and a binary reached by path", () => {
    expect(background({ command: "gtimeout -s TERM -k 5 900 /x/bin/slopweaver automation run-due" })).toEqual({
      invocation: "/x/bin/slopweaver automation run-due",
      kind: "deadline-wrapper",
      wrapper: "gtimeout",
    });
  });

  it("refuses the chair tick's own spelling: a loop, a variable program, a pipe", () => {
    const command =
      'for r in worktree-prune store-backup-daily; do echo "== $r"; timeout 900 $B recipe run-due --recipe $r 2>&1 | ' +
      "tail -4; done > $S/recipes.log 2>&1";
    expect(background({ command })).toEqual({
      invocation: "$B recipe run-due --recipe $r",
      kind: "deadline-wrapper",
      wrapper: "timeout",
    });
  });

  it("refuses a node running the binary under timeout", () => {
    expect(background({ command: "timeout 900 node bin/slopweaver automation run-due" }).kind).toBe("deadline-wrapper");
  });

  it("carries a deadline into the shell it wraps", () => {
    expect(background({ command: "timeout 900 bash -c 'slopweaver automation run-due --recipe x'" })).toEqual({
      invocation: "slopweaver automation run-due --recipe x",
      kind: "deadline-wrapper",
      wrapper: "timeout",
    });
  });

  it("refuses a foreground run-due with no wrapper", () => {
    expect(foreground({ command: "slopweaver automation run-due --recipe x" })).toEqual({
      invocation: "slopweaver automation run-due --recipe x",
      kind: "foreground",
    });
  });

  it("refuses a foreground run-due spelled with the noun's earlier name, recipe", () => {
    expect(foreground({ command: "slopweaver recipe run-due --recipe x" })).toEqual({
      invocation: "slopweaver recipe run-due --recipe x",
      kind: "foreground",
    });
  });

  it("allows run-due under a noun that is neither automation nor its alias", () => {
    expect(foreground({ command: "slopweaver handover run-due" })).toEqual({ kind: "allowed" });
  });

  it("refuses a foreground run-due inside a substitution", () => {
    expect(foreground({ command: 'out="$(slopweaver automation run-due)"' }).kind).toBe("foreground");
  });

  it("refuses a background run-due with no timeout at the tool's 30-minute default, the seats' spelling", () => {
    expect(
      classifyRunDueDeadline({
        command: "slopweaver automation run-due --recipe resync-corpus-slack --claim-id t",
        runInBackground: true,
        timeoutMs: undefined,
      }),
    ).toEqual({
      invocation: "slopweaver automation run-due --recipe resync-corpus-slack --claim-id t",
      kind: "background-cap",
      limitMs: 1_800_000,
    });
  });

  it("refuses a background run-due one millisecond below the maximum, naming the limit it carried", () => {
    expect(
      classifyRunDueDeadline({
        command: "slopweaver automation run-due --recipe x",
        runInBackground: true,
        timeoutMs: 7_199_999,
      }),
    ).toEqual({ invocation: "slopweaver automation run-due --recipe x", kind: "background-cap", limitMs: 7_199_999 });
  });

  it("names a wrapper before a short background limit", () => {
    expect(
      classifyRunDueDeadline({
        command: "timeout 900 slopweaver automation run-due",
        runInBackground: true,
        timeoutMs: undefined,
      }).kind,
    ).toBe("deadline-wrapper");
  });

  it("allows a background run-due at the tool's maximum timeout", () => {
    expect(BASH_BACKGROUND_MAX_TIMEOUT_MS).toBe(7_200_000);
    expect(background({ command: "slopweaver automation run-due --recipe store-backup-daily" })).toEqual({
      kind: "allowed",
    });
  });

  it("allows a background call with no timeout that runs no firing", () => {
    expect(
      classifyRunDueDeadline({
        command: "slopweaver automation due --json",
        runInBackground: true,
        timeoutMs: undefined,
      }),
    ).toEqual({ kind: "allowed" });
  });

  it("allows a dry run, which never takes a firing, even foreground under timeout", () => {
    expect(foreground({ command: "timeout 60 slopweaver automation run-due --dry-run" })).toEqual({ kind: "allowed" });
  });

  it("allows a run-due that is only an argument", () => {
    expect(foreground({ command: "echo slopweaver automation run-due" })).toEqual({ kind: "allowed" });
    expect(foreground({ command: "timeout 5 echo slopweaver automation run-due" })).toEqual({ kind: "allowed" });
    expect(foreground({ command: "grep -n run-due notes.md" })).toEqual({ kind: "allowed" });
  });

  it("allows a quoted or commented mention", () => {
    expect(foreground({ command: "echo 'timeout 900 slopweaver automation run-due'" })).toEqual({ kind: "allowed" });
    expect(foreground({ command: "true # slopweaver automation run-due" })).toEqual({ kind: "allowed" });
  });

  it("does not carry a deadline across a separator", () => {
    expect(background({ command: "timeout 5 echo x; slopweaver automation run-due" })).toEqual({ kind: "allowed" });
    expect(background({ command: "timeout 5 true && slopweaver automation run-due" })).toEqual({ kind: "allowed" });
  });

  it("allows another recipe verb under timeout", () => {
    expect(background({ command: "timeout 60 slopweaver automation due --json" })).toEqual({ kind: "allowed" });
  });
});
