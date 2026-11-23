/**
 * `cmux reseat` on a running seat cmux attributes NO process to. MEASURED: `cmux reseat` refused two workspaces
 * with `NO_LIVE_SESSION (no-process)` while both ran Claude Code — one's claude had read BUSY earlier and still
 * ran on its tab's `ttys001` afterwards. The tab's own tty ties the session back.
 */
import { describe, expect, it } from "vitest";

import { judgeWorkspaceCold } from "../../../../../../cli/commands/cmux/reseatCold.js";
import { liveSessionOf } from "../../../../../../cli/commands/cmux/reseatLiveSession.js";
import { reseatWorkspace } from "../../../../../../cli/commands/cmux/reseatPass.js";
import type { CmuxClient, CmuxProcess } from "../../../../../../cmux/client.js";
import type { CmuxWorkspaceTop } from "../../../../../../cmux/processTree.js";
import { err, ok, unwrap, unwrapErr } from "../../../../../../lib/result.js";
import type { TtyProcessRow } from "../../../../../../live/standing/processes.js";
import type { SessionRecord } from "../../../../../../sessions/liveSessions.js";
import { record, SEAT_ID, SHELL, TABLE, workspace } from "./fixtures.js";
import { world } from "./harness.js";

/** The seat's claude: pid 393 in the fake world, on the tab's tty under its shell (pid 1, `ttys001` in `TABLE`). */
const SEAT_CLAUDE: TtyProcessRow = { argv: "claude", pid: 393, ppid: 1, state: "S+", tty: "ttys001" };
const SEAT: SessionRecord = record({ cwd: "/wt/ws-seat", pid: 393, sessionId: SEAT_ID });
const SEAT_WORKSPACE = workspace({ id: "ws-seat", ref: "workspace:4" });

/** What cmux reported for a running seat's tab: one surface, its tty, and no pid at all. */
const NOTHING_ON = ({ ttys }: { ttys: readonly string[] }): CmuxWorkspaceTop => ({
  surfaces: 1,
  trees: [],
  ttys,
  unattributedTtyPids: [],
});

/**
 * The live world with cmux attributing nothing to the seat's tab: `processTree` empty, `workspaceTop` answering `top`,
 * and the live records and table given.
 *
 * @returns the client and every dep, the journal of effects beside them
 */
function unattributedWorld({
  top,
  liveRecords,
  rows,
}: {
  top: CmuxWorkspaceTop;
  liveRecords: readonly SessionRecord[];
  rows: readonly TtyProcessRow[];
}): { client: CmuxClient; deps: Parameters<typeof reseatWorkspace>[0]["deps"]; journal: string[] } {
  const journal: string[] = [];
  const base = world({ journal, screens: new Map() });
  const client: CmuxClient = {
    ...base.client,
    processTree: () => Promise.resolve(ok([])),
    readResumeBinding: () =>
      Promise.resolve(
        ok({
          argv: `--settings {} --resume ${SEAT_ID}`,
          checkpointId: SEAT_ID,
          cwd: "/wt/ws-seat",
          source: "resume_binding",
        }),
      ),
    workspaceTop: () => Promise.resolve(ok(top)),
  };
  const deps = {
    ...base.deps,
    client,
    readLiveRecords: () => ok(liveRecords),
    readProcessRows: () => ok(rows),
  };
  return { client, deps, journal };
}

