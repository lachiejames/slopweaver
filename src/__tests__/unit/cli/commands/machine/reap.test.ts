import { describe, expect, it } from "vitest";
import type { StoredInteractionSession } from "../../../../../browser/interactionSessionStore.js";
import {
  type MachineReapDeps,
  parseMachineReapArgs,
  runMachineReapWithDeps,
} from "../../../../../cli/commands/machine/reap.js";
import { letGoOfOwnQuietSessions } from "../../../../../cli/commands/machine/reapBrowser.js";
import { unwrapErr } from "../../../../../lib/result.js";
import { parseElapsedRows, parseTopCpuRows } from "../../../../../live/machine/fleetLoad.js";
import type { ProcessRow } from "../../../../../live/standing/processes.js";
import {
  INCIDENT_ETIME_TEXT,
  INCIDENT_PROCESSES,
  INCIDENT_TOP_CPU_TEXT,
} from "../../../live/machine/fleetLoadFixtures.js";
import {
  RUNAWAY_ETIME_TEXT,
  RUNAWAY_PROCESSES,
  RUNAWAY_TOP_CPU_TEXT,
} from "../../../live/machine/runawaySearchFixtures.js";

/** A seam set over the incident snapshot that RECORDS every signal instead of sending one. */
function deps({ signalled }: { signalled: number[] }): MachineReapDeps {
  return {
    browserSessions: () => [],
    cpuRows: () => parseTopCpuRows({ text: INCIDENT_TOP_CPU_TEXT }),
    elapsed: () => parseElapsedRows({ text: INCIDENT_ETIME_TEXT }),
    forgetBrowserSession: () => undefined,
    holdBrowserSession: () => () => undefined,
    kill: ({ pid }) => {
      signalled.push(pid);
      return undefined;
    },
    // The incident snapshot carries no dev server at all, so the stray class is empty over it and these
    // four seams exist only to keep the fixture honest about what the verb now reads.
    cwds: () => new Map<number, string>(),
    listeningPorts: () => new Set<number>(),
    liveBrowserOwners: () => [],
    liveStarterRootPids: () => new Set<number>(),
    liveWorktrees: () => [],
    // Five minutes after every fixture session was last touched: inside its idle expiry.
    nowIso: () => "2026-09-01T00:05:00.000Z",
    processes: () => INCIDENT_PROCESSES,
    releaseBrowser: () => [],
    selfPid: () => 999,
    terminalSlugs: () => new Set<string>(),
    terminate: () => undefined,
  };
}

const daemonRow = ({ name, pid }: { name: string; pid: number }): ProcessRow => ({
  argv: `/node /repo/node_modules/playwright-core/lib/entry/cliDaemon.js ${name} --browser=chrome --extension`,
  pid,
  ppid: 4000,
});

/** One stored session record, opened by `ownerPid`. */
const stored = ({ id, ownerPid }: { id: string; ownerPid: number }): StoredInteractionSession => ({
  observation: null,
  session: {
    clientSession: `slopweaver-${id}`,
    id,
    openedAtIso: "2026-09-01T00:00:00.000Z",
    origins: [],
    owner: { cmuxWorkspace: null, pid: ownerPid, runSlug: null },
    ownerSessionId: `sess-${id}`,
    placement: "background",
    touchedAtIso: "2026-09-01T00:00:00.000Z",
    workspace: `/home/live/browser/sessions/${id}/client`,
  },
});

/**
 * Four sessions over the incident snapshot: `dead-one` and `dead-two` were opened by pids that are gone and
 * each still has its daemon, `no-daemon`'s opener is gone and nothing holds its tab, and `live-one` was opened
 * by pid 5500, a live Claude Code session, a month ago.
 */
const BROWSER_SESSIONS = [
  stored({ id: "dead-one", ownerPid: 7001 }),
  stored({ id: "no-daemon", ownerPid: 7003 }),
  stored({ id: "live-one", ownerPid: 5500 }),
  stored({ id: "dead-two", ownerPid: 7002 }),
];

const BROWSER_PROCESSES: readonly ProcessRow[] = [
  ...INCIDENT_PROCESSES,
  { argv: "/Users/a/.local/bin/claude", pid: 5500, ppid: 4000 },
  daemonRow({ name: "slopweaver-dead-one", pid: 9001 }),
  daemonRow({ name: "slopweaver-dead-two", pid: 9002 }),
  daemonRow({ name: "slopweaver-live-one", pid: 9005 }),
];

/** Every browser effect the reap performed, in order. */
interface BrowserCalls {
  readonly effects: string[];
}

