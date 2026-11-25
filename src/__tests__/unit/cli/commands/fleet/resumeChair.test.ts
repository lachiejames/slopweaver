/**
 * The supervisor's half of a recovery pass, over a plain fake cmux client: which workspace is the chair, the
 * refusal when nothing runs in it — recorded, never a stop for the workers — the bounded wait for its reoriented
 * line, and the investigation line that reports its own failure to send.
 */
import { rmSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ReseatDeps } from "../../../../../cli/commands/cmux/reseatPass.js";
import {
  askChairToInvestigate,
  awaitChairReorientation,
  chairWorkspaceOf,
  resumeChair,
} from "../../../../../cli/commands/fleet/resumeChair.js";
import { chairHostsPin, pinHostedHere } from "../../../../../cli/commands/fleet/resumeChairStanding.js";
import type { CmuxProcess } from "../../../../../cmux/client.js";
import { CmuxErrors } from "../../../../../cmux/errors.js";
import type { FleetPort } from "../../../../../fleet/port.js";
import { err, ok, unwrap } from "../../../../../lib/result.js";
import { parseProcessRowsWhole } from "../../../../../live/standing/processes.js";
import type { SessionRecord } from "../../../../../sessions/liveSessions.js";
import type { ReseatWall } from "../../../../../sessions/reseat.js";
import { ReseatErrors } from "../../../../../sessions/reseatErrors.js";
import type { ClaudeCmuxSupervisorPin } from "../../../../../sessions/supervisorPin.js";
import { memoryFleetPort } from "../../../../fleetStoreFixture.js";
import { fakeClient, fakeDeps, makeHome, memoryReseatLock, passState, workspace } from "./fleetKit.js";

/** A session id no live process on any machine carries. */
const UNUSED_SESSION = "00000000-0000-4000-8000-00000000dead";

const PIN: ClaudeCmuxSupervisorPin = {
  session: { host: "claude-code", id: UNUSED_SESSION },
  pinnedAtIso: "2026-10-04T05:00:00.000Z",
  workspaceId: "chair-id",
  workspaceRef: "workspace:chair-id",
};

let home = "";
/** The one in-memory fleet store of the running test: the pass journals into it and the test reads it back. */
let fleet: FleetPort = memoryFleetPort();

