/*
 * `isPromptShellTree`: a tab is at a prompt only as one childless shell, alone or under the one login that started
 * it, and every tree where a typed line could land in something other than that prompt is refused.
 */
import { describe, expect, it } from "vitest";

import type { CmuxProcess } from "../../../../cmux/client.js";
import { isPromptShellTree } from "../../../../sessions/coldSeat.js";
import { BARE_SHELL, LOGIN_SHELL } from "./harness.js";

describe("isPromptShellTree", () => {
  it("reads one childless shell, a login shell included, as a prompt", () => {
    expect(isPromptShellTree({ tree: BARE_SHELL })).toBe(true);
    expect(isPromptShellTree({ tree: [{ children: [], name: "-zsh", pid: 10 }] })).toBe(true);
  });

  it("reads one childless shell under the one login that started it as a prompt — the 0.65.2 shape, grafted", () => {
    const loginThenScript: readonly CmuxProcess[] = [
      {
        children: [{ children: [{ children: [], name: "sleep", pid: 12 }], name: "-/bin/zsh", pid: 11 }],
        name: "login",
        pid: 10,
      },
    ];
    const loginTwoShells: readonly CmuxProcess[] = [
      {
        children: [
          { children: [], name: "-/bin/zsh", pid: 11 },
          { children: [], name: "-/bin/zsh", pid: 12 },
        ],
        name: "login",
        pid: 10,
      },
    ];
    const notLogin: readonly CmuxProcess[] = [
      { children: [{ children: [], name: "-/bin/zsh", pid: 11 }], name: "tmux", pid: 10 },
    ];

    expect([LOGIN_SHELL, loginThenScript, loginTwoShells, notLogin].map((tree) => isPromptShellTree({ tree }))).toEqual(
      [true, false, false, false],
    );
  });

  it("reads ksh, tcsh and a shell named by its path as a prompt, and an editor as none", () => {
    expect(
      ["ksh", "-tcsh", "/bin/zsh", "-/opt/homebrew/bin/fish", "vim", "node"].map((name) =>
        isPromptShellTree({ tree: [{ children: [], name, pid: 10 }] }),
      ),
    ).toEqual([true, true, true, true, false, false]);
  });

  it("refuses every tree where a typed line could land in something other than the prompt", () => {
    const script: readonly CmuxProcess[] = [
      { children: [{ children: [], name: "bash", pid: 12 }], name: "-zsh", pid: 10 },
    ];
    const foregroundSleep: readonly CmuxProcess[] = [
      { children: [{ children: [], name: "sleep", pid: 12 }], name: "-zsh", pid: 10 },
    ];
    const loginOnly: readonly CmuxProcess[] = [{ children: [], name: "login", pid: 9 }];
    const twoShells: readonly CmuxProcess[] = [
      { children: [], name: "-zsh", pid: 10 },
      { children: [], name: "zsh", pid: 13 },
    ];
    // cmux's git-HEAD watcher: a `sleep` loop zsh runs only while a foreground command does.
    const commandRunning: readonly CmuxProcess[] = [
      { children: [], name: "zsh", pid: 10 },
      { children: [], name: "sleep", pid: 11 },
    ];
    const sleepOnly: readonly CmuxProcess[] = [{ children: [], name: "sleep", pid: 11 }];

    expect(
      [script, foregroundSleep, loginOnly, twoShells, commandRunning, sleepOnly, []].map((tree) =>
        isPromptShellTree({ tree }),
      ),
    ).toEqual([false, false, false, false, false, false, false]);
  });
});
