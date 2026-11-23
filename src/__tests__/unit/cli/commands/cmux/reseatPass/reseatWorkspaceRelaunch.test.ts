/**
 * `cmux reseat`'s pass over a fake client: the order is the design — route, pace, stop, and only then type —
 * so each case reads one journal of every effect in the order it happened. This file: the relaunch and what it reads back.
 */
import { describe, expect, it } from "vitest";

import { reseatWorkspace } from "../../../../../../cli/commands/cmux/reseatPass.js";
import type { CmuxClient } from "../../../../../../cmux/client.js";
import { CmuxErrors } from "../../../../../../cmux/errors.js";
import { err, ok } from "../../../../../../lib/result.js";
import type { TtyProcessRow } from "../../../../../../live/standing/processes.js";
import { LOGGED_OUT, NO_COMPOSER_GRID, ROUTED, SEAT_ID, SHELL, SHELL_RUNNING_VIM, workspace } from "./fixtures.js";
import { world } from "./harness.js";

describe("reseatWorkspace", () => {
  // MEASURED: a seat that never took a prompt has no transcript, and `--resume` on it exits to zsh.
  it("relaunches a session with no transcript FRESH and reports it fresh-seated, never reseated", async () => {
    const journal: string[] = [];
    const { client, deps } = world({ journal, screens: new Map([["ws-seat", LOGGED_OUT]]) });

    const outcome = await reseatWorkspace({
      deps: { ...deps, client, transcriptExists: () => false },
      wall: { kind: "logged-out" },
      workspace: workspace({ id: "ws-seat", ref: "workspace:4" }),
    });

    expect(journal.at(-1)).toBe(`send ws-seat: ${ROUTED} claude --plugin-dir /wt/ws-seat --model opus --effort high`);
    expect(outcome).toEqual(
      expect.objectContaining({ freshSessionId: SEAT_ID, kind: "fresh-seated", why: "no-transcript" }),
    );
  });

  it("retries ONCE fresh when the resume prints No conversation found, never journalling reseated", async () => {
    const journal: string[] = [];
    const { client, deps } = world({ journal, screens: new Map([["ws-seat", LOGGED_OUT]]) });
    const sends = (): number => journal.filter((line) => line.startsWith("send ")).length;
    // After the failed resume the tab is a bare shell under the missing-conversation line; the fresh one then runs.
    const failing: CmuxClient = {
      ...client,
      readScreen: () =>
        Promise.resolve(ok(sends() === 0 ? LOGGED_OUT : `No conversation found with session ID: ${SEAT_ID}\n$ `)),
      readScreenGrid: (options) =>
        sends() === 1 ? Promise.resolve(ok(NO_COMPOSER_GRID)) : client.readScreenGrid(options),
      workspaceTop: (options) =>
        sends() === 1
          ? Promise.resolve(ok({ surfaces: 1, trees: SHELL, ttys: [], unattributedTtyPids: [] }))
          : client.workspaceTop(options),
    };

    const outcome = await reseatWorkspace({
      deps: { ...deps, client: failing },
      wall: { kind: "logged-out" },
      workspace: workspace({ id: "ws-seat", ref: "workspace:4" }),
    });

    expect(journal).toEqual([
      "route ws-seat",
      "boot-slot",
      "stop 393",
      `send ws-seat: ${ROUTED} claude --plugin-dir /wt/ws-seat --model opus --effort high --resume ${SEAT_ID}`,
      `send ws-seat: ${ROUTED} claude --plugin-dir /wt/ws-seat --model opus --effort high`,
    ]);
    expect(outcome).toEqual(expect.objectContaining({ kind: "fresh-seated", why: "missing-conversation" }));
  });

  // An unread baseline counted as zero lines made an old exit in scrollback this launch's own failure.
  it("never reads an old exit as this resume's failure when the screen would not read before the line was typed", async () => {
    const journal: string[] = [];
    const { client, deps } = world({ journal, screens: new Map([["ws-seat", LOGGED_OUT]]) });
    const sends = (): number => journal.filter((line) => line.startsWith("send ")).length;
    const stopped = (): boolean => journal.includes("stop 393");
    const unreadBaseline: CmuxClient = {
      ...client,
      readScreen: () => {
        if (!stopped()) {
          return Promise.resolve(ok(LOGGED_OUT));
        }
        if (sends() === 0) {
          return Promise.resolve(err(CmuxErrors.malformedReply({ detail: "gone", method: "surface.read_text" })));
        }
        return Promise.resolve(ok("No conversation found with session ID: an-older-one\n$ "));
      },
    };

    const outcome = await reseatWorkspace({
      deps: { ...deps, client: unreadBaseline },
      wall: { kind: "logged-out" },
      workspace: workspace({ id: "ws-seat", ref: "workspace:4" }),
    });

    expect(journal.filter((line) => line.startsWith("send "))).toEqual([
      `send ws-seat: ${ROUTED} claude --plugin-dir /wt/ws-seat --model opus --effort high --resume ${SEAT_ID}`,
    ]);
    expect(outcome.kind).toBe("reseated");
  });

  // A column-0 quote drawn before Claude's chrome reads as an exit on the text while the grid holds Claude.
  it("never retries fresh on a quote the text reads as an exit while the grid shows Claude's composer", async () => {
    const journal: string[] = [];
    const { client, deps } = world({ journal, screens: new Map([["ws-seat", LOGGED_OUT]]) });
    const sends = (): number => journal.filter((line) => line.startsWith("send ")).length;
    const quoting: CmuxClient = {
      ...client,
      readScreen: () =>
        Promise.resolve(ok(sends() === 0 ? LOGGED_OUT : `No conversation found with session ID: quoted\n⏺ Restoring`)),
    };

    const outcome = await reseatWorkspace({
      deps: { ...deps, client: quoting },
      wall: { kind: "logged-out" },
      workspace: workspace({ id: "ws-seat", ref: "workspace:4" }),
    });

    expect(journal.filter((line) => line.startsWith("send "))).toEqual([
      `send ws-seat: ${ROUTED} claude --plugin-dir /wt/ws-seat --model opus --effort high --resume ${SEAT_ID}`,
    ]);
    expect(outcome.kind).toBe("reseated");
  });

  // The false positive: a live record carrying the id, and a surface with no composer on it.
  it("refuses UNCONFIRMED when the session registers but no composer ever stands on the surface", async () => {
    const journal: string[] = [];
    const { client, deps } = world({ journal, screens: new Map([["ws-seat", LOGGED_OUT]]) });
    const noComposer: CmuxClient = { ...client, readScreenGrid: () => Promise.resolve(ok(NO_COMPOSER_GRID)) };

    const outcome = await reseatWorkspace({
      deps: { ...deps, client: noComposer },
      wall: { kind: "logged-out" },
      workspace: workspace({ id: "ws-seat", ref: "workspace:4" }),
    });

    expect(outcome).toEqual(
      expect.objectContaining({ error: expect.objectContaining({ code: "UNCONFIRMED" }), kind: "refused" }),
    );
  });

  it("types NOTHING when the old claude outlives its stop", async () => {
    const journal: string[] = [];
    const { client, deps } = world({ journal, screens: new Map([["ws-seat", LOGGED_OUT]]), stops: false });

    const outcome = await reseatWorkspace({
      deps: { ...deps, client },
      wall: { kind: "logged-out" },
      workspace: workspace({ id: "ws-seat", ref: "workspace:4" }),
    });

    expect(journal).toEqual(["route ws-seat", "boot-slot", "stop 393"]);
    expect(outcome).toEqual(
      expect.objectContaining({ error: expect.objectContaining({ code: "KILL_TIMEOUT" }), kind: "refused" }),
    );
  });

  // The live arm typed the moment the stop returned, so a program left beside the stopped
  // `claude` would have taken the resume line as keystrokes — the tab is read again, and only a bare shell is typed into.
  it("types NOTHING when the stop leaves something other than a bare shell in the tab", async () => {
    const journal: string[] = [];
    const { client, deps } = world({
      afterStop: SHELL_RUNNING_VIM,
      journal,
      screens: new Map([["ws-seat", LOGGED_OUT]]),
    });

    const outcome = await reseatWorkspace({
      deps: { ...deps, client },
      wall: { kind: "logged-out" },
      workspace: workspace({ id: "ws-seat", ref: "workspace:4" }),
    });

    expect(journal).toEqual(["route ws-seat", "boot-slot", "stop 393"]);
    expect(outcome).toEqual({
      error: {
        code: "NOT_AT_PROMPT",
        message:
          "claude (pid 393) stopped, and workspace:4 did not come back to a bare shell (not-a-bare-shell), so nothing was typed into it — read the screen; once it shows a prompt, run `slopweaver cmux reseat workspace:4` again",
        pid: 393,
      },
      kind: "refused",
      workspaceRef: "workspace:4",
    });
  });

  // Cmux's tree showed the shell childless while `ps` already held a `vim` under it.
  it("types NOTHING when the table shows a program under the shell that cmux's tree omitted", async () => {
    const journal: string[] = [];
    const { client, deps } = world({ journal, screens: new Map([["ws-seat", LOGGED_OUT]]) });
    const psSeesVim: readonly TtyProcessRow[] = [
      { argv: "/Applications/cmux.app/Contents/MacOS/cmux", pid: 100, ppid: 0, state: "S", tty: "??" },
      { argv: "-/bin/zsh", pid: 1, ppid: 100, state: "S", tty: "ttys001" },
      { argv: "vim notes.md", pid: 7, ppid: 1, state: "S", tty: "ttys001" },
    ];

    const outcome = await reseatWorkspace({
      deps: { ...deps, client, readProcessRows: () => ok(psSeesVim) },
      wall: { kind: "logged-out" },
      workspace: workspace({ id: "ws-seat", ref: "workspace:4" }),
    });

    expect(journal).toEqual(["route ws-seat", "boot-slot", "stop 393"]);
    expect(outcome).toEqual({
      error: { code: "NOT_AT_PROMPT", message: expect.stringContaining("(not-a-bare-shell)"), pid: 393 },
      kind: "refused",
      workspaceRef: "workspace:4",
    });
  });

  it("types NOTHING when the stop leaves an empty tab, or the table behind the tab cannot be read", async () => {
    const emptyJournal: string[] = [];
    const empty = world({ afterStop: [], journal: emptyJournal, screens: new Map([["ws-seat", LOGGED_OUT]]) });
    const unreadJournal: string[] = [];
    const unread = world({ journal: unreadJournal, screens: new Map([["ws-seat", LOGGED_OUT]]) });

    const emptyOutcome = await reseatWorkspace({
      deps: { ...empty.deps, client: empty.client },
      wall: { kind: "logged-out" },
      workspace: workspace({ id: "ws-seat", ref: "workspace:4" }),
    });
    const unreadOutcome = await reseatWorkspace({
      deps: { ...unread.deps, client: unread.client, readProcessRows: () => err("ps: timed out") },
      wall: { kind: "logged-out" },
      workspace: workspace({ id: "ws-seat", ref: "workspace:4" }),
    });

    expect([emptyJournal, unreadJournal]).toEqual([
      ["route ws-seat", "boot-slot", "stop 393"],
      ["route ws-seat", "boot-slot", "stop 393"],
    ]);
    expect([emptyOutcome, unreadOutcome]).toEqual([
      {
        error: { code: "NOT_AT_PROMPT", message: expect.stringContaining("(no-process)"), pid: 393 },
        kind: "refused",
        workspaceRef: "workspace:4",
      },
      {
        error: {
          code: "CMUX_READ_FAILED",
          message:
            "cmux could not read the process table behind workspace:4's processes: ps: timed out — nothing was typed; run the same command again once cmux and ps answer, and read the tab's screen if it keeps failing",
        },
        kind: "refused",
        workspaceRef: "workspace:4",
      },
    ]);
  });

  it("answers Claude Code's resume-in-full prompt with 2, the owner's standing answer", async () => {
    const journal: string[] = [];
    const { client, deps } = world({
      journal,
      screens: new Map([["ws-seat", LOGGED_OUT]]),
    });
    const sends = (): number => journal.filter((line) => line.startsWith("send ")).length;
    const menu: CmuxClient = {
      ...client,
      readScreen: () =>
        Promise.resolve(ok(sends() === 0 ? LOGGED_OUT : "1. Resume from summary\n2. Resume full session as-is")),
    };

    await reseatWorkspace({
      deps: { ...deps, client: menu },
      wall: { kind: "logged-out" },
      workspace: workspace({ id: "ws-seat", ref: "workspace:4" }),
    });

    expect(journal.at(-1)).toBe("send ws-seat: 2");
  });
});
