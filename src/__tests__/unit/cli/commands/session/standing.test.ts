/**
 * `session standing` — the pure fold over the ledger shape, the all-clear predicate, and a real filesystem
 * round trip for the CLI edge (mirrors `run.test.ts`'s
 * `buildSchedulerStatusSnapshot` coverage, which this verb composes with).
 *
 * The tree MEASUREMENT is covered against injected seams in `unit/live/standing/inspect.test.ts`; what is
 * tested here is the verb's own shape and its exit contract.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  buildSessionStandingSnapshot,
  runSessionStanding,
  type SessionStandingSnapshot,
  standingIsClear,
} from "../../../../../cli/commands/session/standing.js";
import { findAnySession, findOpenSession } from "../../../../../cli/commands/session/standingLedger.js";
import type { StandingWorkspaceRead } from "../../../../../cli/commands/session/standingWorkspaces.js";
import { EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import type { ProcessSnapshot, StandingInspectDeps } from "../../../../../live/standing/inspect.js";
import type { ClaudeWatchProcess, ProcessRow } from "../../../../../live/standing/processes.js";
import type { SessionItem } from "../../../../../sessions/session.js";
import { writeSupervisorPin } from "../../../../../sessions/supervisorPinStore.js";
import { FABLE_CHAIR_REQUIREMENT } from "../../../../../supervisor/chairPolicy.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A minimal `SessionItem`, overridable per test. */
function item(over: Partial<SessionItem> = {}): SessionItem {
  return { lastEventIso: "2026-08-22T00:00:00.000Z", sessionKey: "a-doc", status: "open", ...over };
}

/** Build an argv the router would hand a verb: `[node, cli, session, standing, …rest]`. */
function argv({ rest }: { rest: readonly string[] }): readonly string[] {
  return ["node", "slopweaver", "session", "standing", ...rest];
}

/** A fresh, empty state home. */
function home(): string {
  const dir = mkdtempSync(join(tmpdir(), "session-standing-home-"));
  fixtureDirs.push(dir);
  return dir;
}

/** A state home whose supervisor pin records a Claude Code chair, so its pinned chat's Claude tabs are judged. */
function claudePinnedHome(): string {
  const dir = home();
  writeSupervisorPin({
    home: dir,
    record: {
      pinnedAtIso: "2026-09-15T19:00:00.000Z",
      session: { host: "claude-code", id: "a0000023" },
      workspaceId: "WS-PINNED",
      workspaceRef: "workspace:1",
    },
  });
  return dir;
}

/** A snapshot half, overridable per test. */
function half(over: Partial<SessionStandingSnapshot["loop"]> = {}): SessionStandingSnapshot["loop"] {
  return { armId: "a1", cwd: "/wt/x", freshness: undefined, grade: "current", live: true, sessionKey: "k", ...over };
}

/** One running keep-alive watch, decoded. */
function watcher({ pid, waiting = false }: { pid: number; waiting?: boolean }): ClaudeWatchProcess {
  return { cwd: "/wt/keepalive", pid, ppid: 1, waiting };
}

/** The keep-alive half, clear, overridable per test. */
function keepAlive(over: Partial<SessionStandingSnapshot["keepAlive"]> = {}): SessionStandingSnapshot["keepAlive"] {
  return {
    candidates: [watcher({ pid: 4242 })],
    cwd: "/wt/keepalive",
    duplicates: [],
    freshness: undefined,
    grade: "current",
    live: true,
    queued: [],
    state: "watching",
    watchId: "w1",
    why: "keep-alive: live (w1, pid 4242), last tick 12s ago",
    ...over,
  };
}

/** A whole snapshot with both halves clear, overridable per test. */
function snapshot(over: Partial<SessionStandingSnapshot> = {}): SessionStandingSnapshot {
  return {
    keepAlive: keepAlive(),
    loop: half(),
    problems: [],
    supervisor: {
      binPath: "/repo",
      chair: { cause: "no-chair", kind: "unresolved", why: "no pinned supervisor chat is open" },
      chairRequirement: FABLE_CHAIR_REQUIREMENT,
      freshness: undefined,
      grade: "current",
      workspaceCwd: "/wt/sup",
    },
    ...over,
  };
}

