/** The recovery pass's two halves, the chair standing and the cold workers, driven through cmux 0.65.2's payload. */
import { rmSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { chairStanding } from "../../../../../../cli/commands/fleet/resumeChairStanding.js";
import { readColdWorkers } from "../../../../../../cli/commands/fleet/resumeCold.js";
import type { CmuxClient } from "../../../../../../cmux/client.js";
import { err, ok, unwrap } from "../../../../../../lib/result.js";
import type { TtyProcessRow } from "../../../../../../live/standing/processes.js";
import type { SessionRecord } from "../../../../../../sessions/liveSessions.js";
import { memoryFleetPort } from "../../../../../fleetStoreFixture.js";
import {
  fakeClient,
  fakeDeps,
  honestExecutables,
  honestProcessGroups,
  honestTtyHolders,
  honestTtyModes,
  makeHome,
  passState,
  workspace,
} from "../fleetKit.js";
import { dispatchRow } from "./harness.js";

let home = "";

beforeEach(() => {
  home = makeHome();
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/**
 * MEASURED on cmux 0.65.2 after the laptop lost power: every tab reopened as a bare shell that cmux
 * attributed to NO tree — `processes: []`, its `login` and shell listed only in `unattributed_tty_process_pids`.
 * `fleet resume` read each as `no-process`, refused the pinned chair `NO_LIVE_SESSION` with a worker-only fallback and
 * reported the loop's tab as having nothing running; the fleet stayed down until the chair was resumed by hand. These
 * drive the pass's two halves — the chair standing, the cold workers — through that exact payload.
 */
describe("the cmux 0.65.2 payload through the pass", () => {
  const CHAIR_SESSION = "7a1c2e4f-1111-4000-8000-000000000001";
  const WORKER_SESSION = "7a1c2e4f-2222-4000-8000-000000000002";
  /** The process table read beside the tree: cmux, then each tab's login shell. */
  const LOGIN_ARGV = "/usr/bin/login -flp ada /bin/bash --noprofile --norc -c exec -l /bin/zsh";
  const TABLE: readonly TtyProcessRow[] = [
    { argv: "/Applications/cmux.app/Contents/MacOS/cmux", pid: 60470, ppid: 1, state: "S", tty: "??" },
    { argv: LOGIN_ARGV, pid: 60561, ppid: 60470, state: "S", tty: "ttys003" },
    { argv: "-/bin/zsh", pid: 60562, ppid: 60561, state: "S", tty: "ttys003" },
    { argv: LOGIN_ARGV, pid: 70561, ppid: 60470, state: "S", tty: "ttys004" },
    { argv: "-/bin/zsh", pid: 70562, ppid: 70561, state: "S", tty: "ttys004" },
  ];
  const chair = workspace({ id: "chair-id" });
  const worker = workspace({ id: "worker" });

  /** The relaunched chair's registry record, under the pid its tab then shows. */
  function chairRecord(): SessionRecord {
    return {
      cwd: "/w/chair-id",
      entrypoint: "cli",
      kind: "interactive",
      name: "s",
      pid: 4242,
      sessionId: CHAIR_SESSION,
      startedAtMs: 0,
      status: "idle",
    };
  }

  /** The fleet as cmux 0.65.2 listed it: two bare tabs, each with a saved session, nothing attributed. */
  function cmuxFleet({ rows = TABLE, sent }: { rows?: readonly TtyProcessRow[]; sent: string[] }): {
    client: CmuxClient;
    deps: ReturnType<typeof fakeDeps>;
  } {
    const base = fakeClient({
      bindings: {
        "chair-id": {
          argv: `--settings {} --resume ${CHAIR_SESSION}`,
          checkpointId: CHAIR_SESSION,
          cwd: "/w/chair-id",
          source: "resume_binding",
        },
        worker: {
          argv: `--model opus --resume ${WORKER_SESSION}`,
          checkpointId: WORKER_SESSION,
          cwd: "/w/worker",
          source: "resume_binding",
        },
      },
      composerAfterSend: true,
      // A screen that reads and shows no wall: the post-relaunch watch needs its last read to have read.
      screens: { "chair-id": "⏺ Reading a file\n│ > │" },
      sent,
      trees: { "chair-id": [], worker: [] },
      ttyPids: { "chair-id": [60561, 60562], worker: [70561, 70562] },
    });
    const typed = (): boolean => sent.length > 0;
    const client: CmuxClient = {
      ...base,
      // Once the resume line is typed, the chair's tab runs the pinned session under its shell.
      processTree: ({ workspaceId }) =>
        Promise.resolve(
          ok(
            typed() && workspaceId === "chair-id"
              ? [{ children: [{ children: [], name: "claude", pid: 4242 }], name: "-/bin/zsh", pid: 60562 }]
              : [],
          ),
        ),
    };
    const deps = {
      ...fakeDeps({
        client,
        liveRecords: () => (typed() ? [chairRecord()] : []),
        ownWorkspaceId: undefined,
        registry: () => (typed() ? [chairRecord()] : []),
      }),
      readExecutables: ({ pids }: { readonly pids: readonly number[] }) => ok(honestExecutables({ pids, rows })),
      readProcessGroups: ({ pids }: { readonly pids: readonly number[] }) => ok(honestProcessGroups({ pids })),
      // cmux 0.65.2 attributes nothing even once the pin runs, so the table is what places it under the chair's shell.
      readProcessRows: () =>
        ok(typed() ? [...rows, { argv: "claude", pid: 4242, ppid: 60562, state: "S+", tty: "ttys003" }] : rows),
      readTtyHolders: ({ tty }: { readonly tty: string }) => ok(honestTtyHolders({ rows, tty })),
      readTtyModes: () => ok(honestTtyModes()),
    };
    return { client, deps };
  }

  it("stands the chair: its bare tab is read cold off the grafted login shell and the pin is typed into it", async () => {
    const sent: string[] = [];
    const { client, deps } = cmuxFleet({ sent });
    const fleet = memoryFleetPort();
    const state = passState({ fleet, home });

    const standing = await chairStanding({
      accounts: [],
      chair,
      client,
      deps,
      sessionId: CHAIR_SESSION,
      signedOut: new Map(),
      state,
      wall: undefined,
    });

    expect(standing).toBe(true);
    expect(state.refusals).toEqual([]);
    expect(sent.length).toBe(1);
    expect(sent[0]!.startsWith("chair-id: ")).toBe(true);
    expect(sent[0]!.endsWith(` --resume ${CHAIR_SESSION}`)).toBe(true);
    expect(
      unwrap(await fleet.readResumeJournal({ home })).events.map((event) => [
        event.kind,
        "phase" in event ? event.phase : "",
      ]),
    ).toEqual([
      ["seat", "recovering"],
      ["seat", "reseated"],
    ]);
  });

  it("reads the worker's bare tab cold for its saved session, naming nothing for the supervisor", async () => {
    const sent: string[] = [];
    const { deps } = cmuxFleet({ sent });
    const state = passState({ fleet: memoryFleetPort(), home });

    const read = await readColdWorkers({
      chairWorkspaceId: "chair-id",
      deps,
      rows: [dispatchRow({ cwd: "/w/worker", workspaceRef: "workspace:worker" })],
      skip: ["chair-id"],
      state,
      walls: new Map(),
      workspaces: [chair, worker],
    });

    expect(read).toEqual({ cold: [{ sessionId: WORKER_SESSION, workspace: worker }], unresumed: [] });
    expect([state.refusals, state.lines, sent]).toEqual([[], [], []]);
  });

  it("refuses the chair naming the process table, typing nothing, when ps cannot be read", async () => {
    const sent: string[] = [];
    const { client, deps } = cmuxFleet({ sent });
    const state = passState({ fleet: memoryFleetPort(), home });

    const standing = await chairStanding({
      accounts: [],
      chair,
      client,
      deps: { ...deps, readProcessRows: () => err("ps: timed out") },
      sessionId: CHAIR_SESSION,
      signedOut: new Map(),
      state,
      wall: undefined,
    });

    expect([standing, sent]).toEqual([false, []]);
    expect(state.refusals.map((refusal) => refusal.code)).toEqual(["NO_LIVE_SESSION"]);
    expect(state.refusals[0]!.message).toContain(
      "cmux could not read the process table behind workspace:chair-id's processes: ps: timed out — nothing was typed; run the same command again once cmux and ps answer, and read the tab's screen if it keeps failing",
    );
    expect(state.refusals[0]!.message).toContain(
      "run `slopweaver fleet resume` again or `slopweaver cmux reseat workspace:chair-id`",
    );
  });

  it("refuses the chair, typing nothing, when the grafted shell is running a program", async () => {
    const sent: string[] = [];
    const busy: readonly TtyProcessRow[] = [
      ...TABLE,
      { argv: "vim notes.md", pid: 60999, ppid: 60562, state: "S", tty: "ttys003" },
    ];
    const { client, deps } = cmuxFleet({ rows: busy, sent });
    const state = passState({ fleet: memoryFleetPort(), home });

    const standing = await chairStanding({
      accounts: [],
      chair,
      client,
      deps,
      sessionId: CHAIR_SESSION,
      signedOut: new Map(),
      state,
      wall: undefined,
    });

    expect([standing, sent]).toEqual([false, []]);
    expect(state.refusals.map((refusal) => [refusal.code, refusal.message.includes("(not-a-bare-shell)")])).toEqual([
      ["NO_LIVE_SESSION", true],
    ]);
  });
});
