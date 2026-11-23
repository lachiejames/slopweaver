/** `cmux reseat`'s cold arm over a fake client: a reopened bare tab is typed into only when it is provably cold. */
import { describe, expect, it } from "vitest";

import { coldResumeWorkspace } from "../../../../../../cli/commands/cmux/reseatRelaunch.js";
import type { CmuxClient, CmuxProcess } from "../../../../../../cmux/client.js";
import { err, ok } from "../../../../../../lib/result.js";
import type { TtyProcessRow } from "../../../../../../live/standing/processes.js";
import { BARE, CHAIR_ID, record, TABLE, workspace } from "./fixtures.js";
import { coldWorld } from "./harness.js";

describe("coldResumeWorkspace", () => {
  it("types the chair's routed line into its bare shell with NOTHING stopped, and reads the session back", async () => {
    const journal: string[] = [];
    const { client, deps } = coldWorld({ journal, trees: [BARE, BARE] });

    const outcome = await coldResumeWorkspace({
      deps: { ...deps, client },
      pinnedSessionId: CHAIR_ID,
      workspace: workspace({ id: "ws-chair", ref: "workspace:1" }),
    });

    const excludes = String.raw`"{\"claudeMdExcludes\":[\"$PWD/.claude/rules/typescript-patterns.md\",\"$PWD/.claude/rules/testing.md\",\"$PWD/.claude/rules/error-handling.md\"]}"`;
    expect(journal).toEqual([
      "route ws-chair",
      "send ws-chair: CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR=3 CLAUDE_SECURESTORAGE_CONFIG_DIR=/home/unbound/seat " +
        `3</home/plan-one/setup-token claude --plugin-dir /wt/ws-chair --model fable --settings ${excludes} ` +
        `--resume ${CHAIR_ID}`,
    ]);
    expect(outcome).toEqual(expect.objectContaining({ kind: "reseated" }));
  });

  // The trees are read across every surface and the line reaches the selected
  // one, so a bare shell on a hidden split vouched for a selected surface that reported nothing.
  it("types NOTHING into a tab holding more than one surface, whatever runs across them", async () => {
    const journal: string[] = [];
    const { client, deps } = coldWorld({ journal, trees: [] });
    const split: CmuxClient = {
      ...client,
      workspaceTop: () => Promise.resolve(ok({ surfaces: 2, trees: BARE, ttys: [], unattributedTtyPids: [] })),
    };

    const outcome = await coldResumeWorkspace({
      deps: { ...deps, client: split },
      pinnedSessionId: CHAIR_ID,
      workspace: workspace({ id: "ws-chair", ref: "workspace:1" }),
    });

    expect(journal).toEqual([]);
    expect(outcome).toEqual({
      error: {
        code: "NOT_COLD",
        message:
          "workspace:1 was not a bare shell when the resume line would have been typed (split-surfaces), so nothing was typed into it — read the screen; once it shows one shell prompt in one surface, run `slopweaver cmux reseat workspace:1` again",
      },
      kind: "refused",
      workspaceRef: "workspace:1",
    });
  });

  // The live-session read takes its own `ps` snapshot, so a tree read BEFORE it
  // was not the last read, and a program started between the two was judged off the older tree.
  it("reads the tab's tree and table LAST before the send, after the live sessions, the saved binding and the registry", async () => {
    const journal: string[] = [];
    const reads: string[] = [];
    const { client, deps } = coldWorld({ journal, trees: [BARE, BARE] });
    const noted: CmuxClient = {
      ...client,
      readResumeBinding: (options) => {
        reads.push("binding");
        return client.readResumeBinding(options);
      },
      sendLine: (options) => {
        reads.push("send");
        return client.sendLine(options);
      },
      workspaceTop: (options) => {
        reads.push("tree");
        return client.workspaceTop(options);
      },
    };

    const outcome = await coldResumeWorkspace({
      deps: {
        ...deps,
        client: noted,
        readLiveRecords: () => {
          reads.push("live");
          return deps.readLiveRecords();
        },
        readExecutables: (options) => {
          reads.push("executables");
          return deps.readExecutables(options);
        },
        readProcessRows: () => {
          reads.push("table");
          return deps.readProcessRows();
        },
        readTtyHolders: (options) => {
          reads.push("holders");
          return deps.readTtyHolders(options);
        },
        readRegistry: () => {
          reads.push("registry");
          return deps.readRegistry();
        },
        transcriptExists: (options) => {
          reads.push("transcript");
          return deps.transcriptExists(options);
        },
      },
      pinnedSessionId: CHAIR_ID,
      workspace: workspace({ id: "ws-chair", ref: "workspace:1" }),
    });

    expect(reads.slice(0, reads.indexOf("send") + 1)).toEqual([
      "live",
      "binding",
      "transcript",
      "tree",
      "table",
      "executables",
      "holders",
      "table",
      "registry",
      "live",
      "binding",
      "transcript",
      "tree",
      "table",
      "executables",
      "holders",
      "table",
      "send",
    ]);
    expect(outcome).toEqual(expect.objectContaining({ kind: "reseated" }));
  });

  // MEASURED: a live seat's defunct child and its shell outside the foreground group Claude holds were refused by
  // the graft as an unreadable bare shell. The session is read first, so neither is ever looked at.
  it("reads a tab whose live session has a defunct child as LIVE, before any graft read", async () => {
    const journal: string[] = [];
    const reads: string[] = [];
    const { client, deps } = coldWorld({ journal, trees: [] });
    const rows: readonly TtyProcessRow[] = [
      ...TABLE,
      { argv: "claude", pid: 4242, ppid: 1, state: "S+", tty: "ttys001" },
      { argv: "(git)", pid: 4300, ppid: 4242, state: "Z+", tty: "ttys001" },
    ];
    const live: CmuxClient = {
      ...client,
      workspaceTop: () =>
        Promise.resolve(
          ok({
            surfaces: 1,
            trees: [{ children: [], name: "zsh", pid: 1 }],
            ttys: [],
            unattributedTtyPids: [],
          }),
        ),
    };

    const outcome = await coldResumeWorkspace({
      deps: {
        ...deps,
        client: live,
        readExecutables: (options) => {
          reads.push("executables");
          return deps.readExecutables(options);
        },
        readLiveRecords: () => ok([record({ cwd: "/wt/ws-chair", pid: 4242, sessionId: CHAIR_ID })]),
        readProcessGroups: () => {
          reads.push("groups");
          return ok(new Map([[1, { pgid: 1, tpgid: 4242 }]]));
        },
        readProcessRows: () => {
          reads.push("table");
          return ok(rows);
        },
        readTtyHolders: (options) => {
          reads.push("holders");
          return deps.readTtyHolders(options);
        },
      },
      pinnedSessionId: CHAIR_ID,
      workspace: workspace({ id: "ws-chair", ref: "workspace:1" }),
    });

    expect(reads).toEqual(["table"]);
    expect(journal).toEqual([]);
    expect(outcome).toEqual({
      error: {
        code: "NOT_COLD",
        message:
          "workspace:1 was not a bare shell when the resume line would have been typed (live-session), so nothing was typed into it — read the screen; once it shows one shell prompt in one surface, run `slopweaver cmux reseat workspace:1` again",
      },
      kind: "refused",
      workspaceRef: "workspace:1",
    });
  });

  // A live pid cmux reported itself was refused CMUX_READ_FAILED when `ps` failed.
  it("reads a tab cmux reports the live session's own pid for as LIVE even when the table will not read", async () => {
    const journal: string[] = [];
    const { client, deps } = coldWorld({ journal, trees: [] });
    const live: CmuxClient = {
      ...client,
      workspaceTop: () =>
        Promise.resolve(
          ok({
            surfaces: 1,
            trees: [{ children: [{ children: [], name: "claude", pid: 4242 }], name: "zsh", pid: 1 }],
            ttys: [],
            unattributedTtyPids: [],
          }),
        ),
    };

    const outcome = await coldResumeWorkspace({
      deps: {
        ...deps,
        client: live,
        readLiveRecords: () => ok([record({ cwd: "/wt/ws-chair", pid: 4242, sessionId: CHAIR_ID })]),
        readProcessRows: () => err("ps: timed out"),
      },
      pinnedSessionId: CHAIR_ID,
      workspace: workspace({ id: "ws-chair", ref: "workspace:1" }),
    });

    expect(journal).toEqual([]);
    expect(outcome).toEqual({
      error: {
        code: "NOT_COLD",
        message:
          "workspace:1 was not a bare shell when the resume line would have been typed (live-session), so nothing was typed into it — read the screen; once it shows one shell prompt in one surface, run `slopweaver cmux reseat workspace:1` again",
      },
      kind: "refused",
      workspaceRef: "workspace:1",
    });
  });

  // Cmux reporting only the session's child left a live tab to the graft.
  it("reads a tab cmux reports only the live session's CHILD for as LIVE, typing nothing", async () => {
    const journal: string[] = [];
    const { client, deps } = coldWorld({ journal, trees: [] });
    const rows: readonly TtyProcessRow[] = [
      ...TABLE,
      { argv: "claude", pid: 4242, ppid: 1, state: "S", tty: "??" },
      { argv: "node", pid: 4300, ppid: 4242, state: "S+", tty: "ttys001" },
    ];
    const live: CmuxClient = {
      ...client,
      workspaceTop: () =>
        Promise.resolve(
          ok({ surfaces: 1, trees: [{ children: [], name: "node", pid: 4300 }], ttys: [], unattributedTtyPids: [] }),
        ),
    };

    const outcome = await coldResumeWorkspace({
      deps: {
        ...deps,
        client: live,
        readLiveRecords: () => ok([record({ cwd: "/wt/ws-chair", pid: 4242, sessionId: CHAIR_ID })]),
        readProcessRows: () => ok(rows),
      },
      pinnedSessionId: CHAIR_ID,
      workspace: workspace({ id: "ws-chair", ref: "workspace:1" }),
    });

    expect(journal).toEqual([]);
    expect(outcome).toEqual({
      error: {
        code: "NOT_COLD",
        message:
          "workspace:1 was not a bare shell when the resume line would have been typed (live-session), so nothing was typed into it — read the screen; once it shows one shell prompt in one surface, run `slopweaver cmux reseat workspace:1` again",
      },
      kind: "refused",
      workspaceRef: "workspace:1",
    });
  });

  it("types NOTHING when the tab stops being a bare shell between the plan and the send", async () => {
    const journal: string[] = [];
    const busy: readonly CmuxProcess[] = [{ children: [{ children: [], name: "vim", pid: 7 }], name: "zsh", pid: 3 }];
    const { client, deps } = coldWorld({ journal, trees: [BARE, busy] });

    const outcome = await coldResumeWorkspace({
      deps: { ...deps, client },
      pinnedSessionId: CHAIR_ID,
      workspace: workspace({ id: "ws-chair", ref: "workspace:1" }),
    });

    expect(journal).toEqual(["route ws-chair"]);
    expect(outcome).toEqual(
      expect.objectContaining({ error: expect.objectContaining({ code: "NOT_COLD" }), kind: "refused" }),
    );
  });

  it("refuses a bare shell whose saved session has no transcript, and routes nothing", async () => {
    const journal: string[] = [];
    const { client, deps } = coldWorld({ journal, trees: [BARE] });

    const outcome = await coldResumeWorkspace({
      deps: { ...deps, client, transcriptExists: () => false },
      pinnedSessionId: CHAIR_ID,
      workspace: workspace({ id: "ws-chair", ref: "workspace:1" }),
    });

    expect(journal).toEqual([]);
    expect(outcome).toEqual(
      expect.objectContaining({ error: expect.objectContaining({ code: "NO_RESUMABLE_SESSION" }), kind: "refused" }),
    );
  });
});