describe("findOpenSession", () => {
  it("finds the open item matching the given key", () => {
    const items = [item({ sessionKey: "unrelated" }), item({ sessionKey: "today-loop-doc" })];

    expect(findOpenSession({ items, sessionKey: "today-loop-doc" })?.sessionKey).toBe("today-loop-doc");
  });

  it("ignores a closed session with the matching key", () => {
    const items = [item({ sessionKey: "today-loop-doc", status: "closed" })];

    expect(findOpenSession({ items, sessionKey: "today-loop-doc" })).toBeUndefined();
  });

  it("returns undefined when the key is not tracked at all", () => {
    expect(
      findOpenSession({ items: [item({ sessionKey: "some-other-workstream" })], sessionKey: "today-loop-doc" }),
    ).toBeUndefined();
  });
});

describe("findAnySession", () => {
  it("finds an OPEN item, like findOpenSession does", () => {
    expect(
      findAnySession({ items: [item({ sessionKey: "today-loop-doc" })], sessionKey: "today-loop-doc" })?.sessionKey,
    ).toBe("today-loop-doc");
  });

  it("still finds a CLOSED item — a closed row's worktree is the attribution this needs", () => {
    const items = [item({ cwd: "/wt/loop", sessionKey: "today-loop-doc", status: "closed" })];

    expect(findAnySession({ items, sessionKey: "today-loop-doc" })?.cwd).toBe("/wt/loop");
  });

  it("returns undefined when the key is not tracked at all", () => {
    expect(findAnySession({ items: [item({ sessionKey: "other" })], sessionKey: "today-loop-doc" })).toBeUndefined();
  });
});

describe("standingIsClear", () => {
  it("is clear when both sessions are live and current", () => {
    expect(standingIsClear({ snapshot: snapshot() })).toBe(true);
  });

  it("is clear when a session is merely behind — a few commits is not an alert", () => {
    expect(standingIsClear({ snapshot: snapshot({ loop: half({ grade: "behind" }) }) })).toBe(true);
  });

  it("is NOT clear when a live session is stale", () => {
    expect(standingIsClear({ snapshot: snapshot({ loop: half({ grade: "stale" }) }) })).toBe(false);
  });

  it("is NOT clear when freshness could not be measured — unknown is not a clean bill", () => {
    expect(standingIsClear({ snapshot: snapshot({ loop: half({ grade: undefined }) }) })).toBe(false);
  });

  it("is NOT clear when a session is not live, however current it is", () => {
    expect(standingIsClear({ snapshot: snapshot({ loop: half({ live: false }) }) })).toBe(false);
  });

  it("is NOT clear when the keep-alive half is stale even though the loop is fine", () => {
    const stale = snapshot();

    expect(standingIsClear({ snapshot: { ...stale, keepAlive: { ...stale.keepAlive, grade: "stale" } } })).toBe(false);
  });

  it("is NOT clear when the SUPERVISOR half is stale, though both live sessions are fine", () => {
    const base = snapshot();

    expect(standingIsClear({ snapshot: { ...base, supervisor: { ...base.supervisor, grade: "stale" } } })).toBe(false);
  });

  it("is NOT clear when the supervisor half could not be measured at all", () => {
    const base = snapshot();

    expect(standingIsClear({ snapshot: { ...base, supervisor: { ...base.supervisor, grade: undefined } } })).toBe(
      false,
    );
  });

  it("stays clear when the supervisor is merely behind on paths it does not run", () => {
    const base = snapshot();

    expect(standingIsClear({ snapshot: { ...base, supervisor: { ...base.supervisor, grade: "behind" } } })).toBe(true);
  });

  // Two watches double the credential writers and fight over the one record, however healthy each is. This
  // is where a second start the admission check could not stop becomes visible.
  it("is NOT clear when a second keep-alive is running beside the live one", () => {
    const duplicated = keepAlive({
      candidates: [watcher({ pid: 4242 }), watcher({ pid: 5151 })],
      duplicates: [watcher({ pid: 5151 })],
    });

    expect(standingIsClear({ snapshot: snapshot({ keepAlive: duplicated }) })).toBe(false);
  });

  it("stays clear with a --wait successor queued, since a waiter writes nothing", () => {
    const queued = keepAlive({ queued: [watcher({ pid: 7070, waiting: true })] });

    expect(standingIsClear({ snapshot: snapshot({ keepAlive: queued }) })).toBe(true);
  });

  it("does NOT require a supervisor chat to be open — an absent plugin-dir is the owner's call, not a fault", () => {
    const base = snapshot();

    expect(
      standingIsClear({ snapshot: { ...base, supervisor: { ...base.supervisor, workspaceCwd: undefined } } }),
    ).toBe(true);
  });
});

