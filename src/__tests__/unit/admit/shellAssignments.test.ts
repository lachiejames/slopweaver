import { describe, expect, it } from "vitest";

import { assignedEnvironments, inheritedAssignments } from "../../../admit/shellAssignments.js";

const ENV = { HOME: "/u/model", SLOPWEAVER_HOME: "/tmp/e2e" };

describe("assignedEnvironments", () => {
  it.each([
    { command: "HOME=/u/owner; cd ~", want: [ENV, { ...ENV, HOME: "/u/owner" }] },
    {
      command: "export SLOPWEAVER_HOME=/u/owner/.slopweaver",
      want: [ENV, { ...ENV, SLOPWEAVER_HOME: "/u/owner/.slopweaver" }],
    },
    { command: "HOME='/u/the owner' rm x", want: [ENV, { ...ENV, HOME: "/u/the owner" }] },
    { command: "true && OLDPWD=/u/owner/.slopweaver", want: [ENV, { ...ENV, OLDPWD: "/u/owner/.slopweaver" }] },
    { command: "HOME=~owner", want: [ENV, { ...ENV, HOME: "/u/owner" }] },
    {
      command: "export GIT_WORK_TREE=/u/owner/.slopweaver",
      want: [ENV, { ...ENV, GIT_WORK_TREE: "/u/owner/.slopweaver" }],
    },
    {
      command: "HOME=/a; HOME=/b",
      want: [ENV, { ...ENV, HOME: "/a" }, { ...ENV, HOME: "/b" }],
    },
  ])("adds an environment for $command", ({ command, want }) => {
    expect(assignedEnvironments({ command, env: ENV })).toEqual(want);
  });

  it.each([
    { command: "rm x", why: "no assignment" },
    { command: 'HOME="$(pwd)"', why: "a value built at run time" },
    { command: "'HOME'=/u/owner", why: "a quoted name, which is a command word" },
    { command: "PATH=/u/owner", why: "a variable the tripwire never expands" },
    { command: "HOME=~2", why: "a tilde it cannot name" },
  ])("adds none for $why", ({ command }) => {
    expect(assignedEnvironments({ command, env: ENV })).toEqual([ENV]);
  });
});

describe("inheritedAssignments", () => {
  it("writes an inherited GIT_WORK_TREE as the assignment word it acts as, its value masked as quoted", () => {
    expect(inheritedAssignments({ env: { ...ENV, GIT_WORK_TREE: "/u/o*" } })).toEqual([
      {
        dynamic: false,
        quoted: true,
        shape: "GIT_WORK_TREE=_____",
        text: "GIT_WORK_TREE=/u/o*",
        unquotedPrefix: "GIT_WORK_TREE=",
      },
    ]);
  });

  it("writes none when GIT_WORK_TREE is unset", () => {
    expect(inheritedAssignments({ env: ENV })).toEqual([]);
  });
});
