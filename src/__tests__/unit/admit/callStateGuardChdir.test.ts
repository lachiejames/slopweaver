/**
 * The call-state tripwire where a command moves its program before naming a path — a `git -C`, a wrapper's own chdir
 * (`env -C`) — each move read exactly once, and a redirection read from where the shell stands. Lexical, so the home
 * is a plain absolute string and no filesystem is touched.
 */
import { describe, expect, it } from "vitest";

import { evaluateCallStateGuard } from "../../../admit/callStateGuard.js";

const USER = "/fixture/users/dev";
const HOME = `${USER}/.slopweaver`;
const CALLS = `${HOME}/talk/calls`;
const INDEX = `${HOME}/talk/call-index.txt`;
const ENV = { HOME: USER, SLOPWEAVER_HOME: HOME };

describe("evaluateCallStateGuard over a moved program", () => {
  it.each([
    // The segment resolver applies a git's `-C` behind `env` or an assignment too, so a second read climbed past the home.
    ["an assigned git's relative -C rm", `cd ${HOME}/corpus && A=1 git -C .. rm -f -- talk/calls/x.jsonl`, CALLS],
    ["an env git's relative -C restore", `cd ${HOME}/corpus && env git -C .. restore -- talk/call-index.txt`, INDEX],
    ["a leading git's relative -C rm", `cd ${HOME}/corpus && git -C .. rm -f -- talk/calls/x.jsonl`, CALLS],
    // The shell opens the file before git moves.
    ["a truncation from where the shell stands", `cd ${HOME}/talk && git -C /tmp log > call-index.txt`, INDEX],
    // An unknown leading variable is relative, so a wrapper's or git's `-C` moves it like any other word.
    ["an env -C rm of a variable-named file", `cd /tmp && env -C ${CALLS} rm "$ID".jsonl`, CALLS],
    // A valued option's value names no wrapper, so the env before it still moves the program.
    ["an env -C past a value naming a wrapper", `cd /tmp && env -u sudo -C ${CALLS} rm live.jsonl`, CALLS],
    [
      "a wrapped git -C clean of an unknown glob",
      `cd /tmp && command git -C ${HOME} clean -fd -- "$OTHER*.tmp"`,
      CALLS,
    ],
  ])("refuses %s", (_label, command, protectedPath) => {
    expect(evaluateCallStateGuard({ command, cwd: "/fixture/work", env: ENV, homes: [HOME] })!.protectedPath).toBe(
      protectedPath,
    );
  });

  it.each([
    ["an env -C", "env -C /tmp rm"],
    ["a git -C", "git -C /tmp rm --"],
  ])("still judges an unknown variable as written under %s, since it may already be absolute", (_label, run) => {
    expect(
      evaluateCallStateGuard({ command: `${run} "$OTHER"`, cwd: CALLS, env: ENV, homes: [HOME] })!.protectedPath,
    ).toBe(CALLS);
  });

  it("allows a truncation the shell opens outside the home, though git's -C reads inside it", () => {
    expect(
      evaluateCallStateGuard({
        command: `cd /fixture/tmp && git -C ${HOME}/talk log > call-index.txt`,
        cwd: "/fixture/work",
        env: ENV,
        homes: [HOME],
      }),
    ).toBe(undefined);
  });
});