/**
 * A cmux listing seam that resolves nothing — a plain fake, never a mock.
 *
 * The supervisor half asks cmux for the pinned workspace on EVERY call, unlike the loop half, which asked
 * only when a session key named a cwd. Without this the suite would read the operator's live fleet and
 * publish a supervisor freshness event about it; caught while building the half, when a run against a fresh
 * home printed `published current — the supervisor standing session is current` for the real machine.
 */
// eslint-disable-next-line @typescript-eslint/require-await -- the seam's contract is async; this fake has nothing to await
const noWorkspaces = async (): Promise<StandingWorkspaceRead> => ({
  loopPids: [],
  problems: [],
  supervisorCwd: undefined,
  supervisorPids: [],
  supervisorWorkspaceId: undefined,
});

/** A keep-alive process-table seam holding no process at all — a plain fake, never a mock. */
const noProcesses = (): ProcessSnapshot => ({ kind: "rows", rows: [] });

/** A running watch's node child, as `bin/slopweaver` leaves it in the table. */
function watchRow({ pid }: { pid: number }): ProcessRow {
  return { argv: `node /wt/keepalive/bin/../src/cli/index.ts claude watch --interval 5`, pid, ppid: 1 };
}

/** A git seam reporting every tree current, so a keep-alive candidate's checkout grades without real git. */
const currentTrees: StandingInspectDeps = {
  git: ({ args }) =>
    ({
      "fetch --quiet origin": "",
      "rev-list --count HEAD..origin/main": "0",
      "rev-parse --git-common-dir": "/repo/.git",
      "rev-parse --short HEAD": "abc1234",
    })[args.join(" ")],
  processes: () => [],
};

describe("buildSessionStandingSnapshot — the keep-alive half reconciles against ONE table read", () => {
  it("reads the process table exactly once, for the verdict and the freshness together", async () => {
    let reads = 0;
    await buildSessionStandingSnapshot({
      chairRequirement: FABLE_CHAIR_REQUIREMENT,
      home: home(),
      inspectDeps: currentTrees,
      loopSessionKey: undefined,
      nowMs: 0,
      readKeepAliveProcessSnapshot: () => {
        reads += 1;
        return { kind: "rows", rows: [watchRow({ pid: 5151 })] };
      },
      readWorkspaces: noWorkspaces,
    });

    expect(reads).toBe(1);
  });

  it("reports every running watch structurally, and a second one is not an all-clear", async () => {
    const built = await buildSessionStandingSnapshot({
      chairRequirement: FABLE_CHAIR_REQUIREMENT,
      home: home(),
      inspectDeps: currentTrees,
      loopSessionKey: undefined,
      nowMs: 0,
      readKeepAliveProcessSnapshot: () => ({ kind: "rows", rows: [watchRow({ pid: 5151 }), watchRow({ pid: 6161 })] }),
      readWorkspaces: noWorkspaces,
    });
    const json = JSON.parse(JSON.stringify(built)) as SessionStandingSnapshot;

    expect(built.keepAlive.state).toBe("unrecorded");
    expect(built.keepAlive.live).toBe(true);
    expect(built.keepAlive.grade).toBe("current");
    expect(json.keepAlive.candidates.map((candidate) => candidate.pid)).toStrictEqual([5151, 6161]);
    expect(json.keepAlive.duplicates.map((duplicate) => duplicate.pid)).toStrictEqual([6161]);
    expect(standingIsClear({ snapshot: built })).toBe(false);
  });

  it("grades an unreadable table unmeasured and names why, rather than reading it as no watch", async () => {
    const built = await buildSessionStandingSnapshot({
      chairRequirement: FABLE_CHAIR_REQUIREMENT,
      home: home(),
      loopSessionKey: undefined,
      nowMs: 0,
      readKeepAliveProcessSnapshot: () => ({ kind: "unreadable", problem: "the process table could not be read (ps)" }),
      readWorkspaces: noWorkspaces,
    });

    expect(built.keepAlive.state).toBe("unmeasured");
    expect(built.keepAlive.live).toBe(false);
    expect(built.problems).toContain("the process table could not be read (ps)");
  });
});