/** The seam set above, holding {@link BROWSER_SESSIONS}, recording each browser effect into `calls`. */
function browserDeps({
  calls,
  release = () => [],
  processes = BROWSER_PROCESSES,
}: {
  calls: BrowserCalls;
  release?: MachineReapDeps["releaseBrowser"];
  processes?: readonly ProcessRow[];
}): MachineReapDeps {
  return {
    ...deps({ signalled: [] }),
    browserSessions: () => BROWSER_SESSIONS,
    forgetBrowserSession: ({ id }) => {
      calls.effects.push(`forget ${id}`);
      return undefined;
    },
    liveBrowserOwners: () => [{ pid: 5500, sessionId: "sess-live-one" }],
    processes: () => processes,
    releaseBrowser: (input) => {
      calls.effects.push(`release ${input.session.id}`);
      return release(input);
    },
    terminate: ({ pid }) => {
      calls.effects.push(`SIGTERM ${String(pid)}`);
      return undefined;
    },
  };
}

const REAP = ["node", "bin", "machine", "reap"];

/** The incident seat reduced to its two selected searches, their tool shells and the live session above them. */
const SEARCH_SEAT: readonly ProcessRow[] = RUNAWAY_PROCESSES.filter((row) =>
  [1, 500, 510, 511, 520, 521].includes(row.pid),
);

/** The recording seam set over {@link SEARCH_SEAT}, with the runaway fixture's cpu and age rows. */
function searchDeps({ signalled }: { signalled: number[] }): MachineReapDeps {
  return {
    ...deps({ signalled }),
    cpuRows: () => parseTopCpuRows({ text: RUNAWAY_TOP_CPU_TEXT }),
    elapsed: () => parseElapsedRows({ text: RUNAWAY_ETIME_TEXT }),
    processes: () => SEARCH_SEAT,
  };
}

describe("parseMachineReapArgs", () => {
  it("refuses a flag it does not carry, naming it", () => {
    const parsed = parseMachineReapArgs({ rest: ["--force"] });
    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed).join(" ")).toContain("--force");
  });
});

describe("runMachineReapWithDeps", () => {
  it("kills every planned pid, deepest first, and exits 0", () => {
    const signalled: number[] = [];
    const code = runMachineReapWithDeps({ argv: ["node", "bin", "machine", "reap"], deps: deps({ signalled }) });
    expect(code).toBe(0);
    expect(signalled).toEqual([302, 300, 301]);
  });

  it("does NOT signal a pid the table no longer carries as the process the plan selected", () => {
    const signalled: number[] = [];
    // The tree's child has exited and pid 302 now belongs to something else entirely.
    const recycled = INCIDENT_PROCESSES.map((row) =>
      row.pid === 302 ? { argv: "/usr/bin/vim notes.txt", pid: 302, ppid: 4242 } : row,
    );
    let reads = 0;
    const seams: MachineReapDeps = {
      ...deps({ signalled }),
      processes: () => {
        reads += 1;
        return reads === 1 ? INCIDENT_PROCESSES : recycled;
      },
    };
    const code = runMachineReapWithDeps({ argv: ["node", "bin", "machine", "reap"], deps: seams });
    expect(code).toBe(0);
    expect(signalled).toEqual([300, 301]);
  });

  it("kills each runaway search alone and leaves its shell and seat", () => {
    const signalled: number[] = [];
    const code = runMachineReapWithDeps({ argv: REAP, deps: searchDeps({ signalled }) });
    expect(code).toBe(0);
    expect(signalled).toEqual([511, 521]);
  });

  it("re-reads the table before EACH search, so a pid reused after the first kill is never signalled", () => {
    const signalled: number[] = [];
    // Search 521 exits while 511 is being killed, and its pid is reused by an unrelated process.
    const reused = SEARCH_SEAT.map((row) =>
      row.pid === 521 ? { argv: "/usr/bin/vim notes.txt", pid: 521, ppid: 4242 } : row,
    );
    const seams: MachineReapDeps = {
      ...searchDeps({ signalled }),
      processes: () => (signalled.includes(511) ? reused : SEARCH_SEAT),
    };
    const code = runMachineReapWithDeps({ argv: REAP, deps: seams });
    expect(code).toBe(0);
    expect(signalled).toEqual([511]);
  });

  it("signals NOTHING under --dry-run", () => {
    const signalled: number[] = [];
    const code = runMachineReapWithDeps({
      argv: ["node", "bin", "machine", "reap", "--dry-run"],
      deps: deps({ signalled }),
    });
    expect(code).toBe(0);
    expect(signalled).toEqual([]);
  });

  it("exits 2 on an unknown flag, having signalled nothing", () => {
    const signalled: number[] = [];
    const code = runMachineReapWithDeps({
      argv: ["node", "bin", "machine", "reap", "--force"],
      deps: deps({ signalled }),
    });
    expect(code).toBe(2);
    expect(signalled).toEqual([]);
  });

  it("reaps NOTHING of any class when the process table cannot be read, and exits 0", () => {
    const signalled: number[] = [];
    const calls: BrowserCalls = { effects: [] };
    const seams: MachineReapDeps = {
      ...browserDeps({ calls }),
      kill: ({ pid }) => {
        signalled.push(pid);
        return undefined;
      },
      processes: () => undefined,
    };
    expect(runMachineReapWithDeps({ argv: REAP, deps: seams })).toBe(0);
    expect(signalled).toEqual([]);
    expect(calls.effects).toEqual([]);
  });

  it("prints the usage and signals nothing for --help", () => {
    const signalled: number[] = [];
    const code = runMachineReapWithDeps({
      argv: ["node", "bin", "machine", "reap", "--help"],
      deps: deps({ signalled }),
    });
    expect(code).toBe(0);
    expect(signalled).toEqual([]);
  });
});