beforeEach(() => {
  home = makeHome();
  fleet = memoryFleetPort();
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** Run `resumeChair` over the listed workspaces with no loops, and no walls unless named. */
async function resumeOver({
  workspaces,
  client = fakeClient({}),
  deps = fakeDeps({ client, ownWorkspaceId: undefined }),
  walls = new Map(),
}: {
  workspaces: readonly ReturnType<typeof workspace>[];
  client?: ReturnType<typeof fakeClient>;
  deps?: ReseatDeps;
  walls?: ReadonlyMap<string, ReseatWall>;
}): Promise<{ half: Awaited<ReturnType<typeof resumeChair>>; state: ReturnType<typeof passState> }> {
  const state = passState({ fleet, home });
  const half = await resumeChair({
    accounts: [],
    client,
    deps,
    loops: new Map(),
    pin: PIN,
    signedOut: new Map(),
    state,
    walls,
    workspaces,
  });
  return { half, state };
}

describe("resumeChair", () => {
  it("records NO_LIVE_SESSION when no workspace is the supervisor's, leaving no chair to wait on", async () => {
    const { half, state } = await resumeOver({ workspaces: [workspace({ id: "other" })] });
    expect(half).toStrictEqual({ standing: undefined, workspace: undefined });
    expect(state.refusals).toEqual([
      {
        code: "NO_LIVE_SESSION",
        message: "no cmux workspace is the supervisor's — neither the pinned id nor a pinned supervisor tab",
        workspaceRef: "supervisor",
      },
    ]);
    expect(state.deferred).toBe(false);
    expect(unwrap(await fleet.readResumeJournal({ home })).events).toMatchObject([
      { kind: "seat", phase: "refused", role: "supervisor", sessionId: UNUSED_SESSION, workspaceRef: "supervisor" },
    ]);
  });

  it("finds the chair by the pinned id and refuses when no live session runs in it", async () => {
    const { half, state } = await resumeOver({
      workspaces: [workspace({ id: "other" }), workspace({ id: "chair-id" })],
    });
    expect([half.workspace!.workspaceId, half.standing]).toStrictEqual(["chair-id", undefined]);
    // The chair's refusal names WHY its tab was not a bare shell and the way back — never the worker's `session re-seat`,
    // which excludes the chair (that fallback left a refused chair with no next move).
    const expected = ReseatErrors.noLiveSession({
      notCold: {
        chair: true,
        why: "cmux could not read workspace:chair-id's process tree: cmux fake failed (not_found): not scripted by this test — nothing was typed; run the same command again once cmux and ps answer, and read the tab's screen if it keeps failing",
      },
      workspaceRef: "workspace:chair-id",
    });
    expect(state.refusals).toEqual([
      { code: "NO_LIVE_SESSION", message: expected.message, workspaceRef: "workspace:chair-id" },
    ]);
    expect(expected.message).toContain(
      "run `slopweaver fleet resume` again or `slopweaver cmux reseat workspace:chair-id`",
    );
  });

  it("falls back to cmux's own pinned supervisor tab when the pinned id is not listed", async () => {
    const tab = { ...workspace({ id: "renumbered", pinned: true }), title: "/slopweaver:supervisor" };
    const { half, state } = await resumeOver({ workspaces: [workspace({ id: "other" }), tab] });
    expect([half.workspace!.workspaceId, half.standing]).toStrictEqual(["renumbered", undefined]);
    expect(state.refusals.map((refusal) => [refusal.code, refusal.workspaceRef])).toEqual([
      ["NO_LIVE_SESSION", "workspace:renumbered"],
    ]);
  });
});

describe("chairWorkspaceOf", () => {
  it("still finds cmux's pinned supervisor tab with no pin recorded, so it is never taken for a worker", () => {
    const tab = { ...workspace({ id: "renumbered", pinned: true }), title: "/slopweaver:supervisor" };
    expect(chairWorkspaceOf({ pin: undefined, workspaces: [workspace({ id: "other" }), tab] })!.workspaceId).toBe(
      "renumbered",
    );
  });

  it("finds no chair with no pin and no pinned supervisor tab", () => {
    expect(chairWorkspaceOf({ pin: undefined, workspaces: [workspace({ id: "other" })] })).toBe(undefined);
  });
});

describe("chairHostsPin", () => {
  /** Ask whether the chair hosts the pin, over one tab's tree and the live seats. */
  async function hosts({
    tree,
    live,
  }: {
    tree: readonly CmuxProcess[] | undefined;
    live: readonly SessionRecord[];
  }): Promise<{ hosted: boolean; codes: readonly string[]; sent: readonly string[] }> {
    const sent: string[] = [];
    const client = fakeClient({ sent, trees: tree === undefined ? {} : { "chair-id": tree } });
    const deps = fakeDeps({ client, liveRecords: () => live, ownWorkspaceId: undefined });
    const state = passState({ fleet, home });
    const hosted = await chairHostsPin({
      chair: workspace({ id: "chair-id" }),
      client,
      deps,
      sessionId: UNUSED_SESSION,
      state,
    });
    return { codes: state.refusals.map((refusal) => refusal.code), hosted, sent };
  }

  it("stands the chair where the pin's own pid runs in its tab", async () => {
    const tree = [{ children: [{ children: [], name: "claude", pid: 4242 }], name: "zsh", pid: 1 }];
    expect(await hosts({ live: [liveRecord({ pid: 4242 })], tree })).toEqual({ codes: [], hosted: true, sent: [] });
  });

  it("refuses NO_LIVE_SESSION, typing nothing, when the pin runs only in another tab — a relaunch confirmed elsewhere included", async () => {
    const bare = [{ children: [], name: "zsh", pid: 1 }];
    expect(await hosts({ live: [liveRecord({ pid: 4242 })], tree: bare })).toEqual({
      codes: ["NO_LIVE_SESSION"],
      hosted: false,
      sent: [],
    });
  });

  // cmux pools every surface's pids, so the pin on a hidden pane must not stand a chair
  // whose nudge lands in the selected one.
  it("refuses CMUX_READ_FAILED on a split tab, even with the pin's pid among its processes", async () => {
    const sent: string[] = [];
    const tree = [{ children: [{ children: [], name: "claude", pid: 4242 }], name: "zsh", pid: 1 }];
    const base = fakeClient({ sent, trees: { "chair-id": tree } });
    const client: ReturnType<typeof fakeClient> = {
      ...base,
      workspaceTop: () => Promise.resolve(ok({ surfaces: 2, trees: tree, ttys: [], unattributedTtyPids: [] })),
    };
    const state = passState({ fleet, home });

    const hosted = await chairHostsPin({
      chair: workspace({ id: "chair-id" }),
      client,
      deps: fakeDeps({ client, liveRecords: () => [liveRecord({ pid: 4242 })], ownWorkspaceId: undefined }),
      sessionId: UNUSED_SESSION,
      state,
    });

    expect(hosted).toBe(false);
    expect(state.refusals.map((refusal) => refusal.code)).toEqual(["CMUX_READ_FAILED"]);
    expect(sent).toEqual([]);
  });

  // A pin cmux reported itself needs no table, so a failed `ps` cannot refuse it.
  it("stands the chair where cmux reports the pin's own pid, even when the process table will not read", async () => {
    const sent: string[] = [];
    const tree = [{ children: [{ children: [], name: "claude", pid: 4242 }], name: "zsh", pid: 1 }];
    const client = fakeClient({ sent, trees: { "chair-id": tree } });
    const deps = fakeDeps({ client, liveRecords: () => [liveRecord({ pid: 4242 })], ownWorkspaceId: undefined });
    const state = passState({ fleet, home });

    const hosted = await chairHostsPin({
      chair: workspace({ id: "chair-id" }),
      client,
      deps: { ...deps, readProcessRows: () => err("ps: timed out") },
      sessionId: UNUSED_SESSION,
      state,
    });

    expect([hosted, state.refusals, sent]).toEqual([true, [], []]);
  });

  // The pin the table put on the chair's tty exits after the table is read, while the
  // same session runs on in another tab; only the record the table matched here may stand the chair.
  it("refuses NO_LIVE_SESSION when the pin the tty tied is gone after the table, though it runs on elsewhere", async () => {
    const sent: string[] = [];
    const here = liveRecord({ pid: 4242 });
    const elsewhere = liveRecord({ pid: 5151 });
    const base = fakeClient({ sent, trees: { "chair-id": [] } });
    const client: ReturnType<typeof fakeClient> = {
      ...base,
      workspaceTop: () => Promise.resolve(ok({ surfaces: 1, trees: [], ttys: ["ttys004"], unattributedTtyPids: [] })),
    };
    let reads = 0;
    const deps = fakeDeps({
      client,
      liveRecords: () => {
        reads += 1;
        return reads === 1 ? [here, elsewhere] : [elsewhere];
      },
      ownWorkspaceId: undefined,
    });
    const table = [" 4242   902 ttys004  S+   claude --resume x", " 5151   903 ttys009  S+   claude --resume x"].join(
      "\n",
    );
    const state = passState({ fleet, home });

    const hosted = await chairHostsPin({
      chair: workspace({ id: "chair-id" }),
      client,
      deps: {
        ...deps,
        readProcessRows: () => parseProcessRowsWhole({ text: table }).mapErr((problem) => problem.message),
      },
      sessionId: UNUSED_SESSION,
      state,
    });

    expect([hosted, state.refusals.map((refusal) => refusal.code), sent]).toEqual([false, ["NO_LIVE_SESSION"], []]);
  });

  it("refuses CMUX_READ_FAILED when the chair's tree cannot be read, never assuming it stands", async () => {
    expect(await hosts({ live: [liveRecord({ pid: 4242 })], tree: undefined })).toEqual({
      codes: ["CMUX_READ_FAILED"],
      hosted: false,
      sent: [],
    });
  });
});

describe("pinHostedHere", () => {
  /** Whether the pin, live at `pid`, is hosted by a tab cmux reported as `trees`, `ttyPids` and `ttys`, over `table`. */
  const hostedAt = ({
    pid,
    trees,
    ttyPids = [],
    ttys = [],
    table = "",
  }: {
    pid: number;
    trees: readonly CmuxProcess[];
    ttyPids?: readonly number[];
    ttys?: readonly string[];
    table?: string;
  }): boolean =>
    pinHostedHere({
      liveRecords: [liveRecord({ pid })],
      report: { surfaces: 1, trees, ttys, unattributedTtyPids: ttyPids },
      rows: unwrap(parseProcessRowsWhole({ text: table })),
      sessionId: UNUSED_SESSION,
    });

  it("is true only where the pinned session's own process runs, however deep in the tree", () => {
    const shellRunningPin = [{ children: [{ children: [], name: "claude", pid: 4242 }], name: "zsh", pid: 10 }];
    expect(hostedAt({ pid: 4242, trees: shellRunningPin })).toBe(true);
  });

  // MEASURED: cmux 0.65.2 attributed nothing to the working chair's tab and listed its
  // `login` and shell as tty pids, so the attributed tree alone refused the chair `NO_LIVE_SESSION`.
  it("is true when cmux attributes nothing and the table puts the pin under the tab's listed shell", () => {
    const table = [
      "  900     1 ??       Ss   /Applications/cmux.app/Contents/MacOS/cmux",
      "  901   900 ttys004  Ss   login -pfl ada /bin/bash -c exec -la zsh /bin/zsh",
      "  902   901 ttys004  S    -/bin/zsh",
      " 4242   902 ttys004  S+   claude --resume x",
    ].join("\n");
    expect(hostedAt({ pid: 4242, table, trees: [], ttyPids: [901, 902] })).toBe(true);
  });

  // MEASURED: cmux reported neither a tree nor a tty pid for two running seats' tabs; the pty
  // each surface names is the tie left.
  it("is true when cmux reports no pid at all and the table puts the pin on the tab's own tty, false on another", () => {
    const table = " 4242   902 ttys004  S+   claude --resume x";
    expect([
      hostedAt({ pid: 4242, table, trees: [], ttys: ["ttys004"] }),
      hostedAt({ pid: 4242, table, trees: [], ttys: ["ttys005"] }),
    ]).toEqual([true, false]);
  });

  it("is false for a bare shell, an empty tab, and a tab running a different session", () => {
    const bareShell = [{ children: [], name: "zsh", pid: 10 }];
    const otherSession = [{ children: [{ children: [], name: "claude", pid: 5151 }], name: "zsh", pid: 10 }];
    expect([
      hostedAt({ pid: 4242, trees: bareShell }),
      hostedAt({ pid: 4242, trees: [] }),
      hostedAt({ pid: 4242, trees: otherSession }),
    ]).toEqual([false, false, false]);
  });
});

describe("awaitChairReorientation", () => {
  it("waits for nothing and refuses nothing when the chair was already caught up", async () => {
    const state = passState({ fleet, home });
    await awaitChairReorientation({
      chair: workspace({ id: "chair-id" }),
      client: fakeClient({}),
      reorientSeconds: 0,
      standing: { caughtUp: true, loop: undefined, sessionId: UNUSED_SESSION },
      state,
    });
    expect([state.deferred, state.refusals, state.lines]).toStrictEqual([false, [], []]);
  });

  it("ends the attempt NOT YET when the chair does not answer within its bound", async () => {
    const state = passState({ fleet, home });
    await awaitChairReorientation({
      chair: workspace({ id: "chair-id" }),
      client: fakeClient({}),
      reorientSeconds: 0,
      standing: { caughtUp: false, loop: undefined, sessionId: UNUSED_SESSION },
      state,
    });
    expect(state.deferred).toBe(true);
    expect(state.refusals).toStrictEqual([
      {
        code: "CHAIR_REORIENTATION_TIMEOUT",
        message: "the supervisor did not run `supervisor reoriented --attempt att-1` within 0s",
        workspaceRef: "workspace:chair-id",
      },
    ]);
  });
});

describe("resumeChair on a cold tab", () => {
  const LOGGED_OUT = "│ > │\n  Not logged in · Please run /login";

  it("types the PIN's routed resume line into the chair's bare shell, first and with nothing stopped", async () => {
    const sent: string[] = [];
    const base = fakeClient({ composerAfterSend: true, screens: { "chair-id": LOGGED_OUT }, sent });
    // A bare shell until the line is typed, then the relaunched pin under it — signed out, its composer still drawn.
    const tree = (): readonly CmuxProcess[] => [
      { children: sent.length === 0 ? [] : [{ children: [], name: "claude", pid: 4242 }], name: "zsh", pid: 1 },
    ];
    const client: ReturnType<typeof fakeClient> = {
      ...base,
      processTree: () => Promise.resolve(ok(tree())),
      workspaceTop: () => Promise.resolve(ok({ surfaces: 1, trees: tree(), ttys: [], unattributedTtyPids: [] })),
    };
    const pinOnceTyped = (): readonly SessionRecord[] => (sent.length === 0 ? [] : [liveRecord({ pid: 4242 })]);
    const deps = fakeDeps({ client, liveRecords: pinOnceTyped, ownWorkspaceId: undefined, registry: pinOnceTyped });

    const { half, state } = await resumeOver({ client, deps, workspaces: [workspace({ id: "chair-id" })] });

    expect(half.standing).toBe(undefined);
    const excludes = String.raw`"{\"claudeMdExcludes\":[\"$PWD/.claude/rules/typescript-patterns.md\",\"$PWD/.claude/rules/testing.md\",\"$PWD/.claude/rules/error-handling.md\"]}"`;
    expect(sent).toEqual([`chair-id: claude --model fable --settings ${excludes} --resume ${UNUSED_SESSION}`]);
    expect(state.refusals.map((refusal) => refusal.code)).toEqual(["SEAT_STILL_WALLED"]);
  });

  it("refuses CMUX_READ_FAILED, never reseated, when no screen reads after the relaunch confirmed", async () => {
    const sent: string[] = [];
    const base = fakeClient({ composerAfterSend: true, screens: { "chair-id": LOGGED_OUT }, sent });
    const tree = (): readonly CmuxProcess[] => [
      { children: sent.length === 0 ? [] : [{ children: [], name: "claude", pid: 4242 }], name: "zsh", pid: 1 },
    ];
    const client: ReturnType<typeof fakeClient> = {
      ...base,
      processTree: () => Promise.resolve(ok(tree())),
      // The tab's text reads until the line is typed, and never again: every wall read after the relaunch fails.
      readScreen: (options) =>
        sent.length === 0
          ? base.readScreen(options)
          : Promise.resolve(
              err(CmuxErrors.terminalTextUnreadable({ detail: "settling", method: "surface.read_text" })),
            ),
      workspaceTop: () => Promise.resolve(ok({ surfaces: 1, trees: tree(), ttys: [], unattributedTtyPids: [] })),
    };
    const pinOnceTyped = (): readonly SessionRecord[] => (sent.length === 0 ? [] : [liveRecord({ pid: 4242 })]);
    const deps = fakeDeps({ client, liveRecords: pinOnceTyped, ownWorkspaceId: undefined, registry: pinOnceTyped });

    const { state } = await resumeOver({ client, deps, workspaces: [workspace({ id: "chair-id" })] });

    expect(sent).toHaveLength(1);
    expect(state.refusals.map((refusal) => refusal.code)).toEqual(["CMUX_READ_FAILED"]);
    expect(state.refusals[0]!.message).toContain("workspace:chair-id's screen after relaunch");
    expect(state.lines.filter((line) => line.includes("reseated"))).toEqual([]);
    const phases = unwrap(await fleet.readResumeJournal({ home })).events.flatMap((event) =>
      event.kind === "seat" ? [event.phase] : [],
    );
    expect(phases).toEqual(["recovering", "refused"]);
  });

  it("holds the chair's reseat lock until its wall re-check has read, releasing it once", async () => {
    const sent: string[] = [];
    const events: string[] = [];
    const base = fakeClient({ composerAfterSend: true, screens: { "chair-id": LOGGED_OUT }, sent });
    const tree = (): readonly CmuxProcess[] => [
      { children: sent.length === 0 ? [] : [{ children: [], name: "claude", pid: 4242 }], name: "zsh", pid: 1 },
    ];
    const client: ReturnType<typeof fakeClient> = {
      ...base,
      processTree: () => Promise.resolve(ok(tree())),
      readScreen: (options) => {
        if (sent.length === 0) {
          return base.readScreen(options);
        }
        events.push("recheck");
        return Promise.resolve(
          err(CmuxErrors.terminalTextUnreadable({ detail: "settling", method: "surface.read_text" })),
        );
      },
      workspaceTop: () => Promise.resolve(ok({ surfaces: 1, trees: tree(), ttys: [], unattributedTtyPids: [] })),
    };
    const pinOnceTyped = (): readonly SessionRecord[] => (sent.length === 0 ? [] : [liveRecord({ pid: 4242 })]);
    const deps = {
      ...fakeDeps({ client, liveRecords: pinOnceTyped, ownWorkspaceId: undefined, registry: pinOnceTyped }),
      acquireReseatLock: memoryReseatLock({ journal: events }),
    };

    await resumeOver({ client, deps, workspaces: [workspace({ id: "chair-id" })] });

    // Sixteen reads after the line: the read-back's one, then the wall re-check's fifteen — all before the release.
    expect([events.at(0), events.at(-1), events.filter((event) => event === "recheck").length]).toEqual([
      "lock chair-id",
      "release chair-id",
      16,
    ]);
  });

  it("types nothing and refuses NO_LIVE_SESSION when the chair's tab runs something that is not a shell", async () => {
    const sent: string[] = [];
    const client = fakeClient({
      sent,
      trees: { "chair-id": [{ children: [{ children: [], name: "vim", pid: 7 }], name: "zsh", pid: 2 }] },
    });

    const { half, state } = await resumeOver({ client, workspaces: [workspace({ id: "chair-id" })] });

    expect(half.standing).toBe(undefined);
    expect(sent).toEqual([]);
    expect(state.refusals.map((refusal) => refusal.code)).toEqual(["NO_LIVE_SESSION"]);
  });

  it("refuses NO_RESUMABLE_SESSION when the pinned session's transcript is gone, typing nothing", async () => {
    const sent: string[] = [];
    const client = fakeClient({ sent, trees: { "chair-id": [{ children: [], name: "zsh", pid: 1 }] } });
    const deps = fakeDeps({ client, ownWorkspaceId: undefined, transcripts: new Set() });

    const { state } = await resumeOver({ client, deps, workspaces: [workspace({ id: "chair-id" })] });

    expect(sent).toEqual([]);
    expect(state.refusals.map((refusal) => refusal.code)).toEqual(["NO_RESUMABLE_SESSION"]);
  });
});

describe("resumeChair on a walled tab", () => {
  /**
   * Relaunch a walled chair whose old session is pid 4242 in its tab; once the line is typed the pin is live at 5151,
   * which the tab's tree holds only when `relaunchedHere`.
   */
  async function relaunchWalledChair({ relaunchedHere }: { relaunchedHere: boolean }): Promise<{
    standing: boolean;
    codes: readonly string[];
    resumeLines: number;
  }> {
    const sent: string[] = [];
    // The tab over time: the old pin under its shell, a bare shell once that is stopped, then the new pin under
    // it once a line is typed — only when `relaunchedHere`.
    let stopped = false;
    const children = (): readonly CmuxProcess[] => {
      if (!stopped) {
        return [{ children: [], name: "claude", pid: 4242 }];
      }
      return relaunchedHere && sent.length > 0 ? [{ children: [], name: "claude", pid: 5151 }] : [];
    };
    const tree = (): readonly CmuxProcess[] => [{ children: children(), name: "zsh", pid: 1 }];
    const client: ReturnType<typeof fakeClient> = {
      ...fakeClient({ composerAfterSend: true, screens: { "chair-id": "⏺ Reading a file\n│ > │" }, sent }),
      // Walled until a line is typed, so the wall the pass picked it for still stands under the reseat lock.
      readScreen: () =>
        Promise.resolve(
          ok(
            sent.length === 0
              ? "⏺ Reading a file\n│ > │\n  Not logged in · Please run /login"
              : "⏺ Reading a file\n│ > │",
          ),
        ),
      processTree: () => Promise.resolve(ok(tree())),
      workspaceTop: () => Promise.resolve(ok({ surfaces: 1, trees: tree(), ttys: [], unattributedTtyPids: [] })),
    };
    const pinNow = (): readonly SessionRecord[] => [liveRecord({ pid: sent.length === 0 ? 4242 : 5151 })];
    const deps: ReseatDeps = {
      ...fakeDeps({ client, liveRecords: pinNow, ownWorkspaceId: undefined, registry: pinNow }),
      readArgv: () => `claude --model fable --resume ${UNUSED_SESSION}`,
      stop: () => {
        stopped = true;
        return Promise.resolve(true);
      },
    };
    const { half, state } = await resumeOver({
      client,
      deps,
      walls: new Map([["chair-id", { kind: "logged-out" }]]),
      workspaces: [workspace({ id: "chair-id" })],
    });
    return {
      codes: state.refusals.map((refusal) => refusal.code),
      resumeLines: sent.filter((line) => line.includes(`--resume ${UNUSED_SESSION}`)).length,
      standing: half.standing !== undefined,
    };
  }

  // The hosting check once refused this; now the read-back itself confirms only inside the tab.
  it("refuses UNCONFIRMED when the relaunched pin runs only outside the chair's tab", async () => {
    expect(await relaunchWalledChair({ relaunchedHere: false })).toEqual({
      codes: ["UNCONFIRMED"],
      resumeLines: 1,
      standing: false,
    });
  });

  it("stands the chair when the relaunched pin runs in its own tab", async () => {
    expect(await relaunchWalledChair({ relaunchedHere: true })).toEqual({ codes: [], resumeLines: 1, standing: true });
  });
});

/** The pinned session's registry record, as the relaunch would write it. */
function liveRecord({ pid }: { pid: number }): SessionRecord {
  return {
    cwd: "/w/chair-id",
    entrypoint: "cli",
    kind: "interactive",
    name: "chair",
    pid,
    sessionId: UNUSED_SESSION,
    startedAtMs: 0,
    status: "idle",
  };
}

describe("askChairToInvestigate", () => {
  it("says on the pass's lines that the investigation line did not send when cmux refused it", async () => {
    const state = passState({ fleet, home });
    await askChairToInvestigate({
      chair: workspace({ id: "chair-id" }),
      client: fakeClient({ sendFails: true }),
      line: "find the cause",
      state,
    });
    expect(state.lines).toEqual(["supervisor\tthe investigation line did not send"]);
    expect(state.refusals).toEqual([]);
  });
});