describe("reseatWorkspace — a running seat cmux attributes no process to", () => {
  it("plans the live relaunch off the tab's tty, stopping the seat's own pid", async () => {
    const { deps, journal } = unattributedWorld({
      liveRecords: [SEAT],
      rows: [...TABLE, SEAT_CLAUDE],
      top: NOTHING_ON({ ttys: ["ttys001"] }),
    });

    const outcome = await reseatWorkspace({
      deps: { ...deps, dryRun: true },
      wall: undefined,
      workspace: SEAT_WORKSPACE,
    });

    expect(journal).toEqual(["route ws-seat"]);
    expect(outcome).toEqual(
      expect.objectContaining({
        kind: "would-reseat",
        plan: expect.objectContaining({ prior: { kind: "live", pid: 393 }, sessionId: SEAT_ID }),
      }),
    );
  });

  it("stops, relaunches and confirms the seat when cmux still attributes nothing after the line", async () => {
    let stopped = false;
    const after: TtyProcessRow = { ...SEAT_CLAUDE, pid: 1393 };
    const relaunched: SessionRecord = { ...SEAT, pid: 1393 };
    const { client, deps, journal } = unattributedWorld({
      liveRecords: [SEAT],
      rows: [...TABLE, SEAT_CLAUDE],
      top: NOTHING_ON({ ttys: ["ttys001"] }),
    });
    const typed = (): boolean => journal.some((line) => line.startsWith("send "));
    const shellOnly: readonly CmuxProcess[] = SHELL;

    const outcome = await reseatWorkspace({
      deps: {
        ...deps,
        client: {
          ...client,
          // Stopped, the tab is its bare shell; relaunched, cmux attributes nothing to it again.
          workspaceTop: () =>
            Promise.resolve(
              ok(
                stopped && !typed()
                  ? { surfaces: 1, trees: shellOnly, ttys: ["ttys001"], unattributedTtyPids: [] }
                  : NOTHING_ON({ ttys: ["ttys001"] }),
              ),
            ),
        },
        readLiveRecords: () => ok(typed() ? [relaunched] : [SEAT]),
        readProcessRows: () => {
          if (typed()) {
            return ok([...TABLE, after]);
          }
          return ok(stopped ? TABLE : [...TABLE, SEAT_CLAUDE]);
        },
        stop: async (options) => {
          stopped = true;
          return deps.stop(options);
        },
      },
      wall: undefined,
      workspace: SEAT_WORKSPACE,
    });

    expect(journal.map((line) => line.split(": ")[0])).toEqual([
      "route ws-seat",
      "boot-slot",
      "stop 393",
      "send ws-seat",
    ]);
    expect(outcome.kind).toBe("reseated");
  });

  it("refuses two live sessions on the tab's tty as ambiguous, stopping and typing nothing", async () => {
    const second: SessionRecord = { ...SEAT, pid: 394, sessionId: "a0000074-0000-4000-8000-000000000080" };
    const { deps, journal } = unattributedWorld({
      liveRecords: [SEAT, second],
      rows: [...TABLE, SEAT_CLAUDE, { ...SEAT_CLAUDE, pid: 394 }],
      top: NOTHING_ON({ ttys: ["ttys001"] }),
    });

    const outcome = await reseatWorkspace({ deps, wall: undefined, workspace: SEAT_WORKSPACE });

    expect(journal).toEqual([]);
    expect(outcome).toEqual(
      expect.objectContaining({ error: expect.objectContaining({ code: "AMBIGUOUS_SESSION" }), kind: "refused" }),
    );
  });

  it("refuses a table that would not read as a failed read, never as no-process", async () => {
    const { deps, journal } = unattributedWorld({
      liveRecords: [SEAT],
      rows: [],
      top: NOTHING_ON({ ttys: ["ttys001"] }),
    });

    const outcome = await reseatWorkspace({
      deps: { ...deps, readProcessRows: () => err("ps exited 1") },
      wall: undefined,
      workspace: SEAT_WORKSPACE,
    });

    expect(journal).toEqual([]);
    expect(outcome).toEqual(
      expect.objectContaining({ error: expect.objectContaining({ code: "CMUX_READ_FAILED" }), kind: "refused" }),
    );
  });

  it("still refuses no-process when cmux sends no tty, as an older cmux does", async () => {
    const { deps, journal } = unattributedWorld({
      liveRecords: [SEAT],
      rows: [...TABLE, SEAT_CLAUDE],
      top: NOTHING_ON({ ttys: [] }),
    });

    const outcome = await reseatWorkspace({ deps, wall: undefined, workspace: SEAT_WORKSPACE });

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

describe("liveSessionOf — the session a reseat would stop", () => {
  it("names the tab's tty's live session, and returns the attributed refusal when the tab sends more than one tty", async () => {
    const tied = unattributedWorld({
      liveRecords: [SEAT],
      rows: [...TABLE, SEAT_CLAUDE],
      top: NOTHING_ON({ ttys: ["ttys001"] }),
    });
    const twoTtys = unattributedWorld({
      liveRecords: [SEAT],
      rows: [...TABLE, SEAT_CLAUDE],
      top: NOTHING_ON({ ttys: ["ttys001", "ttys002"] }),
    });

    const named = await liveSessionOf({ deps: tied.deps, workspace: SEAT_WORKSPACE });
    const refused = await liveSessionOf({ deps: twoTtys.deps, workspace: SEAT_WORKSPACE });

    expect(unwrap(named)).toEqual(SEAT);
    expect(unwrapErr(refused).code).toBe("NO_LIVE_SESSION");
  });

  it("answers a tab cmux reports a pid for with main's own refusal, even when a later read races to empty", async () => {
    const { client, deps } = unattributedWorld({
      liveRecords: [SEAT],
      rows: [...TABLE, SEAT_CLAUDE],
      top: NOTHING_ON({ ttys: ["ttys001"] }),
    });

    const outcomes = await Promise.all(
      [() => ok([SEAT]), () => err("ps exited 1")].map((readLiveRecords) =>
        liveSessionOf({
          deps: { ...deps, client: { ...client, processTree: () => Promise.resolve(ok(SHELL)) }, readLiveRecords },
          workspace: SEAT_WORKSPACE,
        }),
      ),
    );

    expect(outcomes.map((outcome) => unwrapErr(outcome).code)).toEqual(["NO_LIVE_SESSION", "NO_LIVE_SESSION"]);
  });

  it("names nothing when the session the tty tied is no longer live once the table has been read", async () => {
    let reads = 0;
    const { deps } = unattributedWorld({
      liveRecords: [SEAT],
      rows: [...TABLE, SEAT_CLAUDE],
      top: NOTHING_ON({ ttys: ["ttys001"] }),
    });

    // Live before the table, gone after it: the pid the table put on the tty may now be another process.
    const outcome = await liveSessionOf({
      deps: {
        ...deps,
        readLiveRecords: () => {
          reads += 1;
          return ok(reads === 1 ? [SEAT] : []);
        },
      },
      workspace: SEAT_WORKSPACE,
    });

    expect(reads).toBe(2);
    expect(unwrapErr(outcome).code).toBe("NO_LIVE_SESSION");
  });

  it("names nothing when the pid the tty tied now runs the same session from a new start", async () => {
    let reads = 0;
    const { deps } = unattributedWorld({
      liveRecords: [SEAT],
      rows: [...TABLE, SEAT_CLAUDE],
      top: NOTHING_ON({ ttys: ["ttys001"] }),
    });
    const reborn: SessionRecord = { ...SEAT, procStart: "Wed Nov  4 17:00:00 2026" };

    const outcome = await liveSessionOf({
      deps: {
        ...deps,
        readLiveRecords: () => {
          reads += 1;
          return ok(reads === 1 ? [SEAT] : [reborn]);
        },
      },
      workspace: SEAT_WORKSPACE,
    });

    expect(unwrapErr(outcome).code).toBe("NO_LIVE_SESSION");
  });
});

describe("judgeWorkspaceCold — the never-type read of a tab cmux attributes nothing to", () => {
  it("reads a live session on the tab's tty as live, and a tab whose tty holds none as the empty tree", async () => {
    const live = unattributedWorld({
      liveRecords: [SEAT],
      rows: [...TABLE, SEAT_CLAUDE],
      top: NOTHING_ON({ ttys: ["ttys001"] }),
    });
    const elsewhere = unattributedWorld({
      liveRecords: [SEAT],
      rows: [...TABLE, { ...SEAT_CLAUDE, tty: "ttys009" }],
      top: NOTHING_ON({ ttys: ["ttys001"] }),
    });

    let reads = 0;
    // Live before the table, reborn after it: the tie off the table no longer names the process it read.
    const reborn = {
      deps: {
        ...live.deps,
        readLiveRecords: () => {
          reads += 1;
          return ok(reads === 1 ? [SEAT] : [{ ...SEAT, startedAtMs: SEAT.startedAtMs + 1 }]);
        },
      },
    };

    const verdicts = await Promise.all(
      [live, elsewhere, reborn].map(async ({ deps }) =>
        unwrap(await judgeWorkspaceCold({ deps, pinnedSessionId: undefined, workspace: SEAT_WORKSPACE })),
      ),
    );

    expect(verdicts).toEqual([
      { kind: "not-cold", why: "live-session" },
      { kind: "not-cold", why: "no-process" },
      { kind: "not-cold", why: "no-process" },
    ]);
  });
});