describe("letGoOfOwnQuietSessions — browser open's own sweep", () => {
  const quiet = ({ calls, over = {} }: { calls: BrowserCalls; over?: Partial<MachineReapDeps> }): MachineReapDeps => ({
    ...browserDeps({ calls }),
    nowIso: () => "2026-09-01T00:41:00.000Z",
    ...over,
  });

  it("lets go of ONLY its own opener's quiet session — never a dead opener's, which is the reap's to take", () => {
    const calls: BrowserCalls = { effects: [] };
    const lines = letGoOfOwnQuietSessions({ deps: quiet({ calls }), ownerPid: 5500 });
    expect(calls.effects).toEqual(["release live-one", "forget live-one"]);
    expect(lines).toEqual(["browser open: let go of 1 of this seat's session(s) idle past their 15-minute expiry"]);
  });

  it("does nothing, and reads no process table, while its own session is still in use", () => {
    const calls: BrowserCalls = { effects: [] };
    const seams = { ...browserDeps({ calls }), processes: () => undefined };
    expect(letGoOfOwnQuietSessions({ deps: seams, ownerPid: 5500 })).toEqual([]);
    expect(calls.effects).toEqual([]);
  });

  it("does nothing on a host that records no opener pid", () => {
    const calls: BrowserCalls = { effects: [] };
    expect(letGoOfOwnQuietSessions({ deps: quiet({ calls }), ownerPid: null })).toEqual([]);
    expect(calls.effects).toEqual([]);
  });

  it("says what it left for the reap when the close went unconfirmed", () => {
    const calls: BrowserCalls = { effects: [] };
    const seams = quiet({
      calls,
      over: {
        releaseBrowser: ({ session }) => {
          calls.effects.push(`release ${session.id}`);
          return ["tab-close timed out after 15000 ms"];
        },
      },
    });
    const lines = letGoOfOwnQuietSessions({ deps: seams, ownerPid: 5500 });
    expect(calls.effects).toEqual(["release live-one", "SIGTERM 9005", "forget live-one"]);
    expect(lines).toEqual([
      "browser open: let go of 0 of this seat's session(s) idle past their 15-minute expiry (1 left for the next machine reap — `slopweaver browser sessions` lists them)",
    ]);
  });

  it("lets go of at most three per open, and names the rest as left for the reap", () => {
    const calls: BrowserCalls = { effects: [] };
    const own = ["q1", "q2", "q3", "q4"].map((id) => stored({ id, ownerPid: 5500 }));
    const lines = letGoOfOwnQuietSessions({
      deps: quiet({ calls, over: { browserSessions: () => own } }),
      ownerPid: 5500,
    });
    expect(calls.effects).toEqual(["forget q1", "forget q2", "forget q3"]);
    expect(lines).toEqual([
      "browser open: let go of 3 of this seat's session(s) idle past their 15-minute expiry (1 left for the next machine reap — `slopweaver browser sessions` lists them)",
    ]);
  });

  it("leaves a session whose lock a command holds right now, and says so", () => {
    const calls: BrowserCalls = { effects: [] };
    const lines = letGoOfOwnQuietSessions({
      deps: quiet({ calls, over: { holdBrowserSession: () => undefined } }),
      ownerPid: 5500,
    });
    expect(calls.effects).toEqual([]);
    expect(lines).toEqual([
      "browser open: let go of 0 of this seat's session(s) idle past their 15-minute expiry (1 left for the next machine reap — `slopweaver browser sessions` lists them)",
    ]);
  });

  it("leaves them for the reap when the process table cannot be read", () => {
    const calls: BrowserCalls = { effects: [] };
    const lines = letGoOfOwnQuietSessions({
      deps: quiet({ calls, over: { processes: () => undefined } }),
      ownerPid: 5500,
    });
    expect(calls.effects).toEqual([]);
    expect(lines).toEqual([
      "browser open: the process table could not be read, so 1 quiet session(s) of this seat are left for the next machine reap",
    ]);
  });
});