// The liveness halves read each standing session's own records; against a fresh home there is no arm and no
// registration, and the keep-alive's table is the empty fake above, so nothing here reaches git or cmux.
describe("buildSessionStandingSnapshot", () => {
  it("reports the loop absent for a fresh home, and says so rather than reporting current", async () => {
    const built = await buildSessionStandingSnapshot({
      chairRequirement: FABLE_CHAIR_REQUIREMENT,
      home: home(),
      loopSessionKey: undefined,
      nowMs: 0,
      readKeepAliveProcessSnapshot: noProcesses,
      readWorkspaces: noWorkspaces,
    });

    expect(built.loop.live).toBe(false);
    expect(built.loop.grade).toBeUndefined();
  });

  it("names each unmeasurable half in its problems rather than leaving it silent", async () => {
    const built = await buildSessionStandingSnapshot({
      chairRequirement: FABLE_CHAIR_REQUIREMENT,
      home: home(),
      loopSessionKey: undefined,
      nowMs: 0,
      readKeepAliveProcessSnapshot: noProcesses,
      readWorkspaces: noWorkspaces,
    });

    expect(built.problems.some((problem) => problem.startsWith("loop freshness:"))).toBe(true);
  });

  it("echoes back a loop key that was never recorded, as attribution rather than as liveness", async () => {
    const built = await buildSessionStandingSnapshot({
      chairRequirement: FABLE_CHAIR_REQUIREMENT,
      home: home(),
      loopSessionKey: "today-loop-doc",
      nowMs: 0,
      readKeepAliveProcessSnapshot: noProcesses,
      readWorkspaces: noWorkspaces,
    });

    expect(built.loop.sessionKey).toBe("today-loop-doc");
    expect(built.loop.cwd).toBeUndefined();
  });
});

describe("runSessionStanding", () => {
  it("prints usage on --help without touching disk", async () => {
    expect(await runSessionStanding(argv({ rest: ["--help"] }))).toBe(EXIT_OK);
  });

  it("rejects a flag it does not know", async () => {
    expect(await runSessionStanding(argv({ rest: ["--nope"] }))).toBe(EXIT_USAGE);
  });

  // The exit-3 path is asserted through the composition rather than through the verb, because the verb has no
  // seam for the cmux listing the supervisor half needs. Calling it here would open the operator's LIVE cmux
  // socket from a unit test — measured while building that half: a fresh-home run printed
  // `published current — the supervisor standing session is current` about the real machine.
  it("exits 3 against a fresh home — neither standing session is live, and nothing is measurable", async () => {
    const built = await buildSessionStandingSnapshot({
      chairRequirement: FABLE_CHAIR_REQUIREMENT,
      home: home(),
      loopSessionKey: undefined,
      nowMs: 0,
      readKeepAliveProcessSnapshot: noProcesses,
      readWorkspaces: noWorkspaces,
    });

    expect(standingIsClear({ snapshot: built })).toBe(false);
    expect(built.supervisor.grade).toBeUndefined();
    expect(built.supervisor.binPath).toBeUndefined();
  });

  it("names the unmeasured main checkout in its problems rather than reporting the supervisor current", async () => {
    const built = await buildSessionStandingSnapshot({
      chairRequirement: FABLE_CHAIR_REQUIREMENT,
      home: home(),
      loopSessionKey: undefined,
      nowMs: 0,
      readKeepAliveProcessSnapshot: noProcesses,
      readWorkspaces: noWorkspaces,
    });

    expect(built.problems.some((problem) => problem.includes("no main checkouts are declared"))).toBe(true);
    expect(built.problems.some((problem) => problem.includes("supervisor freshness: nothing to measure"))).toBe(true);
  });
});

