/**
 * `cmux reseat`'s pass over a fake client: the order is the design — route, pace, stop, and only then type —
 * so each case reads one journal of every effect in the order it happened. This file: the caller's own tab, dry runs and cold tabs.
 */
import { describe, expect, it } from "vitest";

import { reseatWorkspace } from "../../../../../../cli/commands/cmux/reseatPass.js";
import type { CmuxClient } from "../../../../../../cmux/client.js";
import { err, ok } from "../../../../../../lib/result.js";
import type { TtyProcessRow } from "../../../../../../live/standing/processes.js";
import { honestExecutables, honestTtyHolders } from "../../fleet/fleetKit.js";
import { BARE, CHAIR_ID, LOGGED_OUT, workspace } from "./fixtures.js";
import { coldWorld, world } from "./harness.js";

describe("reseatWorkspace", () => {
  it("touches nothing when the seat's claude is on the caller's own parent chain", async () => {
    const journal: string[] = [];
    const { client, deps } = world({ journal, screens: new Map([["ws-seat", LOGGED_OUT]]) });

    const outcome = await reseatWorkspace({
      deps: { ...deps, callerAncestry: () => ok(new Set([9001, 393, 1])), client, ownWorkspaceId: undefined },
      wall: { kind: "logged-out" },
      workspace: workspace({ id: "ws-seat", ref: "workspace:4" }),
    });

    expect(journal).toEqual([]);
    expect(outcome).toEqual(
      expect.objectContaining({ error: expect.objectContaining({ code: "OWN_WORKSPACE" }), kind: "refused" }),
    );
  });

  it("touches nothing when its own parent chain cannot be read", async () => {
    const journal: string[] = [];
    const { client, deps } = world({ journal, screens: new Map() });

    const outcome = await reseatWorkspace({
      deps: { ...deps, callerAncestry: () => err("ps failed"), client },
      wall: { kind: "logged-out" },
      workspace: workspace({ id: "ws-seat", ref: "workspace:4" }),
    });

    expect(journal).toEqual([]);
    expect(outcome).toEqual(
      expect.objectContaining({ error: expect.objectContaining({ code: "CMUX_READ_FAILED" }), kind: "refused" }),
    );
  });

  it("stops and sends nothing on a dry run", async () => {
    const journal: string[] = [];
    const { client, deps } = world({ journal, screens: new Map() });

    const outcome = await reseatWorkspace({
      deps: { ...deps, client, dryRun: true },
      wall: undefined,
      workspace: workspace({ id: "ws-seat", ref: "workspace:4" }),
    });

    expect(journal).toEqual(["route ws-seat"]);
    expect(outcome.kind).toBe("would-reseat");
  });

  // MEASURED on cmux 0.65.2: `cmux reseat workspace:1000000001` on the loop's reopened bare tab refused
  // `NO_LIVE_SESSION` — the single-tab verb ran the live arm alone, while the cold arm was `fleet resume`'s only. The
  // chair refusal `fleet resume` prints names THIS verb as the way back, so it has to resume a cold tab itself.
  it("resumes a 0.65.2 bare tab's saved session cold when no claude is live in it, the chair's on the pin", async () => {
    const journal: string[] = [];
    const { client, deps } = coldWorld({ journal, trees: [] });
    const unattributed: CmuxClient = {
      ...client,
      workspaceTop: () =>
        Promise.resolve(ok({ surfaces: 1, trees: [], ttys: [], unattributedTtyPids: [60561, 60562] })),
    };
    const table: readonly TtyProcessRow[] = [
      { argv: "/Applications/cmux.app/Contents/MacOS/cmux", pid: 60470, ppid: 1, state: "S", tty: "??" },
      {
        argv: "/usr/bin/login -flp ada /bin/bash --noprofile --norc -c exec -l /bin/zsh",
        pid: 60561,
        ppid: 60470,
        state: "Ss",
        tty: "ttys003",
      },
      { argv: "-/bin/zsh", pid: 60562, ppid: 60561, state: "S", tty: "ttys003" },
    ];
    // cmux 0.65.2 attributes nothing even once the pin runs, so only the table places it under the tab's shell.
    const typed = (): boolean => journal.some((line) => line.startsWith("send "));
    const relaunched: TtyProcessRow = { argv: "claude", pid: 80000, ppid: 60562, state: "S+", tty: "ttys003" };

    const outcome = await reseatWorkspace({
      deps: {
        ...deps,
        chairSessionId: CHAIR_ID,
        client: unattributed,
        readExecutables: ({ pids }) => ok(honestExecutables({ pids, rows: table })),
        readProcessRows: () => ok(typed() ? [...table, relaunched] : table),
        readTtyHolders: ({ tty }) => ok(honestTtyHolders({ rows: table, tty })),
      },
      wall: undefined,
      workspace: workspace({ id: "ws-chair", ref: "workspace:1" }),
    });

    expect(journal.map((line) => line.split(" --resume ")[0])).toEqual([
      "route ws-chair",
      "send ws-chair: CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR=3 CLAUDE_SECURESTORAGE_CONFIG_DIR=/home/unbound/seat " +
        "3</home/plan-one/setup-token claude --plugin-dir /wt/ws-chair --model fable --settings " +
        String.raw`"{\"claudeMdExcludes\":[\"$PWD/.claude/rules/typescript-patterns.md\",\"$PWD/.claude/rules/testing.md\",\"$PWD/.claude/rules/error-handling.md\"]}"`,
    ]);
    expect(journal.at(-1)!.endsWith(` --resume ${CHAIR_ID}`)).toBe(true);
    expect(outcome).toEqual(expect.objectContaining({ kind: "reseated" }));
  });

  it("plans a worker's cold resume on a dry run, typing nothing", async () => {
    const journal: string[] = [];
    const { client, deps } = coldWorld({ journal, trees: [BARE, BARE] });

    const outcome = await reseatWorkspace({
      deps: { ...deps, client, dryRun: true },
      wall: undefined,
      workspace: workspace({ id: "ws-seat", ref: "workspace:4" }),
    });

    expect(journal).toEqual(["route ws-seat"]);
    expect(outcome.kind).toBe("would-reseat");
  });

  it("refuses a tab that is neither live nor a bare shell naming why, the chair's way back `fleet resume` or this verb", async () => {
    const journal: string[] = [];
    const { client, deps } = coldWorld({ journal, trees: [[]] });

    const outcome = await reseatWorkspace({
      deps: { ...deps, chairSessionId: CHAIR_ID, client },
      wall: undefined,
      workspace: workspace({ id: "ws-chair", ref: "workspace:1" }),
    });

    expect(journal).toEqual([]);
    expect(outcome).toEqual({
      error: {
        code: "NO_LIVE_SESSION",
        message:
          "no live Claude session runs in workspace:1, and its tab was not a bare shell to resume the pin into (no-process) — once the tab shows a shell prompt, run `slopweaver fleet resume` again or `slopweaver cmux reseat workspace:1` from another tab; `session re-seat` never seats the chair",
      },
      kind: "refused",
      workspaceRef: "workspace:1",
    });
  });

  it("refuses a worker's tab that is neither live nor a bare shell, `session re-seat` only once no saved session is there", async () => {
    const journal: string[] = [];
    const { client, deps } = coldWorld({ journal, trees: [[]] });

    const outcome = await reseatWorkspace({
      deps: { ...deps, client },
      wall: undefined,
      workspace: workspace({ id: "ws-seat", ref: "workspace:4" }),
    });

    expect(journal).toEqual([]);
    expect(outcome).toEqual({
      error: {
        code: "NO_LIVE_SESSION",
        message:
          "no live Claude session runs in workspace:4, and its tab was not a bare shell holding a saved session to resume (no-process) — once the tab shows a shell prompt, run `slopweaver cmux reseat workspace:4` again; a seat with no saved session is fresh-spawned from its ledger row with `slopweaver session re-seat`",
      },
      kind: "refused",
      workspaceRef: "workspace:4",
    });
  });
});