describe("runMachineReapWithDeps — browser sessions", () => {
  it("closes each dead opener's tab, forgets a record no daemon holds, and never touches the live one", () => {
    const calls: BrowserCalls = { effects: [] };
    expect(runMachineReapWithDeps({ argv: REAP, deps: browserDeps({ calls }) })).toBe(0);
    expect(calls.effects).toEqual([
      "release dead-one",
      "forget dead-one",
      "forget no-daemon",
      "release dead-two",
      "forget dead-two",
    ]);
  });

  it("closes the live opener's tab too once it has sat idle past its expiry", () => {
    const calls: BrowserCalls = { effects: [] };
    const seams: MachineReapDeps = { ...browserDeps({ calls }), nowIso: () => "2026-09-01T00:41:00.000Z" };
    expect(runMachineReapWithDeps({ argv: REAP, deps: seams })).toBe(0);
    expect(calls.effects).toEqual([
      "release dead-one",
      "forget dead-one",
      "forget no-daemon",
      "release live-one",
      "forget live-one",
      "release dead-two",
      "forget dead-two",
    ]);
  });

  it("performs NO browser effect under --dry-run", () => {
    const calls: BrowserCalls = { effects: [] };
    expect(runMachineReapWithDeps({ argv: [...REAP, "--dry-run"], deps: browserDeps({ calls }) })).toBe(0);
    expect(calls.effects).toEqual([]);
  });

  it("on an unconfirmed close: never retries, SIGTERMs the one daemon still carrying it, and defers the rest", () => {
    const calls: BrowserCalls = { effects: [] };
    const seams = browserDeps({ calls, release: () => ["tab-close timed out after 15000 ms"] });
    expect(runMachineReapWithDeps({ argv: REAP, deps: seams })).toBe(0);
    expect(calls.effects).toEqual(["release dead-one", "SIGTERM 9001", "forget dead-one", "forget no-daemon"]);
  });

  it("signals NEITHER daemon when two carry the session whose close went unconfirmed", () => {
    const calls: BrowserCalls = { effects: [] };
    const seams = browserDeps({
      calls,
      processes: [...BROWSER_PROCESSES, daemonRow({ name: "slopweaver-dead-one", pid: 9003 })],
      release: () => ["tab-close timed out after 15000 ms"],
    });
    expect(runMachineReapWithDeps({ argv: REAP, deps: seams })).toBe(0);
    expect(calls.effects).toEqual(["release dead-one", "forget dead-one", "forget no-daemon"]);
  });

  it("signals NEITHER daemon when a second one carrying the session appears only after the close", () => {
    const calls: BrowserCalls = { effects: [] };
    const state = { released: false };
    const later = [...BROWSER_PROCESSES, daemonRow({ name: "slopweaver-dead-one", pid: 9003 })];
    const seams: MachineReapDeps = {
      ...browserDeps({ calls }),
      processes: () => (state.released ? later : BROWSER_PROCESSES),
      releaseBrowser: ({ session }) => {
        calls.effects.push(`release ${session.id}`);
        state.released = true;
        return ["tab-close timed out after 15000 ms"];
      },
    };
    expect(runMachineReapWithDeps({ argv: REAP, deps: seams })).toBe(0);
    expect(calls.effects).toEqual(["release dead-one", "forget dead-one", "forget no-daemon"]);
  });

  it("signals no daemon when a record carrying the same name is opened while the close fails", () => {
    const calls: BrowserCalls = { effects: [] };
    const state = { released: false };
    const newcomer = stored({ id: "dead-one-b", ownerPid: 5500 });
    const sameName = { ...newcomer, session: { ...newcomer.session, clientSession: "slopweaver-dead-one" } };
    const seams: MachineReapDeps = {
      ...browserDeps({ calls }),
      browserSessions: () => (state.released ? [...BROWSER_SESSIONS, sameName] : BROWSER_SESSIONS),
      releaseBrowser: ({ session }) => {
        calls.effects.push(`release ${session.id}`);
        state.released = true;
        return ["tab-close timed out after 15000 ms"];
      },
    };
    expect(runMachineReapWithDeps({ argv: REAP, deps: seams })).toBe(0);
    expect(calls.effects).toEqual(["release dead-one", "forget dead-one", "forget no-daemon"]);
  });

  it("judges each recorded pid by the process table alone, so an unreadable registry changes nothing", () => {
    const calls: BrowserCalls = { effects: [] };
    const seams: MachineReapDeps = { ...browserDeps({ calls }), liveBrowserOwners: () => undefined };
    expect(runMachineReapWithDeps({ argv: REAP, deps: seams })).toBe(0);
    expect(calls.effects).toEqual([
      "release dead-one",
      "forget dead-one",
      "forget no-daemon",
      "release dead-two",
      "forget dead-two",
    ]);
  });
});