describe("the supervisor half's chair check — which model the pinned chat is really on, every call", () => {
  /** The pinned workspace resolving to one chat whose pids are 111 and 222. */
  // eslint-disable-next-line @typescript-eslint/require-await -- the seam's contract is async; this fake has nothing to await
  const pinnedChat = async (): Promise<StandingWorkspaceRead> => ({
    loopPids: [],
    problems: [],
    supervisorCwd: "/wt/fresh-supervisor-handoff-9271",
    supervisorPids: [111, 222],
    supervisorWorkspaceId: "WS-PINNED",
  });

  it("is NOT clear, and says why, when the pinned chat's newest turn is off Fable", async () => {
    let askedPids: readonly number[] = [];
    const built = await buildSessionStandingSnapshot({
      chairRequirement: FABLE_CHAIR_REQUIREMENT,
      home: claudePinnedHome(),
      inspectDeps: currentTrees,
      loopSessionKey: undefined,
      nowMs: 0,
      readChair: ({ pids }) => {
        askedPids = pids;
        return {
          kind: "resolved",
          sessions: [
            {
              pid: 111,
              sessionId: "a0000023",
              verdict: {
                atIso: "2026-09-15T19:23:30.360Z",
                fallback: undefined,
                kind: "off-fable",
                model: "claude-opus-4-8",
              },
            },
          ],
        };
      },
      readKeepAliveProcessSnapshot: noProcesses,
      readWorkspaces: pinnedChat,
    });

    expect(askedPids).toStrictEqual([111, 222]);
    expect(built.supervisor.chair.kind).toBe("resolved");
    expect(
      standingIsClear({
        snapshot: { ...snapshot(), supervisor: { ...snapshot().supervisor, chair: built.supervisor.chair } },
      }),
    ).toBe(false);
    expect(built.problems).toContain(
      "supervisor chair: 1 of 1 session(s) in the pinned workspace are off Fable, 0 unread",
    );
  });

  it("says why, never an empty chair, when the process table that binds the chair's sessions will not read", async () => {
    const built = await buildSessionStandingSnapshot({
      chairRequirement: FABLE_CHAIR_REQUIREMENT,
      home: claudePinnedHome(),
      inspectDeps: currentTrees,
      loopSessionKey: undefined,
      nowMs: 0,
      readChair: () => ({
        cause: "process-table-unread",
        kind: "unresolved",
        why: "the process table that binds a session to its pid could not be read (ps timed out)",
      }),
      readKeepAliveProcessSnapshot: noProcesses,
      readWorkspaces: pinnedChat,
    });

    expect(built.supervisor.chair).toStrictEqual({
      cause: "process-table-unread",
      kind: "unresolved",
      why: "the process table that binds a session to its pid could not be read (ps timed out)",
    });
    expect(built.problems).toContain(
      "supervisor chair: the chair could not be read: the process table that binds a session to its pid could not be read (ps timed out)",
    );
  });

  it("holds the chair to Opus once one Claude plan stands, so an Opus seat raises no chair problem", async () => {
    const built = await buildSessionStandingSnapshot({
      chairRequirement: { kind: "claude", model: "opus", why: "exactly one Claude plan stands" },
      home: claudePinnedHome(),
      inspectDeps: currentTrees,
      loopSessionKey: undefined,
      nowMs: 0,
      readChair: () => ({
        kind: "resolved",
        sessions: [
          {
            pid: 111,
            sessionId: "a0000023",
            verdict: {
              atIso: "2026-11-21T09:00:00.000Z",
              fallback: undefined,
              kind: "off-fable",
              model: "claude-opus-4-8",
            },
          },
        ],
      }),
      readKeepAliveProcessSnapshot: noProcesses,
      readWorkspaces: pinnedChat,
    });

    expect(built.problems.filter((problem) => problem.startsWith("supervisor chair:"))).toStrictEqual([]);
    expect(
      standingIsClear({
        snapshot: {
          ...snapshot(),
          supervisor: {
            ...snapshot().supervisor,
            chair: built.supervisor.chair,
            chairRequirement: built.supervisor.chairRequirement,
          },
        },
      }),
    ).toBe(true);
  });

  it("stays clear when no supervisor chat is open — whether it is open is the owner's call", () => {
    expect(standingIsClear({ snapshot: snapshot() })).toBe(true);
  });
});
