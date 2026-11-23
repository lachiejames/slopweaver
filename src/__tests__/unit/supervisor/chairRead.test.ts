/**
 * The chair read's filesystem half — Claude Code's session registry joined by pid, then each transcript's tail
 * judged — as a real round trip over a throwaway `~/.claude`, carrying the frozen chair transcript.
 */
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { CmuxWorkspaceSummary } from "../../../cmux/client.js";
import { CmuxErrors } from "../../../cmux/errors.js";
import type { CmuxWorkspaceTop } from "../../../cmux/processTree.js";
import { err, ok } from "../../../lib/result.js";
import { SUPERVISOR_WORKSPACE_TITLE } from "../../../live/standing/supervisor.js";
import { type ChairSessionReading, judgeChair } from "../../../supervisor/chairGate.js";
import { FABLE_CHAIR_REQUIREMENT } from "../../../supervisor/chairPolicy.js";
import { readCallerChairSession, readChairThrough } from "../../../supervisor/chairRead.js";
import { type ChairSessionReadings, chairSessionIdsOf, readChairSessions } from "../../../supervisor/chairRecords.js";

/** Every temp `~/.claude` this file minted, removed after each test. */
const minted: string[] = [];

afterEach(() => {
  for (const dir of minted.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/**
 * A throwaway `~/.claude` with the registry files and transcripts the caller names.
 *
 * @param sessions each registered session: its pid, id, and the transcript to copy in when it has one
 * @returns the directory
 */
function claudeHome({
  sessions,
}: {
  sessions: readonly { pid: number; sessionId: string; transcript?: string; procStart?: string }[];
}): string {
  const dir = mkdtempSync(join(tmpdir(), "chair-read-"));
  minted.push(dir);
  mkdirSync(join(dir, "sessions"));
  mkdirSync(join(dir, "projects", "-wt-fresh-supervisor-handoff-9271"), { recursive: true });
  for (const session of sessions) {
    writeFileSync(
      join(dir, "sessions", `${String(session.pid)}.json`),
      JSON.stringify({ pid: session.pid, procStart: session.procStart, sessionId: session.sessionId }),
    );
    if (session.transcript !== undefined) {
      copyFileSync(
        session.transcript,
        join(dir, "projects", "-wt-fresh-supervisor-handoff-9271", `${session.sessionId}.jsonl`),
      );
    }
  }
  return dir;
}

/** The frozen, field-trimmed transcript of the chair a safeguard fallback reseated on Opus. */
const FIXTURE = join(import.meta.dirname, "../../fixtures/supervisor/chair-fallback-a0000023.jsonl");

/** A process start stamp as `TZ=UTC LC_ALL=C ps -o lstart=` prints it and Claude Code records it as `procStart`. */
const STAMP = "Wed Nov  4 10:00:00 2026";

/**
 * A process table in which each named pid runs the process that started at {@link STAMP}.
 *
 * @param pids the running pids
 * @returns the start stamp per pid
 */
function startsOf(...pids: number[]): ReadonlyMap<number, string> {
  return new Map(pids.map((pid) => [pid, STAMP]));
}

describe("readChairSessions", () => {
  it("judges only the registered sessions among the workspace's pids, off Fable for the reseated chair", () => {
    const home = claudeHome({
      sessions: [
        { pid: 111, procStart: STAMP, sessionId: "a0000023-0000-4000-8000-000000000026", transcript: FIXTURE },
        { pid: 999, procStart: STAMP, sessionId: "a-session-in-another-workspace", transcript: FIXTURE },
      ],
    });

    const readings = sessionsOf(
      readChairSessions({ claudeHome: home, pids: [111, 222], starts: startsOf(111, 222, 999) }),
    );

    expect(readings.map((reading) => [reading.pid, reading.sessionId, reading.verdict.kind])).toStrictEqual([
      [111, "a0000023-0000-4000-8000-000000000026", "off-fable"],
    ]);
    expect(readings[0]!.verdict).toMatchObject({ atIso: "2026-09-15T20:58:32.701Z", model: "claude-opus-4-8" });
  });

  it("reads a registered session with no transcript as unread, never as Fable", () => {
    const home = claudeHome({ sessions: [{ pid: 111, procStart: STAMP, sessionId: "no-transcript-here" }] });

    expect(readChairSessions({ claudeHome: home, pids: [111], starts: startsOf(111) })).toStrictEqual({
      kind: "resolved",
      sessions: [
        {
          pid: 111,
          sessionId: "no-transcript-here",
          verdict: { kind: "unreadable", why: "no transcript was found for this session" },
        },
      ],
    });
  });

  it("finds nothing when no registry file carries a workspace pid", () => {
    const home = claudeHome({
      sessions: [{ pid: 999, procStart: STAMP, sessionId: "elsewhere", transcript: FIXTURE }],
    });

    expect(readChairSessions({ claudeHome: home, pids: [111], starts: startsOf(111, 999) })).toStrictEqual({
      kind: "resolved",
      sessions: [],
    });
  });

  it("is unresolved when a registry file on a reported pid will not read, never judging the sibling that did", () => {
    const home = claudeHome({
      sessions: [
        { pid: 111, procStart: STAMP, sessionId: "a0000023-0000-4000-8000-000000000026", transcript: FIXTURE },
      ],
    });
    writeFileSync(join(home, "sessions", "222.json"), "{not json");
    writeFileSync(join(home, "sessions", "333.json"), "{not json either");

    const read = readChairSessions({ claudeHome: home, pids: [111, 222], starts: startsOf(111, 222) });

    expect(read.kind).toBe("unresolved");
    expect(JSON.stringify(read)).toContain("a chair session's registry file would not read (222.json: ");
    expect(JSON.stringify(read)).not.toContain("333.json");
  });

  it("drops a dead session's registry file whose pid a listed shell now runs, so its old transcript never judges the chair", () => {
    const home = claudeHome({
      sessions: [
        {
          pid: 18588,
          procStart: "Mon Nov  2 08:00:00 2026",
          sessionId: "a0000023-0000-4000-8000-000000000026",
          transcript: FIXTURE,
        },
      ],
    });

    expect(readChairSessions({ claudeHome: home, pids: [18527, 18588], starts: startsOf(18527, 18588) })).toStrictEqual(
      { kind: "resolved", sessions: [] },
    );
  });

  it("judges a session on a reported pid with no start stamp unread, never dropping it and never as Fable", () => {
    const home = claudeHome({ sessions: [{ pid: 111, sessionId: "unstamped", transcript: FIXTURE }] });

    expect(readChairSessions({ claudeHome: home, pids: [111], starts: startsOf(111) })).toStrictEqual({
      kind: "resolved",
      sessions: [
        {
          pid: 111,
          sessionId: "unstamped",
          verdict: {
            kind: "unreadable",
            why: "its registry file names no start stamp, so it cannot be bound to the process on its pid",
          },
        },
      ],
    });
  });
});

/**
 * The sessions of a resolved chair read, throwing on an unresolved one so the test fails loudly rather than branching.
 *
 * @param read the chair read
 * @returns its sessions
 */
function sessionsOf(read: ChairSessionReadings): readonly ChairSessionReading[] {
  if (read.kind !== "resolved") {
    throw new Error(`expected a resolved chair read, got: ${read.why}`);
  }
  return read.sessions;
}

/** One cmux workspace, pinned and titled as the supervisor's when the caller says so. */
function workspace({ id, pinned }: { id: string; pinned: boolean }): CmuxWorkspaceSummary {
  return {
    currentDirectory: `/wt/${id}`,
    description: undefined,
    latestConversationMessage: undefined,
    latestSubmittedAtIso: undefined,
    latestSubmittedMessage: undefined,
    pinned,
    selected: false,
    title: SUPERVISOR_WORKSPACE_TITLE,
    windowId: "w1",
    workspaceId: id,
    workspaceRef: `workspace:${id}`,
  };
}

/** A `system.top` reply reporting nothing for the tab: no attributed tree and no listed tty pid. */
const EMPTY_TOP = { surfaces: 1, trees: [], ttys: [], unattributedTtyPids: [] } satisfies CmuxWorkspaceTop;

describe("readChairThrough", () => {
  it("walks the pinned workspace's process tree to the reseated chair's transcript", async () => {
    const home = claudeHome({
      sessions: [
        { pid: 72755, procStart: STAMP, sessionId: "a0000023-0000-4000-8000-000000000026", transcript: FIXTURE },
      ],
    });
    const asked: string[] = [];

    const read = await readChairThrough({
      claudeHome: home,
      readStarts: () => ({ starts: startsOf(72700, 72755) }),
      client: {
        // eslint-disable-next-line @typescript-eslint/require-await -- the seam's contract is async; this fake has nothing to await
        listWorkspaces: async () =>
          ok([workspace({ id: "177", pinned: true }), workspace({ id: "12", pinned: false })]),
        // eslint-disable-next-line @typescript-eslint/require-await -- the seam's contract is async; this fake has nothing to await
        workspaceTop: async ({ workspaceId }) => {
          asked.push(workspaceId);
          return ok({
            surfaces: 1,
            trees: [{ children: [{ children: [], name: "claude", pid: 72755 }], name: "zsh", pid: 72700 }],
            ttys: [],
            unattributedTtyPids: [],
          });
        },
      },
    });

    expect(asked).toStrictEqual(["177"]);
    expect(read).toMatchObject({ kind: "resolved", workspaceCwd: "/wt/177" });
    expect(judgeChair({ read, requirement: FABLE_CHAIR_REQUIREMENT }).kind).toBe("refused");
  });

  it("finds the chair cmux attributes to no tree, among the tab's listed tty pids", async () => {
    // The reply for the pinned chair: `processes: []`, and the tab's login, two shells, the chair's own
    // `claude` and its helper listed in `unattributed_tty_process_pids` instead.
    const home = claudeHome({
      sessions: [
        { pid: 19207, procStart: STAMP, sessionId: "a0000023-0000-4000-8000-000000000026", transcript: FIXTURE },
      ],
    });

    const read = await readChairThrough({
      claudeHome: home,
      readStarts: () => ({ starts: startsOf(18527, 18588, 19205, 19207, 20704) }),
      client: {
        // eslint-disable-next-line @typescript-eslint/require-await -- the seam's contract is async; this fake has nothing to await
        listWorkspaces: async () => ok([workspace({ id: "177", pinned: true })]),
        // eslint-disable-next-line @typescript-eslint/require-await -- the seam's contract is async; this fake has nothing to await
        workspaceTop: async () =>
          ok({ surfaces: 1, trees: [], ttys: [], unattributedTtyPids: [18527, 18588, 19205, 19207, 20704] }),
      },
    });

    expect(read).toMatchObject({
      kind: "resolved",
      sessions: [{ pid: 19207, sessionId: "a0000023-0000-4000-8000-000000000026", verdict: { kind: "off-fable" } }],
      workspaceCwd: "/wt/177",
    });
  });

  it("is unresolved, naming the process table, when the table that binds a session to its pid will not read", async () => {
    const read = await readChairThrough({
      claudeHome: claudeHome({ sessions: [] }),
      client: {
        // eslint-disable-next-line @typescript-eslint/require-await -- the seam's contract is async; this fake has nothing to await
        listWorkspaces: async () => ok([workspace({ id: "177", pinned: true })]),
        // eslint-disable-next-line @typescript-eslint/require-await -- the seam's contract is async; this fake has nothing to await
        workspaceTop: async () => ok({ surfaces: 1, trees: [], ttys: [], unattributedTtyPids: [19207] }),
      },
      readStarts: () => ({ why: "ps timed out" }),
    });

    expect(read).toStrictEqual({
      cause: "process-table-unread",
      kind: "unresolved",
      why: "the process table that binds a session to its pid could not be read (ps timed out)",
    });
    expect(judgeChair({ read, requirement: FABLE_CHAIR_REQUIREMENT }).kind).toBe("refused");
  });

  it("is unresolved, naming why, when no workspace is pinned", async () => {
    const read = await readChairThrough({
      claudeHome: claudeHome({ sessions: [] }),
      readStarts: () => ({ starts: startsOf() }),
      client: {
        // eslint-disable-next-line @typescript-eslint/require-await -- the seam's contract is async; this fake has nothing to await
        listWorkspaces: async () => ok([workspace({ id: "12", pinned: false })]),
        // eslint-disable-next-line @typescript-eslint/require-await -- the seam's contract is async; this fake has nothing to await
        workspaceTop: async () => ok(EMPTY_TOP),
      },
    });

    expect(read.kind).toBe("unresolved");
    expect(judgeChair({ read, requirement: FABLE_CHAIR_REQUIREMENT })).toMatchObject({ kind: "refused" });
  });

  it("is unresolved when cmux cannot list its workspaces or read the pinned tree", async () => {
    const failure = CmuxErrors.malformedReply({ detail: "not json", method: "workspace.list" });
    const home = claudeHome({ sessions: [] });

    const unlisted = await readChairThrough({
      claudeHome: home,
      readStarts: () => ({ starts: startsOf() }),
      client: {
        // eslint-disable-next-line @typescript-eslint/require-await -- the seam's contract is async; this fake has nothing to await
        listWorkspaces: async () => err(failure),
        // eslint-disable-next-line @typescript-eslint/require-await -- the seam's contract is async; this fake has nothing to await
        workspaceTop: async () => ok(EMPTY_TOP),
      },
    });
    const untreed = await readChairThrough({
      claudeHome: home,
      readStarts: () => ({ starts: startsOf() }),
      client: {
        // eslint-disable-next-line @typescript-eslint/require-await -- the seam's contract is async; this fake has nothing to await
        listWorkspaces: async () => ok([workspace({ id: "177", pinned: true })]),
        // eslint-disable-next-line @typescript-eslint/require-await -- the seam's contract is async; this fake has nothing to await
        workspaceTop: async () => err(failure),
      },
    });

    expect(unlisted).toStrictEqual({
      cause: "cmux-error",
      kind: "unresolved",
      why: `cmux workspaces could not be listed (${failure.message})`,
    });
    expect(untreed).toStrictEqual({
      cause: "cmux-error",
      kind: "unresolved",
      why: `the pinned workspace's process tree could not be read (${failure.message})`,
    });
  });

  it("names cmux-unanswered only for silence: a timeout or a socket that will not open", async () => {
    const home = claudeHome({ sessions: [] });
    const silences = [
      CmuxErrors.timedOut({ method: "workspace.list", timeoutMs: 15_000 }),
      CmuxErrors.socketUnavailable({ detail: "ECONNREFUSED", socketPath: "/tmp/cmux.sock" }),
    ];
    const answers = [
      CmuxErrors.callFailed({ cmuxCode: "internal_error", message: "boom", method: "workspace.list" }),
      CmuxErrors.terminalTextUnreadable({ detail: "settling", method: "workspace.list" }),
    ];

    const causes = await Promise.all(
      [...silences, ...answers].map(async (failure) => {
        const read = await readChairThrough({
          claudeHome: home,
          readStarts: () => ({ starts: startsOf() }),
          client: {
            // eslint-disable-next-line @typescript-eslint/require-await -- the seam's contract is async; this fake has nothing to await
            listWorkspaces: async () => err(failure),
            // eslint-disable-next-line @typescript-eslint/require-await -- the seam's contract is async; this fake has nothing to await
            workspaceTop: async () => ok(EMPTY_TOP),
          },
        });
        return read.kind === "unresolved" ? read.cause : read.kind;
      }),
    );

    expect(causes).toStrictEqual(["cmux-unanswered", "cmux-unanswered", "cmux-error", "cmux-error"]);
  });

  it("names no-chair, never cmux, when cmux answered and nothing was pinned", async () => {
    const read = await readChairThrough({
      claudeHome: claudeHome({ sessions: [] }),
      readStarts: () => ({ starts: startsOf() }),
      client: {
        // eslint-disable-next-line @typescript-eslint/require-await -- the seam's contract is async; this fake has nothing to await
        listWorkspaces: async () => ok([workspace({ id: "12", pinned: false })]),
        // eslint-disable-next-line @typescript-eslint/require-await -- the seam's contract is async; this fake has nothing to await
        workspaceTop: async () => ok(EMPTY_TOP),
      },
    });

    expect(read).toMatchObject({ cause: "no-chair", kind: "unresolved" });
  });
});

/** A supervisor-pin record as `cmux pin` writes it. */
const PIN = {
  session: { host: "claude-code", id: "a0000014-0000-4000-8000-000000000015" } as const,
  pinnedAtIso: "2026-10-11T03:00:00.000Z",
  workspaceId: "ws-uuid-936",
  workspaceRef: "workspace:936",
};

describe("readCallerChairSession", () => {
  it("judges the caller's own transcript by its id, with no registry file and no cmux", () => {
    const home = claudeHome({ sessions: [] });
    copyFileSync(
      FIXTURE,
      join(home, "projects", "-wt-fresh-supervisor-handoff-9271", "a0000023-0000-4000-8000-000000000026.jsonl"),
    );

    const reading = readCallerChairSession({
      claudeHome: home,
      pin: { ...PIN, session: { host: "claude-code", id: "a0000023-0000-4000-8000-000000000026" } as const },
      sessionId: "a0000023-0000-4000-8000-000000000026",
    });

    expect(reading.sessionId).toBe("a0000023-0000-4000-8000-000000000026");
    expect(reading.pin).toStrictEqual({ kind: "holder" });
    expect(reading.verdict).toMatchObject({
      atIso: "2026-09-15T20:58:32.701Z",
      kind: "off-fable",
      model: "claude-opus-4-8",
    });
  });

  it("reads a caller with no transcript as unread, never as Fable", () => {
    expect(
      readCallerChairSession({ claudeHome: claudeHome({ sessions: [] }), pin: undefined, sessionId: "nowhere" }),
    ).toStrictEqual({
      pin: { kind: "unrecorded" },
      sessionId: "nowhere",
      verdict: { kind: "unreadable", why: "no transcript was found for this session" },
    });
  });

  it("names the recorded holder when the supervisor-pin record names another session", () => {
    const reading = readCallerChairSession({
      claudeHome: claudeHome({ sessions: [] }),
      pin: PIN,
      sessionId: "a-fable-worker",
    });

    expect(reading.pin).toStrictEqual({
      holderSessionId: "a0000014-0000-4000-8000-000000000015",
      kind: "other",
      workspaceRef: "workspace:936",
    });
  });
});

describe("chairSessionIdsOf", () => {
  it("lists the registered sessions among the workspace's pids by id and pid, reading no transcript", () => {
    const home = claudeHome({
      sessions: [
        { pid: 38858, sessionId: "a0000032" },
        { pid: 11, sessionId: "not-in-the-chair" },
      ],
    });

    expect(chairSessionIdsOf({ claudeHome: home, pids: [38858, 99], starts: startsOf(38858, 99, 11) })).toStrictEqual({
      kind: "resolved",
      sessions: [{ pid: 38858, sessionId: "a0000032" }],
    });
  });

  it("carries each session's recorded process start, so a credential read can be bound to its process", () => {
    const home = claudeHome({
      sessions: [{ pid: 61965, procStart: "Sun Sep 27 00:58:16 2026", sessionId: "4c829e9d" }],
    });

    expect(
      chairSessionIdsOf({
        claudeHome: home,
        pids: [61965],
        starts: new Map([[61965, "Sun Sep 27 00:58:16 2026"]]),
      }),
    ).toStrictEqual({
      kind: "resolved",
      sessions: [{ pid: 61965, procStart: "Sun Sep 27 00:58:16 2026", sessionId: "4c829e9d" }],
    });
  });

  it("drops a dead session's file on a pid a listed shell now runs, so the live chair alone draws the gauge's star", () => {
    const home = claudeHome({
      sessions: [
        { pid: 19207, procStart: STAMP, sessionId: "ba6cdc90" },
        { pid: 18588, procStart: "Mon Nov  2 08:00:00 2026", sessionId: "a-dead-session" },
      ],
    });

    expect(
      chairSessionIdsOf({ claudeHome: home, pids: [18527, 18588, 19207], starts: startsOf(18527, 18588, 19207) }),
    ).toStrictEqual({ kind: "resolved", sessions: [{ pid: 19207, procStart: STAMP, sessionId: "ba6cdc90" }] });
  });

  it("reads the chair unresolved when one of its pids has a registry file that will not parse", () => {
    const home = claudeHome({ sessions: [{ pid: 38858, sessionId: "a0000032" }] });
    writeFileSync(join(home, "sessions", "2.json"), "{not json");
    writeFileSync(join(home, "sessions", "3.json"), "{not json either");

    const read = chairSessionIdsOf({ claudeHome: home, pids: [38858, 2], starts: startsOf(38858, 2) });

    expect(read.kind).toBe("unresolved");
    expect(JSON.stringify(read)).toContain("2.json: ");
    expect(JSON.stringify(read)).not.toContain("3.json");
  });

  it("says an unreadable session registry, never reading it as an empty chair", () => {
    const home = mkdtempSync(join(tmpdir(), "chair-read-"));
    minted.push(home);

    const read = chairSessionIdsOf({ claudeHome: home, pids: [38858], starts: startsOf(38858) });

    expect(read.kind).toBe("unresolved");
    expect(JSON.stringify(read)).toContain("the Claude session registry could not be read");
  });
});
